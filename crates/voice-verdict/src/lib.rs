//! The check of a signed Speak-to-Sign verdict
//! (`seams_voice_signed_verdict_v2`).
//!
//! The verifier signs `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` with
//! ed25519 and gives the signature as standard base64. [`check_verdict`]
//! checks the signature over the exact text that it receives, then reads the
//! 13 fields. So nobody serializes the verdict again.
//!
//! A NEAR contract turns the feature `dalek` off and passes the check of its
//! host to [`check_verdict_with`]:
//!
//! ```ignore
//! let verdict = voice_verdict::check_verdict_with(
//!     verdict_json,
//!     signature_b64,
//!     &self.verifier_key,
//!     &Check::at(env::block_timestamp_ms()).request(&my_digest),
//!     |signature, message, key| env::ed25519_verify(signature, message, key),
//! );
//! ```
//!
//! [`check_attestation_binding`] checks the TDX quote of an OutLayer call:
//! that it binds the output of the call to a WASM that you accept.
#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod attestation;

pub use attestation::{
    check_attestation_binding, parse_attestation_record, AttestationRecord, AttestationRefusal,
    Binding, Bound, Measurements,
};

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec::Vec;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The prefix of the signed message.
pub const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";
/// The only verdict kind that this crate accepts.
pub const VERDICT_KIND: &str = "seams_voice_signed_verdict_v2";
/// The prefix of the request digest preimage of `spoken-intent`.
pub const REQUEST_DIGEST_DOMAIN: &[u8] = b"seams:spoken-intent:request:v1";

/// `accept`, `step_up` or `refuse`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Accept,
    StepUp,
    Refuse,
}

/// The 13 signed fields. Each field must be present, and no other field is
/// allowed. A digest is `None` only on a refusal that came before it was
/// known.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verdict {
    pub kind: String,
    pub renderer: String,
    /// The verifier version. The worker writes it; nothing proves it.
    pub verifier: String,
    /// base64url with no padding.
    // `deserialize_with` makes a missing field an error, not `None`.
    #[serde(deserialize_with = "Option::deserialize")]
    pub request_digest: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub spoken_text_digest: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub audio_digest: Option<String>,
    pub outcome: Outcome,
    /// Set only on `refuse`. A text, so that a reason of a later verifier
    /// version still reads.
    #[serde(deserialize_with = "Option::deserialize")]
    pub reason: Option<String>,
    /// The id of the policy rule, set only on `step_up`.
    #[serde(deserialize_with = "Option::deserialize")]
    pub policy_rule: Option<String>,
    /// ms since the UNIX epoch.
    pub expires_at_ms: u64,
    #[serde(deserialize_with = "Option::deserialize")]
    pub speaker_score_milli: Option<i32>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub word_margin_milli: Option<i32>,
    /// The heard words, for display only. Verifier 0.15.0 and later sets
    /// them only on a refusal with the reason `words`. No check reads it.
    #[serde(deserialize_with = "Option::deserialize")]
    pub heard: Option<String>,
}

/// Why a verdict does not pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// `signature_b64` is not standard base64 of 64 bytes.
    BadSignatureEncoding,
    /// The key did not sign these bytes.
    BadSignature,
    /// The signed text is not a verdict of 13 fields.
    Malformed(String),
    /// The signed `kind` is not [`VERDICT_KIND`].
    WrongKind(String),
    /// The verifier refused. The verdict holds the reason.
    Refused(Box<Verdict>),
    /// The voice and the words passed, and a policy rule asks for a second
    /// approval.
    StepUp(Box<Verdict>),
    /// `expires_at_ms` is before the time of the check.
    Expired(Box<Verdict>),
    /// The verdict is for another request.
    RequestMismatch(Box<Verdict>),
    /// The verdict is for another recording.
    AudioMismatch(Box<Verdict>),
}

/// The text of a refusal, for a log or a contract panic. The demo contracts
/// panic with it, so their tests name these texts.
impl core::fmt::Display for Refusal {
    fn fmt(&self, out: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::BadSignatureEncoding => {
                out.write_str("signature_b64 must be standard base64 of 64 bytes")
            }
            Self::BadSignature => {
                out.write_str("the verdict signature does not match the verifier key")
            }
            Self::Malformed(error) => write!(out, "verdict_json is not a verdict: {error}"),
            Self::WrongKind(_) => write!(out, "the verdict kind must be {VERDICT_KIND}"),
            Self::Refused(_) | Self::StepUp(_) => {
                out.write_str("the verdict outcome must be accept")
            }
            Self::Expired(_) => out.write_str("the verdict has expired"),
            Self::RequestMismatch(_) => out.write_str("the verdict is for another request"),
            Self::AudioMismatch(_) => out.write_str("the verdict is for another recording"),
        }
    }
}

