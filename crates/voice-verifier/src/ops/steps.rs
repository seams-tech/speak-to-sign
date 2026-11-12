//! The steps that `enroll` and `verify` both use: the clip decode (plain or
//! sealed), the
//! request batch around the storage calls, the checked service replies and
//! the used-audio mark.
use std::time::Instant;

use super::whisper::{near_ai_key, Early};
use super::{Pins, Refusal};
use crate::audio::{decode_wav, wav_bytes};
use crate::config::{audio_used_key, AUDIO_KEY_ENV};
use crate::digest::{from_b64, sha256};
use crate::embedding::Embedding;
use crate::envelope::{audio_aad, AudioKey};
use crate::host::{Host, LocalEmbeddings, PostRequest, Timed};
use crate::input::RequestInput;
use crate::output::{short, Reason, Stages};
use crate::speaker_client::{check_service_reply, ServiceReply};
use crate::summary_check::{parse_fit, summary_fits, summary_request};

/// A decoded inline WAV: its samples, the canonical WAV and its digest.
pub(super) struct Clip {
    pub(super) pcm: Vec<i16>,
    pub(super) wav: Vec<u8>,
    pub(super) digest: [u8; 32],
}

/// The clips of one input, in input order: `plain` WAVs, or `sealed` WAVs
/// that the audio key opens for this `op` and `owner`. An input with both
/// fields, or with neither, is `unsupported`. So is sealed audio on a
/// project without the audio key. A clip that does not open is
/// `audio_invalid`: it was sealed to another key, for another owner or
/// operation, or it was changed.
pub(super) fn decode_clips(
    host: &dyn Host,
    op: &str,
    owner: &str,
    plain: Option<&[String]>,
    sealed: Option<&[String]>,
) -> Result<Vec<Clip>, Refusal> {
    match (plain, sealed) {
        (Some(plain), None) => plain.iter().map(|text| decode_wav_clip(&base64_bytes(text)?)).collect(),
        (None, Some(sealed)) => {
            let key = host
                .secret(AUDIO_KEY_ENV)
                .and_then(|text| AudioKey::from_secret(&text))
                .ok_or_else(|| Refusal::new(Reason::Unsupported, "audio_key: missing"))?;
            let aad = audio_aad(op, owner);
            sealed
                .iter()
                .map(|text| {
                    let wav = key
                        .open(&base64_bytes(text)?, &aad)
                        .ok_or_else(|| Refusal::new(Reason::AudioInvalid, "not_sealed_to_this_request"))?;
                    decode_wav_clip(&wav)
                })
                .collect()
        }
        _ => Err(Refusal::new(Reason::Unsupported, "audio: one of plain or sealed")),
    }
}

/// The one clip of an input, as [`decode_clips`] reads it.
pub(super) fn decode_clip(
    host: &dyn Host,
    op: &str,
    owner: &str,
    plain: &Option<String>,
    sealed: &Option<String>,
) -> Result<Clip, Refusal> {
    let (plain, sealed) = (plain.as_ref().map(std::slice::from_ref), sealed.as_ref().map(std::slice::from_ref));
    let clips = decode_clips(host, op, owner, plain, sealed)?;
    <[Clip; 1]>::try_from(clips).map(|[clip]| clip).map_err(|_| Reason::Unsupported.into())
}

fn base64_bytes(text: &str) -> Result<Vec<u8>, Refusal> {
    from_b64(text).ok_or_else(|| Refusal::new(Reason::AudioInvalid, "bad_base64"))
}

fn decode_wav_clip(bytes: &[u8]) -> Result<Clip, Refusal> {
    let pcm = decode_wav(bytes).map_err(|error| Refusal::new(Reason::AudioInvalid, error))?;
    let wav = wav_bytes(&pcm);
    let digest = sha256(&wav);
    Ok(Clip { pcm, wav, digest })
}

/// What [`in_flight`] gives back: the value of the storage step, the
/// responses in request order, and the result of the model inside the
/// worker if `local` clips were given.
pub(super) struct Flight<T> {
    pub(super) value: T,
    pub(super) results: Vec<Timed>,
    pub(super) local: Option<Result<LocalEmbeddings, String>>,
}

/// Starts `requests` and sends their bodies, runs `storage` while they are
/// in flight, then waits for every response. A storage refusal drops the
/// requests without a wait. Records the stages `send`, `storage`, `wait`
/// and `parallel`; `storage` can record its own stages inside.
///
/// With `local` clips (the `local-speaker` build), the model inside the
/// worker runs on them after the storage step, while the requests are still
/// in flight. It records the stages `model_fetch`, `model_cached` (1 or 0)
/// and `redimnet`.
pub(super) fn in_flight<T>(
    host: &mut dyn Host,
    ms: &mut Stages,
    mut requests: Vec<PostRequest>,
    early: Option<Early>,
    local: Option<&[&Clip]>,
    storage: impl FnOnce(&mut dyn Host, &mut Stages) -> Result<T, Reason>,
) -> Result<Flight<T>, Reason> {
    // With `early`, the first requests are in flight already (see
    // [`words_request`](super::whisper::words_request)): the rest join them.
    let sending = Instant::now();
    let flight = match early {
        Some(early) => {
            host.post_add(requests.split_off(early.count));
            early.started
        }
        None => {
            host.post_start(requests);
            sending
        }
    };
    ms.since("send", sending);
    let stored = Instant::now();
    let value = match storage(host, ms) {
        Ok(value) => value,
        Err(reason) => {
            host.post_cancel();
            return Err(reason);
        }
    };
    ms.since("storage", stored);
    let local = local.map(|clips| {
        let pcm: Vec<&[i16]> = clips.iter().map(|clip| clip.pcm.as_slice()).collect();
        let embedded = host.embed_local(&pcm);
        if let Ok(done) = &embedded {
            ms.record("model_fetch", done.fetch_ms);
            ms.record("model_cached", u64::from(done.model_cached));
            ms.record("redimnet", done.run_ms);
        }
        embedded
    });
    let results = ms.time("wait", || host.post_wait());
    ms.since("parallel", flight);
    Ok(Flight { value, results, local })
}

