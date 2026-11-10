//! Fixed values of this verifier version. A change to any of them is a new
//! WASM hash. The Wallet pins the signing key, not the hash.

/// The verifier version that every output names.
pub const VERIFIER_VERSION: &str = "0.8.0";

/// The manifest, for the test that checks it against these values.
/// `main.rs` links the same file into the `outlayer.manifest` custom section.
#[cfg(test)]
const MANIFEST_JSON: &str = include_str!("../manifest/outlayer.json");

/// The declared signing key (manifest `signing_keys`, `bind: "project"`).
/// The keystore derives it from the project and the caller: over HTTPS the
/// caller is the payment-key owner.
pub const SIGNING_KEY_PATH: &str = "verdict";

/// The prefix of the signed preimage:
/// `signed message = SHA-256(VERDICT_DOMAIN || verdict JSON bytes)`.
pub const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";

/// The prefix of the signed preimage of a transcript:
/// `signed message = SHA-256(TRANSCRIPT_DOMAIN || transcript JSON bytes)`.
/// It is not the verdict prefix, so no signature of a transcript is a
/// signature of a verdict.
pub const TRANSCRIPT_DOMAIN: &[u8] = b"seams:outlayer:voice-transcript:v1";

/// The text of a signed transcript is cut to this many bytes (8 s of speech
/// are about 20 words), so that the output stays below [`MAX_OUTPUT_BYTES`]
/// with the longest owner and stage times.
pub const MAX_TRANSCRIPT_BYTES: usize = 200;

/// A verdict expires this long after the worker clock read before signing.
pub const VERDICT_TTL_MS: u64 = 120_000;

/// The speaker service host: ReDimNet in a Phala Cloud dstack CVM. To move
/// it, change this name and the same `host` in `manifest/outlayer.json` (a
/// test checks that the two agree).
macro_rules! speaker_host {
    () => {
        "627a3cc63411c2f454cb43695a3747f54618482c-8080.dstack-pha1-prod5.phala.network"
    };
}
#[cfg(test)]
const SPEAKER_HOST: &str = speaker_host!();
pub const SPEAKER_EMBED_URL: &str = concat!("https://", speaker_host!(), "/v1/embed");
pub const SPEAKER_TIMEOUT_SECS: u64 = 30;
pub const SPEAKER_MAX_RESPONSE_BYTES: usize = 8_192;

/// The speaker service key, pinned after its attestation was checked on
/// 2026-11-07: TDX report_data = sha256("seams:speaker-service:v1" || key ||
/// ReDimNet hash), compose-hash 8429e4c7…1bab, os-image-hash of dstack-0.6.1.
pub const SPEAKER_PINNED_KEY_HEX: &str = "1f704027a643874bc8f4d9391065881cf66c9c8c72d6f5241739b21d9a5235e3";

/// The prefix of the preimage that the speaker service signs.
pub const SPEAKER_EMBED_DOMAIN: &[u8] = b"seams:speaker-embedding:v1";

/// The host of the model file for the `local-speaker` build: FastFS, the
/// file store on NEAR. The worker downloads the file only if its storage
/// does not hold the model (`model_cache`). It refuses the bytes unless
/// their SHA-256 is the pinned digest, so the host is not trusted for the
/// model. To move
/// the file, change this name and the same `host` in
/// `manifest/outlayer-local-speaker.json` (a test checks that the two agree).
macro_rules! model_host {
    () => {
        "test.fastfs.io"
    };
}

/// One speaker model: every value that changes with the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpeakerModel {
    /// A short name, for people.
    pub name: &'static str,
    /// Lowercase hex SHA-256 of the ONNX file. The speaker service must name
    /// it, the `local-speaker` build refuses any other bytes, and a template
    /// records it.
    pub sha256_hex: &'static str,
    /// Where the `local-speaker` build fetches the file.
    pub url: &'static str,
    /// The size of the file. A larger download is an error.
    pub bytes: usize,
    /// The number of values of one embedding.
    pub embedding_dim: usize,
    /// The speaker cutoff in thousandths of cosine. It belongs to the
    /// model: another model needs its own measured cutoff.
    pub cutoff_milli: i32,
    /// The name of the ONNX output node with the embedding.
    pub output: &'static str,
}

