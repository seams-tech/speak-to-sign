//! `select`: one recording of the owner against 2 to 16 candidate requests.
//! The verdict is for the one request whose sentence the owner said.
//!
//! This is intent detection for a closed set, with no language model: the
//! application sends the actions that are possible now, and the word check
//! of `verify` runs for each one. The word rule is stricter than in
//! `verify`: the heard words must equal the sentence of exactly one
//! candidate. No summary passes with a changed word, because here the other
//! candidates are the near misses.
//!
//! The verdict is a normal verdict (`seams_voice_signed_verdict_v2`) for the
//! selected request. A checker computes the request digest of the candidate
//! at `selected` and checks the verdict as it checks one of `verify`.
use std::time::Instant;

use serde_json::Value;
use spoken_intent::{confusion_set, render, request_digest, spoken_text_digest, RenderedIntentV1, SpokenRequestV1};

use super::request::{known_accounts, typed_request, unsupported};
use super::steps::{decode_clip, in_flight, local_embedding, reply, speaker_reply};
use super::verify::{finish, verify_storage};
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{MAX_CONTACTS, MAX_SELECT_REQUESTS, NEAR_AI_API_KEY_ENV};
use crate::digest::b64u;
use crate::embedding::{similarity_milli, speaker_passes};
use crate::host::Host;
use crate::input::SelectInput;
use crate::output::{Outcome, Reason, Stages, Verdict, VerifyOutput};
use crate::policy::{self, Decision};
use crate::speaker_client::service_request;
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::check_words;

/// One select run. The output is the output of `verify`, with `selected`.
pub(super) fn select(value: Value, host: &mut dyn Host, pins: &Pins) -> VerifyOutput {
    let started = Instant::now();
    let mut verdict = Verdict::new();
    let mut ms = Stages::default();
    let mut selected = None;
    let (policy_text, detail) = match select_steps(value, host, pins, &mut verdict, &mut ms, &mut selected) {
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
            selected = None;
            (None, refusal.detail)
        }
    };
    finish(verdict, ms, policy_text, detail, None, selected, host, started)
}

fn select_steps(
    value: Value,
    host: &mut dyn Host,
    pins: &Pins,
    verdict: &mut Verdict,
    ms: &mut Stages,
    selected: &mut Option<usize>,
) -> Result<Decision, Refusal> {
    let started = Instant::now();
    let input: SelectInput = serde_json::from_value(value).map_err(unsupported)?;
    if input.op != "select"
        || input.contacts.len() > MAX_CONTACTS
        || !(2..=MAX_SELECT_REQUESTS).contains(&input.requests.len())
        || input.requests.iter().any(|request| request.is_multisig())
    {
        return Err(Reason::Unsupported.into());
    }
    // 1. The candidates. Two candidates with one sentence cannot be told
    //    apart by voice.
    let mut candidates: Vec<(SpokenRequestV1, RenderedIntentV1)> = Vec::with_capacity(input.requests.len());
    for request in &input.requests {
        let request = typed_request(&input.owner, request)?;
        let rendered = render(&request);
        if candidates.iter().any(|(_, other)| other.spoken_text == rendered.spoken_text) {
            return Err(Refusal::new(Reason::Unsupported, "select: same_sentence"));
        }
        candidates.push((request, rendered));
    }

    // 2. The audio.
    let clip = decode_clip(host, "select", &input.owner, &input.audio_wav_b64, &input.audio_sealed_b64)?;
    let digest_b64u = b64u(&clip.digest);
    verdict.audio_digest = Some(digest_b64u.clone());
    if !energy_gate(&clip.pcm).passes() {
        return Err(Reason::Quality.into());
    }
    ms.since("decode", started);

    // 3. and 4. The requests and the storage calls, as in `verify`.
    let Some(api_key) =
        host.secret(NEAR_AI_API_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty())
    else {
        return Err(Refusal::new(Reason::TranscriberUnavailable, "transcriber: no_api_key"));
    };
    let nonce = host.random32().map_err(|_| Reason::SpeakerUnavailable)?;
    let mut requests = Vec::with_capacity(2);
    if !pins.local_speaker {
        requests.push(service_request(&clip.wav, &nonce));
    }
    let words_at = requests.len();
    requests.push(transcription_request(&api_key, &clip.wav));
    let local = [&clip];
    let flight = in_flight(host, ms, requests, pins.local_speaker.then_some(&local[..]), |host, ms| {
        verify_storage(host, &input.owner, &digest_b64u, ms)
    })?;
    let (record, results) = (flight.value, flight.results);
    if let Some(timed) = results.first().filter(|_| !pins.local_speaker) {
        ms.record("speaker", timed.ms);
    }
    if let Some(timed) = results.get(words_at) {
        ms.record("transcribe", timed.ms);
    }

    // 5. Speaker.
    let embedding = if pins.local_speaker {
        local_embedding(flight.local.as_ref(), 0)?
    } else {
        let speaker = speaker_reply(results.first(), &clip, &nonce, pins)?;
        if let Some(model_ms) = speaker.model_ms {
            ms.record("redimnet", model_ms);
        }
        speaker.embedding
    };
    let score = similarity_milli(&embedding, &record.template);
    verdict.speaker_score_milli = Some(score);
    if !speaker_passes(score) {
        return Err(Reason::Speaker.into());
    }

    // 6. The transcript.
    let transcript = reply(results.get(words_at), "transcriber", Reason::TranscriberUnavailable, parse_reply)?;

    // 7. Words: the heard tokens must equal the rendered tokens of exactly
    //    one candidate.
    let mut said = Vec::new();
    for (index, (request, rendered)) in candidates.iter().enumerate() {
        let contacts = known_accounts(&input.contacts, request, false)?;
        let check = check_words(&transcript, &contacts, &rendered.spoken, &confusion_set(request, &contacts));
        if index == 0 {
            verdict.heard = Some(check.heard.clone());
        }
        if check.matched {
            said.push((index, check));
        }
    }
    let (index, check) = match said.len() {
        1 => said.remove(0),
        0 => return Err(Reason::Words.into()),
        _ => return Err(Refusal::new(Reason::Words, "select: ambiguous")),
    };
    let (request, rendered) = &candidates[index];
    verdict.request_digest = Some(b64u(&request_digest(request)));
    verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(rendered)));
    verdict.heard = Some(check.heard);
    verdict.word_margin_milli = check.margin_milli;
    *selected = Some(index);

    // 8. The policy step, for the selected request.
    Ok(ms.time("policy", || policy::decide(request)))
}
