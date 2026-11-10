//! The shared signed-transcript vectors `testdata/signed_transcript_v1.json`.
//! The TypeScript package `packages/voice-verdict` checks them as live
//! transcripts. Here: each transcript's bytes are what this verifier
//! serializes, and each signature is what its signing path gives with the
//! vector's test key.
//!
//! To write the file again: delete it, or set `SEAMS_WRITE_VECTOR=1`, and
//! run `cargo test --test signed_transcript_vector`.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

use seams_voice_verifier::config::TRANSCRIPT_DOMAIN;
use seams_voice_verifier::digest::{b64u, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::output::{transcript_message, Outcome, Reason, Transcript};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/signed_transcript_v1.json");

/// A test key. Never use it outside tests. The same key as in
/// `signed_verdict_v2.json`: one verifier key signs both kinds.
const TEST_SEED_HEX: &str = "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
const EXPIRES_AT_MS: u64 = 1_762_700_120_000;

fn case(name: &str, owner: &str, text: Option<&str>, reason: Option<Reason>, key: &SigningKey) -> Value {
    let mut transcript = Transcript::new();
    transcript.owner = Some(owner.to_string());
    transcript.audio_digest = Some(b64u(&[7u8; 32]));
    transcript.outcome = if reason.is_some() { Outcome::Refuse } else { Outcome::Accept };
    transcript.reason = reason;
    transcript.expires_at_ms = EXPIRES_AT_MS;
    transcript.speaker_score_milli = Some(if reason.is_some() { 120 } else { 655 });
    transcript.text = text.map(str::to_string);
    let json_text = serde_json::to_string(&transcript).unwrap();
    let message = transcript_message(json_text.as_bytes());
    json!({
        "name": name,
        "owner": owner,
        "audio_digest": transcript.audio_digest,
        "text": text,
        "transcript_json": json_text,
        "message_sha256_hex": hex(&message),
        "signature_b64": STANDARD.encode(key.sign(&message).to_bytes()),
    })
}

fn expected() -> Value {
    let key = SigningKey::from_bytes(&from_hex::<32>(TEST_SEED_HEX).unwrap());
    json!({
        "comment": "Shared signed transcripts. voice-verifier/tests/signed_transcript_vector.rs writes and checks them. message = SHA-256(domain || transcript_json bytes); signature = ed25519(message) by the test key. The test seed is for tests only.",
        "domain": String::from_utf8(TRANSCRIPT_DOMAIN.to_vec()).unwrap(),
        "test_seed_hex": TEST_SEED_HEX,
        "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
        "expires_at_ms": EXPIRES_AT_MS,
        "transcripts": [
            case("accept", "app:user-42", Some("book a table for two at 8 o'clock please"), None, &key),
            case("accept_near_owner", "owner.testnet", Some("what is my balance"), None, &key),
            case("refuse_speaker", "app:user-42", None, Some(Reason::Speaker), &key),
        ],
    })
}

#[test]
fn vector_is_what_this_verifier_signs() {
    let expected = expected();
    if std::env::var("SEAMS_WRITE_VECTOR").is_ok() || !std::path::Path::new(PATH).exists() {
        std::fs::write(PATH, serde_json::to_string_pretty(&expected).unwrap() + "\n").unwrap();
    }
    let file: Value = serde_json::from_str(&std::fs::read_to_string(PATH).unwrap()).unwrap();
    assert_eq!(file, expected);
    for case in file["transcripts"].as_array().unwrap() {
        let text = case["transcript_json"].as_str().unwrap();
        let transcript: Transcript = serde_json::from_str(text).unwrap();
        assert_eq!(serde_json::to_string(&transcript).unwrap(), text);
    }
}
