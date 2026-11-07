//! Fixed values of this verifier version. A change to any of them is a new
//! WASM hash. The vault pins the signing key, not the hash (plan Section 7.5).

/// The verifier version that every output names.
pub const VERIFIER_VERSION: &str = "0.2.0";

/// The manifest, also linked into the `outlayer.manifest` custom section.
pub const MANIFEST_JSON: &str = include_str!("../manifest/outlayer.json");

/// The declared signing key (manifest `signing_keys`, `bind: "project"`).
/// The keystore derives it from the project and the caller: over HTTPS the
/// caller is the payment-key owner.
pub const SIGNING_KEY_PATH: &str = "verdict";

/// The prefix of the signed preimage:
/// `signed message = SHA-256(VERDICT_DOMAIN || verdict JSON bytes)`.
pub const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v1";

/// The speaker service host: ReDimNet in a Phala Cloud dstack CVM. To move
/// it, change this name and the same `host` in `manifest/outlayer.json` (a
/// test checks that the two agree).
macro_rules! speaker_host {
    () => {
        "627a3cc63411c2f454cb43695a3747f54618482c-8080.dstack-pha1-prod5.phala.network"
    };
}
pub const SPEAKER_HOST: &str = speaker_host!();
pub const SPEAKER_EMBED_URL: &str = concat!("https://", speaker_host!(), "/v1/embed");
pub const SPEAKER_TIMEOUT_SECS: u64 = 30;
pub const SPEAKER_MAX_RESPONSE_BYTES: usize = 8_192;

/// The speaker service key, pinned after its attestation was checked on
/// 2026-11-07: TDX report_data = sha256("seams:speaker-service:v1" || key ||
/// ReDimNet hash), compose-hash 8429e4c7…1bab, os-image-hash of dstack-0.6.1.
pub const SPEAKER_PINNED_KEY_HEX: &str = "1f704027a643874bc8f4d9391065881cf66c9c8c72d6f5241739b21d9a5235e3";

/// The prefix of the preimage that the speaker service signs.
pub const SPEAKER_EMBED_DOMAIN: &[u8] = b"seams:speaker-embedding:v1";

/// ReDimNet B1: the model that the speaker service must name (lowercase hex
/// SHA-256). A template records it.
pub const REDIMNET_SHA256_HEX: &str = "e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269";

/// The NEAR AI Cloud host, endpoint, model and language.
pub const NEAR_AI_HOST: &str = "cloud-api.near.ai";
pub const NEAR_AI_TRANSCRIPTIONS_URL: &str = "https://cloud-api.near.ai/v1/audio/transcriptions";
pub const NEAR_AI_MODEL: &str = "openai/whisper-large-v3";
pub const NEAR_AI_LANGUAGE: &str = "en";
/// The OutLayer secret (an environment variable) with the NEAR AI API key.
pub const NEAR_AI_API_KEY_ENV: &str = "NEAR_AI_API_KEY";
pub const NEAR_AI_TIMEOUT_SECS: u64 = 30;
pub const NEAR_AI_MAX_RESPONSE_BYTES: usize = 65_536;

/// The speaker cutoff in thousandths of cosine. The Wallet uses 0.45
/// (`VOICE_MATCH_THRESHOLD`).
pub const SPEAKER_CUTOFF_MILLI: i32 = 450;

/// ReDimNet embedding size.
pub const EMBEDDING_DIM: usize = 192;

/// Audio sample rate.
pub const SAMPLE_RATE: u32 = 16_000;

/// At most 8 s of audio (plan Section 7.2).
pub const MAX_SAMPLES: usize = 8 * SAMPLE_RATE as usize;

/// Energy gate frame: 512 samples (32 ms), as the Wallet's VAD frame.
pub const GATE_FRAME: usize = 512;

/// A frame is voiced at or above this RMS (the Wallet's `LEVEL_THRESHOLD`).
pub const GATE_LEVEL_RMS: f32 = 0.006;

/// At least this much voiced audio (the Wallet's `REQUIRED_VOICED_MS`).
pub const GATE_MIN_VOICED_MS: u32 = 600;

/// At most this share of samples, in thousandths, may be at full scale.
pub const GATE_MAX_CLIPPED_PERMILLE: u32 = 10;

/// At most this many contacts in a verify input (plan Section 7.2).
pub const MAX_CONTACTS: usize = 32;

/// `enroll` takes exactly this many recordings (plan Section 4.4).
pub const ENROLL_RECORDINGS: usize = 3;

/// The template epoch that a template records. The vault does not check it.
pub const TEMPLATE_EPOCH: u32 = 1;

/// The `heard` field is cut to this many bytes, or fewer if the output
/// would not fit.
pub const MAX_HEARD_BYTES: usize = 200;

/// Every output stays below this size.
pub const MAX_OUTPUT_BYTES: usize = 1024;

/// Storage key of a template. Over HTTPS the storage cell is the payment-key
/// owner, so the key names the vault and the owner. Account ids hold no `:`.
pub fn template_key(vault: &str, owner: &str) -> String {
    format!("template:v2:{vault}:{owner}")
}

/// Raw storage key of a used audio digest (base64url of the canonical WAV
/// SHA-256). It is not secret: the digest is public in each verdict.
pub fn audio_used_key(digest_b64u: &str) -> String {
    format!("audio:v2:{digest_b64u}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn manifest_matches_the_constants() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        assert_eq!(manifest["operations"], json!(["enroll", "verify"]));
        // HTTPS calls: no callers block, and the default storage cell (the
        // payment-key owner).
        assert!(manifest.get("callers").is_none());
        assert!(manifest.get("storage_account").is_none());
        let network = manifest["capabilities"]["network"].as_array().unwrap();
        let hosts: Vec<&str> = network.iter().map(|entry| entry["host"].as_str().unwrap()).collect();
        assert_eq!(hosts, [SPEAKER_HOST, NEAR_AI_HOST]);
        assert_eq!(network[0]["timeout_secs"], SPEAKER_TIMEOUT_SECS);
        assert_eq!(network[1]["timeout_secs"], NEAR_AI_TIMEOUT_SECS);
        assert_eq!(
            manifest["signing_keys"],
            json!([{ "path": SIGNING_KEY_PATH, "type": "ed25519", "bind": "project" }])
        );
        assert!(SPEAKER_EMBED_URL.starts_with(&format!("https://{SPEAKER_HOST}/")));
        assert!(NEAR_AI_TRANSCRIPTIONS_URL.starts_with(&format!("https://{NEAR_AI_HOST}/")));
    }

    #[test]
    fn storage_keys_name_vault_and_owner() {
        assert_eq!(template_key("v.testnet", "o.testnet"), "template:v2:v.testnet:o.testnet");
        assert_ne!(template_key("a.testnet", "b.testnet"), template_key("b.testnet", "a.testnet"));
        assert_eq!(audio_used_key("abc"), "audio:v2:abc");
    }
}
