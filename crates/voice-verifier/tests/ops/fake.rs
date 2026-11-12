//! The fake host, the shared input builders and the verdict checks.
use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::audio::wav_bytes;
use seams_voice_verifier::authorization::{authorization_message, enrollment_digest, nep413_hash};
use seams_voice_verifier::config::{
    AUDIO_INFO, AUDIO_KEY_ENV, EMBEDDING_DIM, ENROLLMENT_RECIPIENT, MAX_OUTPUT_BYTES, NEAR_AI_API_KEY_ENV,
    NEAR_AI_ATTESTATION_URL, NEAR_AI_CHAT_URL, NEAR_AI_GATEWAY_KEY_HEX, NEAR_AI_GATEWAY_RECORD_KEY, NEAR_AI_OHTTP_URL,
    NEAR_AI_SYSTEMONE_URL, NEAR_RPC_URL, REDIMNET_SHA256_HEX, SPEAKER_EMBED_URL, VENICE_API_KEY_ENV,
    VENICE_TRANSCRIPTIONS_URL,
};
use seams_voice_verifier::digest::{b64u, base58, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::envelope::{audio_aad, AudioKey};
use seams_voice_verifier::host::{GetRequest, Host, LocalEmbeddings, PostRequest, Reply, Timed};
use seams_voice_verifier::nearai_attestation::Gateway;
use seams_voice_verifier::ohttp::gateway::{bhttp_response_bytes, GatewayKey};
use seams_voice_verifier::output::{verdict_message, Verdict};
use seams_voice_verifier::speaker_client::service_message;
use seams_voice_verifier::{run_with, Pins};

const SPEAKER_SEED: [u8; 32] = [0x11; 32];
pub(crate) const VERDICT_SEED: [u8; 32] = [0x22; 32];
/// The owner's full-access key.
pub(crate) const OWNER_SEED: [u8; 32] = [0x33; 32];
pub(crate) const OWNER: &str = "owner.testnet";
/// The audio key secret, as the keystore gives a `hex32` value.
pub(crate) const AUDIO_KEY_HEX: &str = "5555555555555555555555555555555555555555555555555555555555555555";
/// The fake wall clock, in ms since the UNIX epoch.
pub(crate) const NOW_MS: u64 = 1_762_700_000_000;
pub(crate) const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// A clip: a 2 s tone at `step` radians per sample.
pub(crate) fn clip(step: f32) -> Vec<u8> {
    let pcm: Vec<i16> = (0..32_000).map(|i| ((i as f32 * step).sin() * 3_000.0) as i16).collect();
    wav_bytes(&pcm)
}

/// A unit vector along `axis`, turned toward `axis + 1` by `angle`.
pub(crate) fn embedding(axis: usize, angle: f32) -> Vec<f32> {
    let mut values = vec![0f32; EMBEDDING_DIM];
    values[axis] = angle.cos();
    values[axis + 1] = angle.sin();
    values
}

/// The recorded report of the NEAR AI gateway (for the nonce of
/// [`Fake::random32`]) and Intel's recorded collateral for it.
const NEAR_AI_REPORT: &[u8] = include_bytes!("../../testdata/nearai_report_v1.json");
const INTEL_COLLATERAL: &str = include_str!("../../testdata/nearai_collateral_v1.json");

/// The OHTTP key of the fake NEAR AI gateway.
pub(crate) fn fake_gateway() -> GatewayKey {
    GatewayKey::derive(b"the fake NEAR AI gateway", 1)
}

/// Where the Whisper request of this build goes: the OHTTP route of NEAR AI,
/// or Venice AI with the feature `venice`.
pub(crate) const WORDS_URL: &str = if cfg!(feature = "venice") { VENICE_TRANSCRIPTIONS_URL } else { NEAR_AI_OHTTP_URL };

/// The host events of a call in this build. The `venice` build has no
/// gateway record, so it does not read the worker storage for one.
pub(crate) fn events_of(default_build: &[&'static str]) -> Vec<&'static str> {
    default_build.iter().copied().filter(|event| !cfg!(feature = "venice") || *event != "worker_get").collect()
}

/// A checked gateway record of the fake gateway's key, checked at `at_ms`.
pub(crate) fn gateway_record(at_ms: u64) -> Vec<u8> {
    Gateway {
        gateway_key: NEAR_AI_GATEWAY_KEY_HEX.into(),
        key_config: hex(&fake_gateway().config_bytes()),
        compose_hash: "00".repeat(32),
        tcb_status: "UpToDate".into(),
        quote_sha256: "00".repeat(32),
        checked_at_ms: at_ms,
    }
    .to_record()
}

/// What the fake NEAR AI attestation endpoint and Intel PCS answer.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Attestation {
    /// The recorded report and collateral.
    #[default]
    Recorded,
    /// The recorded report with another model name.
    WrongModel,
    /// No answer.
    Down,
}

/// What the fake NEAR AI gateway does with a sealed request.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum GatewayMode {
    /// Opens it, and seals the reply for it.
    #[default]
    Opens,
    /// Answers 400, as the gateway does for a request that it cannot open.
    Status400,
    /// Seals the reply with a changed byte.
    WrongSeal,
}

/// What the fake NEAR RPC says about a key of `OWNER`.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Access {
    /// `OWNER_SEED` is a full-access key; any other key is unknown.
    #[default]
    Full,
    /// `OWNER_SEED` is a function-call key.
    FunctionCall,
    /// The RPC does not answer.
    Down,
}

