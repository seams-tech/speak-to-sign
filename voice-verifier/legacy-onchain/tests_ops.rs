//! The three operations end to end against a fake host: storage, relay,
//! ReDimNet, NEAR AI and the verdict fields.
use std::collections::HashMap;

use seams_voice_verifier::audio::{associated_data, seal_blob};
use seams_voice_verifier::config::{EMBEDDING_DIM, MAX_OUTPUT_BYTES, RELAY_HOST};
use seams_voice_verifier::digest::{b64u, from_b64u, sha256};
use seams_voice_verifier::host::{Host, PostRequest};
use seams_voice_verifier::run;
use serde_json::{json, Value};
use spoken_intent::{
    render, request_digest, spoken_text_digest, NearAmount, Network, SpokenAccount, SpokenRequestV1,
};

const VAULT: &str = "vault.testnet";
const OWNER: &str = "owner.testnet";
const API_KEY: &str = "test-key";

/// The field order of the shared vector (`testdata/verdict_vectors.json`).
const VERDICT_FIELDS: [&str; 13] = [
    "kind",
    "renderer",
    "verifier",
    "request_id",
    "request_digest",
    "spoken_text_digest",
    "audio_digest",
    "template_epoch",
    "outcome",
    "reason",
    "speaker_score_milli",
    "word_margin_milli",
    "heard",
];

struct FakeHost {
    caller: Option<String>,
    api_key: Option<String>,
    storage: HashMap<String, Vec<u8>>,
    blobs: HashMap<String, (u16, Vec<u8>)>,
    speaker_up: bool,
    speaker_loaded: bool,
    voice: Vec<f32>,
    /// What NEAR AI answers: `Err` is a network failure.
    reply: Result<(u16, Vec<u8>), String>,
    posts: Vec<PostRequest>,
}

fn reply_text(text: &str) -> Result<(u16, Vec<u8>), String> {
    Ok((200, serde_json::to_vec(&json!({ "text": text })).unwrap()))
}

impl FakeHost {
    fn new() -> Self {
        Self {
            caller: Some(VAULT.into()),
            api_key: Some(API_KEY.into()),
            storage: HashMap::new(),
            blobs: HashMap::new(),
            speaker_up: true,
            speaker_loaded: false,
            voice: voice(0),
            reply: reply_text(" Send 25 NEAR to alice.testnet."),
            posts: Vec::new(),
        }
    }

    fn call(&mut self, input: Value) -> Value {
        let bytes = run(&serde_json::to_vec(&input).unwrap(), self);
        assert!(bytes.len() < MAX_OUTPUT_BYTES, "{} bytes", bytes.len());
        let text = String::from_utf8(bytes).unwrap();
        let output: Value = serde_json::from_str(&text).unwrap();
        if output["kind"] == "seams_voice_verdict_v1" {
            // One wire shape: all 13 fields, in order, also when null.
            assert_eq!(output.as_object().unwrap().len(), VERDICT_FIELDS.len(), "{text}");
            let order: Vec<usize> =
                VERDICT_FIELDS.iter().map(|field| text.find(&format!("\"{field}\":")).unwrap()).collect();
            assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{text}");
        }
        output
    }

    fn public_key(&mut self) -> [u8; 32] {
        let output = self.call(json!({ "kind": "seams_voice_audio_key_input_v1", "op": "audio_key" }));
        from_b64u(output["public_key"].as_str().unwrap()).unwrap().try_into().unwrap()
    }

    /// Seals PCM for `subject`, puts it on the relay, and returns its `audio` ref.
    fn upload(&mut self, id: &str, subject: &str, pcm: &[u8]) -> Value {
        let public_key = self.public_key();
        let blob = seal_blob(&public_key, &associated_data(VAULT, subject), pcm).unwrap();
        let url = format!("https://{RELAY_HOST}/v1/blob/{id}");
        let audio = json!({ "url": url, "digest": b64u(&sha256(&blob)), "bytes": blob.len() });
        self.blobs.insert(url, (200, blob));
        audio
    }

    fn enroll_owner(&mut self) -> Value {
        let audio: Vec<Value> = (0..3).map(|i| self.upload(&format!("e{i}"), OWNER, &speech(i))).collect();
        self.call(enroll_input(audio))
    }
}