/// What the checker expects.
#[derive(Clone, Copy, Debug)]
pub struct Check<'a> {
    /// The time of the check, in ms since the UNIX epoch.
    pub now_ms: u64,
    /// The digest of the request that the checker built itself. `None` lets
    /// any request pass.
    pub request_digest: Option<&'a [u8; 32]>,
    /// The digest of the recording that the checker sent.
    pub audio_digest: Option<&'a [u8; 32]>,
    /// `true` lets a `step_up` verdict pass. The checker must then get the
    /// second approval itself.
    pub accept_step_up: bool,
}

impl<'a> Check<'a> {
    /// A check at `now_ms` that expects no digest.
    pub fn at(now_ms: u64) -> Self {
        Self {
            now_ms,
            request_digest: None,
            audio_digest: None,
            accept_step_up: false,
        }
    }

    /// Expects this request digest.
    pub fn request(mut self, digest: &'a [u8; 32]) -> Self {
        self.request_digest = Some(digest);
        self
    }

    /// Expects this audio digest.
    pub fn audio(mut self, digest: &'a [u8; 32]) -> Self {
        self.audio_digest = Some(digest);
        self
    }

    /// Lets a `step_up` verdict pass.
    pub fn accept_step_up(mut self) -> Self {
        self.accept_step_up = true;
        self
    }
}

/// Checks a signed verdict with `ed25519-dalek` (strict verification). The
/// checks run in this order: signature, shape, kind, outcome, expiry,
/// request digest, audio digest.
#[cfg(feature = "dalek")]
pub fn check_verdict(
    verdict_json: &str,
    signature_b64: &str,
    verifier_key: &[u8; 32],
    check: &Check,
) -> Result<Verdict, Refusal> {
    check_verdict_with(
        verdict_json,
        signature_b64,
        verifier_key,
        check,
        |signature, message, key| {
            ed25519_dalek::VerifyingKey::from_bytes(key)
                .and_then(|key| {
                    key.verify_strict(message, &ed25519_dalek::Signature::from_bytes(signature))
                })
                .is_ok()
        },
    )
}

/// [`check_verdict`] with the ed25519 check of the caller:
/// `verify(signature, message, public_key)`.
pub fn check_verdict_with(
    verdict_json: &str,
    signature_b64: &str,
    verifier_key: &[u8; 32],
    check: &Check,
    verify: impl FnOnce(&[u8; 64], &[u8; 32], &[u8; 32]) -> bool,
) -> Result<Verdict, Refusal> {
    let signature: [u8; 64] = STANDARD
        .decode(signature_b64)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(Refusal::BadSignatureEncoding)?;
    if !verify(&signature, &verdict_message(verdict_json), verifier_key) {
        return Err(Refusal::BadSignature);
    }

    let verdict = parse_verdict(verdict_json)?;
    match verdict.outcome {
        Outcome::Refuse => return Err(Refusal::Refused(Box::new(verdict))),
        Outcome::StepUp if !check.accept_step_up => return Err(Refusal::StepUp(Box::new(verdict))),
        Outcome::StepUp | Outcome::Accept => {}
    }
    if verdict.expires_at_ms < check.now_ms {
        return Err(Refusal::Expired(Box::new(verdict)));
    }
    if check
        .request_digest
        .is_some_and(|digest| !same_digest(verdict.request_digest.as_deref(), digest))
    {
        return Err(Refusal::RequestMismatch(Box::new(verdict)));
    }
    if check
        .audio_digest
        .is_some_and(|digest| !same_digest(verdict.audio_digest.as_deref(), digest))
    {
        return Err(Refusal::AudioMismatch(Box::new(verdict)));
    }
    Ok(verdict)
}

