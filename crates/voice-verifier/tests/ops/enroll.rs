//! `enroll`: the template, the owner's authorization and the refusals.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::audio::wav_bytes;
use seams_voice_verifier::config::{audio_used_key, template_key, NEAR_RPC_URL, SPEAKER_EMBED_URL};
use seams_voice_verifier::digest::{b64u, base58};

use crate::fake::{
    call, clip, digest_of, embedding, enroll_input, enroll_input_signed, Access, Fake, OWNER, OWNER_SEED, VERDICT_SEED,
};

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
        [
            "start",
            "get",
            "marker_get",
            "marker_get",
            "marker_get",
            "wait",
            "marker_set",
            "marker_set",
            "marker_set",
            "set"
        ]
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