impl Host for FakeHost {
    fn caller(&self) -> Option<String> {
        self.caller.clone()
    }
    fn secret(&self, name: &str) -> Option<String> {
        assert_eq!(name, "NEAR_AI_API_KEY");
        self.api_key.clone()
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
    fn fetch(&mut self, url: &str) -> Result<(u16, Vec<u8>), String> {
        Ok(self.blobs.get(url).cloned().unwrap_or((404, Vec::new())))
    }
    fn post(&mut self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
        self.posts.push(request.clone());
        self.reply.clone()
    }
    fn load_speaker_model(&mut self) -> Result<(), String> {
        if !self.speaker_up {
            return Err("digest is not pinned".into());
        }
        self.speaker_loaded = true;
        Ok(())
    }
    fn speaker_embedding(&mut self, _samples: &[f32]) -> Result<Vec<f32>, String> {
        assert!(self.speaker_loaded);
        Ok(self.voice.clone())
    }
}

/// The text parts of a multipart body (everything but the WAV bytes).
fn text_parts(body: &[u8]) -> String {
    let start = body.windows(4).position(|w| w == b"RIFF").unwrap();
    let end = body.windows(4).rposition(|w| w == b"\r\n--").unwrap();
    format!("{}{}", String::from_utf8_lossy(&body[..start]), String::from_utf8_lossy(&body[end..]))
}

/// A raw embedding for speaker number `n`.
fn voice(n: usize) -> Vec<f32> {
    let mut values = vec![0.01f32; EMBEDDING_DIM];
    values[n] = 3.0;
    values
}

/// 1.5 s of tone at speech level, as PCM16, a little different per `n`.
fn speech(n: usize) -> Vec<u8> {
    (0..24_000)
        .map(|i| ((i as f32 * (0.05 + n as f32 * 0.01)).sin() * 3_000.0) as i16)
        .flat_map(i16::to_le_bytes)
        .collect()
}

fn transfer(vault: &str, network: Network) -> SpokenRequestV1 {
    SpokenRequestV1::VaultTransfer {
        network,
        vault: SpokenAccount::new(vault).unwrap(),
        owner: SpokenAccount::new(OWNER).unwrap(),
        receiver: SpokenAccount::new("alice.testnet").unwrap(),
        amount: NearAmount::from_hundredths(2_500).unwrap(),
        nonce: 3,
    }
}

fn enroll_input(audio: Vec<Value>) -> Value {
    json!({ "kind": "seams_voice_enroll_input_v1", "op": "enroll", "subject": OWNER, "template_epoch": 1, "audio": audio })
}

fn verify_input(request: &SpokenRequestV1, audio: Value) -> Value {
    json!({
        "kind": "seams_voice_verify_input_v1",
        "op": "verify",
        "renderer": "spoken-intent/1",
        "request_id": "17",
        "request": b64u(&borsh::to_vec(request).unwrap()),
        "subject": OWNER,
        "template_epoch": 1,
        "contacts": ["alice.testnet", "bob.testnet"],
        "audio": audio,
    })
}

fn reason(output: &Value) -> &str {
    output["reason"].as_str().unwrap_or("none")
}

#[test]
fn audio_key_is_made_once() {
    let mut host = FakeHost::new();
    let first = host.call(json!({ "kind": "seams_voice_audio_key_input_v1", "op": "audio_key" }));
    assert_eq!(first["outcome"], "accept");
    assert_eq!(first["created"], true);
    assert_eq!(first["kind"], "seams_voice_audio_key_v1");
    let second = host.call(json!({ "kind": "seams_voice_audio_key_input_v1", "op": "audio_key" }));
    assert_eq!(second["created"], false);
    assert_eq!(first["public_key"], second["public_key"]);
    assert_eq!(first["public_key"].as_str().unwrap().len(), 43);
}

#[test]
fn enroll_stores_one_template() {
    let mut host = FakeHost::new();
    let output = host.enroll_owner();
    assert_eq!(output["outcome"], "accept", "{output}");
    assert_eq!(output["agreement_milli"], 1000);
    assert_eq!(output["subject"], OWNER);
    assert_eq!(output["audio_digests"].as_array().unwrap().len(), 3);
    assert_eq!(host.storage["template:owner.testnet"].len(), 808);

    let again = host.enroll_owner();
    assert_eq!(reason(&again), "template_exists");
}

#[test]
fn enroll_refuses_disagreeing_samples_and_bad_input() {
    let mut host = FakeHost::new();
    host.voice = voice(1);
    let mut audio: Vec<Value> = (0..2).map(|i| host.upload(&format!("e{i}"), OWNER, &speech(i))).collect();
    audio.push(audio[0].clone());
    assert_eq!(reason(&host.call(enroll_input(audio.clone()))), "audio_reused");
    audio.pop();
    assert_eq!(reason(&host.call(enroll_input(audio))), "unsupported");

    let mut host = FakeHost::new();
    let audio: Vec<Value> = (0..3).map(|i| host.upload(&format!("e{i}"), OWNER, &speech(i))).collect();
    // The fake returns one voice for every call, so make the models fail instead.
    host.speaker_up = false;
    assert_eq!(reason(&host.call(enroll_input(audio.clone()))), "model_unavailable");
    host.speaker_up = true;
    assert_eq!(host.call(enroll_input(audio))["outcome"], "accept");
    // Enrollment never sends audio to NEAR AI.
    assert!(host.posts.is_empty());
}

#[test]
fn verify_accepts_the_owner_saying_the_request() {
    let mut host = FakeHost::new();
    host.enroll_owner();
    let request = transfer(VAULT, Network::Testnet);
    let audio = host.upload("v1", OWNER, &speech(5));
    let verdict = host.call(verify_input(&request, audio.clone()));
    assert_eq!(verdict["outcome"], "accept", "{verdict}");
    assert_eq!(verdict["reason"], Value::Null);
    assert_eq!(verdict["kind"], "seams_voice_verdict_v1");
    assert_eq!(verdict["renderer"], "spoken-intent/1");
    assert_eq!(verdict["verifier"], "0.1.0");
    assert_eq!(verdict["request_id"], "17");
    assert_eq!(verdict["request_digest"], b64u(&request_digest(&request)));
    assert_eq!(verdict["spoken_text_digest"], b64u(&spoken_text_digest(&render(&request))));
    assert_eq!(verdict["audio_digest"], audio["digest"]);
    assert_eq!(verdict["template_epoch"], 1);
    assert!(verdict["speaker_score_milli"].as_i64().unwrap() >= 999);
    assert_eq!(verdict["word_margin_milli"], 125);
    assert_eq!(verdict["heard"], "send twenty five near to alice dot testnet");

    // One NEAR AI call: the audio, the model and the language; no expected
    // text and no prompt.
    assert_eq!(host.posts.len(), 1);
    let post = &host.posts[0];
    assert_eq!(post.url, "https://cloud-api.near.ai/v1/audio/transcriptions");
    assert_eq!(post.timeout_secs, 30);
    assert!(post.headers.contains(&("Authorization".into(), format!("Bearer {API_KEY}"))));
    let parts = text_parts(&post.body);
    assert_eq!(parts.matches("Content-Disposition").count(), 3, "{parts}");
    assert!(parts.contains("name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n"));
    assert!(parts.contains("name=\"language\"\r\n\r\nen\r\n"));
    assert!(parts.contains("name=\"file\"; filename=\"clip.wav\""));
    let everything = String::from_utf8_lossy(&post.body).to_lowercase();
    for secret in ["alice", "twenty", "send", "prompt", "testnet"] {
        assert!(!everything.contains(secret), "{secret}");
    }
    // The WAV holds the decrypted PCM unchanged.
    let wav_start = post.body.windows(4).position(|w| w == b"RIFF").unwrap();
    assert_eq!(&post.body[wav_start + 44..wav_start + 44 + 48_000], &speech(5)[..]);

    // The same blob again: refused before any fetch or NEAR AI call.
    let replay = host.call(verify_input(&request, audio));
    assert_eq!(reason(&replay), "audio_reused");
    assert_eq!(replay["request_digest"], verdict["request_digest"]);
    assert_eq!(replay["audio_digest"], verdict["audio_digest"]);
    assert_eq!(host.posts.len(), 1);
}

#[test]
fn verify_refuses_another_speaker_and_other_words() {
    let mut host = FakeHost::new();
    host.enroll_owner();
    let request = transfer(VAULT, Network::Testnet);

    host.voice = voice(7);
    let audio = host.upload("v1", OWNER, &speech(5));
    let verdict = host.call(verify_input(&request, audio));
    assert_eq!(reason(&verdict), "speaker");
    assert!(verdict["speaker_score_milli"].as_i64().unwrap() < 450);
    assert_eq!(verdict["heard"], Value::Null);
    // Another voice never goes to NEAR AI.
    assert!(host.posts.is_empty());

    host.voice = voice(0);
    host.reply = reply_text("Send 25 NEAR to bob.testnet.");
    let audio = host.upload("v2", OWNER, &speech(6));
    let verdict = host.call(verify_input(&request, audio.clone()));
    assert_eq!(reason(&verdict), "words");
    assert_eq!(verdict["heard"], "send twenty five near to bob dot testnet");
    assert_eq!(verdict["word_margin_milli"], -125);
    // A word refusal uses the recording.
    host.reply = reply_text("Send 25 NEAR to alice.testnet.");
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "audio_reused");

