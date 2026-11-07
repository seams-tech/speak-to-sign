//! The shared signed-verdict vector `testdata/signed_verdict_v1.json`. The
//! vault's tests read the same file (`voice-vault/src/tests.rs`) and pay on
//! it. Here: the verdict bytes are exactly what this verifier serializes for
//! that request, and the signature is what its signing path gives with the
//! vector's test key. So both crates agree on the signed bytes.
//!
//! To write the file again: delete it, or set `SEAMS_WRITE_VECTOR=1`, and
//! run `cargo test --test signed_vector`.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

use seams_voice_verifier::config::VERDICT_DOMAIN;
use seams_voice_verifier::digest::{b64u, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::ops::transfer_request;
use seams_voice_verifier::output::{verdict_json, verdict_message, Outcome, Verdict};
use spoken_intent::{render, request_digest, spoken_text_digest};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/signed_verdict_v1.json");

/// A test key. Never use it outside tests.
const TEST_SEED_HEX: &str = "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";

fn expected() -> Value {
    let request = transfer_request("voicevault.testnet", "owner.testnet", "alice.testnet", 2 * 10u128.pow(24), 0).unwrap();
    let rendered = render(&request);
    let mut verdict = Verdict::new();
    verdict.request_digest = Some(b64u(&request_digest(&request)));
    verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(&rendered)));
    verdict.audio_digest = Some(b64u(&[7u8; 32]));
    verdict.outcome = Outcome::Accept;
    verdict.reason = None;
    verdict.speaker_score_milli = Some(655);
    verdict.word_margin_milli = Some(142);
    verdict.heard = Some(rendered.spoken_text.clone());
    let text = verdict_json(&verdict);
    let message = verdict_message(text.as_bytes());
    let key = SigningKey::from_bytes(&from_hex::<32>(TEST_SEED_HEX).unwrap());
    let signature = key.sign(&message);
    json!({
        "comment": "Shared signed verdict (plan Section 7.5). voice-verifier/tests/signed_vector.rs writes and checks it; voice-vault/src/tests.rs pays on it. message = SHA-256(domain || verdict_json bytes); signature = ed25519(message) by the test key. The test seed is for tests only.",
        "domain": String::from_utf8(VERDICT_DOMAIN.to_vec()).unwrap(),
        "request": {
            "network": "testnet",
            "vault": "voicevault.testnet",
            "owner": "owner.testnet",
            "receiver": "alice.testnet",
            "amount_yocto": "2000000000000000000000000",
            "nonce": 0
        },
        "spoken_text": rendered.spoken_text,
        "request_digest": verdict.request_digest,
        "spoken_text_digest": verdict.spoken_text_digest,
        "audio_digest": verdict.audio_digest,
        "test_seed_hex": TEST_SEED_HEX,
        "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
        "public_key_hex": hex(&key.verifying_key().to_bytes()),
        "verdict_json": text,
        "message_sha256_hex": hex(&message),
        "signature_b64": STANDARD.encode(signature.to_bytes()),
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
    // The verdict text parses back into the same 11-field shape.
    let verdict: Verdict = serde_json::from_str(file["verdict_json"].as_str().unwrap()).unwrap();
    assert_eq!(verdict_json(&verdict), file["verdict_json"].as_str().unwrap());
}