#[derive(Default)]
pub(crate) struct Fake {
    pub(crate) secrets: HashMap<String, String>,
    pub(crate) storage: HashMap<String, Vec<u8>>,
    pub(crate) markers: HashMap<String, Vec<u8>>,
    /// The embedding the fake service returns for a canonical WAV digest.
    voices: HashMap<[u8; 32], Vec<f32>>,
    pub(crate) transcript: Option<String>,
    /// The content of the chat model's reply (`detect`). `None`: the model
    /// does not answer.
    pub(crate) chat: Option<String>,
    /// JEV's probability that the summary of a note gives its main point.
    /// `None`: JEV does not answer.
    pub(crate) summary_fit: Option<f64>,
    /// The body of each request to JEV.
    pub(crate) summary_checks: Vec<Value>,
    pub(crate) speaker_down: bool,
    pub(crate) speaker_tamper: bool,
    /// The model inside the worker fails (the `local-speaker` build).
    pub(crate) local_model_down: bool,
    pub(crate) access: Access,
    /// The accounts whose full-access key is `OWNER_SEED`.
    pub(crate) accounts: Vec<String>,
    pub(crate) posts: Vec<String>,
    /// The plaintext worker storage (the checked NEAR AI gateway).
    pub(crate) worker: HashMap<String, Vec<u8>>,
    /// The URL of each GET.
    pub(crate) gets: Vec<String>,
    pub(crate) attestation: Attestation,
    pub(crate) gateway_mode: GatewayMode,
    /// The fake wall clock. `Fake::new` sets [`NOW_MS`].
    pub(crate) now: u64,
    /// The plaintext of each sealed request that the fake gateway opened.
    pub(crate) sealed_requests: Vec<Vec<u8>>,
    /// Host calls in order: "start", "wait", "cancel", "get", "marker_get",
    /// "marker_set", "set", "embed_local", "worker_get", "worker_set",
    /// "get_all".
    pub(crate) events: Vec<&'static str>,
    batch: Option<Vec<Timed>>,
}

