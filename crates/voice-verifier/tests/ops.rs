//! `enroll` and `verify` against a fake host: a fake speaker service that
//! signs as the real one does, a fake NEAR AI, storage maps and a real
//! ed25519 signing key.
use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::audio::wav_bytes;
use seams_voice_verifier::config::{
    audio_used_key, template_key, EMBEDDING_DIM, ENROLLMENT_RECIPIENT, MAX_OUTPUT_BYTES, NEAR_AI_API_KEY_ENV,
    NEAR_AI_TRANSCRIPTIONS_URL, NEAR_RPC_URL, REDIMNET_SHA256_HEX, SPEAKER_EMBED_URL, VERDICT_TTL_MS,
};
use seams_voice_verifier::digest::{b64u, base58, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::enrollment::{authorization_message, enrollment_digest, nep413_hash};
use seams_voice_verifier::host::{Host, PostRequest, Timed};
use seams_voice_verifier::output::{verdict_message, Verdict};
use seams_voice_verifier::policy::STUB_AMOUNT_RULE;
use seams_voice_verifier::speaker::service_message;
use seams_voice_verifier::{run_with, Pins};

const SPEAKER_SEED: [u8; 32] = [0x11; 32];
const VERDICT_SEED: [u8; 32] = [0x22; 32];
/// The owner's full-access key.
const OWNER_SEED: [u8; 32] = [0x33; 32];
const OWNER: &str = "owner.testnet";
/// The fake wall clock, in ms since the UNIX epoch.
const NOW_MS: u64 = 1_762_700_000_000;
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// A clip: a 2 s tone at `step` radians per sample.
fn clip(step: f32) -> Vec<u8> {
    let pcm: Vec<i16> = (0..32_000).map(|i| ((i as f32 * step).sin() * 3_000.0) as i16).collect();
    wav_bytes(&pcm)
}

/// A unit vector along `axis`, turned toward `axis + 1` by `angle`.
fn embedding(axis: usize, angle: f32) -> Vec<f32> {
    let mut values = vec![0f32; EMBEDDING_DIM];
    values[axis] = angle.cos();
    values[axis + 1] = angle.sin();
    values
}

/// What the fake NEAR RPC says about a key of `OWNER`.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Access {
    /// `OWNER_SEED` is a full-access key; any other key is unknown.
    #[default]
    Full,
    /// `OWNER_SEED` is a function-call key.
    FunctionCall,
    /// The RPC does not answer.
    Down,
}

#[derive(Default)]
struct Fake {
    secrets: HashMap<String, String>,
    storage: HashMap<String, Vec<u8>>,
    markers: HashMap<String, Vec<u8>>,
    /// The embedding the fake service returns for a canonical WAV digest.
    voices: HashMap<[u8; 32], Vec<f32>>,
    transcript: Option<String>,
    speaker_down: bool,
    speaker_tamper: bool,
    access: Access,
    posts: Vec<String>,
    /// Host calls in order: "start", "wait", "cancel", "get", "marker_get",
    /// "marker_set", "set".
    events: Vec<&'static str>,
    batch: Option<Vec<Timed>>,
}

impl Fake {
    fn new() -> Self {
        let mut fake = Fake::default();
        fake.secrets.insert(NEAR_AI_API_KEY_ENV.into(), "sk-test".into());
        fake
    }