/// ReDimNet B1, the model of the Wallet (`@seams/voiceid`) and of the
/// speaker service. The Wallet uses the cutoff 0.45
/// (`VOICE_MATCH_THRESHOLD`).
pub const REDIMNET_B1: SpeakerModel = SpeakerModel {
    name: "redimnet-b1",
    sha256_hex: "e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269",
    // Uploaded from `seams-v1.testnet` on 2026-11-10 (9 transactions to
    // `outlayer.testnet`; the first is HVcxZzvRH2ne3uq4cELgmHEBkhmf96nxM5uiFFztVvbw).
    url: concat!(
        "https://",
        model_host!(),
        "/seams-v1.testnet/outlayer.testnet/e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269.onnx"
    ),
    bytes: 8_859_593,
    embedding_dim: 192,
    cutoff_milli: 450,
    output: "embedding",
};

/// The speaker model of this build. To use another model (for example
/// another ReDimNet size), add its [`SpeakerModel`] and name it here. The
/// speaker service must run the same file. A template of another model is
/// not read: its owner enrolls again. See README.md, "Another speaker
/// model".
pub const SPEAKER_MODEL: SpeakerModel = REDIMNET_B1;

/// The digest of [`SPEAKER_MODEL`].
pub const REDIMNET_SHA256_HEX: &str = SPEAKER_MODEL.sha256_hex;

/// [`SPEAKER_MODEL`] values for the `local-speaker` build.
pub const REDIMNET_BYTES: usize = SPEAKER_MODEL.bytes;
pub const REDIMNET_URL: &str = SPEAKER_MODEL.url;
pub const REDIMNET_TIMEOUT_SECS: u64 = 30;
#[cfg(test)]
const MODEL_HOST: &str = model_host!();

/// The manifest of the `local-speaker` build. `main.rs` links it in place of
/// `manifest/outlayer.json`.
#[cfg(test)]
const LOCAL_SPEAKER_MANIFEST_JSON: &str = include_str!("../manifest/outlayer-local-speaker.json");

/// The NEAR AI Cloud host, endpoint, model and language.
#[cfg(test)]
const NEAR_AI_HOST: &str = "cloud-api.near.ai";
pub const NEAR_AI_TRANSCRIPTIONS_URL: &str = "https://cloud-api.near.ai/v1/audio/transcriptions";
pub const NEAR_AI_MODEL: &str = "openai/whisper-large-v3";
pub const NEAR_AI_LANGUAGE: &str = "en";
/// The OutLayer secret (an environment variable) with the NEAR AI API key.
pub const NEAR_AI_API_KEY_ENV: &str = "NEAR_AI_API_KEY";
pub const NEAR_AI_TIMEOUT_SECS: u64 = 30;
pub const NEAR_AI_MAX_RESPONSE_BYTES: usize = 65_536;

/// The NEAR RPC endpoint that `enroll` reads the owner's access key from
/// (`view_access_key`, finality `final`). The verifier trusts this endpoint
/// for that read (see README.md).
macro_rules! near_rpc_host {
    () => {
        "test.rpc.fastnear.com"
    };
}
#[cfg(test)]
const NEAR_RPC_HOST: &str = near_rpc_host!();
pub const NEAR_RPC_URL: &str = concat!("https://", near_rpc_host!(), "/");
pub const NEAR_RPC_TIMEOUT_SECS: u64 = 10;
pub const NEAR_RPC_MAX_RESPONSE_BYTES: usize = 8_192;

/// The prefix of the enrollment digest preimage:
/// `SHA-256(ENROLLMENT_DOMAIN || owner || 0x00 || d1 || d2 || d3)`.
pub const ENROLLMENT_DOMAIN: &[u8] = b"seams:voice-enrollment:v2";

/// The NEP-413 message that authorizes an enrollment is this prefix and the
/// base64url enrollment digest.
pub const ENROLLMENT_MESSAGE_PREFIX: &str = "Speak-to-Sign voice enrollment ";

/// The NEP-413 recipient of the enrollment message: this OutLayer project.
pub const ENROLLMENT_RECIPIENT: &str = "seams-v1.testnet/voice-verifier";

/// The NEP-413 prefix tag, `2^31 + 413`, written as `u32` little-endian
/// before the Borsh payload, so the signed bytes are never a transaction.
pub const NEP413_TAG: u32 = 2_147_484_061;

/// The speaker cutoff of [`SPEAKER_MODEL`], in thousandths of cosine.
pub const SPEAKER_CUTOFF_MILLI: i32 = SPEAKER_MODEL.cutoff_milli;

/// The embedding size of [`SPEAKER_MODEL`].
pub const EMBEDDING_DIM: usize = SPEAKER_MODEL.embedding_dim;

