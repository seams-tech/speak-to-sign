//! The on-chain check of a signed voice verdict. The same check as in the voice multisig
//! contract (`../voice-multisig/src/verdict.rs`).
//!
//! The verifier signs `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` with
//! ed25519 and gives the signature as standard base64. The contract checks
//! the signature over the exact bytes it receives, so it never serializes
//! the verdict again.

use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use near_sdk::serde::Deserialize;
use near_sdk::serde::de::IgnoredAny;
use near_sdk::{env, serde_json};

/// The prefix of the signed message.
pub const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";
/// The only verdict kind that the contract accepts.
pub const VERDICT_KIND: &str = "seams_voice_signed_verdict_v2";
/// The only outcome that counts as a confirmation.
const ACCEPT: &str = "accept";

/// The 13 fields of the verdict. Each field must be present and no other
/// field is allowed. The contract reads four of them; the rest only have to
/// be there.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Verdict {
    kind: String,
    #[serde(rename = "renderer")]
    _renderer: IgnoredAny,
    #[serde(rename = "verifier")]
    _verifier: IgnoredAny,
    // `deserialize_with` makes a missing field an error, not `None`.
    #[serde(deserialize_with = "Option::deserialize")]
    request_digest: Option<String>,
    #[serde(rename = "spoken_text_digest")]
    _spoken_text_digest: IgnoredAny,
    #[serde(rename = "audio_digest")]
    _audio_digest: IgnoredAny,
    outcome: String,
    #[serde(rename = "reason")]
    _reason: IgnoredAny,
    #[serde(rename = "policy_rule")]
    _policy_rule: IgnoredAny,
    expires_at_ms: u64,
    #[serde(rename = "speaker_score_milli")]
    _speaker_score_milli: IgnoredAny,
    #[serde(rename = "word_margin_milli")]
    _word_margin_milli: IgnoredAny,
    #[serde(rename = "heard")]
    _heard: IgnoredAny,
}

/// Panics unless the verdict is signed by `verifier_key`, accepts, has not
/// expired and is for `request_digest`.
pub fn check_verdict(
    verifier_key: &[u8; 32],
    request_digest: &[u8; 32],
    verdict_json: &str,
    signature_b64: &str,
) {
    let signature: [u8; 64] = STANDARD
        .decode(signature_b64)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .unwrap_or_else(|| env::panic_str("signature_b64 must be standard base64 of 64 bytes"));
    if !env::ed25519_verify(&signature, verdict_message(verdict_json), verifier_key) {
        env::panic_str("the verdict signature does not match the verifier key");
    }

    let verdict: Verdict = serde_json::from_str(verdict_json)
        .unwrap_or_else(|e| env::panic_str(&format!("verdict_json is not a verdict: {e}")));
    if verdict.kind != VERDICT_KIND {
        env::panic_str("the verdict kind must be seams_voice_signed_verdict_v2");
    }
    if verdict.outcome != ACCEPT {
        env::panic_str("the verdict outcome must be accept");
    }
    if verdict.expires_at_ms < env::block_timestamp_ms() {
        env::panic_str("the verdict has expired");
    }
    if verdict.request_digest.as_deref() != Some(URL_SAFE_NO_PAD.encode(request_digest).as_str()) {
        env::panic_str("the verdict is for another request");
    }
}

/// `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)`.
fn verdict_message(verdict_json: &str) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(VERDICT_DOMAIN.len() + verdict_json.len());
    preimage.extend_from_slice(VERDICT_DOMAIN);
    preimage.extend_from_slice(verdict_json.as_bytes());
    env::sha256_array(&preimage)
}

/// Parses `ed25519:<base58 of 32 bytes>`.
pub fn parse_ed25519_key(text: &str) -> Option<[u8; 32]> {
    let base58 = text.strip_prefix("ed25519:")?;
    near_sdk::bs58::decode(base58)
        .into_vec()
        .ok()?
        .try_into()
        .ok()
}

/// `ed25519:<base58>`.
pub fn format_ed25519_key(key: &[u8; 32]) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(key).into_string())
}
