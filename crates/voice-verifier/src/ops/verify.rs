//! `verify`: one recording of the owner against one typed request, with a
//! signed verdict.
use std::time::Instant;

use serde_json::Value;
use spoken_intent::{confusion_set, render, request_digest, spoken_text_digest};

use super::multisig::{self, Prepared};
use super::request::{known_accounts, typed_request, unsupported, SERVED_NETWORK};
use super::steps::{consume, decode_clip, in_flight, reply, speaker_reply};
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{template_key, MAX_CONTACTS, NEAR_AI_API_KEY_ENV, VERDICT_TTL_MS};
use crate::digest::b64u;
use crate::embedding::{similarity_milli, speaker_passes};
use crate::host::Host;
use crate::input::VerifyInput;
use crate::output::{
    fit_heard, short, sign_verdict, MultisigOpening, Outcome, Reason, Stages, Verdict, VerifyOutput,
};
use crate::policy::{self, Decision};
use crate::speaker_client::service_request;
use crate::template::{model_sha256, TemplateRecord};
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::{check_words, words_pass};

/// One verify run. The output JSON stays below
/// [`MAX_OUTPUT_BYTES`](crate::config::MAX_OUTPUT_BYTES).
pub(super) fn verify(value: Value, host: &mut dyn Host, pins: &Pins) -> VerifyOutput {
    let started = Instant::now();
    let mut verdict = Verdict::new();
    let mut ms = Stages::default();
    let mut opening = None;
    let (policy_text, detail) = match verify_steps(value, host, pins, &mut verdict, &mut ms, &mut opening) {
        Ok(Decision::Allow) => {
            verdict.outcome = Outcome::Accept;
            verdict.reason = None;
            (None, None)
        }
        Ok(Decision::StepUp(rule)) => {
            verdict.outcome = Outcome::StepUp;
            verdict.reason = None;
            verdict.policy_rule = Some(rule.id.to_string());
            (Some(rule.text), None)
        }
        Err(refusal) => {
            verdict.outcome = Outcome::Refuse;
            verdict.reason = Some(refusal.reason);
            opening = None;
            (None, refusal.detail)
        }
    };
    finish(verdict, ms, policy_text, detail, opening, host, started)
}

