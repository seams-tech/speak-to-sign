//! The steps that `enroll` and `verify` both use: the clip decode, the
//! request batch around the storage calls, the checked service replies and
//! the used-audio mark.
use std::time::Instant;

use super::{Pins, Refusal};
use crate::audio::{decode_wav, wav_bytes};
use crate::config::audio_used_key;
use crate::digest::{from_b64, sha256};
use crate::host::{Host, PostRequest, Timed};
use crate::output::{short, Reason, Stages};
use crate::speaker_client::{check_service_reply, ServiceReply};

/// A decoded inline WAV: its samples, the canonical WAV and its digest.
pub(super) struct Clip {
    pub(super) pcm: Vec<i16>,
    pub(super) wav: Vec<u8>,
    pub(super) digest: [u8; 32],
}

pub(super) fn decode_clip(b64_text: &str) -> Result<Clip, Refusal> {
    let bytes = from_b64(b64_text).ok_or_else(|| Refusal::new(Reason::AudioInvalid, "bad_base64"))?;
    let pcm = decode_wav(&bytes).map_err(|error| Refusal::new(Reason::AudioInvalid, error))?;
    let wav = wav_bytes(&pcm);
    let digest = sha256(&wav);
    Ok(Clip { pcm, wav, digest })
}

/// Starts `requests` and sends their bodies, runs `storage` while they are
/// in flight, then waits for every response. A storage refusal drops the
/// requests without a wait. Records the stages `send`, `storage`, `wait`
/// and `parallel`; `storage` can record its own stages inside.
pub(super) fn in_flight<T>(
    host: &mut dyn Host,
    ms: &mut Stages,
    requests: Vec<PostRequest>,
    storage: impl FnOnce(&mut dyn Host, &mut Stages) -> Result<T, Reason>,
) -> Result<(T, Vec<Timed>), Reason> {
    let flight = Instant::now();
    host.post_start(requests);
    ms.since("send", flight);
    let stored = Instant::now();
    let value = match storage(host, ms) {
        Ok(value) => value,
        Err(reason) => {
            host.post_cancel();
            return Err(reason);
        }
    };
    ms.since("storage", stored);
    let results = ms.time("wait", || host.post_wait());
    ms.since("parallel", flight);
    Ok((value, results))
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
    let checked = match timed.map(|timed| &timed.result) {
        Some(Ok((status, body))) => check(*status, body),
        Some(Err(error)) => Err(format!("network: {error}")),
        None => Err("no_result".into()),
    };
    checked.map_err(|error| Refusal::new(unavailable, short(&format!("{service}: {error}"))))
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

/// Marks an audio digest used, atomically. A second use is refused.
pub(super) fn consume(host: &mut dyn Host, digest_b64u: &str) -> Result<(), Reason> {
    match host.marker_set_if_absent(&audio_used_key(digest_b64u), b"1") {
        Ok(true) => Ok(()),
        Ok(false) => Err(Reason::AudioReused),
        Err(_) => Err(Reason::Storage),
    }
}