/// The embedding of clip `index` from the model inside the worker. A
/// failure of the model refuses with `speaker_unavailable`.
pub(super) fn local_embedding(
    local: Option<&Result<LocalEmbeddings, String>>,
    index: usize,
) -> Result<Embedding, Refusal> {
    let unavailable = |error: &str| Refusal::new(Reason::SpeakerUnavailable, short(&format!("speaker: {error}")));
    let embeddings = match local {
        Some(Ok(done)) => &done.embeddings,
        Some(Err(error)) => return Err(unavailable(error)),
        None => return Err(unavailable("no_result")),
    };
    embeddings.get(index).and_then(|raw| Embedding::from_raw(raw)).ok_or_else(|| unavailable("bad_embedding"))
}

/// The checked reply of one request of the batch: `check` reads a
/// response, a transport error is `network: …` and a missing result is
/// `no_result`. A failure refuses with `unavailable`, and its detail starts
/// with the name of the `service`.
pub(super) fn reply<T>(
    timed: Option<&Timed>,
    service: &str,
    unavailable: Reason,
    check: impl FnOnce(u16, &[u8]) -> Result<T, String>,
) -> Result<T, Refusal> {
    let checked = reply_of(timed).and_then(|(status, body)| check(status, body));
    checked.map_err(|error| Refusal::new(unavailable, short(&format!("{service}: {error}"))))
}

/// The status and the body of one response of the batch. A transport error
/// is `network: …` and a missing result is `no_result`.
pub(super) fn reply_of(timed: Option<&Timed>) -> Result<(u16, &[u8]), String> {
    match timed.map(|timed| &timed.result) {
        Some(Ok((status, body))) => Ok((*status, body)),
        Some(Err(error)) => Err(format!("network: {error}")),
        None => Err("no_result".into()),
    }
}

/// The checked speaker service reply for `clip`.
pub(super) fn speaker_reply(
    timed: Option<&Timed>,
    clip: &Clip,
    nonce: &[u8; 32],
    pins: &Pins,
) -> Result<ServiceReply, Refusal> {
    reply(timed, "speaker", Reason::SpeakerUnavailable, |status, body| {
        check_service_reply(status, body, &clip.digest, nonce, &pins.speaker_key)
    })
}

/// Adds the summary check of a community note to the batch, and gives its
/// place in the batch. `None` for a request of another kind: only a note
/// holds the text that its summary describes.
///
/// The check runs on NEAR AI in every build. A note with no NEAR AI key
/// refuses and drops the requests that are in flight, so a note is never
/// signed without the check.
pub(super) fn push_summary_check(
    host: &mut dyn Host,
    requests: &mut Vec<PostRequest>,
    request: &RequestInput,
) -> Result<Option<usize>, Refusal> {
    let Some((note, summary)) = request.note_summary() else {
        return Ok(None);
    };
    let Some(api_key) = near_ai_key(host) else {
        host.post_cancel();
        return Err(Refusal::new(Reason::SummaryCheckUnavailable, "summary: no_api_key"));
    };
    requests.push(summary_request(&api_key, note, summary));
    Ok(Some(requests.len() - 1))
}

/// The summary check of a note, from the reply at `at` of the batch: the
/// summary must give the main point of the note. No answer refuses too, so
/// a note is never signed without the check.
pub(super) fn check_summary(results: &[Timed], at: usize, ms: &mut Stages) -> Result<(), Refusal> {
    let timed = results.get(at);
    if let Some(timed) = timed {
        ms.record("summary", timed.ms);
    }
    let fit_milli = reply(timed, "summary", Reason::SummaryCheckUnavailable, parse_fit)?;
    if summary_fits(fit_milli) {
        Ok(())
    } else {
        Err(Refusal::new(Reason::SummaryMismatch, format!("summary: fit_{fit_milli}")))
    }
}

/// Marks an audio digest used, atomically. A second use is refused.
pub(super) fn consume(host: &mut dyn Host, digest_b64u: &str) -> Result<(), Reason> {
    match host.marker_set_if_absent(&audio_used_key(digest_b64u), b"1") {
        Ok(true) => Ok(()),
        Ok(false) => Err(Reason::AudioReused),
        Err(_) => Err(Reason::Storage),
    }
}
