//! `detect`: one recording of the owner and a list of intents. The output
//! is a signed proposal: the voice passed the speaker check, these are the
//! heard words, and a chat model named this intent of the list for them.
//!
//! This is the weakest operation. No sentence is expected, and two models
//! make the result: the speech-to-text model and the chat model. Neither
//! signs its part. So the result must not approve an action with value by
//! itself: the application shows the proposed action and asks for a
//! confirmation with `verify` or `select`.
use std::time::Instant;

use serde_json::Value;

use super::request::{unsupported, Owner};
use super::steps::{decode_clip, in_flight, local_embedding, reply, speaker_reply};
use super::verify::verify_storage;
use super::whisper::{api_key, words_reply, words_request};
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{MAX_INTENT_TEXT_BYTES, MAX_SLOTS_JSON_BYTES, NEAR_AI_CHAT_MODEL, VERDICT_TTL_MS};
use crate::digest::b64u;
use crate::embedding::{similarity_milli, speaker_passes};
use crate::host::Host;
use crate::input::DetectInput;
use crate::intent::{chat_request, intents_digest, intents_valid, parse_proposal};
use crate::output::{short, DetectOutput, IntentResult, Outcome, Reason, Stages};
use crate::speaker_client::service_request;
use crate::words::{cut_at, printable};

/// One detect run.
pub(super) fn detect(value: Value, host: &mut dyn Host, pins: &Pins) -> DetectOutput {
    let started = Instant::now();
    let mut result = IntentResult::new();
    let mut ms = Stages::default();
    let detail = match detect_steps(value, host, pins, &mut result, &mut ms) {
        Ok(()) => {
            result.outcome = Outcome::Accept;
            result.reason = None;
            None
        }
        Err(refusal) => {
            result.outcome = Outcome::Refuse;
            result.reason = Some(refusal.reason);
            result.intent = None;
            result.slots = None;
            refusal.detail
        }
    };
    result.expires_at_ms = host.now_ms().saturating_add(VERDICT_TTL_MS);
    // The signed result is long. The output keeps only two stage times, so
    // that it stays below the size limit.
    let mut kept = Stages::default();
    kept.record("detect", ms.get("detect"));
    let mut output = DetectOutput::signed(host, &result, kept, detail);
    output.ms.since("total", started);
    output
}

fn detect_steps(
    value: Value,
    host: &mut dyn Host,
    pins: &Pins,
    result: &mut IntentResult,
    ms: &mut Stages,
) -> Result<(), Refusal> {
    let input: DetectInput = serde_json::from_value(value).map_err(unsupported)?;
    if input.op != "detect" || !intents_valid(&input.intents) {
        return Err(Reason::Unsupported.into());
    }
    let owner = Owner::parse(&input.owner)?;
    result.owner = Some(owner.as_str().to_string());
    result.intents_digest = Some(b64u(&intents_digest(&input.intents)));

    // The audio.
    let clip = decode_clip(host, "detect", &input.owner, &input.audio_wav_b64, &input.audio_sealed_b64)?;
    let digest_b64u = b64u(&clip.digest);
    result.audio_digest = Some(digest_b64u.clone());
    if !energy_gate(&clip.pcm).passes() {
        return Err(Reason::Quality.into());
    }

    // The speaker and the words, as in `transcribe`.
    let api_key = api_key(host)?;
    let nonce = host.random32().map_err(|_| Reason::SpeakerUnavailable)?;
    let mut requests = Vec::with_capacity(2);
    if !pins.local_speaker {
        requests.push(service_request(&clip.wav, &nonce));
    }
    let words_at = requests.len();
    let (words_post, words) = words_request(host, ms, &api_key, &clip.wav)?;
    requests.push(words_post);
    let local = [&clip];
    let flight = in_flight(host, ms, requests, pins.local_speaker.then_some(&local[..]), |host, ms| {
        verify_storage(host, owner.as_str(), &digest_b64u, ms)
    })?;
    let (record, results) = (flight.value, flight.results);
    let embedding = if pins.local_speaker {
        local_embedding(flight.local.as_ref(), 0)?
    } else {
        speaker_reply(results.first(), &clip, &nonce, pins)?.embedding
    };
    let score = similarity_milli(&embedding, &record.template);
    result.speaker_score_milli = Some(score);
    if !speaker_passes(score) {
        return Err(Reason::Speaker.into());
    }
    let heard = words_reply(host, results.get(words_at), &words)?;
    let text = cut_at(&printable(&heard), MAX_INTENT_TEXT_BYTES);
    if text.is_empty() {
        return Err(Reason::Words.into());
    }
    result.text = Some(text.clone());

    // The chat model, only after the speaker passed: a stranger gets no
    // model call.
    let asked = Instant::now();
    host.post_start(vec![chat_request(&api_key, &input.intents, &text)]);
    let answers = host.post_wait();
    ms.since("detect", asked);
    let proposal = reply(answers.first(), "detector", Reason::DetectorUnavailable, |status, body| {
        parse_proposal(status, body, &input.intents, &text)
    })?;
    result.model = Some(NEAR_AI_CHAT_MODEL.to_string());
    result.intent = proposal.intent;
    if result.intent.is_some() {
        let fits = serde_json::to_string(&proposal.slots).is_ok_and(|json| json.len() <= MAX_SLOTS_JSON_BYTES);
        if !fits {
            return Err(Refusal::new(Reason::DetectorUnavailable, short("detector: slots_too_long")));
        }
        result.slots = Some(proposal.slots);
    }
    Ok(())
}
