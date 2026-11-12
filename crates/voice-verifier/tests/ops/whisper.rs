//! The Whisper request: sealed to the checked NEAR AI gateway, with the
//! checked gateway in the worker storage (see `src/ops/whisper.rs`).
use serde_json::Value;

use seams_voice_verifier::config::{
    NEAR_AI_ATTESTATION_URL, NEAR_AI_GATEWAY_RECORD_KEY, NEAR_AI_OHTTP_URL, SPEAKER_EMBED_URL,
};

use crate::fake::{
    call, checked_verdict, clip, enrolled, gateway_record, outcome_name, verify_input, Attestation, Fake, GatewayMode,
    NOW_MS,
};

const HOUR_MS: u64 = 3_600_000;

/// An enrolled fake that will hear the words of `verify_input`.
fn ready() -> Fake {
    let mut fake = enrolled();
    fake.transcript = Some("Send 2 NEAR to alice.testnet.".into());
    fake
}

/// The fake with its clock at the time of the recorded collateral, and a
/// stored gateway that was checked `age_ms` before.
fn at_recorded_time(age_ms: u64) -> Fake {
    let mut fake = ready();
    fake.now = Fake::recorded_at();
    fake.worker.insert(NEAR_AI_GATEWAY_RECORD_KEY.into(), gateway_record(fake.now - age_ms));
    fake
}

/// The outcome name, the detail and the stage times of one verify call.
fn verify(fake: &mut Fake) -> (String, Value, Value) {
    let out = call(fake, verify_input(&clip(0.03)));
    let name = outcome_name(&checked_verdict(&out));
    (name, out["detail"].clone(), out["ms"].clone())
}

/// A refusal of the gateway: the speaker request was in flight (it starts
/// before the read of the gateway record) and was dropped. Nothing went to
/// NEAR AI.
fn assert_sent_to_the_speaker_service_only(fake: &Fake) {
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL]);
    assert_eq!(fake.events.last(), Some(&"cancel"));
    assert!(fake.sealed_requests.is_empty());
}

#[test]
fn a_fresh_record_needs_no_check() {
    let mut fake = ready();
    let (name, _, ms) = verify(&mut fake);
    assert_eq!(name, "accept");
    assert!(fake.gets.is_empty());
    assert_eq!(ms["tee_cached"], 1);
    assert!(ms["tee"].is_u64());
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, NEAR_AI_OHTTP_URL]);
    // Only the fake gateway opened the audio: the sealed request holds it.
    let wav = clip(0.03);
    let opened = &fake.sealed_requests[0];
    assert!(opened.windows(wav.len()).any(|window| window == wav));
}

#[test]
fn an_old_record_is_checked_again_with_a_fresh_nonce() {
    let mut fake = at_recorded_time(7 * HOUR_MS);
    let (name, detail, ms) = verify(&mut fake);
    // The check passed and gave the real gateway's key configuration. The
    // fake gateway does not hold that key, so it could not open the request.
    assert_eq!(ms["tee_cached"], 0);
    assert_eq!(fake.gets.len(), 6);
    assert!(fake.gets[0].starts_with(NEAR_AI_ATTESTATION_URL));
    assert!(fake.gets[1..].iter().all(|url| url.contains("trustedservices.intel.com")));
    // The speaker request is in flight during the read of the record and
    // during the check.
    assert_eq!(fake.events[..6], ["start", "worker_get", "get_all", "get_all", "worker_set", "add"]);
    assert_eq!((name.as_str(), detail.as_str()), ("transcriber_not_attested", Some("transcriber: ohttp: status_400")));
    // That reply drops the record, so the next call checks again.
    assert_eq!(fake.worker[NEAR_AI_GATEWAY_RECORD_KEY], b"{}");
}

#[test]
fn no_record_and_no_answer_refuses_before_any_audio_goes_to_whisper() {
    let mut fake = ready();
    fake.worker.clear();
    fake.attestation = Attestation::Down;
    let (name, detail, _) = verify(&mut fake);
    assert_eq!(name, "transcriber_unavailable");
    assert_eq!(detail, "attestation: report: connection refused");
    assert_sent_to_the_speaker_service_only(&fake);
}

#[test]
fn within_the_grace_period_a_service_that_is_down_keeps_the_record() {
    let mut fake = at_recorded_time(7 * HOUR_MS);
    fake.attestation = Attestation::Down;
    let (name, _, ms) = verify(&mut fake);
    assert_eq!(name, "accept");
    assert_eq!(ms["tee_cached"], 2);
}

#[test]
fn after_the_grace_period_a_service_that_is_down_refuses() {
    let mut fake = at_recorded_time(25 * HOUR_MS);
    fake.attestation = Attestation::Down;
    let (name, detail, _) = verify(&mut fake);
    assert_eq!(name, "transcriber_unavailable");
    assert_eq!(detail, "attestation: report: connection refused");
    assert_sent_to_the_speaker_service_only(&fake);
}

#[test]
fn a_failed_check_refuses_even_within_the_grace_period() {
    let mut fake = at_recorded_time(7 * HOUR_MS);
    fake.attestation = Attestation::WrongModel;
    let (name, detail, _) = verify(&mut fake);
    assert_eq!((name.as_str(), detail.as_str()), ("transcriber_not_attested", Some("attestation: model: name")));
    assert_sent_to_the_speaker_service_only(&fake);
}

#[test]
fn a_reply_that_the_gateway_did_not_seal_refuses_and_drops_the_record() {
    let mut fake = ready();
    fake.gateway_mode = GatewayMode::WrongSeal;
    let (name, detail, _) = verify(&mut fake);
    assert_eq!(
        (name.as_str(), detail.as_str()),
        ("transcriber_not_attested", Some("transcriber: ohttp: not_sealed_for_this_request"))
    );
    assert_eq!(fake.worker[NEAR_AI_GATEWAY_RECORD_KEY], b"{}");

    // The next call has no record, so it checks the gateway first.
    fake.gateway_mode = GatewayMode::Opens;
    fake.attestation = Attestation::Down;
    let again = call(&mut fake, verify_input(&clip(0.04)));
    assert_eq!(again["detail"], "attestation: report: connection refused");
}

#[test]
fn a_request_that_the_gateway_cannot_open_refuses() {
    let mut fake = ready();
    fake.gateway_mode = GatewayMode::Status400;
    let (name, detail, _) = verify(&mut fake);
    assert_eq!((name.as_str(), detail.as_str()), ("transcriber_not_attested", Some("transcriber: ohttp: status_400")));
}

#[test]
fn a_record_of_another_gateway_key_is_no_record() {
    let mut fake = ready();
    let mut record: Value = serde_json::from_slice(&fake.worker[NEAR_AI_GATEWAY_RECORD_KEY]).unwrap();
    record["gateway_key"] = Value::from("11".repeat(32));
    fake.worker.insert(NEAR_AI_GATEWAY_RECORD_KEY.into(), record.to_string().into_bytes());
    fake.attestation = Attestation::Down;
    let (name, _, _) = verify(&mut fake);
    assert_eq!(name, "transcriber_unavailable");
    assert_eq!(fake.gets.len(), 1);
}

#[test]
fn a_record_from_the_future_is_checked_again() {
    let mut fake = ready();
    fake.worker.insert(NEAR_AI_GATEWAY_RECORD_KEY.into(), gateway_record(NOW_MS + HOUR_MS));
    fake.attestation = Attestation::Down;
    let (name, _, _) = verify(&mut fake);
    assert_eq!(name, "transcriber_unavailable");
}