impl Fake {
    pub(crate) fn new() -> Self {
        let mut fake = Fake::default();
        fake.secrets.insert(NEAR_AI_API_KEY_ENV.into(), "sk-test".into());
        fake.secrets.insert(VENICE_API_KEY_ENV.into(), "vk-test".into());
        fake.secrets.insert(AUDIO_KEY_ENV.into(), AUDIO_KEY_HEX.into());
        fake.accounts.push(OWNER.into());
        fake.now = NOW_MS;
        fake.worker.insert(NEAR_AI_GATEWAY_RECORD_KEY.into(), gateway_record(NOW_MS));
        fake
    }

    /// The fake NEAR AI gateway: opens the sealed request with its key, and
    /// seals the Whisper reply for it.
    /// The reply of each request of a batch.
    fn replies(&mut self, requests: &[PostRequest]) -> Vec<Timed> {
        requests
            .iter()
            .map(|request| {
                self.posts.push(request.url.clone());
                let result = if request.url == SPEAKER_EMBED_URL {
                    self.speaker_reply(request)
                } else if request.url == NEAR_AI_OHTTP_URL {
                    self.gateway_reply(request)
                } else if request.url == VENICE_TRANSCRIPTIONS_URL {
                    assert_eq!(request.headers[0], ("Authorization".to_string(), "Bearer vk-test".to_string()));
                    match &self.transcript {
                        Some(text) => Ok((200, json!({ "text": text, "duration": 1.5 }).to_string().into_bytes())),
                        None => Ok((503, b"{}".to_vec())),
                    }
                } else if request.url == NEAR_AI_CHAT_URL {
                    match &self.chat {
                        Some(content) => {
                            let reply =
                                json!({ "choices": [{ "message": { "role": "assistant", "content": content } }] });
                            Ok((200, reply.to_string().into_bytes()))
                        }
                        None => Ok((503, b"{}".to_vec())),
                    }
                } else if request.url == NEAR_AI_SYSTEMONE_URL {
                    self.summary_checks.push(serde_json::from_slice(&request.body).expect("JSON body"));
                    match self.summary_fit {
                        Some(noul) => {
                            let reply = json!({ "answers": { "fits": { "type": "noul", "noul": noul } } });
                            Ok((200, reply.to_string().into_bytes()))
                        }
                        None => Ok((503, b"{}".to_vec())),
                    }
                } else if request.url == NEAR_RPC_URL {
                    self.rpc_reply(request)
                } else {
                    Err("unknown host".into())
                };
                Timed { result, ms: 7 }
            })
            .collect()
    }

