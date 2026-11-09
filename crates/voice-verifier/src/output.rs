//! Output JSON and the signed verdict.
//!
//! The verdict is the only signed object. Its bytes are exactly what
//! [`verdict_json`] writes; the Seams route passes them to the Wallet as a
//! string, so nobody serializes them again. The signed message is
//! `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` (32 bytes), and the
//! manifest signing key signs it with ed25519.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::config::{MAX_OUTPUT_BYTES, VERDICT_DOMAIN, VERIFIER_VERSION};
use crate::digest::sha256;

/// The verdict kind. The Wallet accepts only this one.
pub const VERDICT_KIND: &str = "seams_voice_signed_verdict_v2";

/// `accept`, `step_up` or `refuse`. On `step_up` the voice and the words
/// passed, and a policy rule asks the Wallet for a fresh passkey as well.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Accept,
    StepUp,
    Refuse,
}

/// Refusal reasons.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// The energy gate refused the audio.
    Quality,
    /// The speaker score is below the cutoff, or enrollment samples disagree.
    Speaker,
    /// The heard words are not the rendered words.
    Words,
    /// The audio digest was used before.
    AudioReused,
    /// The audio is not a 16 kHz mono PCM16 WAV of 1 sample to 8 s.
    AudioInvalid,
    /// No template for this owner.
    TemplateMissing,
    /// The input is not a request this version handles.
    Unsupported,
    /// The speaker service did not answer, or its reply failed a check.
    SpeakerUnavailable,
    /// Worker storage failed.
    Storage,
    /// `enroll` only: another enrollment of this owner changed the template
    /// during this one.
    TemplateExists,
    /// NEAR AI did not answer, answered with an error, or gave no text.
    TranscriberUnavailable,
    /// `enroll` only: the authorization is not a valid NEP-413 signature of
    /// this enrollment by a full-access key of the owner.
    NotAuthorized,
    /// `enroll` only: the NEAR RPC access-key view failed.
    AuthorizationUnavailable,
}

impl Reason {
    /// Every reason, in declaration order.
    pub const ALL: [Reason; 13] = [
        Reason::Quality,
        Reason::Speaker,
        Reason::Words,
        Reason::AudioReused,
        Reason::AudioInvalid,
        Reason::TemplateMissing,
        Reason::Unsupported,
        Reason::SpeakerUnavailable,
        Reason::Storage,
        Reason::TemplateExists,
        Reason::TranscriberUnavailable,
        Reason::NotAuthorized,
        Reason::AuthorizationUnavailable,
    ];
}

/// The signed verdict: 13 fields, always all present, in this order. A
/// digest is `null` only on a refusal that came before it was known.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verdict {
    pub kind: String,
    pub renderer: String,
    pub verifier: String,
    /// base64url `request_digest(request)` of `spoken-intent`.
    pub request_digest: Option<String>,
    /// base64url `spoken_text_digest(render(request))`.
    pub spoken_text_digest: Option<String>,
    /// base64url SHA-256 of the canonical WAV.
    pub audio_digest: Option<String>,
    pub outcome: Outcome,
    /// Set only on `refuse`.
    pub reason: Option<Reason>,
    /// The id of the policy rule, set only on `step_up`.
    pub policy_rule: Option<String>,
    /// The worker clock before signing plus [`crate::config::VERDICT_TTL_MS`],
    /// in ms since the UNIX epoch. The Wallet refuses the verdict after it.
    pub expires_at_ms: u64,
    pub speaker_score_milli: Option<i32>,
    pub word_margin_milli: Option<i32>,
    pub heard: Option<String>,
}

impl Verdict {
    /// An empty verdict that refuses as `unsupported` until filled.
    pub fn new() -> Self {
        Self {
            kind: VERDICT_KIND.to_string(),
            renderer: spoken_intent::RENDERER_VERSION.to_string(),
            verifier: VERIFIER_VERSION.to_string(),
            request_digest: None,
            spoken_text_digest: None,
            audio_digest: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            policy_rule: None,
            expires_at_ms: 0,
            speaker_score_milli: None,
            word_margin_milli: None,
            heard: None,
        }
    }
}

impl Default for Verdict {
    fn default() -> Self {
        Self::new()
    }
}

/// The verdict's bytes: compact JSON, fields in declaration order.
pub fn verdict_json(verdict: &Verdict) -> String {
    serde_json::to_string(verdict).expect("verdict serializes")
}