/// Audio sample rate.
pub const SAMPLE_RATE: u32 = 16_000;

/// At most 8 s of audio.
pub const MAX_SAMPLES: usize = 8 * SAMPLE_RATE as usize;

/// Energy gate frame: 512 samples (32 ms), as the Wallet's VAD frame.
pub const GATE_FRAME: usize = 512;

/// A frame is voiced at or above this RMS (the Wallet's `LEVEL_THRESHOLD`).
pub const GATE_LEVEL_RMS: f32 = 0.006;

/// At least this much voiced audio (the Wallet's `REQUIRED_VOICED_MS`).
pub const GATE_MIN_VOICED_MS: u32 = 600;

/// At most this share of samples, in thousandths, may be at full scale.
pub const GATE_MAX_CLIPPED_PERMILLE: u32 = 10;

/// At most this many contacts in a verify input.
pub const MAX_CONTACTS: usize = 32;

/// `select` takes 2 to this many candidate requests.
pub const MAX_SELECT_REQUESTS: usize = 16;

/// `enroll` takes exactly this many recordings.
pub const ENROLL_RECORDINGS: usize = 3;

/// The epoch of a first template. Each re-enrollment adds 1.
pub const TEMPLATE_EPOCH: u32 = 1;

/// The `heard` field is cut to this many bytes, or fewer if the output
/// would not fit.
pub const MAX_HEARD_BYTES: usize = 200;

/// Every output stays below this size.
pub const MAX_OUTPUT_BYTES: usize = 1024;

/// Storage key of a template. Over HTTPS the storage cell is the payment-key
/// owner, so the key names the account whose voice it is.
pub fn template_key(owner: &str) -> String {
    format!("template:v3:{owner}")
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
        assert_eq!(manifest["operations"], json!(["enroll", "verify", "select", "transcribe"]));
        // HTTPS calls: no callers block, and the default storage cell (the
        // payment-key owner).
        assert!(manifest.get("callers").is_none());
        assert!(manifest.get("storage_account").is_none());
        let network = manifest["capabilities"]["network"].as_array().unwrap();
        let hosts: Vec<&str> = network.iter().map(|entry| entry["host"].as_str().unwrap()).collect();
        assert_eq!(hosts, [SPEAKER_HOST, NEAR_AI_HOST, NEAR_RPC_HOST]);
        assert_eq!(network[0]["timeout_secs"], SPEAKER_TIMEOUT_SECS);
        assert_eq!(network[1]["timeout_secs"], NEAR_AI_TIMEOUT_SECS);
        assert_eq!(network[2]["timeout_secs"], NEAR_RPC_TIMEOUT_SECS);
        assert!(NEAR_RPC_URL.starts_with(&format!("https://{NEAR_RPC_HOST}/")));
        assert_eq!(
            manifest["signing_keys"],
            json!([{ "path": SIGNING_KEY_PATH, "type": "ed25519", "bind": "project" }])
        );
        assert!(SPEAKER_EMBED_URL.starts_with(&format!("https://{SPEAKER_HOST}/")));
        assert!(NEAR_AI_TRANSCRIPTIONS_URL.starts_with(&format!("https://{NEAR_AI_HOST}/")));
    }

    /// The `local-speaker` manifest is the default manifest with the model
    /// host in place of the speaker service host.
    #[test]
    fn local_speaker_manifest_differs_only_in_the_first_host() {
        let mut manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        let local: Value = serde_json::from_str(LOCAL_SPEAKER_MANIFEST_JSON).unwrap();
        assert_eq!(local["capabilities"]["network"][0]["host"], MODEL_HOST);
        assert_eq!(local["capabilities"]["network"][0]["timeout_secs"], REDIMNET_TIMEOUT_SECS);
        assert!(REDIMNET_URL.starts_with(&format!("https://{MODEL_HOST}/")));
        manifest["capabilities"]["network"][0] = local["capabilities"]["network"][0].clone();
        manifest["display"] = local["display"].clone();
        assert_eq!(manifest, local);
    }

    #[test]
    fn storage_keys_name_the_owner() {
        assert_eq!(template_key("o.testnet"), "template:v3:o.testnet");
        assert_eq!(audio_used_key("abc"), "audio:v2:abc");
    }

    #[test]
    fn nep413_tag_is_two_to_the_31_plus_413() {
        assert_eq!(NEP413_TAG, (1 << 31) + 413);
    }
}
