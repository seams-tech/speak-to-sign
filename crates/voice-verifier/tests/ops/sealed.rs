//! Sealed audio: `verify` and `enroll` open a recording that a Wallet
//! sealed to the audio key, and `audio_key` names that key.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, SigningKey, Verifier};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::config::{AUDIO_KEY_ENV, NEAR_AI_OHTTP_URL, SPEAKER_EMBED_URL};
use seams_voice_verifier::digest::{b64u, base58, from_hex, hex};
use seams_voice_verifier::envelope::{audio_key_message, AudioKey};

use crate::fake::{
    audio_public_key, call, checked_verdict, clip, embedding, enroll_input, enrolled, outcome_name, seal_to, sealed,
    verify_input, with_sealed_audio, Fake, AUDIO_KEY_HEX, OWNER, VERDICT_SEED,
};

const TRANSCRIPT: &str = "Send 2 NEAR to alice.testnet.";

/// A verify output for `input` on a fresh enrolled fake that hears the
/// transfer sentence in the voice of the owner.
fn verify_sealed(wav: &[u8], input: Value) -> (Fake, Value) {
    let mut fake = enrolled();
    fake.transcript = Some(TRANSCRIPT.into());
    fake.voice(wav, embedding(0, 0.3));
    let out = call(&mut fake, input);
    (fake, out)
}

#[test]
fn verify_accepts_sealed_audio() {
    let wav = clip(0.03);
    let (fake, out) = verify_sealed(&wav, with_sealed_audio(verify_input(&wav)));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    // The digest and the services see the opened WAV, as for plain audio.
    assert_eq!(verdict.audio_digest, Some(b64u(&Sha256::digest(&wav))));
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, NEAR_AI_OHTTP_URL]);
}

#[test]
fn a_sealed_recording_is_used_up_like_a_plain_one() {
    let wav = clip(0.03);
    let (mut fake, _) = verify_sealed(&wav, with_sealed_audio(verify_input(&wav)));
    // Another seal of the same WAV, and the plain WAV, are the same audio.
    let mut again = verify_input(&wav);
    again.as_object_mut().unwrap().remove("audio_wav_b64");
    again["audio_sealed_b64"] = STANDARD.encode(seal_to(&audio_public_key(), &wav, "verify", OWNER, 0x77)).into();
    for input in [again, verify_input(&wav)] {
        assert_eq!(outcome_name(&checked_verdict(&call(&mut fake, input))), "audio_reused");
    }
}

#[test]
fn enroll_accepts_sealed_audio() {
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.2 * index as f32));
    }
    let out = call(&mut fake, with_sealed_audio(enroll_input(&clips)));
    assert_eq!(out["outcome"], "accept", "{out}");
    let digests: Vec<String> = clips.iter().map(|wav| b64u(&Sha256::digest(wav))).collect();
    assert_eq!(out["audio_digests"], json!(digests));
}

#[test]
fn the_other_operations_open_sealed_audio_for_their_own_name() {
    let wav = clip(0.03);
    let plain = json!({ "op": "transcribe", "owner": OWNER, "audio_wav_b64": STANDARD.encode(&wav) });
    let (_, out) = verify_sealed(&wav, with_sealed_audio(plain.clone()));
    assert_eq!(out["kind"], "seams_voice_transcript_output_v1");
    let transcript: Value = serde_json::from_str(out["transcript_json"].as_str().unwrap()).unwrap();
    assert_eq!(transcript["outcome"], "accept", "{out}");
    assert_eq!(transcript["audio_digest"], b64u(&Sha256::digest(&wav)));
    // A clip sealed for `verify` does not open for `transcribe`.
    let mut for_verify = plain;
    for_verify.as_object_mut().unwrap().remove("audio_wav_b64");
    for_verify["audio_sealed_b64"] = sealed(&wav, "verify", OWNER).into();
    let (_, out) = verify_sealed(&wav, for_verify);
    let transcript: Value = serde_json::from_str(out["transcript_json"].as_str().unwrap()).unwrap();
    assert_eq!(transcript["reason"], "audio_invalid", "{out}");
}

/// The refusal of a verify input whose sealed audio is `sealed_b64`.
fn refusal_of(sealed_b64: String) -> (String, Value) {
    let wav = clip(0.03);
    let mut input = verify_input(&wav);
    input.as_object_mut().unwrap().remove("audio_wav_b64");
    input["audio_sealed_b64"] = sealed_b64.into();
    let (fake, out) = verify_sealed(&wav, input);
    // A recording that does not open reaches no service.
    assert!(fake.posts.is_empty());
    (outcome_name(&checked_verdict(&out)), out["detail"].clone())
}

#[test]
fn sealed_audio_opens_only_for_its_owner_and_operation() {
    let wav = clip(0.03);
    for (op, owner) in [("verify", "other.testnet"), ("enroll", OWNER)] {
        let (reason, detail) = refusal_of(sealed(&wav, op, owner));
        assert_eq!((reason.as_str(), detail), ("audio_invalid", json!("not_sealed_to_this_request")));
    }
}

