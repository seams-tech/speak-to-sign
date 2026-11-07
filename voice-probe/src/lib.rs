//! Refactor 210, task E: a latency probe for the HTTPS path (plan Sections
//! 7.5 and 11.5).
//!
//! One operation, `verify_latency`. It does the work of a verify run and
//! times each stage with `Instant`:
//!
//! 1. `decode`: parse the input JSON, the base64 and the WAV.
//! 2. `redimnet_fetch`, `redimnet_load`, `redimnet_run`: ReDimNet B1 with its
//!    pinned SHA-256, in `tract` (not in the `tiny` build).
//! 3. `transcribe`: Whisper large-v3 on NEAR AI Cloud.
//! 4. `words`: `spoken_intent::normalize_punctuated` against `expected`.
//! 5. `sign`: ed25519 over a 32-byte digest that this probe composes, with
//!    the manifest signing key `latency` (`bind: "project"`, as an HTTPS project call needs).
//!
//! A stage that fails records an error and the run goes on, so one output
//! shows every stage. The output stays below [`MAX_OUTPUT_BYTES`].
//!
//! Everything here is pure, so native tests cover it. `main.rs` supplies the
//! OutLayer host for `wasm32-wasip2`.
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use spoken_intent::{normalize_punctuated, PunctuatedRefusal, SpokenAccount, SpokenToken};
use std::time::Instant;

/// The probe version that every output names.
pub const PROBE_VERSION: &str = "0.1.0";

/// The manifest, also linked into the `outlayer.manifest` custom section.
#[cfg(not(feature = "speaker-service"))]
pub const MANIFEST_JSON: &str = include_str!("../manifest/outlayer.json");
#[cfg(feature = "speaker-service")]
pub const MANIFEST_JSON: &str = include_str!("../manifest/outlayer-speaker.json");

/// True if this build skips ReDimNet and `tract`.
pub const TINY: bool = cfg!(feature = "tiny") || !cfg!(feature = "redimnet");

/// True if this build gets the embedding from the speaker service, at the
/// same time as the transcript.
pub const SPEAKER: bool = cfg!(feature = "speaker-service");

/// The speaker service host. To point the probe at a deployed CVM, change
/// this name and the same `host` in `manifest/outlayer-speaker.json` (a test
/// checks that the two agree). A Phala Cloud app URL has the form
/// `<app-id>-8080.<gateway domain>`.
macro_rules! speaker_host {
    () => {
        "627a3cc63411c2f454cb43695a3747f54618482c-8080.dstack-pha1-prod5.phala.network"
    };
}
pub const SPEAKER_HOST: &str = speaker_host!();
pub const SPEAKER_EMBED_URL: &str = concat!("https://", speaker_host!(), "/v1/embed");
pub const SPEAKER_TIMEOUT_SECS: u64 = 30;
pub const SPEAKER_MAX_RESPONSE_BYTES: usize = 8_192;

/// Optional secret: the service public key (64 hex characters) from its
/// verified `/v1/attestation`. If it is set, a reply signed by another key
/// fails. If it is not set, the probe checks the signature only.
pub const SPEAKER_PUBLIC_KEY_ENV: &str = "SPEAKER_PUBLIC_KEY_HEX";

/// The speaker service key, pinned after its attestation was checked on
/// 2026-11-07: TDX report_data = sha256("seams:speaker-service:v1" || key ||
/// ReDimNet hash), compose-hash 8429e4c7…1bab, os-image-hash of dstack-0.6.1.
/// A reply signed by any other key fails; there is no unpinned mode.
pub const SPEAKER_PINNED_KEY_HEX: &str = "1f704027a643874bc8f4d9391065881cf66c9c8c72d6f5241739b21d9a5235e3";

/// Release builds use the pinned key only. Tests may set the key through the
/// environment, because their fake service signs with its own key.
#[cfg(feature = "speaker-service")]
fn pinned_speaker_key(host: &mut dyn Host) -> Result<Option<[u8; 32]>, &'static str> {
    if cfg!(test) {
        if let Some(text) = host.env(SPEAKER_PUBLIC_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty()) {
            return hex32(&text).map(Some).ok_or("bad_pinned_key");
        }
    }
    hex32(SPEAKER_PINNED_KEY_HEX).map(Some).ok_or("bad_pinned_key")
}

/// The prefix of the preimage that the speaker service signs.
pub const SPEAKER_EMBED_DOMAIN: &[u8] = b"seams:speaker-embedding:v1";

/// The only operation.
pub const OP: &str = "verify_latency";

/// The declared signing key path (manifest `signing_keys`).
pub const SIGNING_KEY_PATH: &str = "latency";

/// The host that serves the speaker model.
pub const MODEL_HOST: &str = "test.sign.seams.sh";

/// ReDimNet B1: URL and lowercase hex SHA-256 (as the verifier pins it).
pub const REDIMNET_URL: &str = "https://test.sign.seams.sh/sdk/voiceid/redimnet-b1.onnx";
pub const REDIMNET_SHA256: &str = "e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269";

/// ReDimNet embedding size.
pub const EMBEDDING_DIM: usize = 192;

/// The NEAR AI host, endpoint, model and language (as the verifier).
pub const NEAR_AI_HOST: &str = "cloud-api.near.ai";
pub const NEAR_AI_TRANSCRIPTIONS_URL: &str = "https://cloud-api.near.ai/v1/audio/transcriptions";
pub const NEAR_AI_MODEL: &str = "openai/whisper-large-v3";
pub const NEAR_AI_LANGUAGE: &str = "en";
pub const NEAR_AI_API_KEY_ENV: &str = "NEAR_AI_API_KEY";
pub const NEAR_AI_TIMEOUT_SECS: u64 = 30;
pub const NEAR_AI_MAX_RESPONSE_BYTES: usize = 65_536;

/// Audio sample rate.
pub const SAMPLE_RATE: u32 = 16_000;

/// At most 8 s of audio (plan Section 7.2).
pub const MAX_SAMPLES: usize = 8 * SAMPLE_RATE as usize;

/// Every output stays below this size, so a run resolves in one call.
pub const MAX_OUTPUT_BYTES: usize = 1024;

