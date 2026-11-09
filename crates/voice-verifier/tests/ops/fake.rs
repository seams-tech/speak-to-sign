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
    EMBEDDING_DIM, ENROLLMENT_RECIPIENT, MAX_OUTPUT_BYTES, NEAR_AI_API_KEY_ENV, NEAR_AI_TRANSCRIPTIONS_URL,
    NEAR_RPC_URL, REDIMNET_SHA256_HEX, SPEAKER_EMBED_URL,
};
use seams_voice_verifier::digest::{b64u, base58, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::host::{Host, PostRequest, Timed};
use seams_voice_verifier::output::{verdict_message, Verdict};
use seams_voice_verifier::speaker_client::service_message;
use seams_voice_verifier::{run_with, Pins};

const SPEAKER_SEED: [u8; 32] = [0x11; 32];
pub(crate) const VERDICT_SEED: [u8; 32] = [0x22; 32];
/// The owner's full-access key.
pub(crate) const OWNER_SEED: [u8; 32] = [0x33; 32];
pub(crate) const OWNER: &str = "owner.testnet";
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
    pub(crate) speaker_down: bool,
    pub(crate) speaker_tamper: bool,
    pub(crate) access: Access,
    pub(crate) posts: Vec<String>,
    /// Host calls in order: "start", "wait", "cancel", "get", "marker_get",
    /// "marker_set", "set".
    pub(crate) events: Vec<&'static str>,
    batch: Option<Vec<Timed>>,
}

impl Fake {
    pub(crate) fn new() -> Self {
        let mut fake = Fake::default();
        fake.secrets.insert(NEAR_AI_API_KEY_ENV.into(), "sk-test".into());
        fake
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
        let reply = if params["account_id"] != OWNER || params["public_key"] != owner_key.as_str() {
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
        let results = requests
            .iter()
            .map(|request| {
                self.posts.push(request.url.clone());
                let result = if request.url == SPEAKER_EMBED_URL {
                    self.speaker_reply(request)
                } else if request.url == NEAR_AI_TRANSCRIPTIONS_URL {
                    match &self.transcript {
                        Some(text) => Ok((200, json!({ "text": text }).to_string().into_bytes())),
                        None => Ok((503, b"{}".to_vec())),
                    }
                } else if request.url == NEAR_RPC_URL {
                    self.rpc_reply(request)
                } else {
                    Err("unknown host".into())
                };
                Timed { result, ms: 7 }
            })
            .collect();
        self.batch = Some(results);
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
    fn random32(&mut self) -> Result<[u8; 32], String> {
        Ok([0x5a; 32])
    }
    fn now_ms(&mut self) -> u64 {
        NOW_MS
    }
    fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
        Ok(SigningKey::from_bytes(&VERDICT_SEED).sign(message).to_bytes().to_vec())
    }
    fn public_key(&mut self) -> Result<Vec<u8>, String> {
        Ok(SigningKey::from_bytes(&VERDICT_SEED).verifying_key().to_bytes().to_vec())
    }
}

fn pins() -> Pins {
    Pins { speaker_key: SigningKey::from_bytes(&SPEAKER_SEED).verifying_key().to_bytes() }
}

pub(crate) fn call(fake: &mut Fake, input: Value) -> Value {
    let bytes = run_with(input.to_string().as_bytes(), fake, &pins());
    assert!(bytes.len() < MAX_OUTPUT_BYTES, "{} bytes", bytes.len());
    serde_json::from_slice(&bytes).unwrap()
}

/// The enrollment digest text of these clips for `OWNER`.
pub(crate) fn digest_of(clips: &[Vec<u8>]) -> String {
    let digests: Vec<[u8; 32]> = clips.iter().map(|wav| Sha256::digest(wav).into()).collect();
    b64u(&enrollment_digest(OWNER, &digests))
}

/// An enroll input whose authorization the key `seed` signed over the
/// digest of `signed_clips`.
pub(crate) fn enroll_input_signed(clips: &[Vec<u8>], signed_clips: &[Vec<u8>], seed: [u8; 32]) -> Value {
    let key = SigningKey::from_bytes(&seed);
    let nonce = [0x44u8; 32];
    let hash = nep413_hash(&authorization_message(&digest_of(signed_clips)), &nonce, ENROLLMENT_RECIPIENT);
    json!({
        "op": "enroll",
        "owner": OWNER,
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