    fn gateway_reply(&mut self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
        assert_eq!(request.headers, [("Content-Type".to_string(), "message/ohttp-req".to_string())]);
        let opened = fake_gateway().open(&request.body);
        let Some((message, responder)) = opened.filter(|_| self.gateway_mode != GatewayMode::Status400) else {
            return Ok((400, br#"{"error":{"message":"OHTTP decapsulation failed"}}"#.to_vec()));
        };
        let contains = |part: &[u8]| message.windows(part.len()).any(|window| window == part);
        assert!(contains(b"/v1/audio/transcriptions"));
        assert!(contains(b"\x0dauthorization\x0eBearer sk-test"));
        self.sealed_requests.push(message.clone());
        let (status, body) = match &self.transcript {
            Some(text) => (200, json!({ "text": text }).to_string().into_bytes()),
            None => (503, b"{}".to_vec()),
        };
        let mut sealed = responder.seal(&bhttp_response_bytes(status, &body), &[7; 32]);
        if self.gateway_mode == GatewayMode::WrongSeal {
            sealed[40] ^= 1;
        }
        Ok((200, sealed))
    }

    /// The fake NEAR AI attestation endpoint and Intel PCS.
    fn get_reply(&self, request: &GetRequest) -> Result<Reply, String> {
        if self.attestation == Attestation::Down {
            return Err("connection refused".into());
        }
        if request.url.starts_with(NEAR_AI_ATTESTATION_URL) {
            assert!(request.url.ends_with(&format!("&nonce={}", "5a".repeat(32))), "{}", request.url);
            let mut report: Value = serde_json::from_slice(NEAR_AI_REPORT).unwrap();
            if self.attestation == Attestation::WrongModel {
                report["model_attestations"][0]["model_name"] = Value::from("openai/whisper-tiny");
            }
            return Ok(Reply { status: 200, headers: Vec::new(), body: report.to_string().into_bytes() });
        }
        let recorded: Value = serde_json::from_str(INTEL_COLLATERAL).unwrap();
        let reply = recorded["replies"]
            .as_array()
            .unwrap()
            .iter()
            .find(|reply| reply["url"] == request.url.as_str())
            .ok_or("unknown host")?;
        let headers = reply["headers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| (pair[0].as_str().unwrap().to_string(), pair[1].as_str().unwrap().to_string()))
            .collect();
        let body = STANDARD.decode(reply["body_b64"].as_str().unwrap()).unwrap();
        Ok(Reply { status: reply["status"].as_u64().unwrap() as u16, headers, body })
    }

    /// The time of Intel's recorded collateral: a check of the recorded
    /// report passes at this time.
    #[cfg_attr(feature = "venice", allow(dead_code))]
    pub(crate) fn recorded_at() -> u64 {
        let recorded: Value = serde_json::from_str(INTEL_COLLATERAL).unwrap();
        recorded["checked_at_ms"].as_u64().unwrap()
    }

    pub(crate) fn voice(&mut self, wav: &[u8], values: Vec<f32>) {
        self.voices.insert(Sha256::digest(wav).into(), values);
    }

    fn speaker_reply(&self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
        if self.speaker_down {
            return Err("connection refused".into());
        }
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let wav = STANDARD.decode(body["audio_wav_b64"].as_str().unwrap()).unwrap();
        let nonce = from_hex::<32>(body["nonce"].as_str().unwrap()).unwrap();
        let digest: [u8; 32] = Sha256::digest(&wav).into();
        let values = self.voices.get(&digest).cloned().unwrap_or_else(|| embedding(0, 0.0));
        let mut bytes: Vec<u8> = values.iter().flat_map(|value| value.to_le_bytes()).collect();
        let model = from_hex::<32>(REDIMNET_SHA256_HEX).unwrap();
        let key = SigningKey::from_bytes(&SPEAKER_SEED);
        let signature = key.sign(&service_message(&digest, &nonce, &model, &bytes));
        if self.speaker_tamper {
            bytes[0] ^= 1;
        }
        let reply = json!({
            "embedding_b64": STANDARD.encode(&bytes),
            "audio_digest": hex(&digest),
            "model_sha256": REDIMNET_SHA256_HEX,
            "nonce": hex(&nonce),
            "public_key": hex(&key.verifying_key().to_bytes()),
            "signature": hex(&signature.to_bytes()),
            "model_ms": 360,
        });
        Ok((200, reply.to_string().into_bytes()))
    }

    /// A NEAR RPC `view_access_key` reply for a key of `OWNER`.
    fn rpc_reply(&self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
        if self.access == Access::Down {
            return Err("connection refused".into());
        }
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let params = &body["params"];
        assert_eq!(params["request_type"], "view_access_key");
        assert_eq!(params["finality"], "final");
        let owner_key = near_ed25519_key(&SigningKey::from_bytes(&OWNER_SEED).verifying_key().to_bytes());
        let known = self.accounts.iter().any(|account| params["account_id"] == account.as_str());
        let reply = if !known || params["public_key"] != owner_key.as_str() {
            json!({ "jsonrpc": "2.0", "id": body["id"], "error": {
                "name": "HANDLER_ERROR", "cause": { "name": "UNKNOWN_ACCESS_KEY", "info": {} } } })
        } else if self.access == Access::FunctionCall {
            json!({ "jsonrpc": "2.0", "id": body["id"], "result": { "nonce": 3, "block_height": 1,
                "block_hash": "h", "permission": { "FunctionCall": {
                    "allowance": null, "receiver_id": "x.testnet", "method_names": [] } } } })
        } else {
            json!({ "jsonrpc": "2.0", "id": body["id"], "result": {
                "nonce": 3, "block_height": 1, "block_hash": "h", "permission": "FullAccess" } })
        };
        Ok((200, reply.to_string().into_bytes()))
    }
}

impl Host for Fake {
    fn secret(&self, name: &str) -> Option<String> {
        self.secrets.get(name).cloned()
    }
    fn storage_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        self.events.push("get");
        Ok(self.storage.get(key).cloned())
    }
    fn storage_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        self.events.push("set");
        if self.storage.contains_key(key) {
            return Ok(false);
        }
        self.storage.insert(key.into(), value.to_vec());
        Ok(true)
    }
    fn storage_set_if_equals(&mut self, key: &str, expected: &[u8], value: &[u8]) -> Result<bool, String> {
        self.events.push("set");
        if self.storage.get(key).map(Vec::as_slice) != Some(expected) {
            return Ok(false);
        }
        self.storage.insert(key.into(), value.to_vec());
        Ok(true)
    }
    fn worker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        self.events.push("worker_get");
        Ok(self.worker.get(key).cloned())
    }
    fn worker_set(&mut self, key: &str, value: &[u8]) -> Result<(), String> {
        self.events.push("worker_set");
        self.worker.insert(key.into(), value.to_vec());
        Ok(())
    }
    fn get_all(&mut self, requests: Vec<GetRequest>) -> Vec<Result<Reply, String>> {
        self.events.push("get_all");
        self.gets.extend(requests.iter().map(|request| request.url.clone()));
        requests.iter().map(|request| self.get_reply(request)).collect()
    }
    fn marker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        self.events.push("marker_get");
        Ok(self.markers.get(key).cloned())
    }
    fn marker_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        self.events.push("marker_set");
        if self.markers.contains_key(key) {
            return Ok(false);
        }
        self.markers.insert(key.into(), value.to_vec());
        Ok(true)
    }
    fn post_start(&mut self, requests: Vec<PostRequest>) {
        self.events.push("start");
        self.batch = Some(self.replies(&requests));
    }
    fn post_add(&mut self, requests: Vec<PostRequest>) {
        self.events.push("add");
        let replies = self.replies(&requests);
        self.batch.get_or_insert_with(Vec::new).extend(replies);
    }
    fn post_poll(&mut self) {
        self.events.push("poll");
    }
    fn post_wait(&mut self) -> Vec<Timed> {
        self.events.push("wait");
        self.batch.take().unwrap_or_default()
    }
    fn post_cancel(&mut self) {
        self.events.push("cancel");
        self.batch = None;
    }
    /// The model inside the worker: the same voices as the fake service.
    fn embed_local(&mut self, clips: &[&[i16]]) -> Result<LocalEmbeddings, String> {
        self.events.push("embed_local");
        if self.local_model_down {
            return Err("model fetch: status_503".into());
        }
        let embeddings = clips
            .iter()
            .map(|pcm| {
                let digest: [u8; 32] = Sha256::digest(wav_bytes(pcm)).into();
                self.voices.get(&digest).cloned().unwrap_or_else(|| embedding(0, 0.0))
            })
            .collect();
        Ok(LocalEmbeddings { embeddings, fetch_ms: 300, model_cached: true, run_ms: 1_500 })
    }
    fn random32(&mut self) -> Result<[u8; 32], String> {
        Ok([0x5a; 32])
    }
    fn now_ms(&mut self) -> u64 {
        self.now
    }
    fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
        Ok(SigningKey::from_bytes(&VERDICT_SEED).sign(message).to_bytes().to_vec())
    }
    fn public_key(&mut self) -> Result<Vec<u8>, String> {
        Ok(SigningKey::from_bytes(&VERDICT_SEED).verifying_key().to_bytes().to_vec())
    }
}

