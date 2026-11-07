//! The verifier verdict (plan Section 7.3) and how the vault judges the
//! callback value that `outlayer.testnet` delivers.
//!
//! The callback gets one of three values (Gate 0, item 7): the verdict JSON,
//! `null` for a failed run, or a promise error (for example an unknown
//! `version_key`). Only a well-formed verdict whose fields match the pending
//! request and whose outcome is `accept` can pay. Every other value is a
//! refusal. Nothing here panics.
//!
//! One wire shape, the one the verifier writes: all 13 fields are present.
//! On a refusal the verifier writes `null` for a binding field (request id,
//! request digest, spoken-text digest, audio digest, template epoch) that it
//! does not know. An `accept` must hold all five. The shared vector
//! `voice-verifier/testdata/verdict_vectors.json` holds one accept and one
//! refusal for each reason; both crates' tests read it.

use near_sdk::base64::engine::general_purpose::URL_SAFE_NO_PAD;
use near_sdk::base64::Engine;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;
use near_sdk::PromiseResult;

use crate::state::PendingTransfer;

/// Why the verifier refused: every reason that the verifier's `Reason` can
/// emit (plan Section 7.3, and the verifier's additions).
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum VerifierReason {
    Quality,
    Speaker,
    Words,
    AudioReused,
    AudioUnavailable,
    AudioInvalid,
    TemplateMissing,
    Unsupported,
    /// ReDimNet did not fetch, failed its pinned digest, or did not run.
    ModelUnavailable,
    /// Verifier storage failed.
    Storage,
    /// `enroll` only; a verdict never holds it, but it is a valid name.
    TemplateExists,
    /// NEAR AI did not answer, answered with an error, or gave no text.
    TranscriberUnavailable,
}

impl VerifierReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quality => "quality",
            Self::Speaker => "speaker",
            Self::Words => "words",
            Self::AudioReused => "audio_reused",
            Self::AudioUnavailable => "audio_unavailable",
            Self::AudioInvalid => "audio_invalid",
            Self::TemplateMissing => "template_missing",
            Self::Unsupported => "unsupported",
            Self::ModelUnavailable => "model_unavailable",
            Self::Storage => "storage",
            Self::TemplateExists => "template_exists",
            Self::TranscriberUnavailable => "transcriber_unavailable",
        }
    }
}

/// Why the vault did not pay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The OutLayer call failed, for example "Version not found".
    PromiseError,
    /// OutLayer returned `null`: the run failed or timed out.
    NoVerdict,
    /// The value is not a `seams_voice_verdict_v1` with valid fields.
    Malformed,
    /// A well-formed verdict for another request, digest, audio or epoch.
    Mismatch,
    /// The verifier refused.
    Verifier(VerifierReason),
    /// The receiver is no longer an active contact.
    ContactRemoved,
}

impl Refusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PromiseError => "promise_error",
            Self::NoVerdict => "no_verdict",
            Self::Malformed => "malformed_verdict",
            Self::Mismatch => "verdict_mismatch",
            Self::Verifier(reason) => reason.as_str(),
            Self::ContactRemoved => "contact_removed",
        }
    }
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
enum VerdictKind {
    #[serde(rename = "seams_voice_verdict_v1")]
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
const WIRE_FIELDS: usize = 13;

/// The wire form. Unknown fields make the verdict malformed, and so does a
/// missing one (see [`WIRE_FIELDS`]).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
#[allow(dead_code)]
struct WireVerdict {
    kind: VerdictKind,
    renderer: Renderer,
    verifier: String,
    request_id: Option<String>,
    request_digest: Option<String>,
    spoken_text_digest: Option<String>,
    audio_digest: Option<String>,
    template_epoch: Option<u32>,
    outcome: Outcome,
    reason: Option<VerifierReason>,
    speaker_score_milli: Option<i64>,
    word_margin_milli: Option<i64>,
    heard: Option<String>,
}

/// The decision of a well-formed verdict. An `accept` with a reason, or a
/// `refuse` without one, does not convert into this type.
#[derive(Debug, PartialEq, Eq)]
enum Decision {
    Accept,
    Refuse(VerifierReason),
}

/// The fields that bind a verdict to one request. `None` only on a refusal.
#[derive(Debug, PartialEq, Eq)]
struct Binding {
    request_id: Option<u64>,
    request_digest: Option<[u8; 32]>,
    spoken_text_digest: Option<[u8; 32]>,
    audio_digest: Option<[u8; 32]>,
    template_epoch: Option<u32>,
}

impl Binding {
    fn is_complete(&self) -> bool {
        self.request_id.is_some()
            && self.request_digest.is_some()
            && self.spoken_text_digest.is_some()
            && self.audio_digest.is_some()
            && self.template_epoch.is_some()
    }

