//! The shared verdict vector `testdata/verdict_vectors.json`. The vault's
//! tests read the same file (`voice-vault/src/tests.rs`). Here: each vector
//! is exactly what this verifier serializes, and the reasons are exactly
//! `Reason::ALL`.
use std::collections::BTreeSet;

use seams_voice_verifier::digest::{b64u, sha256};
use seams_voice_verifier::output::{verdict_bytes, Outcome, Reason, Verdict};
use serde::Deserialize;
use serde_json::Value;
use spoken_intent::{
    render, request_digest, spoken_text_digest, NearAmount, Network, SpokenAccount, SpokenRequestV1,
};

pub const VECTORS: &str = include_str!("../testdata/verdict_vectors.json");

/// The wire fields, in serialization order.
const FIELDS: [&str; 13] = [
    "kind",
    "renderer",
    "verifier",
    "request_id",
    "request_digest",
    "spoken_text_digest",
    "audio_digest",
    "template_epoch",
    "outcome",
    "reason",
    "speaker_score_milli",
    "word_margin_milli",
    "heard",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Wire {
    kind: String,
    renderer: String,
    verifier: String,
    request_id: Option<String>,
    request_digest: Option<String>,
    spoken_text_digest: Option<String>,
    audio_digest: Option<String>,
    template_epoch: Option<u32>,
    outcome: Outcome,
    reason: Option<Reason>,
    speaker_score_milli: Option<i32>,
    word_margin_milli: Option<i32>,
    heard: Option<String>,
}

fn vectors() -> Value {
    serde_json::from_str(VECTORS).unwrap()
}

#[test]
fn binding_fields_are_the_vault_test_request() {
    let file = vectors();
    let spec = &file["request"];
    let account = |field: &str| SpokenAccount::new(spec[field].as_str().unwrap()).unwrap();
    assert_eq!(spec["network"], "testnet");
    let request = SpokenRequestV1::VaultTransfer {
        network: Network::Testnet,
        vault: account("vault"),
        owner: account("owner"),
        receiver: account("receiver"),
        amount: NearAmount::from_yocto(spec["amount_yocto"].as_str().unwrap().parse().unwrap()).unwrap(),
        nonce: spec["nonce"].as_u64().unwrap(),
    };
    let rendered = render(&request);
    assert_eq!(file["spoken_text"], rendered.spoken_text);
    assert_eq!(file["request_digest"], b64u(&request_digest(&request)));
    assert_eq!(file["spoken_text_digest"], b64u(&spoken_text_digest(&rendered)));
    let fill = spec["audio_digest_fill_byte"].as_u64().unwrap() as u8;
    assert_eq!(file["audio_digest"], b64u(&[fill; 32]));
    // Not a real digest of anything; only its form matters.
    assert_ne!(file["audio_digest"], b64u(&sha256(b"")));
}

#[test]
fn each_vector_is_what_the_verifier_serializes() {
    let file = vectors();
    let mut reasons = Vec::new();
    let mut accepts = 0;
    for case in file["verdicts"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let wire_value = &case["verdict"];
        let keys: Vec<&str> = wire_value.as_object().unwrap().keys().map(String::as_str).collect();
        let mut sorted_fields = FIELDS.to_vec();
        sorted_fields.sort_unstable();
        assert_eq!(keys, sorted_fields, "{name}: every field is present, also when null");

        let wire: Wire = serde_json::from_value(wire_value.clone()).unwrap();
        let mut verdict = Verdict::new();
        assert_eq!((wire.kind.as_str(), wire.renderer.as_str(), wire.verifier.as_str()),
            (verdict.kind, verdict.renderer, verdict.verifier), "{name}");
        verdict.request_id = wire.request_id;
        verdict.request_digest = wire.request_digest;
        verdict.spoken_text_digest = wire.spoken_text_digest;
        verdict.audio_digest = wire.audio_digest;
        verdict.template_epoch = wire.template_epoch;
        verdict.outcome = wire.outcome;
        verdict.reason = wire.reason;
        verdict.speaker_score_milli = wire.speaker_score_milli;
        verdict.word_margin_milli = wire.word_margin_milli;
        verdict.heard = wire.heard;

        let bytes = verdict_bytes(&verdict);
        let text = String::from_utf8(bytes.clone()).unwrap();
        let order: Vec<usize> = FIELDS.iter().map(|field| text.find(&format!("\"{field}\":")).unwrap()).collect();
        assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{name}: field order");
        assert_eq!(&serde_json::from_slice::<Value>(&bytes).unwrap(), wire_value, "{name}");

        match (verdict.outcome, verdict.reason) {
            (Outcome::Accept, None) => {
                accepts += 1;
                assert_eq!(case["vault_reason"], Value::Null, "{name}");
                for field in ["request_id", "request_digest", "spoken_text_digest", "audio_digest", "template_epoch"] {
                    assert_eq!(wire_value[field], file[field], "{name}: {field}");
                }
            }
            (Outcome::Refuse, Some(reason)) => {
                reasons.push(reason);
                assert_eq!(case["vault_reason"], serde_json::to_value(reason).unwrap(), "{name}");
                assert_eq!(name, case["vault_reason"].as_str().unwrap());
                for field in ["request_id", "request_digest", "spoken_text_digest", "audio_digest", "template_epoch"] {
                    assert!(wire_value[field].is_null() || wire_value[field] == file[field], "{name}: {field}");
                }
            }
            other => panic!("{name}: {other:?}"),
        }
    }
    assert_eq!(accepts, 1);
    assert_eq!(reasons.len(), Reason::ALL.len(), "one refusal per reason");
    let names = |list: &[Reason]| -> BTreeSet<String> {
        list.iter().map(|reason| serde_json::to_value(reason).unwrap().as_str().unwrap().to_string()).collect()
    };
    assert_eq!(names(&reasons), names(&Reason::ALL));
}
