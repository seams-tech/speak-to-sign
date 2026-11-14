//! The shared signed-verdict vectors `testdata/signed_verdict_v2.json`. The
//! Wallet's tests read the same file and check each verdict as they check a
//! live one. Here: each verdict's bytes are exactly what this verifier
//! serializes for that request, and each signature is what its signing path
//! gives with the vector's test key. So both sides agree on the signed bytes.
//!
//! To write the file again: delete it, or set `SEAMS_WRITE_VECTOR=1`, and
//! run `cargo test --test signed_vector`.
// The shared vectors are those of the default build. The `venice` build
// writes `<version>+venice` in each output, so it has its own bytes.
#![cfg(not(feature = "venice"))]
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

use seams_voice_verifier::config::VERDICT_DOMAIN;
use seams_voice_verifier::digest::{b64u, from_hex, hex, near_ed25519_key};
use seams_voice_verifier::ops::transfer_request;
use seams_voice_verifier::output::{verdict_json, verdict_message, Outcome, Verdict};
use seams_voice_verifier::policy::STUB_AMOUNT_RULE;
use spoken_intent::{render, request_digest, spoken_text_digest};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/signed_verdict_v2.json");

/// A test key. Never use it outside tests.
const TEST_SEED_HEX: &str = "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
/// The fixed expiry of every vector verdict, in ms since the UNIX epoch.
const EXPIRES_AT_MS: u64 = 1_762_700_120_000;
const OWNER: &str = "owner.testnet";
const RECEIVER: &str = "alice.testnet";

/// One signed verdict of a transfer of `amount_yocto` to `RECEIVER`.
fn case(name: &str, amount_yocto: u128, outcome: Outcome, key: &SigningKey) -> Value {
    let request = transfer_request(OWNER, RECEIVER, amount_yocto).unwrap();
    let rendered = render(&request);
    let mut verdict = Verdict::new();
    verdict.request_digest = Some(b64u(&request_digest(&request)));
    verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(&rendered)));
    verdict.audio_digest = Some(b64u(&[7u8; 32]));
    verdict.outcome = outcome;
    verdict.reason = None;
    if outcome == Outcome::StepUp {
        verdict.policy_rule = Some(STUB_AMOUNT_RULE.id.to_string());
    }
    verdict.expires_at_ms = EXPIRES_AT_MS;
    verdict.speaker_score_milli = Some(655);
    verdict.word_margin_milli = Some(142);
    // An `accept` and a `step_up` have no heard words.
    let text = verdict_json(&verdict);
    let message = verdict_message(text.as_bytes());
    json!({
        "name": name,
        "request": {
            "kind": "transfer",
            "network": "testnet",
            "owner": OWNER,
            "receiver": RECEIVER,
            "amount_yocto": amount_yocto.to_string(),
        },
        "request_borsh_hex": hex(&borsh_of(&request)),
        "spoken_text": rendered.spoken_text,
        "request_digest": verdict.request_digest,
        "spoken_text_digest": verdict.spoken_text_digest,
        "audio_digest": verdict.audio_digest,
        "outcome": serde_json::to_value(outcome).unwrap(),
        "policy_rule": verdict.policy_rule,
        "policy_text": (outcome == Outcome::StepUp).then_some(STUB_AMOUNT_RULE.text),
        "expires_at_ms": EXPIRES_AT_MS,
        "verdict_json": text,
        "message_sha256_hex": hex(&message),
        "signature_b64": STANDARD.encode(key.sign(&message).to_bytes()),
    })
}

/// The Borsh bytes of the request, for the Wallet's port of the request
/// digest (`request_digest = SHA-256(domain || these bytes)`).
fn borsh_of(request: &spoken_intent::SpokenRequestV1) -> Vec<u8> {
    use spoken_intent::{SpokenRequestV1, REQUEST_DIGEST_DOMAIN};
    let SpokenRequestV1::AccountTransfer { owner, receiver, amount, .. } = request else { unreachable!() };
    // Tag 2, network testnet (0), owner, receiver, amount (u128 LE).
    let mut bytes = vec![2u8, 0u8];
    for text in [owner.as_str(), receiver.as_str()] {
        bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
        bytes.extend_from_slice(text.as_bytes());
    }
    bytes.extend_from_slice(&amount.yocto().to_le_bytes());
    let mut preimage = REQUEST_DIGEST_DOMAIN.to_vec();
    preimage.extend_from_slice(&bytes);
    assert_eq!(seams_voice_verifier::digest::sha256(&preimage), request_digest(request));
    bytes
}

fn expected() -> Value {
    let key = SigningKey::from_bytes(&from_hex::<32>(TEST_SEED_HEX).unwrap());
    let one_near = 10u128.pow(24);
    json!({
        "comment": "Shared signed verdicts. voice-verifier/tests/signed_vector.rs writes and checks them; the Wallet's tests check them as live verdicts. message = SHA-256(domain || verdict_json bytes); signature = ed25519(message) by the test key. The test seed is for tests only.",
        "domain": String::from_utf8(VERDICT_DOMAIN.to_vec()).unwrap(),
        "test_seed_hex": TEST_SEED_HEX,
        "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
        "public_key_hex": hex(&key.verifying_key().to_bytes()),
        "verdicts": [
            case("accept", 2 * one_near, Outcome::Accept, &key),
            case("step_up", 11 * one_near, Outcome::StepUp, &key),
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
    // Each verdict text parses back into the same 13-field shape.
    for case in file["verdicts"].as_array().unwrap() {
        let text = case["verdict_json"].as_str().unwrap();
        let verdict: Verdict = serde_json::from_str(text).unwrap();
        assert_eq!(verdict_json(&verdict), text);
    }
}