fn pins() -> Pins {
    Pins { speaker_key: SigningKey::from_bytes(&SPEAKER_SEED).verifying_key().to_bytes(), local_speaker: false }
}

pub(crate) fn call(fake: &mut Fake, input: Value) -> Value {
    call_with(fake, input, &pins())
}

/// A call of the `local-speaker` build: the model runs inside the worker.
pub(crate) fn call_local(fake: &mut Fake, input: Value) -> Value {
    call_with(fake, input, &Pins { local_speaker: true, ..pins() })
}

fn call_with(fake: &mut Fake, input: Value, pins: &Pins) -> Value {
    let bytes = run_with(input.to_string().as_bytes(), fake, pins);
    assert!(bytes.len() < MAX_OUTPUT_BYTES, "{} bytes", bytes.len());
    serde_json::from_slice(&bytes).unwrap()
}

/// A generator that gives one byte value. It makes a fixed ephemeral key,
/// so a test seals to the same bytes on every run.
pub(crate) struct FixedRng(pub(crate) u8);

impl hpke::rand_core::TryRng for FixedRng {
    type Error = std::convert::Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        Ok(u32::from_le_bytes([self.0; 4]))
    }

    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        Ok(u64::from_le_bytes([self.0; 8]))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
        dst.fill(self.0);
        Ok(())
    }
}

