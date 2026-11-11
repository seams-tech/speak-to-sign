//! `transcribe`: one recording of the owner, with no request. The output is
//! a signed transcript: the voice passed the speaker check for this owner,
//! and these are the words that the speech-to-text model heard.
//!
//! This is weaker than `verify` and `select`. No sentence is expected, so
//! no word check and no near-miss check exists: a wrong word of the model is
//! a wrong word of the transcript. The signed object is not a verdict
//! (another `kind`, another signing prefix), so a checker of verdicts never
//! takes a transcript as an approval of a request.
use std::time::Instant;

use serde_json::Value;

use super::request::{unsupported, Owner};
use super::steps::{decode_clip, in_flight, local_embedding, reply, speaker_reply};
use super::verify::verify_storage;
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{MAX_TRANSCRIPT_BYTES, NEAR_AI_API_KEY_ENV, VERDICT_TTL_MS};
use crate::digest::b64u;
use crate::embedding::{similarity_milli, speaker_passes};
use crate::host::Host;
use crate::input::TranscribeInput;
use crate::output::{Outcome, Reason, Stages, TranscribeOutput, Transcript};
use crate::speaker_client::service_request;
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::{cut_at, printable};

/// One transcribe run.
pub(super) fn transcribe(value: Value, host: &mut dyn Host, pins: &Pins) -> TranscribeOutput {
    let started = Instant::now();
    let mut transcript = Transcript::new();
    let mut ms = Stages::default();
    let detail = match transcribe_steps(value, host, pins, &mut transcript, &mut ms) {
        Ok(()) => {
            transcript.outcome = Outcome::Accept;
            transcript.reason = None;
            None
        }
        Err(refusal) => {
            transcript.outcome = Outcome::Refuse;
            transcript.reason = Some(refusal.reason);
            transcript.text = None;
            refusal.detail
        }
    };
    transcript.expires_at_ms = host.now_ms().saturating_add(VERDICT_TTL_MS);
    let mut output = TranscribeOutput::signed(host, &transcript, ms, detail);
    output.ms.since("total", started);
    output
}

fn transcribe_steps(
    value: Value,
    host: &mut dyn Host,
    pins: &Pins,
    transcript: &mut Transcript,
    ms: &mut Stages,
) -> Result<(), Refusal> {
    let started = Instant::now();
    let input: TranscribeInput = serde_json::from_value(value).map_err(unsupported)?;
    if input.op != "transcribe" {
        return Err(Reason::Unsupported.into());
    }
    let owner = Owner::parse(&input.owner)?;
    transcript.owner = Some(owner.as_str().to_string());

    // The audio.
    let clip = decode_clip(host, "transcribe", &input.owner, &input.audio_wav_b64, &input.audio_sealed_b64)?;
    let digest_b64u = b64u(&clip.digest);
    transcript.audio_digest = Some(digest_b64u.clone());
    if !energy_gate(&clip.pcm).passes() {
        return Err(Reason::Quality.into());
    }
    ms.since("decode", started);

    // The requests and the storage calls, as in `verify`.
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
        verify_storage(host, owner.as_str(), &digest_b64u, ms)
    })?;
    let (record, results) = (flight.value, flight.results);
    if let Some(timed) = results.first().filter(|_| !pins.local_speaker) {
        ms.record("speaker", timed.ms);
    }
    if let Some(timed) = results.get(words_at) {
        ms.record("transcribe", timed.ms);
    }

    // The speaker.
    let embedding = if pins.local_speaker {
        local_embedding(flight.local.as_ref(), 0)?
    } else {
        speaker_reply(results.first(), &clip, &nonce, pins)?.embedding
    };
    let score = similarity_milli(&embedding, &record.template);
    transcript.speaker_score_milli = Some(score);
    if !speaker_passes(score) {
        return Err(Reason::Speaker.into());
    }

    // The words. No text is a refusal: a signed empty transcript says nothing.
    let heard = reply(results.get(words_at), "transcriber", Reason::TranscriberUnavailable, parse_reply)?;
    let text = cut_at(&printable(&heard), MAX_TRANSCRIPT_BYTES);
    if text.is_empty() {
        return Err(Reason::Words.into());
    }
    transcript.text = Some(text);
    Ok(())
}
