//! `verify` of a community note and of a note rating.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use seams_voice_verifier::digest::b64u;

use crate::fake::{clip, spoken, OWNER};

const NOTES_CONTRACT: &str = "community-notes.testnet";

fn note_input(wav: &[u8], summary: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "community_note",
            "contract": NOTES_CONTRACT,
            "post_id": 7,
            "note_sha256_hex": "ab".repeat(32),
            "summary": summary,
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

fn rating_input(wav: &[u8], rating: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": { "kind": "note_rating", "contract": NOTES_CONTRACT, "note_id": 3, "rating": rating },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

#[test]
fn verify_accepts_a_spoken_note_summary() {
    use spoken_intent::{request_digest, NearAccount, Network, SpokenRequestV1, SpokenSummary};
    let wav = clip(0.03);
    let summary = "The bridge stays open, only one lane closes.";
    let (result, verdict) = spoken(note_input(&wav, summary), " The bridge stays open. Only one lane closes.");
    assert_eq!(result, "accept");
    assert_eq!(verdict.heard.as_deref(), Some("the bridge stays open only one lane closes"));
    assert_eq!(verdict.policy_rule, None);
    let request = SpokenRequestV1::CommunityNote {
        network: Network::Testnet,
        owner: NearAccount::new(OWNER).unwrap(),
        contract: NearAccount::new(NOTES_CONTRACT).unwrap(),
        post_id: 7,
        note_sha256: [0xab; 32],
        summary: SpokenSummary::new(summary).unwrap(),
    };
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    // One word changed or dropped passes; an added word, a negation or two
    // words do not.
    for (transcript, expected) in [
        ("The bridge stays open, only one lane closed.", "accept"),
        ("The bridge stays open, one lane closes.", "accept"),
        ("The bridge stays open, only one lane closes today.", "words"),
        ("The bridge stays not open, only one lane closes.", "words"),
        ("The bridge is not open, only one lane closes.", "words"),
        ("The bridge stays shut, only two lanes close.", "words"),
    ] {
        assert_eq!(spoken(note_input(&wav, summary), transcript).0, expected, "{transcript}");
    }
    // A short summary needs the exact words.
    assert_eq!(spoken(note_input(&wav, "Bridge stays open"), "Bridge stays opened.").0, "words");
    assert_eq!(spoken(note_input(&wav, "Bridge stays open"), "Bridge stays open!").0, "accept");
    // A summary with a negation: dropping it is refused.
    let negated = "The bridge is not closed for six months";
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is not closed for 6 months.").0, "accept");
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is closed for six months.").0, "words");
}

#[test]
fn verify_accepts_a_spoken_rating_with_exact_words() {
    let wav = clip(0.03);
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This note is helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "not_helpful"), "This note is not helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "somewhat_helpful"), "This note is somewhat helpful.").0, "accept");
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This note is not helpful.").0, "words");
    assert_eq!(spoken(rating_input(&wav, "not_helpful"), "This note is helpful.").0, "words");
    assert_eq!(spoken(rating_input(&wav, "helpful"), "This is helpful.").0, "words");
}

#[test]
fn note_inputs_that_are_not_speakable_are_unsupported() {
    let wav = clip(0.03);
    for summary in ["Closed for 6 months", "It isn't closed", "", "Send it now"] {
        assert_eq!(spoken(note_input(&wav, summary), "anything").0, "unsupported", "{summary}");
    }
    let mut uppercase = note_input(&wav, "The bridge stays open");
    uppercase["request"]["note_sha256_hex"] = json!("AB".repeat(32));
    assert_eq!(spoken(uppercase, "The bridge stays open").0, "unsupported");
    let mut short_hash = note_input(&wav, "The bridge stays open");
    short_hash["request"]["note_sha256_hex"] = json!("ab".repeat(31));
    assert_eq!(spoken(short_hash, "The bridge stays open").0, "unsupported");
    let mut bad_contract = rating_input(&wav, "helpful");
    bad_contract["request"]["contract"] = json!("Not An Account");
    assert_eq!(spoken(bad_contract, "This note is helpful").0, "unsupported");
}