impl hpke::rand_core::TryCryptoRng for FixedRng {}

/// The public key of `AUDIO_KEY_HEX`.
pub(crate) fn audio_public_key() -> [u8; 32] {
    AudioKey::from_secret(AUDIO_KEY_HEX).unwrap().public_key()
}

/// Seals as a Wallet does: `enc || ciphertext || tag`, to `public_key`,
/// with the ephemeral key that `ikm` gives.
pub(crate) fn seal_to(public_key: &[u8; 32], plaintext: &[u8], op: &str, owner: &str, ikm: u8) -> Vec<u8> {
    use hpke::{aead::ChaCha20Poly1305, kdf::HkdfSha256, kem::X25519HkdfSha256, Deserializable, OpModeS, Serializable};
    let public_key = <X25519HkdfSha256 as hpke::Kem>::PublicKey::from_bytes(public_key).unwrap();
    let (encapped, ciphertext) = hpke::single_shot_seal_with_rng::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256>(
        &OpModeS::Base,
        &public_key,
        AUDIO_INFO,
        plaintext,
        &audio_aad(op, owner),
        &mut FixedRng(ikm),
    )
    .unwrap();
    [encapped.to_bytes().as_slice(), &ciphertext].concat()
}

/// A WAV sealed to the verifier's audio key, standard base64.
pub(crate) fn sealed(wav: &[u8], op: &str, owner: &str) -> String {
    STANDARD.encode(seal_to(&audio_public_key(), wav, op, owner, 0x66))
}

/// `input` with its plain audio replaced by the same audio, sealed for the
/// input's own `op` and `owner`.
pub(crate) fn with_sealed_audio(mut input: Value) -> Value {
    let (op, owner) = (input["op"].as_str().unwrap().to_string(), input["owner"].as_str().unwrap().to_string());
    let seal = |text: &Value| Value::from(sealed(&STANDARD.decode(text.as_str().unwrap()).unwrap(), &op, &owner));
    let plain = input.as_object_mut().unwrap().remove("audio_wav_b64").unwrap();
    input["audio_sealed_b64"] = match &plain {
        Value::Array(clips) => clips.iter().map(seal).collect(),
        one => seal(one),
    };
    input
}

/// The enrollment digest text of these clips for `OWNER`.
pub(crate) fn digest_of(clips: &[Vec<u8>]) -> String {
    digest_for(OWNER, clips)
}

fn digest_for(owner: &str, clips: &[Vec<u8>]) -> String {
    let digests: Vec<[u8; 32]> = clips.iter().map(|wav| Sha256::digest(wav).into()).collect();
    b64u(&enrollment_digest(owner, &digests))
}