/// The prefix of the signed digest's preimage. The probe signs only a digest
/// that it composes itself, never caller bytes.
pub const DIGEST_DOMAIN: &[u8] = b"seams:outlayer:voice-probe-latency:v1|";

/// Edge punctuation that is removed from a word of `expected` before the
/// account check (as `normalize_punctuated`).
const EDGE: [char; 7] = [',', '.', '!', '?', ';', ':', '"'];

// ---------------------------------------------------------------------------
// Input

/// The parsed input.
#[derive(Debug, PartialEq)]
pub struct Input {
    /// 16 kHz mono PCM16 samples.
    pub pcm: Vec<i16>,
    /// SHA-256 of the WAV bytes as sent.
    pub audio_sha256: [u8; 32],
    /// The text that the speaker must say.
    pub expected: String,
    /// Contacts for the recipient step: the `contacts` field, and each
    /// account id in `expected`.
    pub contacts: Vec<SpokenAccount>,
}

#[derive(Deserialize)]
struct RawInput {
    op: String,
    audio_wav_b64: String,
    expected: String,
    #[serde(default)]
    contacts: Vec<String>,
}

/// Parses `{"op":"verify_latency","audio_wav_b64":"...","expected":"...",
/// "contacts":[...]?}`.
pub fn parse_input(bytes: &[u8]) -> Result<Input, String> {
    let raw: RawInput = serde_json::from_slice(bytes).map_err(|_| "bad_input_json".to_string())?;
    if raw.op != OP {
        return Err("unknown_op".into());
    }
    let wav = base64::engine::general_purpose::STANDARD
        .decode(raw.audio_wav_b64.trim())
        .map_err(|_| "bad_base64".to_string())?;
    let pcm = decode_wav(&wav)?;
    let mut contacts = Vec::new();
    for id in raw.contacts.iter().map(String::as_str).chain(accounts_in(&raw.expected)) {
        let account = SpokenAccount::new(&id.to_ascii_lowercase()).map_err(|_| "contact_not_speakable".to_string())?;
        if !contacts.contains(&account) {
            contacts.push(account);
        }
    }
    Ok(Input { pcm, audio_sha256: Sha256::digest(&wav).into(), expected: raw.expected, contacts })
}

/// The account ids that `expected` names: words with a letter and a `.`,
/// after the edge punctuation is removed.
fn accounts_in(expected: &str) -> impl Iterator<Item = &str> {
    expected
        .split_ascii_whitespace()
        .map(|word| word.trim_matches(&EDGE[..]))
        .filter(|word| word.contains('.') && word.chars().any(|c| c.is_ascii_alphabetic()))
}

// ---------------------------------------------------------------------------
// WAV

/// Reads a RIFF WAV: PCM (or WAVE_FORMAT_EXTENSIBLE with PCM), 16 kHz, mono,
/// 16-bit, 1 to [`MAX_SAMPLES`] samples. Other chunks (`LIST`) are skipped.
pub fn decode_wav(bytes: &[u8]) -> Result<Vec<i16>, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not_wav".into());
    }
    let mut at = 12;
    let mut format_ok = false;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let body_start = at + 8;
        let body_end = body_start.checked_add(size).ok_or("bad_wav_chunk")?;
        if id == b"data" {
            if !format_ok {
                return Err("wav_data_before_fmt".into());
            }
            // Some writers set a data size past the end; take what is there.
            let data = &bytes[body_start..body_end.min(bytes.len())];
            let samples = data.len() / 2;
            if samples == 0 || samples > MAX_SAMPLES {
                return Err("wav_length".into());
            }
            return Ok(data.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])).collect());
        }
        if body_end > bytes.len() {
            return Err("bad_wav_chunk".into());
        }
        if id == b"fmt " {
            let fmt = &bytes[body_start..body_end];
            if fmt.len() < 16 {
                return Err("bad_wav_fmt".into());
            }
            let tag = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let rate = u32::from_le_bytes(fmt[4..8].try_into().unwrap());
            let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
            // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID starts with the tag.
            let pcm = tag == 1 || (tag == 0xFFFE && fmt.len() >= 26 && fmt[24..26] == [1, 0]);
            if !pcm || channels != 1 || rate != SAMPLE_RATE || bits != 16 {
                return Err("wav_not_16k_mono_pcm16".into());
            }
            format_ok = true;
        }
        // Chunks are padded to an even size.
        at = body_end + (size & 1);
    }
    Err("wav_no_data".into())
}

