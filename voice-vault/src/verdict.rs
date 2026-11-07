//! The signed verdict of the HTTPS path (plan Section 7.5).
//!
//! The verifier signs `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` with
//! its project-bound ed25519 key. The vault checks that signature over the
//! exact bytes it receives, then parses them. One wire shape: all 11 fields
//! are present, and an unknown field makes the verdict malformed.
//! `voice-verifier/testdata/signed_verdict_v1.json` holds a vector that both
//! crates' tests check.

use near_sdk::base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use near_sdk::base64::Engine;
use near_sdk::env;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;

use crate::error::VaultError;

/// The prefix of the signed preimage.
pub const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v1";

/// The 32-byte message that the verifier key signs.
pub fn verdict_message(verdict_json: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(VERDICT_DOMAIN.len() + verdict_json.len());
    preimage.extend_from_slice(VERDICT_DOMAIN);
    preimage.extend_from_slice(verdict_json);
    env::sha256_array(&preimage)
}

/// Checks the ed25519 signature (standard base64, 64 bytes) over the
/// verdict message against the pinned key.
pub fn check_signature(verdict_json: &str, signature_b64: &str, public_key: &[u8; 32]) -> Result<(), VaultError> {
    let signature: [u8; 64] = STANDARD
        .decode(signature_b64)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(VaultError::BadSignature)?;
    let message = verdict_message(verdict_json.as_bytes());
    if env::ed25519_verify(&signature, message, public_key) {
        Ok(())
    } else {
        Err(VaultError::BadSignature)
    }
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
enum VerdictKind {
    #[serde(rename = "seams_voice_signed_verdict_v1")]
    V1,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
enum Renderer {
    #[serde(rename = "spoken-intent/1")]
    V1,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
enum Outcome {
    Accept,
    Refuse,
}

/// The number of wire fields. Each one must be present, also when `null`.
const WIRE_FIELDS: usize = 11;

/// The wire form. The reason is any string: the vault pays only on
/// `accept`, so it needs no list of reasons.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
#[allow(dead_code)]
struct WireVerdict {
    kind: VerdictKind,
    renderer: Renderer,
    verifier: String,
    request_digest: Option<String>,
    spoken_text_digest: Option<String>,
    audio_digest: Option<String>,
    outcome: Outcome,
    reason: Option<String>,
    speaker_score_milli: Option<i64>,
    word_margin_milli: Option<i64>,
    heard: Option<String>,
}

/// An `accept` verdict: the three digests that bind it to one request and
/// one recording.
#[derive(Debug, PartialEq, Eq)]
pub struct Accepted {
    pub request_digest: [u8; 32],
    pub spoken_text_digest: [u8; 32],
    pub audio_digest: [u8; 32],
}

pub fn encode_digest(digest: &[u8; 32]) -> String {
    URL_SAFE_NO_PAD.encode(digest)
}

/// Base64url without padding, exactly 32 bytes, canonical form only.
pub fn decode_digest(text: &str) -> Option<[u8; 32]> {
    let bytes = URL_SAFE_NO_PAD.decode(text).ok()?;
    let digest: [u8; 32] = bytes.try_into().ok()?;
    (URL_SAFE_NO_PAD.encode(digest) == text).then_some(digest)
}

/// Parses signed verdict bytes. A `refuse` gives `VerdictRefused`; any other
/// shape gives `MalformedVerdict`.
pub fn parse_accepted(verdict_json: &str) -> Result<Accepted, VaultError> {
    let value: serde_json::Value = serde_json::from_str(verdict_json).map_err(|_| VaultError::MalformedVerdict)?;
    if value.as_object().map(|object| object.len()) != Some(WIRE_FIELDS) {
        return Err(VaultError::MalformedVerdict);
    }
    let wire: WireVerdict = serde_json::from_value(value).map_err(|_| VaultError::MalformedVerdict)?;
    match (&wire.outcome, &wire.reason) {
        (Outcome::Accept, None) => {}
        (Outcome::Refuse, Some(_)) => return Err(VaultError::VerdictRefused),
        _ => return Err(VaultError::MalformedVerdict),
    }
    let digest = |field: &Option<String>| field.as_deref().and_then(decode_digest).ok_or(VaultError::MalformedVerdict);
    Ok(Accepted {
        request_digest: digest(&wire.request_digest)?,
        spoken_text_digest: digest(&wire.spoken_text_digest)?,
        audio_digest: digest(&wire.audio_digest)?,
    })
}
