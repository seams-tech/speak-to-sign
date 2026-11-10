//! The shared vectors: the signed verdicts of
//! `../voice-verifier/testdata/signed_verdict_v2.json` and the request
//! vectors of `../spoken-intent/fixtures/spoken_intent_vectors_v1.json`.
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use voice_verdict::{
    check_verdict, check_verdict_with, parse_ed25519_key, parse_verdict, request_digest,
    verdict_message, Check, Outcome, Refusal,
};

const SIGNED: &str = include_str!("../../voice-verifier/testdata/signed_verdict_v2.json");
const REQUESTS: &str = include_str!("../../spoken-intent/fixtures/spoken_intent_vectors_v1.json");

struct Case {
    verdict_json: String,
    signature_b64: String,
    request_digest: [u8; 32],
    expires_at_ms: u64,
    message_hex: String,
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file() -> Value {
    serde_json::from_str(SIGNED).unwrap()
}

fn key() -> [u8; 32] {
    parse_ed25519_key(file()["public_key"].as_str().unwrap()).unwrap()
}

fn case(name: &str) -> Case {
    let file = file();
    let case = file["verdicts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == name)
        .unwrap();
    let text = |field: &str| case[field].as_str().unwrap().to_string();
    Case {
        verdict_json: text("verdict_json"),
        signature_b64: text("signature_b64"),
        request_digest: request_digest(&unhex(&text("request_borsh_hex"))).unwrap(),
        expires_at_ms: case["expires_at_ms"].as_u64().unwrap(),
        message_hex: text("message_sha256_hex"),
    }
}

/// Signs a verdict text with the test key of the vector file.
fn sign(verdict_json: &str) -> String {
    use base64::Engine;
    let seed: [u8; 32] = unhex(file()["test_seed_hex"].as_str().unwrap())
        .try_into()
        .unwrap();
    let signature = SigningKey::from_bytes(&seed).sign(&verdict_message(verdict_json));
    base64::engine::general_purpose::STANDARD.encode(signature.to_bytes())
}

fn check_signed(verdict: &Value) -> Result<voice_verdict::Verdict, Refusal> {
    let text = verdict.to_string();
    check_verdict(&text, &sign(&text), &key(), &Check::at(0))
}

fn good() -> Value {
    serde_json::from_str(&case("accept").verdict_json).unwrap()
}

#[test]
fn the_key_text_is_the_key_bytes() {
    assert_eq!(hex(&key()), file()["public_key_hex"].as_str().unwrap());
    for text in [
        "",
        "ed25519:",
        "ed25519:0OIl",
        "secp256k1:abc",
        "ed25519:1111",
    ] {
        assert_eq!(parse_ed25519_key(text), None, "{text}");
    }
    assert_eq!(
        parse_ed25519_key(&format!("ed25519:{}", "1".repeat(32))),
        Some([0; 32])
    );
}

#[test]
fn the_accept_vector_passes() {
    let accept = case("accept");
    assert_eq!(
        hex(&verdict_message(&accept.verdict_json)),
        accept.message_hex
    );
    let audio = [7u8; 32];
    let check = Check::at(accept.expires_at_ms)
        .request(&accept.request_digest)
        .audio(&audio);
    let verdict =
        check_verdict(&accept.verdict_json, &accept.signature_b64, &key(), &check).unwrap();
    assert_eq!(verdict.outcome, Outcome::Accept);
    assert_eq!(
        verdict.heard.as_deref(),
        Some("send two near to alice dot testnet")
    );
    assert_eq!(verdict.speaker_score_milli, Some(655));
}

#[test]
fn the_callers_ed25519_check_decides() {
    let accept = case("accept");
    let check = Check::at(0);
    let seen = check_verdict_with(
        &accept.verdict_json,
        &accept.signature_b64,
        &key(),
        &check,
        |_, message, key_| {
            assert_eq!(hex(message), accept.message_hex);
            assert_eq!(key_, &key());
            true
        },
    );
    assert!(seen.is_ok());
    let refused = check_verdict_with(
        &accept.verdict_json,
        &accept.signature_b64,
        &key(),
        &check,
        |_, _, _| false,
    );
    assert_eq!(refused, Err(Refusal::BadSignature));
}

#[test]
fn a_step_up_verdict_passes_only_on_request() {
    let step_up = case("step_up");
    let check = Check::at(0).request(&step_up.request_digest);
    let refused = check_verdict(
        &step_up.verdict_json,
        &step_up.signature_b64,
        &key(),
        &check,
    );
    let Err(Refusal::StepUp(verdict)) = refused else {
        panic!("{refused:?}")
    };
    assert_eq!(
        verdict.policy_rule.as_deref(),
        Some("stub_voice_amount_above_10_near")
    );
    let allowed = check_verdict(
        &step_up.verdict_json,
        &step_up.signature_b64,
        &key(),
        &check.accept_step_up(),
    );
    assert_eq!(allowed.unwrap().outcome, Outcome::StepUp);
}

#[test]
fn expiry_and_other_digests() {
    let accept = case("accept");
    let other = case("step_up");
    let run =
        |check: Check| check_verdict(&accept.verdict_json, &accept.signature_b64, &key(), &check);
    assert!(matches!(
        run(Check::at(accept.expires_at_ms + 1)),
        Err(Refusal::Expired(_))
    ));
    assert!(matches!(
        run(Check::at(0).request(&other.request_digest)),
        Err(Refusal::RequestMismatch(_))
    ));
    assert!(matches!(
        run(Check::at(0).audio(&[0; 32])),
        Err(Refusal::AudioMismatch(_))
    ));
}

#[test]
fn bad_signatures() {
    let accept = case("accept");
    let other = case("step_up");
    let check = Check::at(0);
    assert_eq!(
        check_verdict(&accept.verdict_json, &other.signature_b64, &key(), &check),
        Err(Refusal::BadSignature)
    );
    let changed = accept.verdict_json.replace("two near", "ten near");
    assert_eq!(
        check_verdict(&changed, &accept.signature_b64, &key(), &check),
        Err(Refusal::BadSignature)
    );
    assert_eq!(
        check_verdict(
            &accept.verdict_json,
            &accept.signature_b64,
            &[1; 32],
            &check
        ),
        Err(Refusal::BadSignature)
    );
    for signature in ["", "AAAA", "!!!!", &accept.signature_b64[4..]] {
        assert_eq!(
            check_verdict(&accept.verdict_json, signature, &key(), &check),
            Err(Refusal::BadSignatureEncoding),
            "{signature}"
        );
    }
}

#[test]
fn signed_texts_of_another_outcome_kind_or_shape() {
    let mut refuse = good();
    refuse["outcome"] = json!("refuse");
    refuse["reason"] = json!("a_reason_of_a_later_version");
    let Err(Refusal::Refused(verdict)) = check_signed(&refuse) else {
        panic!()
    };
    assert_eq!(
        verdict.reason.as_deref(),
        Some("a_reason_of_a_later_version")
    );

    let mut kind = good();
    kind["kind"] = json!("seams_voice_signed_verdict_v1");
    assert_eq!(
        check_signed(&kind),
        Err(Refusal::WrongKind("seams_voice_signed_verdict_v1".into()))
    );

    let mut missing = good();
    missing.as_object_mut().unwrap().remove("heard");
    let mut extra = good();
    extra["extra"] = json!(1);
    let mut outcome = good();
    outcome["outcome"] = json!("maybe");
    let mut expiry = good();
    expiry["expires_at_ms"] = json!("1762700120000");
    for verdict in [missing, extra, outcome, expiry, json!([]), json!(null)] {
        assert!(
            matches!(check_signed(&verdict), Err(Refusal::Malformed(_))),
            "{verdict}"
        );
    }
    let text = "not json";
    assert!(matches!(
        check_verdict(text, &sign(text), &key(), &Check::at(0)),
        Err(Refusal::Malformed(_))
    ));

    // A verdict with no request digest reads, and no expected digest matches it.
    let mut no_digest = good();
    no_digest["request_digest"] = json!(null);
    assert!(parse_verdict(&no_digest.to_string()).is_ok());
    let text = no_digest.to_string();
    let digest = case("accept").request_digest;
    assert!(matches!(
        check_verdict(&text, &sign(&text), &key(), &Check::at(0).request(&digest)),
        Err(Refusal::RequestMismatch(_))
    ));
}

#[test]
fn the_request_digest_of_every_spoken_intent_vector() {
    let file: Value = serde_json::from_str(REQUESTS).unwrap();
    let mut plain = 0;
    let mut multisig = 0;
    for case in file["requests"].as_array().unwrap() {
        let borsh = unhex(case["borsh_hex"].as_str().unwrap());
        // Tag 1 (a multisig approval) has its own digest.
        if borsh[0] == 1 {
            assert_eq!(request_digest(&borsh), None);
            multisig += 1;
            continue;
        }
        assert_eq!(
            hex(&request_digest(&borsh).unwrap()),
            case["request_digest_hex"].as_str().unwrap(),
            "{}",
            case["name"]
        );
        plain += 1;
    }
    assert!(plain >= 27 && multisig >= 7, "{plain} {multisig}");
    assert_eq!(request_digest(&[]), None);
}

const TRANSCRIPTS: &str = include_str!("../../voice-verifier/testdata/signed_transcript_v1.json");

#[test]
fn a_confirmation_has_the_bytes_and_the_digest_of_the_golden_vectors() {
    use voice_verdict::confirmation_borsh;
    let file: Value = serde_json::from_str(REQUESTS).unwrap();
    // The fields of the `confirmation_*` cases of `spoken-intent/tests/vectors.rs`.
    for (name, owner, context, summary) in [
        (
            "confirmation_login",
            "app:user-42",
            "shop.example/login",
            "Log in to the example shop",
        ),
        (
            "confirmation_order",
            "app:shop.example:42",
            "shop.example/checkout",
            "Pay forty dollars for two books.",
        ),
        (
            "confirmation_other_chain",
            "app:u",
            "eip155:1/transfer",
            "Approve",
        ),
    ] {
        let case = file["requests"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap();
        let borsh = confirmation_borsh(owner, context, &[0x42; 32], summary).unwrap();
        assert_eq!(hex(&borsh), case["borsh_hex"].as_str().unwrap(), "{name}");
        assert_eq!(
            hex(&request_digest(&borsh).unwrap()),
            case["request_digest_hex"].as_str().unwrap(),
            "{name}"
        );
    }
    let long = format!("app:{}", "a".repeat(97));
    for (owner, context) in [
        ("alice.testnet", "login"),
        ("app:", "login"),
        ("app:User", "login"),
        (long.as_str(), "login"),
        ("app:u", ""),
        ("app:u", "Shop"),
    ] {
        assert_eq!(
            confirmation_borsh(owner, context, &[0; 32], "Log in"),
            None,
            "{owner} {context}"
        );
    }
}

#[test]
fn the_signed_transcripts() {
    use voice_verdict::{check_transcript, TranscriptRefusal};
    let file: Value = serde_json::from_str(TRANSCRIPTS).unwrap();
    let key = parse_ed25519_key(file["public_key"].as_str().unwrap()).unwrap();
    let now = file["expires_at_ms"].as_u64().unwrap();
    let case = |name: &str| {
        let case = file["transcripts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap()
            .clone();
        (
            case["transcript_json"].as_str().unwrap().to_string(),
            case["signature_b64"].as_str().unwrap().to_string(),
        )
    };
    let (json, signature) = case("accept");
    let audio = [7u8; 32];
    let transcript = check_transcript(
        &json,
        &signature,
        &key,
        now,
        Some("app:user-42"),
        Some(&audio),
    )
    .unwrap();
    assert_eq!(
        transcript.text.as_deref(),
        Some("book a table for two at 8 o'clock please")
    );
    assert!(matches!(
        check_transcript(&json, &signature, &key, now, Some("app:user-43"), None),
        Err(TranscriptRefusal::OwnerMismatch(_))
    ));
    assert!(matches!(
        check_transcript(&json, &signature, &key, now, None, Some(&[0; 32])),
        Err(TranscriptRefusal::AudioMismatch(_))
    ));
    assert!(matches!(
        check_transcript(&json, &signature, &key, now + 1, None, None),
        Err(TranscriptRefusal::Expired(_))
    ));
    assert_eq!(
        check_transcript(
            &json.replace("two", "ten"),
            &signature,
            &key,
            now,
            None,
            None
        ),
        Err(TranscriptRefusal::BadSignature)
    );
    let (refused, refused_signature) = case("refuse_speaker");
    let Err(TranscriptRefusal::Refused(transcript)) =
        check_transcript(&refused, &refused_signature, &key, now, None, None)
    else {
        panic!()
    };
    assert_eq!(transcript.reason.as_deref(), Some("speaker"));
    // A transcript is not a verdict, and a verdict is not a transcript: one key, two prefixes.
    assert_eq!(
        check_verdict(&json, &signature, &key, &Check::at(0)),
        Err(Refusal::BadSignature)
    );
    let verdict = super_case();
    assert_eq!(
        check_transcript(
            &verdict.verdict_json,
            &verdict.signature_b64,
            &key,
            0,
            None,
            None
        ),
        Err(TranscriptRefusal::BadSignature)
    );
}

fn super_case() -> Case {
    case("accept")
}