    fn voice(&mut self, wav: &[u8], values: Vec<f32>) {
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

fn call(fake: &mut Fake, input: Value) -> Value {
    let bytes = run_with(input.to_string().as_bytes(), fake, &pins());
    assert!(bytes.len() < MAX_OUTPUT_BYTES, "{} bytes", bytes.len());
    serde_json::from_slice(&bytes).unwrap()
}

/// The enrollment digest text of these clips for `OWNER`.
fn digest_of(clips: &[Vec<u8>]) -> String {
    let digests: Vec<[u8; 32]> = clips.iter().map(|wav| Sha256::digest(wav).into()).collect();
    b64u(&enrollment_digest(OWNER, &digests))
}

/// An enroll input whose authorization the key `seed` signed over the
/// digest of `signed_clips`.
fn enroll_input_signed(clips: &[Vec<u8>], signed_clips: &[Vec<u8>], seed: [u8; 32]) -> Value {
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
fn enroll_input(clips: &[Vec<u8>]) -> Value {
    enroll_input_signed(clips, clips, OWNER_SEED)
}

fn verify_input_for(wav: &[u8], amount_yocto: u128) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": { "kind": "transfer", "receiver": "alice.testnet", "amount_yocto": amount_yocto.to_string() },
        "contacts": ["alice.testnet", "bob.testnet"],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

fn verify_input(wav: &[u8]) -> Value {
    verify_input_for(wav, 2 * ONE_NEAR)
}

/// A fake whose owner is enrolled with three clips near axis 0.
fn enrolled() -> Fake {
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.1 * index as f32));
    }
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    fake.events.clear();
    fake
}

/// The parsed verdict of a verify output, after its signature checks.
fn checked_verdict(out: &Value) -> Verdict {
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

#[test]
fn enroll_stores_the_template_and_returns_the_key() {
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.2 * index as f32));
    }
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    assert_eq!(out["kind"], "seams_voice_enrollment_v3");
    assert_eq!(out["reason"], Value::Null);
    assert!(out.get("vault").is_none());
    assert_eq!(out["owner"], OWNER);
    // cos(0.4) = 0.921
    assert_eq!(out["agreement_milli"], 921);
    assert_eq!(out["template_epoch"], 1);
    assert_eq!(out["enrollment_digest"], digest_of(&clips));
    let key = SigningKey::from_bytes(&VERDICT_SEED).verifying_key().to_bytes();
    assert_eq!(out["verifier_public_key"], format!("ed25519:{}", base58(&key)));
    // The access-key read and the three embeddings in one batch; storage
    // reads while it is in flight; the writes after the decision.
    assert_eq!(fake.posts, [NEAR_RPC_URL, SPEAKER_EMBED_URL, SPEAKER_EMBED_URL, SPEAKER_EMBED_URL]);
    assert_eq!(
        fake.events,
        ["start", "get", "marker_get", "marker_get", "marker_get", "wait", "marker_set", "marker_set", "marker_set", "set"]
    );
    for stage in ["send", "storage", "wait", "parallel", "rpc", "speaker", "write", "total"] {
        assert!(out["ms"][stage].is_u64(), "{stage}: {out}");
    }
    let first = fake.storage.get(&template_key(OWNER)).cloned().unwrap();
    assert_eq!(first.len(), 808);
    for wav in &clips {
        assert!(fake.markers.contains_key(&audio_used_key(&b64u(&Sha256::digest(wav)))));
    }

    // New audio under the signature of the old audio is refused before any
    // network call and changes nothing.
    let again = [clip(0.08), clip(0.09), clip(0.1)];
    for (index, wav) in again.iter().enumerate() {
        fake.voice(wav, embedding(4, 0.1 * index as f32));
    }
    fake.posts.clear();
    let out = call(&mut fake, enroll_input_signed(&again, &clips, OWNER_SEED));
    assert_eq!(out["reason"], "not_authorized");
    assert_eq!(out["detail"], "authorization: bad_signature");
    assert!(fake.posts.is_empty(), "a bad signature makes no network call");
    assert_eq!(fake.storage.get(&template_key(OWNER)), Some(&first));
    assert_eq!(fake.markers.len(), 3);

    // A fresh authorization replaces the template and bumps the epoch.
    let out = call(&mut fake, enroll_input(&again));
    assert_eq!(out["outcome"], "accept", "{out}");
    assert_eq!(out["template_epoch"], 2);
    let second = fake.storage.get(&template_key(OWNER)).cloned().unwrap();
    assert_ne!(second, first);
    assert_eq!(&second[4..8], &2u32.to_le_bytes());
    assert_eq!(fake.markers.len(), 6);

    // The same authorization and audio again: the audio is used.
    let out = call(&mut fake, enroll_input(&again));
    assert_eq!(out["reason"], "audio_reused");
    assert_eq!(fake.events.last(), Some(&"cancel"));
}