/// The 32-byte message that the signing key signs.
pub fn verdict_message(verdict_json: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(VERDICT_DOMAIN.len() + verdict_json.len());
    preimage.extend_from_slice(VERDICT_DOMAIN);
    preimage.extend_from_slice(verdict_json);
    sha256(&preimage)
}

/// The `verify` output. `verdict_json` is a string, so its bytes reach the
/// Wallet as they were signed.
#[derive(Clone, Debug, Serialize)]
pub struct VerifyOutput {
    pub kind: &'static str,
    pub verdict_json: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: Option<String>,
    /// `ed25519:<base58>`: the key that the Wallet pins.
    pub public_key: Option<String>,
    /// The sentence of the policy rule on `step_up`, for the Wallet to show
    /// (not signed; the verdict names the rule id).
    pub policy_text: Option<&'static str>,
    /// Stage times inside the worker, in ms (not signed).
    pub ms: Map<String, Value>,
    /// A short error text for a refusal or a failed signature (not signed).
    pub detail: Option<String>,
}

pub const VERIFY_OUTPUT_KIND: &str = "seams_voice_verify_output_v2";

/// The `enroll` output.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Enrollment {
    pub kind: &'static str,
    pub verifier: &'static str,
    pub owner: Option<String>,
    pub outcome: Outcome,
    pub reason: Option<Reason>,
    /// The lowest pairwise speaker score of the three samples.
    pub agreement_milli: Option<i32>,
    /// The three canonical WAV digests, in input order.
    pub audio_digests: Vec<String>,
    /// base64url enrollment digest, which the owner's NEP-413 message
    /// names.
    pub enrollment_digest: Option<String>,
    /// The epoch of the written template: 1, then 1 more on each
    /// re-enrollment.
    pub template_epoch: Option<u32>,
    /// `ed25519:<base58>` of the verdict signing key, which the Wallet pins.
    pub verifier_public_key: Option<String>,
    pub ms: Map<String, Value>,
    pub detail: Option<String>,
}

impl Enrollment {
    pub fn new() -> Self {
        Self {
            kind: "seams_voice_enrollment_v3",
            verifier: VERIFIER_VERSION,
            owner: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            agreement_milli: None,
            audio_digests: Vec::new(),
            enrollment_digest: None,
            template_epoch: None,
            verifier_public_key: None,
            ms: Map::new(),
            detail: None,
        }
    }
}

impl Default for Enrollment {
    fn default() -> Self {
        Self::new()
    }
}

/// The output for an input without a known `op`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnknownOp {
    pub kind: &'static str,
    pub verifier: &'static str,
    pub outcome: Outcome,
    pub reason: Reason,
}

/// Cuts a detail text to at most 48 bytes at a char boundary.
pub fn short(text: &str) -> String {
    let mut end = text.len().min(48);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Serializes any output.
pub fn json_bytes<T: Serialize>(value: &T) -> Vec<u8> {
    let bytes = serde_json::to_vec(value).expect("output serializes");
    debug_assert!(bytes.len() < MAX_OUTPUT_BYTES, "{}", bytes.len());
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn verdict_has_thirteen_fields_in_order() {
        let text = verdict_json(&Verdict::new());
        assert_eq!(
            text,
            r#"{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.5.0","request_digest":null,"spoken_text_digest":null,"audio_digest":null,"outcome":"refuse","reason":"unsupported","policy_rule":null,"expires_at_ms":0,"speaker_score_milli":null,"word_margin_milli":null,"heard":null}"#
        );
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 13);
        assert_eq!(serde_json::to_value(Outcome::StepUp).unwrap(), "step_up");
    }

    #[test]
    fn reasons_serialize_in_snake_case() {
        let names: Vec<Value> = Reason::ALL.iter().map(|reason| serde_json::to_value(reason).unwrap()).collect();
        assert_eq!(
            Value::Array(names),
            json!([
                "quality", "speaker", "words", "audio_reused", "audio_invalid", "template_missing", "unsupported",
                "speaker_unavailable", "storage", "template_exists", "transcriber_unavailable", "not_authorized",
                "authorization_unavailable"
            ])
        );
    }

    #[test]
    fn message_is_the_domain_then_the_bytes() {
        let mut preimage = b"seams:outlayer:voice-verdict:v2".to_vec();
        preimage.extend_from_slice(b"{}");
        assert_eq!(verdict_message(b"{}"), sha256(&preimage));
    }
}
