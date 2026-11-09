//! `enroll`: three recordings of the owner become the template of the
//! owner, after the owner's authorization and its access key pass.
use std::time::Instant;

use serde_json::Value;
use spoken_intent::NearAccount;

use super::request::unsupported;
use super::steps::{consume, decode_clip, in_flight, reply, speaker_reply};
use super::{Pins, Refusal};
use crate::audio::energy_gate;
use crate::config::{audio_used_key, template_key, ENROLL_RECORDINGS, TEMPLATE_EPOCH};
use crate::digest::{b64u, near_ed25519_key};
use crate::enrollment::{access_key_request, check_authorization, enrollment_digest, parse_access_key, AccessKey};
use crate::host::Host;
use crate::input::EnrollInput;
use crate::output::{short, Enrollment, Outcome, Reason};
use crate::speaker::{self, model_sha256, service_request, TemplateRecord};

/// Three recordings of the owner become the template of the owner.
pub(super) fn enroll(value: Value, host: &mut dyn Host, pins: &Pins) -> Enrollment {
    let started = Instant::now();
    let mut output = Enrollment::new();
    match enroll_steps(value, host, pins, &mut output) {
        Ok(()) => {
            output.outcome = Outcome::Accept;
            output.reason = None;
        }
        Err(refusal) => {
            output.outcome = Outcome::Refuse;
            output.reason = Some(refusal.reason);
            output.detail = refusal.detail;
        }
    }
    match host.public_key() {
        Ok(key) if key.len() == 32 => output.verifier_public_key = Some(near_ed25519_key(&key)),
        Ok(_) => output.detail = output.detail.take().or(Some("public_key: length".into())),
        Err(error) => output.detail = output.detail.take().or(Some(short(&format!("public_key: {error}")))),
    }
    output.ms.since("total", started);
    output
}

fn enroll_steps(value: Value, host: &mut dyn Host, pins: &Pins, output: &mut Enrollment) -> Result<(), Refusal> {
    let input: EnrollInput = serde_json::from_value(value).map_err(unsupported)?;
    let owner = NearAccount::new(&input.owner).map_err(unsupported)?;
    if input.op != "enroll" {
        return Err(Reason::Unsupported.into());
    }
    output.owner = Some(owner.as_str().to_string());
    if input.audio_wav_b64.len() != ENROLL_RECORDINGS {
        return Err(Reason::Unsupported.into());
    }
    let clips = input.audio_wav_b64.iter().map(|text| decode_clip(text)).collect::<Result<Vec<_>, _>>()?;
    output.audio_digests = clips.iter().map(|clip| b64u(&clip.digest)).collect();
    for (index, clip) in clips.iter().enumerate() {
        if clips[..index].iter().any(|other| other.digest == clip.digest) {
            return Err(Reason::AudioReused.into());
        }
        if !energy_gate(&clip.pcm).passes() {
            return Err(Reason::Quality.into());
        }
    }

    let digests: Vec<[u8; 32]> = clips.iter().map(|clip| clip.digest).collect();
    let digest_text = b64u(&enrollment_digest(owner.as_str(), &digests));
    output.enrollment_digest = Some(digest_text.clone());

    // The owner's signature of this digest, before any network call.
    let public_key = check_authorization(&input.authorization, &digest_text)
        .map_err(|error| Refusal::new(Reason::NotAuthorized, format!("authorization: {error}")))?;

    // The owner's access key (NEAR RPC) and the three embeddings (speaker
    // service), in one batch. Storage while the requests are in flight: the
    // current template (for its epoch and the compare-and-swap) and the
    // used-audio markers.
    let nonces = (0..ENROLL_RECORDINGS)
        .map(|_| host.random32())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Reason::SpeakerUnavailable)?;
    let mut requests = vec![access_key_request(owner.as_str(), &public_key)];
    requests.extend(clips.iter().zip(&nonces).map(|(clip, nonce)| service_request(&clip.wav, nonce)));
    let key = template_key(owner.as_str());
    let (previous, results) =
        in_flight(host, &mut output.ms, requests, |host, _| enroll_storage(host, &key, &output.audio_digests))?;
    if let Some(timed) = results.first() {
        output.ms.record("rpc", timed.ms);
    }
    if let Some(slowest) = results.iter().skip(1).map(|timed| timed.ms).max() {
        output.ms.record("speaker", slowest);
    }

    // The key must be a full-access key of the owner, before the embeddings
    // are used.
    let refused = match reply(results.first(), "rpc", Reason::AuthorizationUnavailable, parse_access_key)? {
        AccessKey::FullAccess => None,
        AccessKey::FunctionCall => Some("authorization: function_call_key"),
        AccessKey::Missing => Some("authorization: unknown_key"),
    };
    if let Some(detail) = refused {
        return Err(Refusal::new(Reason::NotAuthorized, detail));
    }

    let mut embeddings = Vec::with_capacity(ENROLL_RECORDINGS);
    for (index, (clip, nonce)) in clips.iter().zip(&nonces).enumerate() {
        embeddings.push(speaker_reply(results.get(index + 1), clip, nonce, pins)?.embedding);
    }
    let template = match speaker::enroll(&embeddings) {
        speaker::Enrollment::Agreed { template, agreement_milli } => {
            output.agreement_milli = Some(agreement_milli);
            template
        }
        speaker::Enrollment::Disagreed { agreement_milli } => {
            output.agreement_milli = Some(agreement_milli);
            return Err(Reason::Speaker.into());
        }
    };
    let marked = Instant::now();
    for digest in &output.audio_digests {
        consume(host, digest)?;
    }
    // A re-enrollment replaces the template and adds 1 to its epoch.
    let epoch = previous
        .as_deref()
        .and_then(TemplateRecord::decode)
        .map_or(TEMPLATE_EPOCH, |record| record.epoch.saturating_add(1));
    let record = TemplateRecord { epoch, model_sha256: model_sha256(), template };
    let written = match &previous {
        None => host.storage_set_if_absent(&key, &record.encode()),
        Some(bytes) => host.storage_set_if_equals(&key, bytes, &record.encode()),
    };
    output.ms.since("write", marked);
    match written {
        Ok(true) => {
            output.template_epoch = Some(epoch);
            Ok(())
        }
        Ok(false) => Err(Reason::TemplateExists.into()),
        Err(_) => Err(Reason::Storage.into()),
    }
}

/// The stored template bytes (if any), after a check that no clip was used.
fn enroll_storage(host: &mut dyn Host, key: &str, digests: &[String]) -> Result<Option<Vec<u8>>, Reason> {
    let previous = host.storage_get(key).map_err(|_| Reason::Storage)?;
    for digest in digests {
        check_unused(host, digest)?;
    }
    Ok(previous)
}

/// A read of the used-audio marker: absent, or a refusal.
fn check_unused(host: &mut dyn Host, digest_b64u: &str) -> Result<(), Reason> {
    match host.marker_get(&audio_used_key(digest_b64u)) {
        Ok(None) => Ok(()),
        Ok(Some(_)) => Err(Reason::AudioReused),
        Err(_) => Err(Reason::Storage),
    }
}