#[test]
fn enroll_needs_a_full_access_key_of_the_owner() {
    let clips = [clip(0.05), clip(0.06), clip(0.07)];

    // Signed over the same clips in another order.
    let mut fake = Fake::new();
    let reordered = [clips[1].clone(), clips[0].clone(), clips[2].clone()];
    let out = call(&mut fake, enroll_input_signed(&clips, &reordered, OWNER_SEED));
    assert_eq!(out["reason"], "not_authorized");
    assert_eq!(out["detail"], "authorization: bad_signature");
    assert!(fake.posts.is_empty());

    // Signed by a key that the owner account does not hold.
    let mut fake = Fake::new();
    let out = call(&mut fake, enroll_input_signed(&clips, &clips, [0x55; 32]));
    assert_eq!(out["outcome"], "refuse");
    assert_eq!(out["reason"], "not_authorized");
    assert_eq!(out["detail"], "authorization: unknown_key");
    assert!(fake.storage.is_empty());
    assert!(fake.markers.is_empty(), "a refused enrollment burns no audio");

    // Signed by a function-call key of the owner.
    let mut fake = Fake::new();
    fake.access = Access::FunctionCall;
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["reason"], "not_authorized");
    assert_eq!(out["detail"], "authorization: function_call_key");

    // A nonce of the wrong length.
    let mut fake = Fake::new();
    let mut input = enroll_input(&clips);
    input["authorization"]["nonce_b64"] = json!(STANDARD.encode([0u8; 31]));
    let out = call(&mut fake, input);
    assert_eq!(out["detail"], "authorization: bad_nonce");

    // No authorization at all is not an enroll input.
    let mut input = enroll_input(&clips);
    input.as_object_mut().unwrap().remove("authorization");
    assert_eq!(call(&mut Fake::new(), input)["reason"], "unsupported");

    // The RPC is down.
    let mut fake = Fake::new();
    fake.access = Access::Down;
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["reason"], "authorization_unavailable");
    assert!(out["detail"].as_str().unwrap().starts_with("rpc: network"));
    assert!(fake.markers.is_empty());
}

#[test]
fn enroll_refusals() {
    // One sample of another voice.
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    fake.voice(&clips[2], embedding(7, 0.0));
    let out = call(&mut fake, enroll_input(&clips));
    assert_eq!(out["reason"], "speaker");
    assert_eq!(out["agreement_milli"], 0);
    assert!(fake.storage.is_empty());
    assert!(fake.markers.is_empty(), "a refused enrollment burns no audio");

    let mut fake = Fake::new();
    let out = call(&mut fake, enroll_input(&[clip(0.05), clip(0.05), clip(0.07)]));
    assert_eq!(out["reason"], "audio_reused");
    let out = call(&mut fake, enroll_input(&[clip(0.05), clip(0.06)]));
    assert_eq!(out["reason"], "unsupported");
    let silent = wav_bytes(&[0; 32_000]);
    let out = call(&mut fake, enroll_input(&[clip(0.05), clip(0.06), silent]));
    assert_eq!(out["reason"], "quality");
    fake.speaker_down = true;
    let out = call(&mut fake, enroll_input(&[clip(0.05), clip(0.06), clip(0.07)]));
    assert_eq!(out["reason"], "speaker_unavailable");
    assert!(out["detail"].as_str().unwrap().starts_with("speaker: network"));
}