#[test]
fn changed_or_foreign_sealed_audio_is_refused() {
    let wav = clip(0.03);
    let mut changed = STANDARD.decode(sealed(&wav, "verify", OWNER)).unwrap();
    *changed.last_mut().unwrap() ^= 1;
    let other_key = AudioKey::from_secret(&"99".repeat(32)).unwrap().public_key();
    let foreign = seal_to(&other_key, &wav, "verify", OWNER, 0x66);
    for bytes in [changed, foreign, vec![0u8; 20]] {
        assert_eq!(refusal_of(STANDARD.encode(bytes)).0, "audio_invalid");
    }
    assert_eq!(refusal_of("not base64!".into()), ("audio_invalid".into(), json!("bad_base64")));
}

#[test]
fn an_input_has_plain_or_sealed_audio_and_not_both() {
    let wav = clip(0.03);
    let mut both = verify_input(&wav);
    both["audio_sealed_b64"] = sealed(&wav, "verify", OWNER).into();
    let mut neither = verify_input(&wav);
    neither.as_object_mut().unwrap().remove("audio_wav_b64");
    for input in [both, neither] {
        let (_, out) = verify_sealed(&wav, input);
        assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported", "{out}");
    }
}

#[test]
fn sealed_audio_needs_the_audio_key() {
    let wav = clip(0.03);
    for secret in [None, Some("not a key")] {
        let mut fake = enrolled();
        fake.secrets.remove(AUDIO_KEY_ENV);
        if let Some(text) = secret {
            fake.secrets.insert(AUDIO_KEY_ENV.into(), text.into());
        }
        let out = call(&mut fake, with_sealed_audio(verify_input(&wav)));
        assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported");
        assert_eq!(out["detail"], "audio_key: missing");
        // Plain audio does not need the key.
        fake.transcript = Some(TRANSCRIPT.into());
        fake.voice(&wav, embedding(0, 0.3));
        assert_eq!(outcome_name(&checked_verdict(&call(&mut fake, verify_input(&wav)))), "accept");
    }
}

#[test]
fn audio_key_names_the_key_with_the_verdict_key() {
    let out = call(&mut Fake::new(), json!({ "op": "audio_key" }));
    assert_eq!(out["kind"], "seams_voice_audio_key_v1");
    assert_eq!(out["outcome"], "accept", "{out}");
    let audio_key: [u8; 32] = STANDARD.decode(out["audio_public_key_b64"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert_eq!(audio_key, audio_public_key());
    let verdict_key = SigningKey::from_bytes(&VERDICT_SEED).verifying_key();
    assert_eq!(out["public_key"], format!("ed25519:{}", base58(&verdict_key.to_bytes())));
    let signature: [u8; 64] = STANDARD.decode(out["signature_b64"].as_str().unwrap()).unwrap().try_into().unwrap();
    verdict_key.verify(&audio_key_message(&audio_key), &Signature::from_bytes(&signature)).expect("signature");
}

#[test]
fn audio_key_refuses_without_the_secret() {
    let mut fake = Fake::new();
    fake.secrets.remove(AUDIO_KEY_ENV);
    let out = call(&mut fake, json!({ "op": "audio_key" }));
    assert_eq!((&out["outcome"], &out["reason"], &out["detail"]), (&json!("refuse"), &json!("unsupported"), &json!("audio_key: missing")));
    assert_eq!(out["audio_public_key_b64"], Value::Null);
}

const VECTOR_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/sealed_audio_v1.json");

/// The shared vector `testdata/sealed_audio_v1.json`: one clip sealed with
/// a fixed ephemeral key. The Wallet package's tests seal the same clip
/// with the same key material and must get the same bytes.
///
/// To write the file again: delete it, or set `SEAMS_WRITE_VECTOR=1`, and
/// run `cargo test --test ops sealed_audio_vector`.
#[test]
fn sealed_audio_vector() {
    let plaintext: Vec<u8> = (0u8..=99).collect();
    let ikm = 0x66u8;
    let vector = json!({
        "suite": "DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305, base mode",
        "info": "seams:voice-audio:v1",
        "op": "verify",
        "owner": OWNER,
        "audio_key_secret_hex": AUDIO_KEY_HEX,
        "audio_public_key_hex": hex(&audio_public_key()),
        "ephemeral_ikm_hex": hex(&[ikm; 32]),
        "plaintext_hex": hex(&plaintext),
        "sealed_hex": hex(&seal_to(&audio_public_key(), &plaintext, "verify", OWNER, ikm)),
        "audio_key_message_hex": hex(&audio_key_message(&audio_public_key())),
    });
    let text = format!("{}\n", serde_json::to_string_pretty(&vector).unwrap());
    if std::env::var_os("SEAMS_WRITE_VECTOR").is_some() || !std::path::Path::new(VECTOR_PATH).exists() {
        std::fs::write(VECTOR_PATH, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(VECTOR_PATH).unwrap(), text);
    // The vector opens with the key of its secret.
    let key = AudioKey::from_secret(AUDIO_KEY_HEX).unwrap();
    let sealed_bytes: Vec<u8> = vector["sealed_hex"]
        .as_str()
        .unwrap()
        .as_bytes()
        .chunks(2)
        .map(|pair| from_hex::<1>(std::str::from_utf8(pair).unwrap()).unwrap()[0])
        .collect();
    assert_eq!(key.open(&sealed_bytes, b"verify\0owner.testnet"), Some(plaintext));
}