    // A transcript that does not normalize.
    host.reply = reply_text("Send <unk> NEAR!");
    let audio = host.upload("v3", OWNER, &speech(7));
    let verdict = host.call(verify_input(&request, audio));
    assert_eq!(reason(&verdict), "words");
    assert_eq!(verdict["heard"], "send unk near");
    assert_eq!(verdict["word_margin_milli"], Value::Null);
}

#[test]
fn transcriber_outage_refuses_and_does_not_burn_the_recording() {
    let mut host = FakeHost::new();
    host.enroll_owner();
    let request = transfer(VAULT, Network::Testnet);
    let audio = host.upload("v1", OWNER, &speech(5));
    let good = host.reply.clone();
    for (reply, key) in [
        (Err("connection refused".to_string()), Some(API_KEY)),
        (Ok((503, b"{\"text\":\"send twenty five near to alice dot testnet\"}".to_vec())), Some(API_KEY)),
        (Ok((200, b"{\"error\":\"overloaded\"}".to_vec())), Some(API_KEY)),
        (reply_text(""), Some(API_KEY)),
        (reply_text("   "), Some(API_KEY)),
        (Ok((200, b"not json".to_vec())), Some(API_KEY)),
        (good.clone(), None),
        (good.clone(), Some("")),
    ] {
        host.reply = reply.clone();
        host.api_key = key.map(str::to_string);
        let verdict = host.call(verify_input(&request, audio.clone()));
        assert_eq!(reason(&verdict), "transcriber_unavailable", "{reply:?} {key:?}");
        assert_eq!(verdict["request_digest"], b64u(&request_digest(&request)));
        assert_eq!(verdict["audio_digest"], audio["digest"]);
        assert_eq!(verdict["template_epoch"], 1);
        assert!(verdict["speaker_score_milli"].as_i64().unwrap() >= 999);
        assert_eq!(verdict["heard"], Value::Null);
    }
    host.reply = good;
    host.api_key = Some(API_KEY.into());
    assert_eq!(host.call(verify_input(&request, audio))["outcome"], "accept");
}

