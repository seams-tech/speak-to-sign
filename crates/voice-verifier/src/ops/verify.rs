//! `verify`: one recording of the owner against one typed request, with a
//! signed verdict.
use std::time::Instant;

use serde_json::Value;
use spoken_intent::{confusion_set, render, request_digest, spoken_text_digest};

use super::request::{known_accounts, typed_request, unsupported};
use super::steps::{consume, decode_clip, in_flight, reply, speaker_reply};
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{
    template_key, MAX_CONTACTS, MAX_HEARD_BYTES, MAX_OUTPUT_BYTES, NEAR_AI_API_KEY_ENV, VERDICT_TTL_MS,
};
use crate::digest::{b64, b64u, near_ed25519_key};
use crate::host::Host;
use crate::input::VerifyInput;
use crate::output::{
    short, verdict_json, verdict_message, Outcome, Reason, Stages, Verdict, VerifyOutput, VERIFY_OUTPUT_KIND,
};
use crate::policy::{self, Decision};
use crate::speaker::{model_sha256, service_request, similarity_milli, speaker_passes, TemplateRecord};
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::{check_words, cut_at, words_pass};

/// One verify run. The output JSON stays below [`MAX_OUTPUT_BYTES`].
pub(super) fn verify(value: Value, host: &mut dyn Host, pins: &Pins) -> VerifyOutput {
    let started = Instant::now();
    let mut verdict = Verdict::new();
    let mut ms = Stages::default();
    let (policy_text, detail) = match verify_steps(value, host, pins, &mut verdict, &mut ms) {
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
            (None, refusal.detail)
        }
    };
    finish(verdict, ms, policy_text, detail, host, started)
}

/// The checks in order. Each one fills the verdict fields that it knows, so
/// a refusal keeps the fields from before it.
fn verify_steps(
    value: Value,
    host: &mut dyn Host,
    pins: &Pins,
    verdict: &mut Verdict,
    ms: &mut Stages,
) -> Result<Decision, Refusal> {
    let started = Instant::now();
    let input: VerifyInput = serde_json::from_value(value).map_err(unsupported)?;
    if input.op != "verify" || input.contacts.len() > MAX_CONTACTS {
        return Err(Reason::Unsupported.into());
    }
    // 1. The request, as the Wallet builds it.
    let request = typed_request(&input.owner, &input.request)?;
    let rendered = render(&request);
    verdict.request_digest = Some(b64u(&request_digest(&request)));
    verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(&rendered)));
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

    // 6. The transcript.
    let transcript = reply(results.get(1), "transcriber", Reason::TranscriberUnavailable, parse_reply)?;

    // 7. Words: the heard tokens must equal the rendered tokens (a note
    //    summary may differ by one word, see `words_pass`).
    let confusions = confusion_set(&request, &contacts);
    let check = check_words(&transcript, &contacts, &rendered.spoken, &confusions);
    let passed = words_pass(&request, &check, rendered.spoken.len());
    verdict.heard = Some(check.heard);
    verdict.word_margin_milli = check.margin_milli;
    if !passed {
        return Err(Reason::Words.into());
    }

    // 8. The policy step, after the deterministic checks. It can only
    //    tighten an accept into a step-up.
    Ok(ms.time("policy", || policy::decide(&request)))
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

/// Sets the expiry, fits the output below [`MAX_OUTPUT_BYTES`] (by a
/// shorter `heard`, which is part of the signed bytes), then signs the
/// verdict.
fn finish(
    mut verdict: Verdict,
    mut ms: Stages,
    policy_text: Option<&'static str>,
    mut detail: Option<String>,
    host: &mut dyn Host,
    started: Instant,
) -> VerifyOutput {
    verdict.expires_at_ms = host.now_ms().saturating_add(VERDICT_TTL_MS);
    let heard = verdict.heard.take();
    let mut verdict_text = String::new();
    for cap in [MAX_HEARD_BYTES, 120, 60, 0] {
        verdict.heard = heard.as_ref().filter(|_| cap > 0).map(|text| cut_at(text, cap));
        verdict_text = verdict_json(&verdict);
        let sized = VerifyOutput {
            kind: VERIFY_OUTPUT_KIND,
            verdict_json: verdict_text.clone(),
            signature_b64: Some("A".repeat(88)),
            public_key: Some(format!("ed25519:{}", "1".repeat(44))),
            policy_text,
            ms: ms.clone(),
            detail: detail.clone(),
        };
        // Room for the `sign` and `total` stage times.
        if serde_json::to_vec(&sized).expect("serializes").len() + 48 < MAX_OUTPUT_BYTES {
            break;
        }
    }

    let signing = Instant::now();
    let message = verdict_message(verdict_text.as_bytes());
    let signed = host.sign(&message).and_then(|signature| {
        let public_key = host.public_key()?;
        if signature.len() != 64 || public_key.len() != 32 {
            return Err("length".to_string());
        }
        Ok((b64(&signature), near_ed25519_key(&public_key)))
    });
    ms.since("sign", signing);
    ms.since("total", started);
    let (signature_b64, public_key) = match signed {
        Ok((signature, key)) => (Some(signature), Some(key)),
        Err(error) => {
            detail = Some(short(&format!("sign: {error}")));
            (None, None)
        }
    };
    VerifyOutput {
        kind: VERIFY_OUTPUT_KIND,
        verdict_json: verdict_text,
        signature_b64,
        public_key,
        policy_text,
        ms,
        detail,
    }
}