/// Reads the 13 fields of a verdict text. It does not check the signature.
pub fn parse_verdict(verdict_json: &str) -> Result<Verdict, Refusal> {
    // The kind first, so that a text of another kind is not `Malformed`.
    #[derive(Deserialize)]
    struct Kind {
        kind: String,
    }
    let kind: Kind = serde_json::from_str(verdict_json).map_err(malformed)?;
    if kind.kind != VERDICT_KIND {
        return Err(Refusal::WrongKind(kind.kind));
    }
    serde_json::from_str(verdict_json).map_err(malformed)
}

fn malformed(error: serde_json::Error) -> Refusal {
    use alloc::string::ToString;
    Refusal::Malformed(error.to_string())
}

fn same_digest(signed: Option<&str>, expected: &[u8; 32]) -> bool {
    signed
        .and_then(|text| URL_SAFE_NO_PAD.decode(text).ok())
        .is_some_and(|bytes| bytes == expected)
}

/// `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)`: the 32 bytes that the
/// verifier key signs.
pub fn verdict_message(verdict_json: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(VERDICT_DOMAIN);
    hasher.update(verdict_json.as_bytes());
    hasher.finalize().into()
}

/// `SHA-256(REQUEST_DIGEST_DOMAIN || borsh(request))`: the request digest of
/// `spoken-intent`, from the Borsh of a `SpokenRequestV1`.
///
/// `None` for no bytes and for tag 1 (a multisig approval). The digest of
/// that kind binds the salted commitment and not the proposal
/// (`spoken_intent::multisig_approval_digest`).
pub fn request_digest(request_borsh: &[u8]) -> Option<[u8; 32]> {
    if matches!(request_borsh.first(), None | Some(1)) {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(REQUEST_DIGEST_DOMAIN);
    hasher.update(request_borsh);
    Some(hasher.finalize().into())
}

/// Parses `ed25519:<base58 of 32 bytes>`.
pub fn parse_ed25519_key(text: &str) -> Option<[u8; 32]> {
    const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let base58 = text.strip_prefix("ed25519:")?;
    // 32 bytes are 32 to 44 base58 characters.
    if base58.is_empty() || base58.len() > 44 {
        return None;
    }
    // Big-endian bytes, least significant last.
    let mut bytes: Vec<u8> = Vec::with_capacity(33);
    for char in base58.bytes() {
        let mut carry = ALPHABET.iter().position(|&letter| letter == char)? as u32;
        for byte in bytes.iter_mut().rev() {
            carry += u32::from(*byte) * 58;
            *byte = carry as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.insert(0, carry as u8);
            carry >>= 8;
        }
    }
    let zeros = base58.bytes().take_while(|&char| char == b'1').count();
    let mut key = alloc::vec![0u8; zeros];
    key.extend_from_slice(&bytes);
    key.try_into().ok()
}

// ---------------------------------------------------------------------------
// The request of an application with no NEAR account.

/// The Borsh tag of `SpokenRequestV1::Confirmation`.
const CONFIRMATION_TAG: u8 = 10;

/// The Borsh bytes of `SpokenRequestV1::Confirmation` of `spoken-intent`:
/// an owner that the application names (`app:<id>`), a context, the SHA-256
/// of any payload, and the summary that the owner says. Pass the bytes to
/// [`request_digest`].
///
/// `None` for an owner or a context that the verifier refuses. The summary
/// is not checked here: the verifier refuses one that it cannot speak.
pub fn confirmation_borsh(
    owner: &str,
    context: &str,
    payload_sha256: &[u8; 32],
    summary: &str,
) -> Option<Vec<u8>> {
    let id = owner.strip_prefix("app:")?;
    let owner_byte =
        |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-:".contains(&byte);
    let context_byte = |byte: u8| owner_byte(byte) || byte == b'/';
    if id.is_empty() || owner.len() > 100 || !id.bytes().all(owner_byte) {
        return None;
    }
    if context.is_empty() || context.len() > 64 || !context.bytes().all(context_byte) {
        return None;
    }
    let mut bytes = alloc::vec![CONFIRMATION_TAG];
    let mut string = |text: &str| {
        bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
        bytes.extend_from_slice(text.as_bytes());
    };
    string(owner);
    string(context);
    bytes.extend_from_slice(payload_sha256);
    let mut string = |text: &str| {
        bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
        bytes.extend_from_slice(text.as_bytes());
    };
    string(summary);
    Some(bytes)
}

// ---------------------------------------------------------------------------
// Signed transcripts (the operation `transcribe`).

/// The prefix of the signed message of a transcript. It is not the prefix
/// of a verdict.
pub const TRANSCRIPT_DOMAIN: &[u8] = b"seams:outlayer:voice-transcript:v1";
/// The kind of a signed transcript.
pub const TRANSCRIPT_KIND: &str = "seams_voice_signed_transcript_v1";

/// The 9 signed fields of a transcript: the voice of `owner` passed the
/// speaker check on this audio, and the speech-to-text model heard `text`.
/// A transcript approves no request.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transcript {
    pub kind: String,
    pub verifier: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub owner: Option<String>,
    /// base64url with no padding.
    #[serde(deserialize_with = "Option::deserialize")]
    pub audio_digest: Option<String>,
    pub outcome: Outcome,
    #[serde(deserialize_with = "Option::deserialize")]
    pub reason: Option<String>,
    pub expires_at_ms: u64,
    #[serde(deserialize_with = "Option::deserialize")]
    pub speaker_score_milli: Option<i32>,
    /// Lowercase words, digits and apostrophes. Set only on `accept`.
    #[serde(deserialize_with = "Option::deserialize")]
    pub text: Option<String>,
}

