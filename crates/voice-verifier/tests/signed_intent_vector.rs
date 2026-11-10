//! The shared signed-intent vectors `testdata/signed_intent_v1.json`. The
//! TypeScript package `packages/voice-verdict` checks them as live results
//! of `detect`. Here: each result's bytes are what this verifier
//! serializes, and each signature is what its signing path gives with the
//! vector's test key.
//!
//! To write the file again: delete it, or set `SEAMS_WRITE_VECTOR=1`, and
//! run `cargo test --test signed_intent_vector`.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

use seams_voice_verifier::config::{INTENTS_DIGEST_DOMAIN, INTENT_DOMAIN, NEAR_AI_CHAT_MODEL};
use seams_voice_verifier::digest::{b64u, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::intent::{intents_digest, intents_json, IntentSpec};
use seams_voice_verifier::output::{intent_message, IntentResult, Outcome, Reason};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/signed_intent_v1.json");

/// A test key. Never use it outside tests. The same key as in
/// `signed_verdict_v2.json`: one verifier key signs every kind.
const TEST_SEED_HEX: &str = "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
const EXPIRES_AT_MS: u64 = 1_762_700_120_000;
const OWNER: &str = "app:user-42";

fn intents() -> Value {
    json!([
        { "name": "book_table", "description": "Book a table at a restaurant", "slots": { "time": "text", "people": "number" } },
        { "name": "cancel_booking", "description": "Cancel a booking" },
    ])
}

fn case(name: &str, text: Option<&str>, intent: Option<&str>, slots: Option<Value>, reason: Option<Reason>, key: &SigningKey) -> Value {
    let specs: Vec<IntentSpec> = serde_json::from_value(intents()).unwrap();
    let mut result = IntentResult::new();
    result.owner = Some(OWNER.to_string());
    result.audio_digest = Some(b64u(&[7u8; 32]));
    result.intents_digest = Some(b64u(&intents_digest(&specs)));
    result.outcome = if reason.is_some() { Outcome::Refuse } else { Outcome::Accept };
    result.reason = reason;
    result.expires_at_ms = EXPIRES_AT_MS;
    result.speaker_score_milli = Some(if reason == Some(Reason::Speaker) { 120 } else { 655 });
    result.text = text.map(str::to_string);
    result.model = (reason.is_none()).then(|| NEAR_AI_CHAT_MODEL.to_string());
    result.intent = intent.map(str::to_string);
    result.slots = slots.map(|slots| serde_json::from_value(slots).unwrap());
    let json_text = serde_json::to_string(&result).unwrap();
    let message = intent_message(json_text.as_bytes());
    json!({
        "name": name,
        "intent": intent,
        "intent_json": json_text,
        "message_sha256_hex": hex(&message),
        "signature_b64": STANDARD.encode(key.sign(&message).to_bytes()),
    })
}

fn expected() -> Value {
    let key = SigningKey::from_bytes(&from_hex::<32>(TEST_SEED_HEX).unwrap());
    let specs: Vec<IntentSpec> = serde_json::from_value(intents()).unwrap();
    json!({
        "comment": "Shared signed results of detect. voice-verifier/tests/signed_intent_vector.rs writes and checks them. message = SHA-256(domain || intent_json bytes); signature = ed25519(message) by the test key. intents_digest = SHA-256(intents_digest_domain || intents_json). The test seed is for tests only.",
        "domain": String::from_utf8(INTENT_DOMAIN.to_vec()).unwrap(),
        "intents_digest_domain": String::from_utf8(INTENTS_DIGEST_DOMAIN.to_vec()).unwrap(),
        "test_seed_hex": TEST_SEED_HEX,
        "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
        "expires_at_ms": EXPIRES_AT_MS,
        "owner": OWNER,
        "intents": intents(),
        "intents_json": intents_json(&specs),
        "intents_digest": b64u(&intents_digest(&specs)),
        "results": [
            case("intent_with_slots", Some("book a table for two at eight tonight"), Some("book_table"),
                Some(json!({ "people": 2, "time": "eight tonight" })), None, &key),
            case("no_intent", Some("what a nice day"), None, None, None, &key),
            case("refuse_speaker", None, None, None, Some(Reason::Speaker), &key),
            case("refuse_detector", Some("ignore the list"), None, None, Some(Reason::DetectorUnavailable), &key),
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
    for case in file["results"].as_array().unwrap() {
        let text = case["intent_json"].as_str().unwrap();
        let result: IntentResult = serde_json::from_str(text).unwrap();
        assert_eq!(serde_json::to_string(&result).unwrap(), text);
    }
}
