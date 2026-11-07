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
    audio_used_key, template_key, EMBEDDING_DIM, MAX_OUTPUT_BYTES, NEAR_AI_API_KEY_ENV, NEAR_AI_TRANSCRIPTIONS_URL,
    REDIMNET_SHA256_HEX, SPEAKER_EMBED_URL,
};
use seams_voice_verifier::digest::{b64u, base58, from_hex, hex};
use seams_voice_verifier::host::{Host, PostRequest, Timed};
use seams_voice_verifier::output::{verdict_message, Verdict};
use seams_voice_verifier::speaker::service_message;
use seams_voice_verifier::{run_with, Pins};

const SPEAKER_SEED: [u8; 32] = [0x11; 32];
const VERDICT_SEED: [u8; 32] = [0x22; 32];
const VAULT: &str = "voicevault.testnet";
const OWNER: &str = "owner.testnet";

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
    posts: Vec<String>,
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
}

impl Host for Fake {
    fn secret(&self, name: &str) -> Option<String> {
        self.secrets.get(name).cloned()
    }
    fn storage_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.storage.get(key).cloned())
    }
    fn storage_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        if self.storage.contains_key(key) {
            return Ok(false);
        }
        self.storage.insert(key.into(), value.to_vec());
        Ok(true)
    }
    fn marker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.markers.get(key).cloned())
    }
    fn marker_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        if self.markers.contains_key(key) {
            return Ok(false);
        }
        self.markers.insert(key.into(), value.to_vec());
        Ok(true)
    }
    fn post_concurrent(&mut self, requests: &[PostRequest]) -> Vec<Timed> {
        requests
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
                } else {
                    Err("unknown host".into())
                };
                Timed { result, ms: 7 }
            })
            .collect()
    }
    fn random32(&mut self) -> Result<[u8; 32], String> {
        Ok([0x5a; 32])
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

fn enroll_input(clips: &[Vec<u8>]) -> Value {
    json!({
        "op": "enroll",
        "vault": VAULT,
        "owner": OWNER,
        "audio_wav_b64": clips.iter().map(|wav| STANDARD.encode(wav)).collect::<Vec<_>>(),
    })
}

fn verify_input(wav: &[u8]) -> Value {
    json!({
        "op": "verify",
        "vault": VAULT,
        "owner": OWNER,
        "receiver": "alice.testnet",
        "amount_yocto": "2000000000000000000000000",
        "nonce": 0,
        "contacts": ["alice.testnet", "bob.testnet"],
        "audio_wav_b64": STANDARD.encode(wav),
    })
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
    assert_eq!(out["reason"], Value::Null);
    // cos(0.4) = 0.921
    assert_eq!(out["agreement_milli"], 921);
    assert_eq!(out["vault"], VAULT);
    let key = SigningKey::from_bytes(&VERDICT_SEED).verifying_key().to_bytes();
    assert_eq!(out["verifier_public_key"], format!("ed25519:{}", base58(&key)));
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL; 3]);
    assert_eq!(fake.storage.get(&template_key(VAULT, OWNER)).map(Vec::len), Some(808));
    for wav in &clips {
        assert!(fake.markers.contains_key(&audio_used_key(&b64u(&Sha256::digest(wav)))));
    }
    // A second enrollment of the same vault and owner is refused.
    let again = [clip(0.08), clip(0.09), clip(0.1)];
    let out = call(&mut fake, enroll_input(&again));
    assert_eq!(out["reason"], "template_exists");
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
    assert_eq!(out["kind"], "seams_voice_verify_output_v1");
    let verdict = checked_verdict(&out);
    assert_eq!(verdict.reason, None, "{out}");
    assert_eq!(serde_json::to_value(verdict.outcome).unwrap(), "accept");
    assert_eq!(verdict.heard.as_deref(), Some("send two near to alice dot testnet"));
    assert_eq!(verdict.audio_digest, Some(b64u(&Sha256::digest(&wav))));
    // The same digests as the shared vector, which the vault checks.
    let vector: Value = serde_json::from_str(include_str!("../testdata/signed_verdict_v1.json")).unwrap();
    assert_eq!(verdict.request_digest.as_deref(), vector["request_digest"].as_str());
    assert_eq!(verdict.spoken_text_digest.as_deref(), vector["spoken_text_digest"].as_str());
    assert!(verdict.speaker_score_milli.unwrap() >= 450);
    for stage in ["decode", "storage", "parallel", "speaker", "transcribe", "redimnet", "sign", "total"] {
        assert!(out["ms"][stage].is_u64(), "{stage}: {out}");
    }
    // Both calls went out in one batch.
    assert_eq!(fake.posts[3..], [SPEAKER_EMBED_URL, NEAR_AI_TRANSCRIPTIONS_URL]);

    // The same audio again: refused before any network call.
    let posts = fake.posts.len();
    let again = call(&mut fake, verify_input(&wav));
    assert_eq!(checked_verdict(&again).reason.map(|r| serde_json::to_value(r).unwrap()), Some(json!("audio_reused")));
    assert_eq!(fake.posts.len(), posts);
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
    // The request digest is known before the audio fails.
    assert!(checked_verdict(&out).request_digest.is_some());

    let mut input = verify_input(&wav);
    input["extra"] = json!(1);
    let out = call(&mut fake, input);
    assert_eq!(reason(&out), "unsupported");
    assert_eq!(checked_verdict(&out).request_digest, None);

    for (field, value) in [
        ("amount_yocto", json!("1000")),
        ("receiver", json!(OWNER)),
        ("receiver", json!("0x1234")),
    ] {
        let mut input = verify_input(&wav);
        input[field] = value;
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
fn unknown_op() {
    let out = call(&mut Fake::new(), json!({ "op": "audio_key" }));
    assert_eq!(out["reason"], "unsupported");
}