#[test]
fn verify_audio_refusals() {
    let mut host = FakeHost::new();
    host.enroll_owner();
    let request = transfer(VAULT, Network::Testnet);

    // The relay lost the blob.
    let mut audio = host.upload("gone", OWNER, &speech(5));
    host.blobs.clear();
    assert_eq!(reason(&host.call(verify_input(&request, audio.clone()))), "audio_unavailable");

    // Changed bytes.
    audio = host.upload("v1", OWNER, &speech(5));
    let url = audio["url"].as_str().unwrap().to_string();
    host.blobs.get_mut(&url).unwrap().1[40] ^= 1;
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "audio_invalid");

    // Sealed for another subject.
    let audio = host.upload("v2", "mallory.testnet", &speech(5));
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "audio_invalid");

    // A URL off the pinned relay.
    let mut audio = host.upload("v3", OWNER, &speech(5));
    audio["url"] = json!("https://example.com/v1/blob/v3");
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "audio_invalid");

    // Silence fails the energy gate.
    let audio = host.upload("v4", OWNER, &vec![0u8; 32_000]);
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "quality");
}

#[test]
fn model_outage_does_not_burn_the_recording() {
    let mut host = FakeHost::new();
    host.enroll_owner();
    let request = transfer(VAULT, Network::Testnet);
    let audio = host.upload("v1", OWNER, &speech(5));
    host.speaker_up = false;
    assert_eq!(reason(&host.call(verify_input(&request, audio.clone()))), "model_unavailable");
    assert!(host.posts.is_empty());
    host.speaker_up = true;
    assert_eq!(host.call(verify_input(&request, audio))["outcome"], "accept");
}