/// An enroll input whose authorization the key `seed` signed over the
/// digest of `signed_clips`.
pub(crate) fn enroll_input_signed(clips: &[Vec<u8>], signed_clips: &[Vec<u8>], seed: [u8; 32]) -> Value {
    enroll_input_for(OWNER, clips, signed_clips, seed)
}

/// An enroll input of `owner`, authorized by `OWNER_SEED`.
pub(crate) fn enroll_input_as(owner: &str, clips: &[Vec<u8>]) -> Value {
    enroll_input_for(owner, clips, clips, OWNER_SEED)
}

fn enroll_input_for(owner: &str, clips: &[Vec<u8>], signed_clips: &[Vec<u8>], seed: [u8; 32]) -> Value {
    let key = SigningKey::from_bytes(&seed);
    let nonce = [0x44u8; 32];
    let hash = nep413_hash(&authorization_message(&digest_for(owner, signed_clips)), &nonce, ENROLLMENT_RECIPIENT);
    json!({
        "op": "enroll",
        "owner": owner,
        "audio_wav_b64": clips.iter().map(|wav| STANDARD.encode(wav)).collect::<Vec<_>>(),
        "authorization": {
            "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
            "signature_b64": STANDARD.encode(key.sign(&hash).to_bytes()),
            "nonce_b64": STANDARD.encode(nonce),
        },
    })
}

/// An enroll input that the owner's full-access key authorized.
pub(crate) fn enroll_input(clips: &[Vec<u8>]) -> Value {
    enroll_input_signed(clips, clips, OWNER_SEED)
}

pub(crate) fn verify_input_for(wav: &[u8], amount_yocto: u128) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": { "kind": "transfer", "receiver": "alice.testnet", "amount_yocto": amount_yocto.to_string() },
        "contacts": ["alice.testnet", "bob.testnet"],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

pub(crate) fn verify_input(wav: &[u8]) -> Value {
    verify_input_for(wav, 2 * ONE_NEAR)
}

/// A fake whose owner is enrolled with three clips near axis 0. It records
/// no host calls and no posts of the enrollment.
pub(crate) fn enrolled() -> Fake {
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.1 * index as f32));
    }
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    fake.events.clear();
    fake.posts.clear();
    // JEV finds that a note's summary fits, unless a test says otherwise.
    fake.summary_fit = Some(0.9);
    fake
}

/// The parsed verdict of a verify output, after its signature checks.
pub(crate) fn checked_verdict(out: &Value) -> Verdict {
    let text = out["verdict_json"].as_str().unwrap();
    let signature: [u8; 64] = STANDARD.decode(out["signature_b64"].as_str().unwrap()).unwrap().try_into().unwrap();
    let key = SigningKey::from_bytes(&VERDICT_SEED).verifying_key();
    assert_eq!(out["public_key"], format!("ed25519:{}", base58(&key.to_bytes())));
    VerifyingKey::from_bytes(&key.to_bytes())
        .unwrap()
        .verify(&verdict_message(text.as_bytes()), &Signature::from_bytes(&signature))
        .expect("signature over the verdict message");
    serde_json::from_str(text).unwrap()
}

/// The refusal reason of a verdict, or its outcome if it has no reason.
pub(crate) fn outcome_name(verdict: &Verdict) -> String {
    let name = match verdict.reason {
        Some(reason) => serde_json::to_value(reason),
        None => serde_json::to_value(verdict.outcome),
    };
    name.unwrap().as_str().unwrap().to_string()
}

/// The outcome name and the verdict of one verify call with a fresh
/// enrolled fake.
pub(crate) fn spoken(input: Value, transcript: &str) -> (String, Verdict) {
    let mut fake = enrolled();
    fake.transcript = Some(transcript.into());
    let verdict = checked_verdict(&call(&mut fake, input));
    (outcome_name(&verdict), verdict)
}