/// PCM16 samples to a 44-byte-header WAV at [`SAMPLE_RATE`].
pub fn wav_bytes(pcm: &[i16]) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len() * 2);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in pcm {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

/// PCM16 to samples in [-1, 1).
pub fn to_f32(pcm: &[i16]) -> Vec<f32> {
    pcm.iter().map(|sample| f32::from(*sample) / 32_768.0).collect()
}

// ---------------------------------------------------------------------------
// NEAR AI

/// One HTTPS POST.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub timeout_secs: u64,
    pub max_response_bytes: usize,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `multipart/form-data` with exactly `model`, `language` and `file`; the
/// boundary comes from the WAV digest, so it is not in the body.
pub fn multipart_body(wav: &[u8]) -> (String, Vec<u8>) {
    let boundary = format!("seams{}", hex(&Sha256::digest(wav)));
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in [("model", NEAR_AI_MODEL), ("language", NEAR_AI_LANGUAGE)] {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// The POST to NEAR AI, without the network.
pub fn transcription_request(api_key: &str, pcm: &[i16]) -> PostRequest {
    let (content_type, body) = multipart_body(&wav_bytes(pcm));
    PostRequest {
        url: NEAR_AI_TRANSCRIPTIONS_URL.to_string(),
        headers: vec![
            ("Authorization".to_string(), format!("Bearer {api_key}")),
            ("Content-Type".to_string(), content_type),
            ("x-no-aliasing".to_string(), "true".to_string()),
        ],
        body,
        timeout_secs: NEAR_AI_TIMEOUT_SECS,
        max_response_bytes: NEAR_AI_MAX_RESPONSE_BYTES,
    }
}

/// Reads a reply: status 200 and `{"text": "<not blank>"}`.
pub fn parse_reply(status: u16, body: &[u8]) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Reply {
        text: Option<String>,
    }
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Reply = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    let text = reply.text.ok_or("bad_reply")?;
    if text.trim().is_empty() {
        return Err("no_text".into());
    }
    Ok(text)
}

// ---------------------------------------------------------------------------
// Speaker service

/// The POST to the speaker service: `{"audio_wav_b64", "nonce"}`.
pub fn speaker_request(wav: &[u8], nonce: &[u8; 32]) -> PostRequest {
    let body = json!({
        "audio_wav_b64": base64::engine::general_purpose::STANDARD.encode(wav),
        "nonce": hex(nonce),
    });
    PostRequest {
        url: SPEAKER_EMBED_URL.to_string(),
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: body.to_string().into_bytes(),
        timeout_secs: SPEAKER_TIMEOUT_SECS,
        max_response_bytes: SPEAKER_MAX_RESPONSE_BYTES,
    }
}

/// The 32-byte message that the speaker service signs:
/// `SHA-256(SPEAKER_EMBED_DOMAIN || audio_digest || nonce || model_sha256 ||
/// embedding bytes)`.
pub fn speaker_message(audio_digest: &[u8; 32], nonce: &[u8; 32], model_sha256: &[u8; 32], embedding_le: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SPEAKER_EMBED_DOMAIN);
    hasher.update(audio_digest);
    hasher.update(nonce);
    hasher.update(model_sha256);
    hasher.update(embedding_le);
    hasher.finalize().into()
}

/// A checked speaker service reply.
#[derive(Debug, PartialEq)]
pub struct SpeakerReply {
    pub embedding: Vec<f32>,
    pub public_key: [u8; 32],
    /// The service's own model time (not signed).
    pub model_ms: Option<u64>,
}

#[cfg(feature = "speaker-service")]
fn hex32(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64 {
        return None;
    }
    let mut out = [0; 32];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(text.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// Checks a reply: status 200; `audio_digest`, `nonce` and `model_sha256`
/// are the values that the worker sent and pins; 192 finite f32 values; an
/// ed25519 signature (strict) over [`speaker_message`] by `public_key`, which
/// must be `pinned` if it is given.
#[cfg(feature = "speaker-service")]
pub fn check_speaker_reply(
    status: u16,
    body: &[u8],
    audio_digest: &[u8; 32],
    nonce: &[u8; 32],
    pinned: Option<[u8; 32]>,
) -> Result<SpeakerReply, String> {
    use ed25519_dalek::{Signature, VerifyingKey};

    #[derive(Deserialize)]
    struct Reply {
        embedding_b64: String,
        audio_digest: String,
        model_sha256: String,
        nonce: String,
        public_key: String,
        signature: String,
        model_ms: Option<u64>,
    }
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Reply = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    let digest = hex32(&reply.audio_digest).ok_or("bad_reply")?;
    let model = hex32(&reply.model_sha256).ok_or("bad_reply")?;
    let echoed = hex32(&reply.nonce).ok_or("bad_reply")?;
    let public_key = hex32(&reply.public_key).ok_or("bad_reply")?;
    let signature: [u8; 64] = (0..64)
        .map(|index| reply.signature.get(index * 2..index * 2 + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok()))
        .collect::<Option<Vec<u8>>>()
        .filter(|_| reply.signature.len() == 128)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or("bad_reply")?;
    if &digest != audio_digest {
        return Err("audio_digest_mismatch".into());
    }
    if &echoed != nonce {
        return Err("nonce_mismatch".into());
    }
    if hex(&model) != REDIMNET_SHA256 {
        return Err("model_not_pinned".into());
    }
    if pinned.is_some_and(|pinned| pinned != public_key) {
        return Err("public_key_not_pinned".into());
    }
    let embedding_le = base64::engine::general_purpose::STANDARD
        .decode(reply.embedding_b64.trim())
        .map_err(|_| "bad_reply".to_string())?;
    if embedding_le.len() != EMBEDDING_DIM * 4 {
        return Err("embedding_length".into());
    }
    let message = speaker_message(&digest, &echoed, &model, &embedding_le);
    VerifyingKey::from_bytes(&public_key)
        .and_then(|key| key.verify_strict(&message, &Signature::from_bytes(&signature)))
        .map_err(|_| "bad_signature".to_string())?;
    let embedding: Vec<f32> =
        embedding_le.chunks_exact(4).map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap())).collect();
    if embedding.iter().any(|value| !value.is_finite()) {
        return Err("embedding_not_finite".into());
    }
    Ok(SpeakerReply { embedding, public_key, model_ms: reply.model_ms })
}

// ---------------------------------------------------------------------------
// Word check

/// The result of the word check.
#[derive(Debug, PartialEq, Eq)]
pub struct WordCheck {
    /// The heard tokens joined with spaces, or the cleaned transcript if it
    /// does not normalize.
    pub heard: String,
    pub matched: bool,
    /// Why a side did not normalize: `heard_<refusal>` or `expected_<refusal>`.
    pub refusal: Option<String>,
}

fn refusal_name(refusal: PunctuatedRefusal) -> &'static str {
    match refusal {
        PunctuatedRefusal::NotNormalizable => "not_normalizable",
        PunctuatedRefusal::RecipientUnkeyable => "recipient_unkeyable",
        PunctuatedRefusal::RecipientNotContact => "recipient_not_contact",
        PunctuatedRefusal::RecipientAmbiguous => "recipient_ambiguous",
    }
}

fn join(tokens: &[SpokenToken]) -> String {
    tokens.iter().map(SpokenToken::as_str).collect::<Vec<_>>().join(" ")
}