#[test]
fn verify_template_and_request_refusals() {
    let mut host = FakeHost::new();
    let request = transfer(VAULT, Network::Testnet);
    let audio = host.upload("v1", OWNER, &speech(5));
    assert_eq!(reason(&host.call(verify_input(&request, audio.clone()))), "template_missing");

    host.enroll_owner();
    let mut wrong_epoch = verify_input(&request, audio.clone());
    wrong_epoch["template_epoch"] = json!(2);
    assert_eq!(reason(&host.call(wrong_epoch)), "template_missing");

    let other_vault = transfer("other-vault.testnet", Network::Testnet);
    assert_eq!(reason(&host.call(verify_input(&other_vault, audio.clone()))), "unsupported");
    let mainnet = transfer(VAULT, Network::Mainnet);
    assert_eq!(reason(&host.call(verify_input(&mainnet, audio.clone()))), "unsupported");

    let mut other_subject = verify_input(&request, audio.clone());
    other_subject["subject"] = json!("bob.testnet");
    assert_eq!(reason(&host.call(other_subject)), "unsupported");

    let mut garbage = verify_input(&request, audio.clone());
    garbage["request"] = json!("AAAA");
    let verdict = host.call(garbage);
    assert_eq!(reason(&verdict), "unsupported");
    assert_eq!(verdict["request_id"], "17");
    assert_eq!(verdict["request_digest"], Value::Null);

    // A refusal names every binding field that the input holds in a readable
    // form, also when the input as a whole is refused.
    let mut extra = verify_input(&request, audio.clone());
    extra["extra"] = json!(true);
    let verdict = host.call(extra);
    assert_eq!(reason(&verdict), "unsupported");
    assert_eq!(verdict["request_id"], "17");
    assert_eq!(verdict["request_digest"], b64u(&request_digest(&request)));
    assert_eq!(verdict["spoken_text_digest"], b64u(&spoken_text_digest(&render(&request))));
    assert_eq!(verdict["audio_digest"], audio["digest"]);
    assert_eq!(verdict["template_epoch"], 1);
    let verdict = host.call(verify_input(&other_vault, audio.clone()));
    assert_eq!(verdict["request_digest"], b64u(&request_digest(&other_vault)));
    assert_eq!(verdict["audio_digest"], audio["digest"]);
    let mut zero_epoch = verify_input(&request, audio.clone());
    zero_epoch["template_epoch"] = json!(0);
    let verdict = host.call(zero_epoch);
    assert_eq!(reason(&verdict), "unsupported");
    assert_eq!(verdict["template_epoch"], Value::Null);
    assert_eq!(verdict["request_digest"], b64u(&request_digest(&request)));

    let mut too_many = verify_input(&request, audio.clone());
    too_many["contacts"] = json!((0..33).map(|i| format!("c{i}.testnet")).collect::<Vec<_>>());
    assert_eq!(reason(&host.call(too_many)), "unsupported");

    host.caller = None;
    assert_eq!(reason(&host.call(verify_input(&request, audio))), "unsupported");
}

#[test]
fn unknown_input_is_refused() {
    let mut host = FakeHost::new();
    let output = host.call(json!({ "op": "drain" }));
    assert_eq!(output["kind"], "seams_voice_error_v1");
    assert_eq!(output["reason"], "unsupported");
    let bytes = run(b"not json", &mut host);
    let output: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(output["reason"], "unsupported");
}
