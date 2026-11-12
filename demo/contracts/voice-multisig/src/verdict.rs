//! The on-chain check of a signed voice verdict.
//!
//! The check is `seams-voice-verdict` (`crates/voice-verdict`) with the
//! ed25519 check of the host. It checks the signature over the exact bytes
//! that the contract receives, so the contract never serializes the verdict
//! again. Only an `accept` verdict passes: a `step_up` verdict does not.

use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::URL_SAFE_NO_PAD;
use near_sdk::env;
pub use voice_verdict::{parse_ed25519_key, VERDICT_DOMAIN, VERDICT_KIND};
use voice_verdict::Check;

/// Checks the verdict and returns the digest of its recording. Panics
/// unless the verdict is signed by `verifier_key`, accepts, has not expired
/// and is for `request_digest`; the panic text is the text of the refusal
/// (`voice_verdict::Refusal`). An accept always has an audio digest, so a
/// verdict without one panics too.
pub fn check_verdict(
    verifier_key: &[u8; 32],
    request_digest: &[u8; 32],
    verdict_json: &str,
    signature_b64: &str,
) -> [u8; 32] {
    let check = Check::at(env::block_timestamp_ms()).request(request_digest);
    let verdict = voice_verdict::check_verdict_with(
        verdict_json,
        signature_b64,
        verifier_key,
        &check,
        |signature, message, key| env::ed25519_verify(signature, message, key),
    )
    .unwrap_or_else(|refusal| env::panic_str(&refusal.to_string()));
    verdict
        .audio_digest
        .and_then(|text| URL_SAFE_NO_PAD.decode(text).ok())
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .unwrap_or_else(|| env::panic_str("the verdict has no audio digest of 32 bytes"))
}

/// `ed25519:<base58>`.
pub fn format_ed25519_key(key: &[u8; 32]) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(key).into_string())
}
