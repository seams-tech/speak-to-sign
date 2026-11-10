//! `transcribe`: a signed transcript with the speaker check, and no request.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, SigningKey, Verifier};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use seams_voice_verifier::config::{NEAR_AI_TRANSCRIPTIONS_URL, SPEAKER_EMBED_URL, VERDICT_TTL_MS};
use seams_voice_verifier::digest::b64u;
use seams_voice_verifier::output::{transcript_message, verdict_message, Transcript};

use crate::fake::{call, call_local, clip, embedding, enrolled, Fake, NOW_MS, OWNER, VERDICT_SEED};

fn input(wav: &[u8]) -> Value {
    json!({ "op": "transcribe", "owner": OWNER, "audio_wav_b64": STANDARD.encode(wav) })
}

fn said(fake: &mut Fake, transcript: &str) -> Vec<u8> {
    fake.transcript = Some(transcript.into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    wav
}

/// The transcript of an output, after its signature checks.
fn checked(out: &Value) -> Transcript {
    assert_eq!(out["kind"], "seams_voice_transcript_output_v1");
    let text = out["transcript_json"].as_str().unwrap();
    let signature: [u8; 64] = STANDARD.decode(out["signature_b64"].as_str().unwrap()).unwrap().try_into().unwrap();
    let key = SigningKey::from_bytes(&VERDICT_SEED).verifying_key();
    let signature = Signature::from_bytes(&signature);
    key.verify(&transcript_message(text.as_bytes()), &signature).expect("signature over the transcript message");
    // The same key signs verdicts, with another prefix: this signature is
    // not a signature of these bytes as a verdict.
    assert!(key.verify(&verdict_message(text.as_bytes()), &signature).is_err());
    serde_json::from_str(text).unwrap()
}

#[test]
fn transcribe_signs_the_heard_words_of_the_owner() {
    let mut fake = enrolled();
    let wav = said(&mut fake, " Book a table for two at 8 o'clock, please!");
    let out = call(&mut fake, input(&wav));
    let transcript = checked(&out);
    assert_eq!(transcript.kind, "seams_voice_signed_transcript_v1");
    assert_eq!(serde_json::to_value(transcript.outcome).unwrap(), "accept");
    assert_eq!(transcript.reason, None);
    assert_eq!(transcript.owner.as_deref(), Some(OWNER));
    assert_eq!(transcript.text.as_deref(), Some("book a table for two at 8 o'clock please"));
    assert_eq!(transcript.audio_digest, Some(b64u(&Sha256::digest(&wav))));
    assert_eq!(transcript.expires_at_ms, NOW_MS + VERDICT_TTL_MS);
    assert!(transcript.speaker_score_milli.unwrap() >= 450);
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, NEAR_AI_TRANSCRIPTIONS_URL]);
    // The transcript is not a verdict: it has no request digest and another kind.
    let value: Value = serde_json::from_str(out["transcript_json"].as_str().unwrap()).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 9);
    assert!(value.get("request_digest").is_none());

    // The recording is used: a second run refuses.
    let again = checked(&call(&mut fake, input(&wav)));
    assert_eq!(serde_json::to_value(again.reason).unwrap(), "audio_reused");
    assert_eq!(again.text, None);
}

#[test]
fn transcribe_refuses_another_voice_and_gives_no_text() {
    let mut fake = enrolled();
    fake.transcript = Some("Pay everything to mallory.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(9, 0.0));
    let transcript = checked(&call(&mut fake, input(&wav)));
    assert_eq!(serde_json::to_value(transcript.reason).unwrap(), "speaker");
    assert_eq!(transcript.text, None);
    assert!(transcript.speaker_score_milli.unwrap() < 450);
}

#[test]
fn transcribe_refusals() {
    // No template.
    let mut fresh = Fake::new();
    let wav = said(&mut fresh, "Hello.");
    let transcript = checked(&call(&mut fresh, input(&wav)));
    assert_eq!(serde_json::to_value(transcript.reason).unwrap(), "template_missing");
    // No words, and a model that does not answer.
    let mut fake = enrolled();
    let wav = said(&mut fake, " ... ");
    assert_eq!(serde_json::to_value(checked(&call(&mut fake, input(&wav))).reason).unwrap(), "words");
    let mut fake = enrolled();
    let wav = said(&mut fake, "Hello.");
    fake.transcript = None;
    let transcript = checked(&call(&mut fake, input(&wav)));
    assert_eq!(serde_json::to_value(transcript.reason).unwrap(), "transcriber_unavailable");
    // An input with a request, or with a bad owner.
    let mut fake = enrolled();
    let mut with_request = input(&wav);
    with_request["request"] = json!({ "kind": "transfer" });
    assert_eq!(serde_json::to_value(checked(&call(&mut fake, with_request)).reason).unwrap(), "unsupported");
    let mut bad_owner = input(&wav);
    bad_owner["owner"] = json!("Not An Account");
    assert_eq!(serde_json::to_value(checked(&call(&mut fake, bad_owner)).reason).unwrap(), "unsupported");
    assert!(fake.posts.is_empty());
}

#[test]
fn transcribe_cuts_a_long_text_and_runs_in_the_local_variant() {
    let mut fake = enrolled();
    let long = "word ".repeat(200);
    let wav = said(&mut fake, &long);
    let out = call_local(&mut fake, input(&wav));
    let transcript = checked(&out);
    let text = transcript.text.unwrap();
    assert!(text.len() <= 200 && text.len() > 190, "{}", text.len());
    assert!(text.ends_with("word"));
    assert_eq!(fake.posts, [NEAR_AI_TRANSCRIPTIONS_URL]);

    // The longest owner and the longest text still fit the output limit
    // (`call` checks the size).
    let owner = format!("app:{}", "a".repeat(96));
    let mut fake = Fake::new();
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    let enroll = json!({
        "op": "enroll",
        "owner": owner,
        "audio_wav_b64": clips.iter().map(|wav| STANDARD.encode(wav)).collect::<Vec<_>>(),
    });
    assert_eq!(call(&mut fake, enroll)["outcome"], "accept");
    let wav = said(&mut fake, &long);
    let mut long_owner = input(&wav);
    long_owner["owner"] = json!(owner);
    let out = call(&mut fake, long_owner);
    assert_eq!(checked(&out).text.unwrap().len(), 199);
    assert!(out.to_string().len() < 1024 - 60, "{}", out.to_string().len());
}