/// The checks in order. Each one fills the verdict fields that it knows, so
/// a refusal keeps the fields from before it. A multisig accept also fills
/// `opening`.
fn verify_steps(
    value: Value,
    host: &mut dyn Host,
    pins: &Pins,
    verdict: &mut Verdict,
    ms: &mut Stages,
    opening: &mut Option<MultisigOpening>,
) -> Result<Decision, Refusal> {
    let started = Instant::now();
    let input: VerifyInput = serde_json::from_value(value).map_err(unsupported)?;
    if input.op != "verify" || input.contacts.len() > MAX_CONTACTS {
        return Err(Reason::Unsupported.into());
    }
    // 1. The request, as the Wallet builds it, or a multisig request with
    //    a new salt or with the stored proposal. For a recalled proposal
    //    the spoken-text digest waits for the accept: it would let the
    //    member test guesses offline.
    let prepared: Option<Prepared> = if input.request.is_multisig() {
        Some(ms.time("multisig", || multisig::prepare(host, &input.owner, &input.request, SERVED_NETWORK))?)
    } else {
        None
    };
    let recalled = prepared.as_ref().is_some_and(|ready| ready.recalled);
    let request = match &prepared {
        Some(ready) => ready.request.clone(),
        None => typed_request(&input.owner, &input.request)?,
    };
    let rendered = render(&request);
    let text_digest = b64u(&spoken_text_digest(&rendered));
    verdict.request_digest = Some(b64u(&request_digest(&request)));
    if !recalled {
        verdict.spoken_text_digest = Some(text_digest.clone());
    }
    let contacts = known_accounts(&input.contacts, &request)?;

    // 2. The audio.
    let clip = decode_clip(&input.audio_wav_b64)?;
    let digest_b64u = b64u(&clip.digest);
    verdict.audio_digest = Some(digest_b64u.clone());
    if !energy_gate(&clip.pcm).passes() {
        return Err(Reason::Quality.into());
    }
    ms.since("decode", started);

    // 3. The speaker service and NEAR AI, at the same time. The bodies go
    //    out now; the responses are read after the storage calls.
    let Some(api_key) =
        host.secret(NEAR_AI_API_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty())
    else {
        return Err(Refusal::new(Reason::TranscriberUnavailable, "transcriber: no_api_key"));
    };
    let nonce = host.random32().map_err(|_| Reason::SpeakerUnavailable)?;
    let requests = vec![service_request(&clip.wav, &nonce), transcription_request(&api_key, &clip.wav)];

    // 4. The template and the used-audio mark, while the requests are in
    //    flight. A refusal here drops them.
    let (record, results) =
        in_flight(host, ms, requests, |host, ms| verify_storage(host, &input.owner, &digest_b64u, ms))?;
    if let Some(timed) = results.first() {
        ms.record("speaker", timed.ms);
    }
    if let Some(timed) = results.get(1) {
        ms.record("transcribe", timed.ms);
    }

    // 5. Speaker.
    let speaker = speaker_reply(results.first(), &clip, &nonce, pins)?;
    if let Some(model_ms) = speaker.model_ms {
        ms.record("redimnet", model_ms);
    }
    let score = similarity_milli(&speaker.embedding, &record.template);
    verdict.speaker_score_milli = Some(score);
    if !speaker_passes(score) {
        return Err(Reason::Speaker.into());
    }
    if let Some(ready) = &prepared {
        ms.time("voices", || multisig::check_other_voices(host, ready, &speaker.embedding))?;
    }

    // 6. The transcript.
    let transcript = reply(results.get(1), "transcriber", Reason::TranscriberUnavailable, parse_reply)?;

    // 7. Words: the heard tokens must equal the rendered tokens (a note
    //    summary may differ by one word, see `words_pass`).
    let confusions = confusion_set(&request, &contacts);
    let check = check_words(&transcript, &contacts, &rendered.spoken, &confusions);
    let passed = words_pass(&request, &check, rendered.spoken.len());
    verdict.heard = Some(check.heard);
    if !passed {
        if let Some(ready) = prepared.as_ref().filter(|ready| ready.recalled) {
            multisig::count_try(host, ready)?;
        } else {
            verdict.word_margin_milli = check.margin_milli;
        }
        return Err(Reason::Words.into());
    }
    verdict.word_margin_milli = check.margin_milli;
    verdict.spoken_text_digest = Some(text_digest);

    // 8. The policy step, after the deterministic checks. It can only
    //    tighten an accept into a step-up.
    let decision = ms.time("policy", || policy::decide(&request));

    // 9. A multisig accept: keep a new proposal, and count the voice.
    if let (Decision::Allow, Some(ready)) = (&decision, &prepared) {
        *opening = ms.time("record", || multisig::record_accept(host, ready))?;
    }
    Ok(decision)
}

/// The owner's template for the pinned model, then the used-audio mark.
///
/// The mark is written here, during the requests, and not after the decision:
/// it is off the critical path, and one atomic write replaces a read and a
/// later write. So a refusal or a service outage also uses up the recording.
/// The Wallet records new audio for each try. An owner without a template
/// uses up nothing.
fn verify_storage(
    host: &mut dyn Host,
    owner: &str,
    digest_b64u: &str,
    ms: &mut Stages,
) -> Result<TemplateRecord, Reason> {
    let record = match host.storage_get(&template_key(owner)) {
        Ok(Some(bytes)) => TemplateRecord::decode(&bytes).ok_or(Reason::TemplateMissing)?,
        Ok(None) => return Err(Reason::TemplateMissing),
        Err(_) => return Err(Reason::Storage),
    };
    if record.model_sha256 != model_sha256() {
        return Err(Reason::TemplateMissing);
    }
    // A response that came during the template read gets its own time.
    host.post_poll();
    ms.time("mark", || consume(host, digest_b64u))?;
    Ok(record)
}

/// Sets the expiry, fits the output below the size limit, then signs the
/// verdict.
fn finish(
    mut verdict: Verdict,
    mut ms: Stages,
    policy_text: Option<&'static str>,
    detail: Option<String>,
    opening: Option<MultisigOpening>,
    host: &mut dyn Host,
    started: Instant,
) -> VerifyOutput {
    verdict.expires_at_ms = host.now_ms().saturating_add(VERDICT_TTL_MS);
    if opening.is_some() {
        // The stage times make room for the commitment and the salt.
        ms = Stages::default();
    }
    let verdict_json = fit_heard(verdict, policy_text, &ms, detail.as_deref(), opening.as_ref());
    let signed = ms.time("sign", || sign_verdict(host, &verdict_json));
    ms.since("total", started);
    let mut output = match signed {
        Ok(signed) => VerifyOutput::new(verdict_json, Some(signed), policy_text, ms, detail),
        Err(error) => {
            return VerifyOutput::new(verdict_json, None, policy_text, ms, Some(short(&format!("sign: {error}"))))
        }
    };
    output.multisig = opening;
    output
}
