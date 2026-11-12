//! The `local-speaker` variant: the speaker model runs inside the worker,
//! and no request goes to the speaker service.
use serde_json::Value;

use seams_voice_verifier::config::{template_key, NEAR_AI_OHTTP_URL, NEAR_RPC_URL};

use crate::fake::{
    call, call_local, checked_verdict, clip, embedding, enroll_input, enrolled, outcome_name, verify_input, Fake, OWNER,
};

fn three_clips(fake: &mut Fake) -> [Vec<u8>; 3] {
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.1 * index as f32));
    }
    clips
}

#[test]
fn enroll_runs_the_model_in_the_worker() {
    let mut fake = Fake::new();
    let clips = three_clips(&mut fake);
    let out = call_local(&mut fake, enroll_input(&clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    assert_eq!(out["template_epoch"], 1);
    // Only the access-key read goes out. The model runs after the storage
    // reads, while that request is in flight.
    assert_eq!(fake.posts, [NEAR_RPC_URL]);
    assert_eq!(fake.events[..6], ["start", "get", "marker_get", "marker_get", "marker_get", "embed_local"]);
    assert_eq!(fake.events[6], "wait");
    assert_eq!(out["ms"]["model_fetch"], 300);
    assert_eq!(out["ms"]["model_cached"], 1);
    assert_eq!(out["ms"]["redimnet"], 1_500);
    assert_eq!(out["ms"]["speaker"], Value::Null);
}

#[test]
fn the_two_variants_write_the_same_template() {
    let mut service = Fake::new();
    let clips = three_clips(&mut service);
    assert_eq!(call(&mut service, enroll_input(&clips))["outcome"], "accept");
    let mut local = Fake::new();
    three_clips(&mut local);
    assert_eq!(call_local(&mut local, enroll_input(&clips))["outcome"], "accept");
    let key = template_key(OWNER);
    assert_eq!(service.storage[&key], local.storage[&key]);
}

#[test]
fn verify_accepts_a_template_of_the_service_variant() {
    // `enrolled` enrolls through the fake speaker service.
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    let out = call_local(&mut fake, verify_input(&wav));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert!(verdict.speaker_score_milli.unwrap() >= 450);
    assert_eq!(fake.posts, [NEAR_AI_OHTTP_URL]);
    assert_eq!(fake.events, ["worker_get", "start", "get", "poll", "marker_set", "embed_local", "wait"]);
    for stage in ["model_fetch", "redimnet", "transcribe", "parallel", "sign", "total"] {
        assert!(out["ms"][stage].is_u64(), "{stage}: {out}");
    }
    assert_eq!(out["ms"]["speaker"], Value::Null);
}

#[test]
fn verify_refuses_another_voice() {
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(7, 0.0));
    let verdict = checked_verdict(&call_local(&mut fake, verify_input(&wav)));
    assert_eq!(outcome_name(&verdict), "speaker");
}

#[test]
fn a_model_failure_is_speaker_unavailable() {
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake.local_model_down = true;
    let out = call_local(&mut fake, verify_input(&clip(0.03)));
    assert_eq!(outcome_name(&checked_verdict(&out)), "speaker_unavailable");
    assert_eq!(out["detail"], "speaker: model fetch: status_503");

    let mut fresh = Fake::new();
    fresh.local_model_down = true;
    let clips = three_clips(&mut fresh);
    let out = call_local(&mut fresh, enroll_input(&clips));
    assert_eq!(out["reason"], "speaker_unavailable", "{out}");
    assert!(!fresh.storage.contains_key(&template_key(OWNER)));
}

#[test]
fn a_build_with_no_model_refuses() {
    // A host with no model (the default `Host::embed_local`) in a local run.
    struct NoModel(Fake);
    use seams_voice_verifier::host::{GetRequest, Host, PostRequest, Reply, Timed};
    impl Host for NoModel {
        fn worker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
            self.0.worker_get(key)
        }
        fn worker_set(&mut self, key: &str, value: &[u8]) -> Result<(), String> {
            self.0.worker_set(key, value)
        }
        fn get_all(&mut self, requests: Vec<GetRequest>) -> Vec<Result<Reply, String>> {
            self.0.get_all(requests)
        }
        fn secret(&self, name: &str) -> Option<String> {
            self.0.secret(name)
        }
        fn storage_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
            self.0.storage_get(key)
        }
        fn storage_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
            self.0.storage_set_if_absent(key, value)
        }
        fn storage_set_if_equals(&mut self, key: &str, expected: &[u8], value: &[u8]) -> Result<bool, String> {
            self.0.storage_set_if_equals(key, expected, value)
        }
        fn marker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
            self.0.marker_get(key)
        }
        fn marker_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
            self.0.marker_set_if_absent(key, value)
        }
        fn post_start(&mut self, requests: Vec<PostRequest>) {
            self.0.post_start(requests)
        }
        fn post_poll(&mut self) {
            self.0.post_poll()
        }
        fn post_wait(&mut self) -> Vec<Timed> {
            self.0.post_wait()
        }
        fn post_cancel(&mut self) {
            self.0.post_cancel()
        }
        fn random32(&mut self) -> Result<[u8; 32], String> {
            self.0.random32()
        }
        fn now_ms(&mut self) -> u64 {
            self.0.now_ms()
        }
        fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
            self.0.sign(message)
        }
        fn public_key(&mut self) -> Result<Vec<u8>, String> {
            self.0.public_key()
        }
    }
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    let mut host = NoModel(fake);
    let pins = seams_voice_verifier::Pins { speaker_key: [0; 32], local_speaker: true };
    let input = verify_input(&clip(0.03)).to_string();
    let out: Value = serde_json::from_slice(&seams_voice_verifier::run_with(input.as_bytes(), &mut host, &pins)).unwrap();
    assert_eq!(out["detail"], "speaker: no_local_model");
}