    /// Every present field equals the pending request's field.
    fn agrees_with(&self, pending: &PendingTransfer) -> bool {
        fn same<T: PartialEq>(field: &Option<T>, expected: &T) -> bool {
            field.as_ref().is_none_or(|value| value == expected)
        }
        same(&self.request_id, &pending.request_id)
            && same(&self.request_digest, &pending.request_digest)
            && same(&self.spoken_text_digest, &pending.spoken_text_digest)
            && same(&self.audio_digest, &pending.audio.digest)
            && same(&self.template_epoch, &pending.template_epoch)
    }
}

/// A verdict whose fields all decoded.
#[derive(Debug, PartialEq, Eq)]
struct Verdict {
    binding: Binding,
    decision: Decision,
}

pub fn encode_digest(digest: &[u8; 32]) -> String {
    URL_SAFE_NO_PAD.encode(digest)
}

/// Base64url without padding, exactly 32 bytes, canonical form only.
pub fn decode_digest(text: &str) -> Option<[u8; 32]> {
    let bytes = URL_SAFE_NO_PAD.decode(text).ok()?;
    let digest: [u8; 32] = bytes.try_into().ok()?;
    (encode_digest(&digest) == text).then_some(digest)
}

/// Decimal `u64` with no sign and no leading zero.
fn decode_request_id(text: &str) -> Option<u64> {
    let value: u64 = text.parse().ok()?;
    (value.to_string() == text).then_some(value)
}

/// A present field must decode; `null` stays `None`.
fn decode_optional<T>(field: Option<String>, decode: fn(&str) -> Option<T>) -> Result<Option<T>, Refusal> {
    field.map(|text| decode(&text).ok_or(Refusal::Malformed)).transpose()
}

fn parse_verdict(bytes: &[u8]) -> Result<Verdict, Refusal> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| Refusal::Malformed)?;
    // `null` is valid JSON; it is the "run failed" value, not a malformed one.
    if value.is_null() {
        return Err(Refusal::NoVerdict);
    }
    if value.as_object().map(|object| object.len()) != Some(WIRE_FIELDS) {
        return Err(Refusal::Malformed);
    }
    let wire: WireVerdict = serde_json::from_value(value).map_err(|_| Refusal::Malformed)?;
    let decision = match (wire.outcome, wire.reason) {
        (Outcome::Accept, None) => Decision::Accept,
        (Outcome::Refuse, Some(reason)) => Decision::Refuse(reason),
        _ => return Err(Refusal::Malformed),
    };
    let binding = Binding {
        request_id: decode_optional(wire.request_id, decode_request_id)?,
        request_digest: decode_optional(wire.request_digest, decode_digest)?,
        spoken_text_digest: decode_optional(wire.spoken_text_digest, decode_digest)?,
        audio_digest: decode_optional(wire.audio_digest, decode_digest)?,
        template_epoch: wire.template_epoch,
    };
    if decision == Decision::Accept && !binding.is_complete() {
        return Err(Refusal::Malformed);
    }
    Ok(Verdict { binding, decision })
}

/// Pays only on a well-formed `accept` verdict for exactly this request. A
/// refusal is reported with the verifier's reason, unless a binding field
/// that it holds names another request.
pub fn judge(pending: &PendingTransfer, result: &PromiseResult) -> Result<(), Refusal> {
    let bytes = match result {
        PromiseResult::Successful(bytes) => bytes,
        PromiseResult::Failed => return Err(Refusal::PromiseError),
    };
    let verdict = parse_verdict(bytes)?;
    // For an accept, `parse_verdict` made sure that every field is present.
    if !verdict.binding.agrees_with(pending) {
        return Err(Refusal::Mismatch);
    }
    match verdict.decision {
        Decision::Accept => Ok(()),
        Decision::Refuse(reason) => Err(Refusal::Verifier(reason)),
    }
}