/// Why a transcript does not pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptRefusal {
    BadSignatureEncoding,
    BadSignature,
    Malformed(String),
    WrongKind(String),
    /// The verifier refused. The transcript holds the reason.
    Refused(Box<Transcript>),
    Expired(Box<Transcript>),
    /// The transcript is of another owner.
    OwnerMismatch(Box<Transcript>),
    AudioMismatch(Box<Transcript>),
}

/// `SHA-256(TRANSCRIPT_DOMAIN || transcript JSON bytes)`.
pub fn transcript_message(transcript_json: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(TRANSCRIPT_DOMAIN);
    hasher.update(transcript_json.as_bytes());
    hasher.finalize().into()
}

/// Checks a signed transcript with `ed25519-dalek`: signature, shape, kind,
/// outcome, expiry, owner, audio digest. `owner` of `None` lets a transcript
/// of any owner pass.
///
/// A transcript is weaker than a verdict: the verifier expected no sentence
/// and made no word check. Do not let it approve an action with value.
#[cfg(feature = "dalek")]
pub fn check_transcript(
    transcript_json: &str,
    signature_b64: &str,
    verifier_key: &[u8; 32],
    now_ms: u64,
    owner: Option<&str>,
    audio_digest: Option<&[u8; 32]>,
) -> Result<Transcript, TranscriptRefusal> {
    let signature: [u8; 64] = STANDARD
        .decode(signature_b64)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(TranscriptRefusal::BadSignatureEncoding)?;
    let signed = ed25519_dalek::VerifyingKey::from_bytes(verifier_key)
        .and_then(|key| {
            key.verify_strict(
                &transcript_message(transcript_json),
                &ed25519_dalek::Signature::from_bytes(&signature),
            )
        })
        .is_ok();
    if !signed {
        return Err(TranscriptRefusal::BadSignature);
    }
    use alloc::string::ToString;
    #[derive(Deserialize)]
    struct Kind {
        kind: String,
    }
    let malformed = |error: serde_json::Error| TranscriptRefusal::Malformed(error.to_string());
    let kind: Kind = serde_json::from_str(transcript_json).map_err(malformed)?;
    if kind.kind != TRANSCRIPT_KIND {
        return Err(TranscriptRefusal::WrongKind(kind.kind));
    }
    let transcript: Transcript = serde_json::from_str(transcript_json).map_err(malformed)?;
    if transcript.outcome != Outcome::Accept {
        return Err(TranscriptRefusal::Refused(Box::new(transcript)));
    }
    if transcript.owner.is_none() || transcript.text.is_none() {
        return Err(TranscriptRefusal::Malformed(
            "an accept with no owner or no text".to_string(),
        ));
    }
    if transcript.expires_at_ms < now_ms {
        return Err(TranscriptRefusal::Expired(Box::new(transcript)));
    }
    if owner.is_some_and(|owner| transcript.owner.as_deref() != Some(owner)) {
        return Err(TranscriptRefusal::OwnerMismatch(Box::new(transcript)));
    }
    if audio_digest.is_some_and(|digest| !same_digest(transcript.audio_digest.as_deref(), digest)) {
        return Err(TranscriptRefusal::AudioMismatch(Box::new(transcript)));
    }
    Ok(transcript)
}
