//! The shared enrollment vectors. The Wallet's tests read both files: it
//! computes the same enrollment digest from its three clips, and it signs
//! the same NEP-413 message that `enroll` checks.
//!
//! - `testdata/enrollment_digest_v2.json`: the digest of three audio digests.
//! - `testdata/enrollment_authorization_v1.json`: a NEP-413 signature of the
//!   enrollment message for that digest by a test key.
//!
//! To write the files again: delete them, or set `SEAMS_WRITE_VECTOR=1`, and
//! run `cargo test --test enrollment_vectors`.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

use seams_voice_verifier::config::{ENROLLMENT_DOMAIN, ENROLLMENT_RECIPIENT, NEP413_TAG};
use seams_voice_verifier::digest::{b64u, hex, near_ed25519_key, sha256};
use seams_voice_verifier::enrollment::{authorization_message, check_authorization, enrollment_digest, nep413_hash};
use seams_voice_verifier::input::EnrollAuthorization;

const DIGEST_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/enrollment_digest_v2.json");
const AUTHORIZATION_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/enrollment_authorization_v1.json");
const OWNER: &str = "owner.testnet";

/// The owner's test key seed: bytes 1 to 32. Never use it outside tests.
fn test_seed() -> [u8; 32] {
    std::array::from_fn(|index| index as u8 + 1)
}

fn audio_digests() -> [[u8; 32]; 3] {
    [1, 2, 3].map(|clip| sha256(format!("seams enrollment clip {clip}").as_bytes()))
}

fn digest_vector() -> Value {
    let digests = audio_digests();
    json!({
        "comment": "enrollment_digest = base64url-no-pad SHA-256(domain || owner || 0x00 || the three raw 32-byte audio digests, in order). Each audio digest here is SHA-256 of \"seams enrollment clip N\".",
        "domain": String::from_utf8(ENROLLMENT_DOMAIN.to_vec()).unwrap(),
        "owner": OWNER,
        "audio_digests": digests.iter().map(|digest| b64u(digest)).collect::<Vec<_>>(),
        "enrollment_digest": b64u(&enrollment_digest(OWNER, &digests)),
    })
}

fn authorization_vector() -> Value {
    let key = SigningKey::from_bytes(&test_seed());
    let digest = b64u(&enrollment_digest(OWNER, &audio_digests()));
    let message = authorization_message(&digest);
    let nonce = [0x2bu8; 32];
    let hash = nep413_hash(&message, &nonce, ENROLLMENT_RECIPIENT);
    json!({
        "comment": "A NEP-413 authorization of the enrollment in enrollment_digest_v2.json. hash = SHA-256(u32 LE tag || borsh(message, nonce, recipient, callback_url = None)); signature = ed25519(hash) by the test key. The test seed is for tests only.",
        "test_seed_hex": hex(&test_seed()),
        "public_key": near_ed25519_key(&key.verifying_key().to_bytes()),
        "owner": OWNER,
        "enrollment_digest": digest,
        "message": message,
        "recipient": ENROLLMENT_RECIPIENT,
        "nonce_b64": STANDARD.encode(nonce),
        "nep413_tag": NEP413_TAG,
        "nep413_hash_hex": hex(&hash),
        "signature_b64": STANDARD.encode(key.sign(&hash).to_bytes()),
    })
}

fn check_file(path: &str, expected: &Value) -> Value {
    if std::env::var("SEAMS_WRITE_VECTOR").is_ok() || !std::path::Path::new(path).exists() {
        std::fs::write(path, serde_json::to_string_pretty(expected).unwrap() + "\n").unwrap();
    }
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(&file, expected);
    file
}

#[test]
fn digest_vector_is_what_enroll_computes() {
    check_file(DIGEST_PATH, &digest_vector());
}

#[test]
fn authorization_vector_passes_the_enroll_check() {
    let file = check_file(AUTHORIZATION_PATH, &authorization_vector());
    let authorization = EnrollAuthorization {
        public_key: file["public_key"].as_str().unwrap().into(),
        signature_b64: file["signature_b64"].as_str().unwrap().into(),
        nonce_b64: file["nonce_b64"].as_str().unwrap().into(),
    };
    let digest = file["enrollment_digest"].as_str().unwrap();
    assert_eq!(check_authorization(&authorization, digest).as_deref(), Ok(file["public_key"].as_str().unwrap()));
    assert_eq!(check_authorization(&authorization, &digest.replace('A', "B")), Err("bad_signature"));
}