/// Keeps `a-z`, digits, apostrophes and single spaces.
fn printable(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '\'' { c.to_ascii_lowercase() } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Both texts go through `normalize_punctuated` with the same contacts; the
/// tokens must be equal.
pub fn check_words(transcript: &str, expected: &str, contacts: &[SpokenAccount]) -> WordCheck {
    let heard = normalize_punctuated(transcript, contacts);
    let wanted = normalize_punctuated(expected, contacts);
    let heard_text = match &heard {
        Ok(tokens) => join(tokens),
        Err(_) => printable(transcript),
    };
    let refusal = match (&heard, &wanted) {
        (_, Err(refusal)) => Some(format!("expected_{}", refusal_name(*refusal))),
        (Err(refusal), _) => Some(format!("heard_{}", refusal_name(*refusal))),
        _ => None,
    };
    let matched = matches!((&heard, &wanted), (Ok(a), Ok(b)) if a == b);
    WordCheck { heard: heard_text, matched, refusal }
}

// ---------------------------------------------------------------------------
// Signed digest

/// The 32-byte digest that the probe signs:
/// `SHA-256(DIGEST_DOMAIN || audio SHA-256 || matched (1 byte) ||
/// heard length (u32 LE) || heard)`. The fixed prefix keeps it from being
/// the hash of a NEAR transaction or any other caller-chosen structure.
pub fn verdict_digest(audio_sha256: &[u8; 32], matched: bool, heard: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DIGEST_DOMAIN);
    hasher.update(audio_sha256);
    hasher.update([u8::from(matched)]);
    hasher.update((heard.len() as u32).to_le_bytes());
    hasher.update(heard.as_bytes());
    hasher.finalize().into()
}

// ---------------------------------------------------------------------------
// The run

/// What the run needs from the worker.
pub trait Host {
    /// An environment variable (an OutLayer secret).
    fn env(&self, name: &str) -> Option<String>;
    /// HTTPS POST: (status, body).
    fn post(&mut self, request: &PostRequest) -> Result<(u16, Vec<u8>), String>;
    /// GET ReDimNet and check its pinned SHA-256. Returns the byte count.
    fn redimnet_fetch(&mut self) -> Result<usize, String>;
    /// Parse the fetched model and build its typed plan for `samples`.
    fn redimnet_load(&mut self, samples: usize) -> Result<(), String>;
    /// Run the plan: the output length (192 for an embedding).
    fn redimnet_run(&mut self, samples: &[f32]) -> Result<usize, String>;
    /// ed25519 over `message` with the declared key: (signature, public key).
    fn sign(&mut self, message: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String>;
    /// Sends every request at once and waits for all of them. Each result
    /// has its time from the start of the batch to the end of its response
    /// body.
    #[cfg(feature = "speaker-service")]
    fn post_concurrent(&mut self, requests: &[PostRequest]) -> Vec<Timed>;
    /// 32 random bytes for the speaker service nonce.
    #[cfg(feature = "speaker-service")]
    fn nonce(&mut self) -> Result<[u8; 32], String>;
}

/// One result of [`Host::post_concurrent`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Timed {
    pub result: Result<(u16, Vec<u8>), String>,
    pub ms: u64,
}

/// Stage names in run order.
pub const STAGES: [&str; 7] =
    ["decode", "redimnet_fetch", "redimnet_load", "redimnet_run", "transcribe", "words", "sign"];

/// Stage names of the `speaker-service` build, in run order. `parallel` is
/// the wall time of both calls; `speaker` and `transcribe` are each call's
/// time inside it; `speaker_check` is the reply and signature check.
pub const SPEAKER_STAGES: [&str; 7] = ["decode", "parallel", "speaker", "transcribe", "speaker_check", "words", "sign"];

