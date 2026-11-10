//! The on-chain check of a signed voice verdict.
//!
//! The check is `seams-voice-verdict` (`crates/voice-verdict`) with the
//! ed25519 check of the host. It checks the signature over the exact bytes
//! that the contract receives, so the contract never serializes the verdict
//! again. Only an `accept` verdict passes: a `step_up` verdict does not.

use near_sdk::env;
pub use voice_verdict::{parse_ed25519_key, VERDICT_DOMAIN, VERDICT_KIND};
use voice_verdict::Check;

/// Panics unless the verdict is signed by `verifier_key`, accepts, has not
/// expired and is for `request_digest`. The panic text is the text of the
/// refusal (`voice_verdict::Refusal`).
pub fn check_verdict(
    verifier_key: &[u8; 32],
    request_digest: &[u8; 32],
    verdict_json: &str,
    signature_b64: &str,
) {
    let check = Check::at(env::block_timestamp_ms()).request(request_digest);
    if let Err(refusal) = voice_verdict::check_verdict_with(
        verdict_json,
        signature_b64,
        verifier_key,
        &check,
        |signature, message, key| env::ed25519_verify(signature, message, key),
    ) {
        env::panic_str(&refusal.to_string());
    }
}

/// `ed25519:<base58>`.
pub fn format_ed25519_key(key: &[u8; 32]) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(key).into_string())
}
