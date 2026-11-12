//! `verify` of a transfer: the signed verdict, the step-up, each refusal and
//! the output size.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::config::{audio_used_key, SPEAKER_EMBED_URL, VERDICT_TTL_MS};
use seams_voice_verifier::digest::b64u;
use seams_voice_verifier::ops::transfer_request;
use seams_voice_verifier::policy::STUB_AMOUNT_RULE;

use crate::fake::{
    call, checked_verdict, clip, embedding, enrolled, events_of, outcome_name, verify_input, verify_input_for, Fake,
    NOW_MS, ONE_NEAR, OWNER, WORDS_URL,
};

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
    let vector: Value = serde_json::from_str(include_str!("../../testdata/signed_verdict_v2.json")).unwrap();
    let accept = &vector["verdicts"][0];
    assert_eq!(accept["name"], "accept");
    assert_eq!(verdict.request_digest.as_deref(), accept["request_digest"].as_str());
    assert_eq!(verdict.spoken_text_digest.as_deref(), accept["spoken_text_digest"].as_str());
    assert!(verdict.speaker_score_milli.unwrap() >= 450);
    for stage in [
        "decode",
        "send",
        "storage",
        "wait",
        "parallel",
        "speaker",
        "transcribe",
        "redimnet",
        "mark",
        "policy",
        "sign",
        "total",
    ] {
        assert!(out["ms"][stage].is_u64(), "{stage}: {out}");
    }
    // The speaker request went out first. The Whisper request joined its
    // batch after the read of the gateway record, before the storage calls
    // of the owner. The audio is marked used during the requests, before the
    // decision.
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, WORDS_URL]);
    assert_eq!(fake.events, events_of(&["start", "worker_get", "add", "get", "poll", "marker_set", "wait"]));

    // The same audio again: refused by the mark; the batch is dropped
    // without a wait.
    fake.events.clear();
    let again = call(&mut fake, verify_input(&wav));
    assert_eq!(outcome_name(&checked_verdict(&again)), "audio_reused");
    assert_eq!(fake.events, events_of(&["start", "worker_get", "add", "get", "poll", "marker_set", "cancel"]));
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
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "words");
    assert_eq!(verdict.policy_rule, None);
    assert_eq!(out["policy_text"], Value::Null);
}

#[test]
fn verify_refuses_other_words_and_uses_the_audio() {
    let wav = clip(0.03);
    let mut fake = enrolled();
    fake.transcript = Some("Send 3 NEAR to alice.testnet.".into());
    let verdict = checked_verdict(&call(&mut fake, verify_input(&wav)));
    assert_eq!(outcome_name(&verdict), "words");
    assert_eq!(verdict.heard.as_deref(), Some("send three near to alice dot testnet"));
    assert!(fake.markers.contains_key(&audio_used_key(&b64u(&Sha256::digest(&wav)))), "words burn the audio");
}

#[test]
fn verify_refuses_another_speaker() {
    let wav = clip(0.03);
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake.voice(&wav, embedding(9, 0.0));
    let verdict = checked_verdict(&call(&mut fake, verify_input(&wav)));
    assert_eq!(outcome_name(&verdict), "speaker");
    assert!(verdict.speaker_score_milli.unwrap() < 450);
}

#[test]
fn verify_refuses_an_owner_without_a_template() {
    let mut fake = Fake::new();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    assert_eq!(outcome_name(&checked_verdict(&call(&mut fake, verify_input(&clip(0.03))))), "template_missing");
    assert!(fake.markers.is_empty(), "an owner without a template uses up no audio");
}

#[test]
fn verify_refuses_a_speaker_reply_that_fails_its_signature() {
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake.speaker_tamper = true;
    let out = call(&mut fake, verify_input(&clip(0.03)));
    assert_eq!(outcome_name(&checked_verdict(&out)), "speaker_unavailable");
    assert_eq!(out["detail"], "speaker: bad_signature");
    assert!(fake.markers.len() == 4, "an outage uses up the audio: the Wallet records again");
}

#[test]
fn verify_refuses_when_the_transcriber_fails() {
    let mut fake = enrolled();
    fake.transcript = None;
    let out = call(&mut fake, verify_input(&clip(0.03)));
    assert_eq!(outcome_name(&checked_verdict(&out)), "transcriber_unavailable");
    assert_eq!(out["detail"], "transcriber: status_503");
}

#[test]
fn verify_refuses_without_an_api_key() {
    let mut fake = enrolled();
    fake.secrets.clear();
    assert_eq!(outcome_name(&checked_verdict(&call(&mut fake, verify_input(&clip(0.03))))), "transcriber_unavailable");
}

#[test]
fn verify_refuses_audio_that_is_not_a_wav() {
    let mut fake = enrolled();
    let mut input = verify_input(&clip(0.03));
    input["audio_wav_b64"] = json!(STANDARD.encode(b"not a wav"));
    let out = call(&mut fake, input);
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "audio_invalid");
    assert_eq!(out["detail"], "not_wav");
    // The request digest is known before the audio fails, and every
    // verdict expires.
    assert!(verdict.request_digest.is_some());
    assert_eq!(verdict.expires_at_ms, NOW_MS + VERDICT_TTL_MS);
}

#[test]
fn verify_refuses_an_unknown_field() {
    let mut fake = enrolled();
    let mut input = verify_input(&clip(0.03));
    input["extra"] = json!(1);
    let verdict = checked_verdict(&call(&mut fake, input));
    assert_eq!(outcome_name(&verdict), "unsupported");
    assert_eq!(verdict.request_digest, None);
}

#[test]
fn verify_refuses_a_transfer_request_that_is_not_speakable() {
    let mut fake = enrolled();
    for (field, value) in [
        ("amount_yocto", json!("1000")),
        ("receiver", json!(OWNER)),
        ("receiver", json!("0x1234")),
        ("kind", json!("vault_transfer")),
        ("nonce", json!(0)),
    ] {
        let mut input = verify_input(&clip(0.03));
        input["request"][field] = value;
        assert_eq!(outcome_name(&checked_verdict(&call(&mut fake, input))), "unsupported", "{field}");
    }
}

#[test]
fn a_long_transcript_still_fits_and_is_signed() {
    let mut fake = enrolled();
    fake.transcript = Some("near ".repeat(400) + &"x".repeat(900));
    let verdict = checked_verdict(&call(&mut fake, verify_input(&clip(0.03))));
    assert_eq!(outcome_name(&verdict), "words");
    let heard = verdict.heard.unwrap_or_default();
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
fn transfer_request_accepts_an_implicit_owner() {
    let implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    assert!(transfer_request(implicit, "alice.testnet", ONE_NEAR).is_ok());
    // The receiver is said, so it must still be speakable.
    assert!(transfer_request("owner.testnet", implicit, ONE_NEAR).is_err());
    assert!(transfer_request(implicit, implicit, ONE_NEAR).is_err());
    assert!(transfer_request("alice.testnet", "alice.testnet", ONE_NEAR).is_err());
}