/// One run's record.
#[derive(Debug, Default)]
pub struct Report {
    pub stages: Vec<(&'static str, u64)>,
    pub errors: Vec<(&'static str, String)>,
    pub total_ms: u64,
    pub samples: usize,
    pub matched: Option<bool>,
    pub heard: Option<String>,
    pub digest: Option<[u8; 32]>,
    pub signature: Option<Vec<u8>>,
    pub public_key: Option<Vec<u8>>,
    pub embedding_len: Option<usize>,
    /// The speaker service: its key, its own model time, and whether the key
    /// matched the pinned secret.
    pub speaker_public_key: Option<[u8; 32]>,
    pub speaker_model_ms: Option<u64>,
    pub speaker_pinned: Option<bool>,
}

impl Report {
    fn stage<T>(&mut self, name: &'static str, work: impl FnOnce() -> Result<T, String>) -> Option<T> {
        let started = Instant::now();
        let result = work();
        self.stages.push((name, started.elapsed().as_millis() as u64));
        match result {
            Ok(value) => Some(value),
            Err(error) => {
                self.errors.push((name, error));
                None
            }
        }
    }

    fn skipped(&mut self, name: &'static str, why: &str) {
        self.errors.push((name, format!("skipped_{why}")));
    }
}

/// The `speaker-service` build: the speaker service POST and the NEAR AI
/// POST go out together (one [`Host::post_concurrent`] batch). Then the
/// speaker reply and its signature are checked. Returns the transcript.
#[cfg(feature = "speaker-service")]
fn speaker_and_transcript(report: &mut Report, host: &mut dyn Host, pcm: &[i16]) -> Option<String> {
    let wav = wav_bytes(pcm);
    let audio_digest: [u8; 32] = Sha256::digest(&wav).into();
    let nonce = host.nonce().map_err(|error| report.errors.push(("speaker", format!("nonce: {error}")))).ok();
    let api_key = host.env(NEAR_AI_API_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty());
    let pinned = pinned_speaker_key(host);

    let mut requests = Vec::new();
    let speaker_index = nonce.map(|nonce| {
        requests.push(speaker_request(&wav, &nonce));
        requests.len() - 1
    });
    let near_index = api_key.as_ref().map(|key| {
        requests.push(transcription_request(key, pcm));
        requests.len() - 1
    });
    let started = Instant::now();
    let results = if requests.is_empty() { Vec::new() } else { host.post_concurrent(&requests) };
    report.stages.push(("parallel", started.elapsed().as_millis() as u64));
    let take = |index: Option<usize>| index.and_then(|index| results.get(index).cloned());

    let speaker = match take(speaker_index) {
        Some(timed) => {
            report.stages.push(("speaker", timed.ms));
            timed.result.map_err(|error| report.errors.push(("speaker", format!("network: {error}")))).ok()
        }
        None => None,
    };
    let transcript = match take(near_index) {
        Some(timed) => {
            report.stages.push(("transcribe", timed.ms));
            match timed.result.map_err(|error| format!("network: {error}")).and_then(|(status, body)| parse_reply(status, &body)) {
                Ok(text) => Some(text),
                Err(error) => {
                    report.errors.push(("transcribe", error));
                    None
                }
            }
        }
        None => {
            report.errors.push(("transcribe", "no_api_key".into()));
            None
        }
    };

    match (speaker, nonce) {
        (Some((status, body)), Some(nonce)) => {
            let pinned_key = pinned.clone().ok().flatten();
            let checked = report.stage("speaker_check", || {
                check_speaker_reply(status, &body, &audio_digest, &nonce, pinned.map_err(String::from)?)
            });
            if let Some(reply) = checked {
                report.embedding_len = Some(reply.embedding.len());
                report.speaker_public_key = Some(reply.public_key);
                report.speaker_model_ms = reply.model_ms;
                report.speaker_pinned = Some(pinned_key.is_some());
            }
        }
        _ => report.skipped("speaker_check", "no_reply"),
    }
    transcript
}

/// Runs `verify_latency` on the raw input bytes.
pub fn run(input: &[u8], host: &mut dyn Host) -> Report {
    let started = Instant::now();
    let mut report = Report::default();
    let Some(input) = report.stage("decode", || parse_input(input)) else {
        report.total_ms = started.elapsed().as_millis() as u64;
        return report;
    };
    report.samples = input.pcm.len();

    if !TINY {
        let samples = to_f32(&input.pcm);
        if report.stage("redimnet_fetch", || host.redimnet_fetch()).is_none() {
            report.skipped("redimnet_load", "fetch_failed");
        } else if report.stage("redimnet_load", || host.redimnet_load(samples.len())).is_none() {
            report.skipped("redimnet_run", "load_failed");
        } else {
            report.embedding_len = report.stage("redimnet_run", || host.redimnet_run(&samples));
        }
    }

    #[cfg(not(feature = "speaker-service"))]
    let transcript = report.stage("transcribe", || {
        let key = host
            .env(NEAR_AI_API_KEY_ENV)
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
            .ok_or("no_api_key")?;
        let request = transcription_request(&key, &input.pcm);
        let (status, body) = host.post(&request).map_err(|error| format!("network: {error}"))?;
        parse_reply(status, &body)
    });
    #[cfg(feature = "speaker-service")]
    let transcript = speaker_and_transcript(&mut report, host, &input.pcm);

    let (matched, heard) = match transcript {
        Some(text) => {
            let check = report.stage("words", || Ok::<_, String>(check_words(&text, &input.expected, &input.contacts)));
            let check = check.expect("infallible");
            if let Some(refusal) = check.refusal {
                report.errors.push(("words", refusal));
            }
            (check.matched, check.heard)
        }
        None => {
            report.skipped("words", "no_transcript");
            (false, String::new())
        }
    };
    report.matched = Some(matched);
    report.heard = Some(heard.clone());

    let digest = verdict_digest(&input.audio_sha256, matched, &heard);
    report.digest = Some(digest);
    if let Some((signature, public_key)) = report.stage("sign", || host.sign(&digest)) {
        report.signature = Some(signature);
        report.public_key = Some(public_key);
    }
    report.total_ms = started.elapsed().as_millis() as u64;
    report
}

/// Cuts text at a char boundary at or below `max` bytes.
fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

impl Report {
    fn to_value(&self, heard_max: usize, error_max: usize) -> Value {
        let mut stages = Map::new();
        for (name, ms) in &self.stages {
            stages.insert((*name).to_string(), json!(ms));
        }
        let mut errors = Map::new();
        for (name, error) in &self.errors {
            errors.insert((*name).to_string(), json!(cut(error, error_max)));
        }
        let b64 = base64::engine::general_purpose::STANDARD;
        #[allow(unused_mut)]
        let mut value = json!({
            "ok": self.errors.is_empty(),
            "op": OP,
            "v": PROBE_VERSION,
            "tiny": TINY,
            "samples": self.samples,
            "ms": stages,
            "total_ms": self.total_ms,
            "errors": errors,
            "matched": self.matched,
            "heard": self.heard.as_deref().map(|heard| cut(heard, heard_max)),
            "emb": self.embedding_len,
            "digest": self.digest.map(|digest| hex(&digest)),
            "sig": self.signature.as_ref().map(|signature| b64.encode(signature)),
            "pk": self.public_key.as_ref().map(|key| hex(key)),
        });
        #[cfg(feature = "speaker-service")]
        {
            value["spk_ms"] = json!(self.speaker_model_ms);
            value["spk_pk"] = json!(self.speaker_public_key.as_ref().map(|key| hex(key)));
            value["spk_pinned"] = json!(self.speaker_pinned);
        }
        value
    }

    /// The output JSON, below [`MAX_OUTPUT_BYTES`]: `heard` and the error
    /// texts are cut until it fits.
    pub fn to_json(&self) -> String {
        for (heard_max, error_max) in [(256, 120), (160, 80), (80, 48), (32, 24), (0, 12), (0, 0)] {
            let text = self.to_value(heard_max, error_max).to_string();
            if text.len() < MAX_OUTPUT_BYTES {
                return text;
            }
        }
        json!({ "ok": false, "op": OP, "v": PROBE_VERSION, "errors": { "output": "too_large" } }).to_string()
    }
}

/// The output of a run on raw input bytes.
pub fn run_json(input: &[u8], host: &mut dyn Host) -> String {
    run(input, host).to_json()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn tone(samples: usize) -> Vec<i16> {
        (0..samples).map(|i| ((i as f32 * 0.05).sin() * 4_000.0) as i16).collect()
    }

    fn input_json(wav: &[u8], expected: &str) -> Vec<u8> {
        json!({
            "op": OP,
            "audio_wav_b64": base64::engine::general_purpose::STANDARD.encode(wav),
            "expected": expected,
        })
        .to_string()
        .into_bytes()
    }

    #[derive(Default)]
    struct Fake {
        env: HashMap<String, String>,
        reply: Option<(u16, Vec<u8>)>,
        posts: Vec<PostRequest>,
        signed: Vec<Vec<u8>>,
        fetch_fails: bool,
        #[cfg_attr(not(feature = "speaker-service"), allow(dead_code))]
        speaker_tamper: bool,
    }

    impl Host for Fake {
        fn env(&self, name: &str) -> Option<String> {
            self.env.get(name).cloned()
        }
        fn post(&mut self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
            self.posts.push(request.clone());
            self.reply.clone().ok_or_else(|| "down".to_string())
        }
        fn redimnet_fetch(&mut self) -> Result<usize, String> {
            if self.fetch_fails {
                Err("status 404".into())
            } else {
                Ok(6_000_000)
            }
        }
        fn redimnet_load(&mut self, _samples: usize) -> Result<(), String> {
            Ok(())
        }
        fn redimnet_run(&mut self, _samples: &[f32]) -> Result<usize, String> {
            Ok(EMBEDDING_DIM)
        }
        fn sign(&mut self, message: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
            self.signed.push(message.to_vec());
            Ok((vec![7; 64], vec![9; 32]))
        }
        #[cfg(feature = "speaker-service")]
        fn post_concurrent(&mut self, requests: &[PostRequest]) -> Vec<Timed> {
            requests
                .iter()
                .map(|request| {
                    let result = if request.url == SPEAKER_EMBED_URL {
                        self.posts.push(request.clone());
                        Ok((200, speaker::reply(request, self.speaker_tamper)))
                    } else {
                        self.post(request)
                    };
                    Timed { result, ms: 5 }
                })
                .collect()
        }
        #[cfg(feature = "speaker-service")]
        fn nonce(&mut self) -> Result<[u8; 32], String> {
            Ok([0x5a; 32])
        }
    }

    /// A speaker service stand-in that signs as the real one does.
    #[cfg(feature = "speaker-service")]
    mod speaker {
        use super::*;
        use ed25519_dalek::{Signer, SigningKey};

        pub const SEED: [u8; 32] = [0x11; 32];

        pub fn public_key() -> [u8; 32] {
            SigningKey::from_bytes(&SEED).verifying_key().to_bytes()
        }

        /// `tamper` changes one embedding byte after the signature.
        pub fn reply(request: &PostRequest, tamper: bool) -> Vec<u8> {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            let wav = base64::engine::general_purpose::STANDARD.decode(body["audio_wav_b64"].as_str().unwrap()).unwrap();
            let nonce = hex32(body["nonce"].as_str().unwrap()).unwrap();
            let digest: [u8; 32] = Sha256::digest(&wav).into();
            let model = hex32(REDIMNET_SHA256).unwrap();
            let mut embedding: Vec<u8> = (0..EMBEDDING_DIM).flat_map(|i| (i as f32 / 100.0).to_le_bytes()).collect();
            let signature = SigningKey::from_bytes(&SEED).sign(&speaker_message(&digest, &nonce, &model, &embedding));
            if tamper {
                embedding[0] ^= 1;
            }
            json!({
                "embedding_b64": base64::engine::general_purpose::STANDARD.encode(&embedding),
                "audio_digest": hex(&digest),
                "model_sha256": REDIMNET_SHA256,
                "nonce": hex(&nonce),
                "public_key": hex(&public_key()),
                "signature": hex(&signature.to_bytes()),
                "model_ms": 120,
            })
            .to_string()
            .into_bytes()
        }
    }

    fn output(fake: &mut Fake, input: &[u8]) -> Value {
        let text = run_json(input, fake);
        assert!(text.len() < MAX_OUTPUT_BYTES, "{} bytes", text.len());
        serde_json::from_str(&text).unwrap()
    }

    #[cfg(feature = "speaker-service")]
    #[test]
    fn speaker_manifest_declares_the_speaker_host_and_near_ai() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        assert_eq!(manifest["operations"], json!([OP]));
        let network = manifest["capabilities"]["network"].as_array().unwrap();
        let hosts: Vec<&str> = network.iter().map(|entry| entry["host"].as_str().unwrap()).collect();
        assert_eq!(hosts, [SPEAKER_HOST, NEAR_AI_HOST]);
        assert_eq!(network[0]["timeout_secs"], SPEAKER_TIMEOUT_SECS);
        assert!(SPEAKER_EMBED_URL.starts_with(&format!("https://{SPEAKER_HOST}/")));
        // The other builds' manifest must not gain the speaker host.
        let other: Value = serde_json::from_str(include_str!("../manifest/outlayer.json")).unwrap();
        assert!(!other.to_string().contains(SPEAKER_HOST));
    }

    #[cfg(feature = "speaker-service")]
    #[test]
    fn speaker_reply_checks() {
        let wav = wav_bytes(&tone(16_000));
        let digest: [u8; 32] = Sha256::digest(&wav).into();
        let nonce = [0x5a; 32];
        let request = speaker_request(&wav, &nonce);
        let good = speaker::reply(&request, false);
        let reply = check_speaker_reply(200, &good, &digest, &nonce, None).unwrap();
        assert_eq!(reply.embedding.len(), EMBEDDING_DIM);
        assert_eq!(reply.embedding[1], 0.01);
        assert_eq!(reply.public_key, speaker::public_key());
        assert_eq!(reply.model_ms, Some(120));
        assert!(check_speaker_reply(200, &good, &digest, &nonce, Some(speaker::public_key())).is_ok());
        let check = |body: &[u8], digest: &[u8; 32], nonce: &[u8; 32], pinned| {
            check_speaker_reply(200, body, digest, nonce, pinned).unwrap_err()
        };
        assert_eq!(check(&good, &digest, &nonce, Some([1; 32])), "public_key_not_pinned");
        assert_eq!(check(&good, &[0; 32], &nonce, None), "audio_digest_mismatch");
        assert_eq!(check(&good, &digest, &[0; 32], None), "nonce_mismatch");
        assert_eq!(check(&speaker::reply(&request, true), &digest, &nonce, None), "bad_signature");
        let mut other_model: Value = serde_json::from_slice(&good).unwrap();
        other_model["model_sha256"] = json!("00".repeat(32));
        assert_eq!(check(other_model.to_string().as_bytes(), &digest, &nonce, None), "model_not_pinned");
        assert_eq!(check(b"{}", &digest, &nonce, None), "bad_reply");
        assert_eq!(check_speaker_reply(502, &good, &digest, &nonce, None).unwrap_err(), "status_502");
    }

    #[cfg(feature = "speaker-service")]
    #[test]
    fn speaker_build_sends_both_requests_in_one_batch() {
        let mut fake = Fake::default();
        fake.env.insert(NEAR_AI_API_KEY_ENV.into(), "sk-1".into());
        fake.env.insert(SPEAKER_PUBLIC_KEY_ENV.into(), hex(&speaker::public_key()));
        fake.reply = Some((200, br#"{"text":" Send 2 NEAR to alice.testnet."}"#.to_vec()));
        let out = output(&mut fake, &input_json(&wav_bytes(&tone(48_000)), "Send two NEAR to alice.testnet"));
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(fake.posts.len(), 2);
        assert_eq!(fake.posts[0].url, SPEAKER_EMBED_URL);
        assert_eq!(fake.posts[1].url, NEAR_AI_TRANSCRIPTIONS_URL);
        assert_eq!(out["emb"], EMBEDDING_DIM);
        assert_eq!(out["spk_ms"], 120);
        assert_eq!(out["spk_pinned"], true);
        assert_eq!(out["spk_pk"], hex(&speaker::public_key()));

        let mut tampered = Fake { speaker_tamper: true, ..Fake::default() };
        tampered.env.insert(NEAR_AI_API_KEY_ENV.into(), "sk-1".into());
        tampered.env.insert(SPEAKER_PUBLIC_KEY_ENV.into(), hex(&speaker::public_key()));
        tampered.reply = fake.reply.clone();
        let out = output(&mut tampered, &input_json(&wav_bytes(&tone(48_000)), "send two near"));
        assert_eq!(out["errors"]["speaker_check"], "bad_signature");
        assert!(out["emb"].is_null());
    }

    #[cfg(not(feature = "speaker-service"))]
    #[test]
    fn manifest_declares_the_op_hosts_and_wasm_key() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        assert_eq!(manifest["operations"], json!([OP]));
        assert!(manifest.get("callers").is_none());
        let network = manifest["capabilities"]["network"].as_array().unwrap();
        let hosts: Vec<&str> = network.iter().map(|entry| entry["host"].as_str().unwrap()).collect();
        assert_eq!(hosts, [MODEL_HOST, NEAR_AI_HOST]);
        assert_eq!(network[1]["timeout_secs"], NEAR_AI_TIMEOUT_SECS);
        assert_eq!(
            manifest["signing_keys"],
            json!([{ "path": SIGNING_KEY_PATH, "type": "ed25519", "bind": "project" }])
        );
        assert!(REDIMNET_URL.starts_with(&format!("https://{MODEL_HOST}/")));
        assert!(NEAR_AI_TRANSCRIPTIONS_URL.starts_with(&format!("https://{NEAR_AI_HOST}/")));
    }

    #[test]
    fn wav_round_trip_and_extra_chunks() {
        let pcm = tone(1_600);
        assert_eq!(decode_wav(&wav_bytes(&pcm)).unwrap(), pcm);
        // ffmpeg adds a LIST chunk before data; an odd chunk is padded.
        let plain = wav_bytes(&pcm);
        let mut with_list = plain[..36].to_vec();
        with_list.extend_from_slice(b"LIST");
        with_list.extend_from_slice(&3u32.to_le_bytes());
        with_list.extend_from_slice(b"abc\0");
        with_list.extend_from_slice(&plain[36..]);
        assert_eq!(decode_wav(&with_list).unwrap(), pcm);
    }

    #[test]
    fn wav_refusals() {
        let pcm = tone(100);
        let wav = wav_bytes(&pcm);
        assert_eq!(decode_wav(b"nope"), Err("not_wav".into()));
        let mut stereo = wav.clone();
        stereo[22] = 2;
        assert_eq!(decode_wav(&stereo), Err("wav_not_16k_mono_pcm16".into()));
        let mut rate = wav.clone();
        rate[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        assert_eq!(decode_wav(&rate), Err("wav_not_16k_mono_pcm16".into()));
        assert_eq!(decode_wav(&wav_bytes(&[])), Err("wav_length".into()));
        assert_eq!(decode_wav(&wav_bytes(&vec![0; MAX_SAMPLES + 1])), Err("wav_length".into()));
        assert_eq!(decode_wav(&wav[..36]), Err("wav_no_data".into()));
    }

    #[test]
    fn multipart_has_three_fields_and_no_prompt() {
        let pcm = tone(800);
        let request = transcription_request("sk-test", &pcm);
        assert_eq!(request.url, NEAR_AI_TRANSCRIPTIONS_URL);
        assert_eq!(request.headers[0].1, "Bearer sk-test");
        let text = String::from_utf8_lossy(&request.body);
        assert_eq!(text.matches("Content-Disposition").count(), 3);
        assert!(text.contains("openai/whisper-large-v3"));
        assert!(!text.contains("prompt"));
        let wav = wav_bytes(&pcm);
        assert!(request.body.windows(wav.len()).any(|window| window == wav));
    }

    #[test]
    fn replies() {
        assert_eq!(parse_reply(200, br#"{"text":"hi"}"#).unwrap(), "hi");
        assert_eq!(parse_reply(503, b""), Err("status_503".into()));
        assert_eq!(parse_reply(200, br#"{"text":" "}"#), Err("no_text".into()));
        assert_eq!(parse_reply(200, b"x"), Err("bad_reply".into()));
    }

    #[test]
    fn input_contacts_come_from_expected() {
        let wav = wav_bytes(&tone(1_000));
        let input = parse_input(&input_json(&wav, "Send 2 NEAR to alice.testnet.")).unwrap();
        assert_eq!(input.contacts.len(), 1);
        assert_eq!(input.contacts[0].as_str(), "alice.testnet");
        assert_eq!(input.pcm.len(), 1_000);
        assert_eq!(input.audio_sha256, <[u8; 32]>::from(Sha256::digest(&wav)));
        let wrong_op = json!({"op": "verify", "audio_wav_b64": "", "expected": ""}).to_string();
        assert_eq!(parse_input(wrong_op.as_bytes()), Err("unknown_op".into()));
        assert_eq!(parse_input(b"{}"), Err("bad_input_json".into()));
    }

    #[test]
    fn word_check_matches_whisper_style_text() {
        let contacts = [SpokenAccount::new("alice.testnet").unwrap()];
        let check = check_words(" Send 2 NEAR to Alice.testnet.", "Send two NEAR to alice dot testnet", &contacts);
        assert_eq!(check, WordCheck { heard: "send two near to alice dot testnet".into(), matched: true, refusal: None });
        let wrong = check_words("Send 3 NEAR to alice.testnet.", "Send two NEAR to alice dot testnet", &contacts);
        assert!(!wrong.matched);
        assert_eq!(wrong.refusal, None);
        let stranger = check_words("Send 2 NEAR to bob.testnet", "Send two NEAR to alice.testnet", &contacts);
        assert_eq!(stranger.refusal.as_deref(), Some("heard_recipient_not_contact"));
        assert!(!stranger.matched);
    }

    #[test]
    fn digest_binds_every_field() {
        let base = verdict_digest(&[1; 32], true, "send two near");
        assert_ne!(base, verdict_digest(&[2; 32], true, "send two near"));
        assert_ne!(base, verdict_digest(&[1; 32], false, "send two near"));
        assert_ne!(base, verdict_digest(&[1; 32], true, "send three near"));
        let mut hasher = Sha256::new();
        hasher.update(DIGEST_DOMAIN);
        hasher.update([1; 32]);
        hasher.update([1]);
        hasher.update(13u32.to_le_bytes());
        hasher.update(b"send two near");
        assert_eq!(base, <[u8; 32]>::from(hasher.finalize()));
    }

    #[test]
    fn full_run_times_every_stage_and_signs_the_digest() {
        let mut fake = Fake::default();
        fake.env.insert(NEAR_AI_API_KEY_ENV.into(), " sk-1 ".into());
        fake.reply = Some((200, br#"{"text":" Send 2 NEAR to alice.testnet."}"#.to_vec()));
        #[cfg(feature = "speaker-service")]
        fake.env.insert(SPEAKER_PUBLIC_KEY_ENV.into(), hex(&speaker::public_key()));
        let wav = wav_bytes(&tone(48_000));
        let out = output(&mut fake, &input_json(&wav, "Send two NEAR to alice.testnet"));
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["matched"], true);
        assert_eq!(out["heard"], "send two near to alice dot testnet");
        let names: Vec<&str> = out["ms"].as_object().unwrap().keys().map(String::as_str).collect();
        let mut expected: Vec<&str> = if SPEAKER {
            SPEAKER_STAGES.to_vec()
        } else {
            STAGES.iter().copied().filter(|s| !TINY || !s.starts_with("redimnet")).collect()
        };
        expected.sort();
        assert_eq!(names, expected);
        let near: Vec<&PostRequest> = fake.posts.iter().filter(|post| post.url == NEAR_AI_TRANSCRIPTIONS_URL).collect();
        assert_eq!(near[0].headers[0].1, "Bearer sk-1");
        // The probe signs the 32-byte digest it composed, nothing else.
        let digest = verdict_digest(&Sha256::digest(&wav).into(), true, "send two near to alice dot testnet");
        assert_eq!(fake.signed, [digest.to_vec()]);
        assert_eq!(out["digest"], hex(&digest));
        assert_eq!(out["sig"].as_str().unwrap().len(), 88);
        assert_eq!(out["pk"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn missing_key_is_an_error_stage_and_the_run_still_signs() {
        let mut fake = Fake::default();
        let out = output(&mut fake, &input_json(&wav_bytes(&tone(1_000)), "send two near"));
        assert_eq!(out["ok"], false);
        assert_eq!(out["errors"]["transcribe"], "no_api_key");
        assert_eq!(out["errors"]["words"], "skipped_no_transcript");
        assert_eq!(out["matched"], false);
        assert!(fake.posts.iter().all(|post| post.url != NEAR_AI_TRANSCRIPTIONS_URL));
        assert_eq!(fake.signed.len(), 1);
        assert!(out["ms"]["sign"].is_u64());
    }

    #[test]
    fn network_failure_and_bad_input() {
        let mut fake = Fake::default();
        fake.env.insert(NEAR_AI_API_KEY_ENV.into(), "k".into());
        fake.fetch_fails = !TINY;
        let out = output(&mut fake, &input_json(&wav_bytes(&tone(1_000)), "send two near"));
        assert_eq!(out["errors"]["transcribe"], "network: down");
        if !TINY {
            assert_eq!(out["errors"]["redimnet_fetch"], "status 404");
            assert_eq!(out["errors"]["redimnet_load"], "skipped_fetch_failed");
        }
        let bad = output(&mut Fake::default(), b"not json");
        assert_eq!(bad["errors"]["decode"], "bad_input_json");
        assert!(bad["ms"]["decode"].is_u64());
    }

    #[test]
    fn output_stays_below_the_limit() {
        let mut report = Report::default();
        for name in STAGES {
            report.stages.push((name, u64::MAX));
            report.errors.push((name, "e".repeat(2_000)));
        }
        report.heard = Some("word ".repeat(400));
        report.digest = Some([0; 32]);
        report.signature = Some(vec![0; 64]);
        report.public_key = Some(vec![0; 32]);
        report.matched = Some(false);
        report.speaker_public_key = Some([0; 32]);
        report.speaker_model_ms = Some(u64::MAX);
        report.speaker_pinned = Some(false);
        for name in SPEAKER_STAGES {
            report.stages.push((name, u64::MAX));
            report.errors.push((name, "e".repeat(2_000)));
        }
        let text = report.to_json();
        assert!(text.len() < MAX_OUTPUT_BYTES, "{}", text.len());
        let value: Value = serde_json::from_str(&text).unwrap();
        assert!(value["sig"].is_string());
    }
}