#[test]
fn verify_accepts_and_signs_the_verdict() {
    let mut fake = enrolled();
    fake.transcript = Some(" Send 2 NEAR to alice.testnet.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(out["kind"], "seams_voice_verify_output_v2");
    assert_eq!(out["policy_text"], Value::Null);
    let verdict = checked_verdict(&out);
    assert_eq!(verdict.reason, None, "{out}");
    assert_eq!(serde_json::to_value(verdict.outcome).unwrap(), "accept");
    assert_eq!(verdict.policy_rule, None);
    assert_eq!(verdict.expires_at_ms, NOW_MS + VERDICT_TTL_MS);
    assert_eq!(verdict.heard.as_deref(), Some("send two near to alice dot testnet"));
    assert_eq!(verdict.audio_digest, Some(b64u(&Sha256::digest(&wav))));
    // The same digests as the shared vector, which the Wallet checks.
    let vector: Value = serde_json::from_str(include_str!("../testdata/signed_verdict_v2.json")).unwrap();
    let accept = &vector["verdicts"][0];
    assert_eq!(accept["name"], "accept");
    assert_eq!(verdict.request_digest.as_deref(), accept["request_digest"].as_str());
    assert_eq!(verdict.spoken_text_digest.as_deref(), accept["spoken_text_digest"].as_str());
    assert!(verdict.speaker_score_milli.unwrap() >= 450);
    for stage in [
        "decode", "send", "storage", "wait", "parallel", "speaker", "transcribe", "redimnet", "mark", "policy", "sign",
        "total",
    ] {
        assert!(out["ms"][stage].is_u64(), "{stage}: {out}");
    }
    // Both calls went out in one batch, before the storage reads; the audio
    // is marked used after the decision.
    assert_eq!(fake.posts[4..], [SPEAKER_EMBED_URL, NEAR_AI_TRANSCRIPTIONS_URL]);
    assert_eq!(fake.events, ["start", "get", "marker_get", "wait", "marker_set"]);

    // The same audio again: refused by the storage check; the batch is
    // dropped without a wait.
    fake.events.clear();
    let again = call(&mut fake, verify_input(&wav));
    assert_eq!(checked_verdict(&again).reason.map(|r| serde_json::to_value(r).unwrap()), Some(json!("audio_reused")));
    assert_eq!(fake.events, ["start", "get", "marker_get", "cancel"]);
}

#[test]
fn verify_steps_up_above_ten_near() {
    let wav = clip(0.03);

    let mut fake = enrolled();
    fake.transcript = Some("Send 11 NEAR to alice.testnet.".into());
    let out = call(&mut fake, verify_input_for(&wav, 11 * ONE_NEAR));
    let verdict = checked_verdict(&out);
    assert_eq!(serde_json::to_value(verdict.outcome).unwrap(), "step_up", "{out}");
    assert_eq!(verdict.reason, None);
    assert_eq!(verdict.policy_rule.as_deref(), Some(STUB_AMOUNT_RULE.id));
    assert_eq!(out["policy_text"], STUB_AMOUNT_RULE.text);
    assert_eq!(verdict.expires_at_ms, NOW_MS + VERDICT_TTL_MS);
    assert!(fake.markers.contains_key(&audio_used_key(&b64u(&Sha256::digest(&wav)))), "a step-up uses the audio");

    // Exactly 10 NEAR needs no step-up.
    let mut fake = enrolled();
    fake.transcript = Some("Send 10 NEAR to alice.testnet.".into());
    let verdict = checked_verdict(&call(&mut fake, verify_input_for(&wav, 10 * ONE_NEAR)));
    assert_eq!(serde_json::to_value(verdict.outcome).unwrap(), "accept");
    assert_eq!(verdict.policy_rule, None);

    // A refusal before the policy step names no rule.
    let mut fake = enrolled();
    fake.transcript = Some("Send 12 NEAR to alice.testnet.".into());
    let out = call(&mut fake, verify_input_for(&wav, 11 * ONE_NEAR));
    assert_eq!(reason(&out), "words");
    assert_eq!(checked_verdict(&out).policy_rule, None);
    assert_eq!(out["policy_text"], Value::Null);
}

fn reason(out: &Value) -> String {
    let verdict = checked_verdict(out);
    serde_json::to_value(verdict.reason.expect("a refusal")).unwrap().as_str().unwrap().to_string()
}

#[test]
fn verify_refusals() {
    let wav = clip(0.03);

    let mut fake = enrolled();
    fake.transcript = Some("Send 3 NEAR to alice.testnet.".into());
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(reason(&out), "words");
    assert_eq!(checked_verdict(&out).heard.as_deref(), Some("send three near to alice dot testnet"));
    assert!(fake.markers.contains_key(&audio_used_key(&b64u(&Sha256::digest(&wav)))), "words burn the audio");

    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake.voice(&wav, embedding(9, 0.0));
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(reason(&out), "speaker");
    assert!(checked_verdict(&out).speaker_score_milli.unwrap() < 450);

    let mut fake = Fake::new();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    assert_eq!(reason(&call(&mut fake, verify_input(&wav))), "template_missing");

    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake.speaker_tamper = true;
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(reason(&out), "speaker_unavailable");
    assert_eq!(out["detail"], "speaker: bad_signature");
    assert!(fake.markers.len() == 3, "an outage does not burn the audio");

    let mut fake = enrolled();
    fake.transcript = None;
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(reason(&out), "transcriber_unavailable");
    assert_eq!(out["detail"], "transcriber: status_503");

    let mut fake = enrolled();
    fake.secrets.clear();
    assert_eq!(reason(&call(&mut fake, verify_input(&wav))), "transcriber_unavailable");

    let mut fake = enrolled();
    let mut input = verify_input(&wav);
    input["audio_wav_b64"] = json!(STANDARD.encode(b"not a wav"));
    let out = call(&mut fake, input);
    assert_eq!(reason(&out), "audio_invalid");
    assert_eq!(out["detail"], "not_wav");
    // The request digest is known before the audio fails, and every
    // verdict expires.
    assert!(checked_verdict(&out).request_digest.is_some());
    assert_eq!(checked_verdict(&out).expires_at_ms, NOW_MS + VERDICT_TTL_MS);

    let mut input = verify_input(&wav);
    input["extra"] = json!(1);
    let out = call(&mut fake, input);
    assert_eq!(reason(&out), "unsupported");
    assert_eq!(checked_verdict(&out).request_digest, None);

    for (field, value) in [
        ("amount_yocto", json!("1000")),
        ("receiver", json!(OWNER)),
        ("receiver", json!("0x1234")),
        ("kind", json!("vault_transfer")),
        ("nonce", json!(0)),
    ] {
        let mut input = verify_input(&wav);
        input["request"][field] = value;
        assert_eq!(reason(&call(&mut fake, input)), "unsupported", "{field}");
    }
}

#[test]
fn a_long_transcript_still_fits_and_is_signed() {
    let mut fake = enrolled();
    fake.transcript = Some("near ".repeat(400) + &"x".repeat(900));
    let out = call(&mut fake, verify_input(&clip(0.03)));
    assert_eq!(reason(&out), "words");
    let heard = checked_verdict(&out).heard.unwrap_or_default();
    assert!(heard.len() <= 200, "{}", heard.len());
}

#[test]
fn a_step_up_with_the_longest_heard_text_still_fits() {
    let mut fake = enrolled();
    let receiver = format!("{}.testnet", "a".repeat(56));
    fake.transcript = Some(format!("Send 999999.99 NEAR to {receiver}."));
    let mut input = verify_input_for(&clip(0.03), 99_999_999 * (ONE_NEAR / 100));
    input["request"]["receiver"] = json!(receiver);
    let out = call(&mut fake, input);
    let verdict = checked_verdict(&out);
    assert_eq!(serde_json::to_value(verdict.outcome).unwrap(), "step_up", "{out}");
    assert_eq!(out["policy_text"], STUB_AMOUNT_RULE.text);
}

#[test]
fn unknown_op() {
    let out = call(&mut Fake::new(), json!({ "op": "audio_key" }));
    assert_eq!(out["reason"], "unsupported");
}

#[test]
fn transfer_request_accepts_an_implicit_owner() {
    use seams_voice_verifier::ops::transfer_request;
    let implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    assert!(transfer_request(implicit, "alice.testnet", ONE_NEAR).is_ok());
    // The receiver is said, so it must still be speakable.
    assert!(transfer_request("owner.testnet", implicit, ONE_NEAR).is_err());
    assert!(transfer_request(implicit, implicit, ONE_NEAR).is_err());
    assert!(transfer_request("alice.testnet", "alice.testnet", ONE_NEAR).is_err());
}

const NOTES_CONTRACT: &str = "community-notes.testnet";

fn note_input(wav: &[u8], summary: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "community_note",
            "contract": NOTES_CONTRACT,
            "post_id": 7,
            "note_sha256_hex": "ab".repeat(32),
            "summary": summary,
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

fn rating_input(wav: &[u8], rating: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": { "kind": "note_rating", "contract": NOTES_CONTRACT, "note_id": 3, "rating": rating },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

/// The outcome or refusal reason of one verify call with a fresh fake.
fn spoken(input: Value, transcript: &str) -> (String, Verdict) {
    let mut fake = enrolled();
    fake.transcript = Some(transcript.into());
    let out = call(&mut fake, input);
    let verdict = checked_verdict(&out);
    let result = match verdict.reason {
        Some(reason) => serde_json::to_value(reason).unwrap().as_str().unwrap().to_string(),
        None => serde_json::to_value(verdict.outcome).unwrap().as_str().unwrap().to_string(),
    };
    (result, verdict)
}

#[test]
fn verify_accepts_a_spoken_note_summary() {
    use spoken_intent::{request_digest, NearAccount, Network, SpokenRequestV1, SpokenSummary};
    let wav = clip(0.03);
    let summary = "The bridge stays open, only one lane closes.";
    let (result, verdict) = spoken(note_input(&wav, summary), " The bridge stays open. Only one lane closes.");
    assert_eq!(result, "accept");
    assert_eq!(verdict.heard.as_deref(), Some("the bridge stays open only one lane closes"));
    assert_eq!(verdict.policy_rule, None);
    let request = SpokenRequestV1::CommunityNote {
        network: Network::Testnet,
        owner: NearAccount::new(OWNER).unwrap(),
        contract: NearAccount::new(NOTES_CONTRACT).unwrap(),
        post_id: 7,
        note_sha256: [0xab; 32],
        summary: SpokenSummary::new(summary).unwrap(),
    };
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    // One word changed or dropped passes; an added word, a negation or two
    // words do not.
    for (transcript, expected) in [
        ("The bridge stays open, only one lane closed.", "accept"),
        ("The bridge stays open, one lane closes.", "accept"),
        ("The bridge stays open, only one lane closes today.", "words"),
        ("The bridge stays not open, only one lane closes.", "words"),
        ("The bridge is not open, only one lane closes.", "words"),
        ("The bridge stays shut, only two lanes close.", "words"),
    ] {
        assert_eq!(spoken(note_input(&wav, summary), transcript).0, expected, "{transcript}");
    }
    // A short summary needs the exact words.
    assert_eq!(spoken(note_input(&wav, "Bridge stays open"), "Bridge stays opened.").0, "words");
    assert_eq!(spoken(note_input(&wav, "Bridge stays open"), "Bridge stays open!").0, "accept");
    // A summary with a negation: dropping it is refused.
    let negated = "The bridge is not closed for six months";
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is not closed for 6 months.").0, "accept");
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is closed for six months.").0, "words");
}

#[test]
fn verify_accepts_a_spoken_rating_with_exact_words() {
    let wav = clip(0.03);
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This note is helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "not_helpful"), "This note is not helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "somewhat_helpful"), "This note is somewhat helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This note is not helpful.").0, "words");
    assert_eq!(spoken(rating_input(&wav, "not_helpful"), "This note is helpful.").0, "words");
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This is helpful.").0, "words");
}

#[test]
fn note_inputs_that_are_not_speakable_are_unsupported() {
    let wav = clip(0.03);
    for summary in ["Closed for 6 months", "It isn't closed", "", "Send it now"] {
        assert_eq!(spoken(note_input(&wav, summary), "anything").0, "unsupported", "{summary}");
    }
    let mut uppercase = note_input(&wav, "The bridge stays open");
    uppercase["request"]["note_sha256_hex"] = json!("AB".repeat(32));
    assert_eq!(spoken(uppercase, "The bridge stays open").0, "unsupported");
    let mut short_hash = note_input(&wav, "The bridge stays open");
    short_hash["request"]["note_sha256_hex"] = json!("ab".repeat(31));
    assert_eq!(spoken(short_hash, "The bridge stays open").0, "unsupported");
    let mut bad_contract = rating_input(&wav, "helpful");
    bad_contract["request"]["contract"] = json!("Not An Account");
    assert_eq!(spoken(bad_contract, "This note is helpful").0, "unsupported");
}

const MERGES_CONTRACT: &str = "merges.seams-v1.testnet";

fn merge_input(wav: &[u8], pull_request: u64, base: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "merge_approval",
            "contract": MERGES_CONTRACT,
            "repo_sha256_hex": "cd".repeat(32),
            "pull_request": pull_request,
            "base": base,
            "head_commit_hex": "0123456789abcdef0123456789abcdef01234567",
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

#[test]
fn verify_accepts_a_spoken_merge_approval_with_exact_words() {
    use spoken_intent::{request_digest, NearAccount, Network, SpokenBranch, SpokenRequestV1};
    let wav = clip(0.03);
    let (result, verdict) = spoken(merge_input(&wav, 42, "main"), "Merge pull request 42 into main.");
    assert_eq!(result, "accept");
    assert_eq!(verdict.heard.as_deref(), Some("merge pull request forty two into main"));
    assert_eq!(verdict.policy_rule, None);
    let request = SpokenRequestV1::MergeApproval {
        network: Network::Testnet,
        owner: NearAccount::new(OWNER).unwrap(),
        contract: NearAccount::new(MERGES_CONTRACT).unwrap(),
        repo_sha256: [0xcd; 32],
        pull_request: 42,
        base: SpokenBranch::new("main").unwrap(),
        head_commit: from_hex::<20>("0123456789abcdef0123456789abcdef01234567").unwrap(),
    };
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    // Another number, another base, a negation or another verb: no
    // forgiveness.
    for transcript in [
        "merge pull request 43 into main",
        "merge pull request 42 into master",
        "Merge pull request 4 into main.",
        "Do not merge pull request 42 into main.",
        "Close pull request 42 into main.",
        "Merge pull request 42.",
    ] {
        assert_eq!(spoken(merge_input(&wav, 42, "main"), transcript).0, "words", "{transcript}");
    }
    assert_eq!(spoken(merge_input(&wav, 1_001, "develop"), "Merge pull request 1001 into develop.").0, "accept");
}

#[test]
fn merge_inputs_that_are_not_speakable_are_unsupported() {
    let wav = clip(0.03);
    let said = "Merge pull request 42 into main.";
    assert_eq!(spoken(merge_input(&wav, 0, "main"), "Merge pull request 0 into main.").0, "unsupported");
    for base in ["", "Main", "release2", "feature/x", "two words", &"a".repeat(33)] {
        assert_eq!(spoken(merge_input(&wav, 42, base), said).0, "unsupported", "{base}");
    }
    for (field, value) in [
        ("repo_sha256_hex", "CD".repeat(32)),
        ("repo_sha256_hex", "cd".repeat(31)),
        ("repo_sha256_hex", "zz".repeat(32)),
        ("head_commit_hex", "0123456789ABCDEF0123456789ABCDEF01234567".to_string()),
        ("head_commit_hex", "ab".repeat(32)),
        ("head_commit_hex", "ab".repeat(19)),
        ("contract", "Not An Account".to_string()),
    ] {
        let mut input = merge_input(&wav, 42, "main");
        input["request"][field] = json!(value);
        assert_eq!(spoken(input, said).0, "unsupported", "{field}: {value}");
    }
    let mut extra = merge_input(&wav, 42, "main");
    extra["request"]["deposit"] = json!("1");
    assert_eq!(spoken(extra, said).0, "unsupported");
}
