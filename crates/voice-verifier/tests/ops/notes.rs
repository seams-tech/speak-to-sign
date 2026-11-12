//! `verify` of a community note and of a note rating.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use seams_voice_verifier::config::{NEAR_AI_SYSTEMONE_URL, NEAR_AI_OHTTP_URL, SPEAKER_EMBED_URL};
use seams_voice_verifier::digest::{b64u, sha256};

use crate::fake::{call, checked_verdict, clip, enrolled, outcome_name, spoken, OWNER};

const NOTES_CONTRACT: &str = "community-notes.testnet";
const NOTE: &str = "The bridge is not closed. One lane closes for two weeks in March, says the city.";

fn note_input(wav: &[u8], summary: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "community_note",
            "contract": NOTES_CONTRACT,
            "post_id": 7,
            "note_text": NOTE,
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
        // The request binds the note by the SHA-256 of its text.
        note_sha256: sha256(NOTE.as_bytes()),
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
    // A summary with a negation: dropping it or replacing a word with one is refused.
    let negated = "The bridge is not closed for six months";
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is not closed for 6 months.").0, "accept");
    assert_eq!(spoken(note_input(&wav, negated), "The bridge is closed for six months.").0, "words");
    assert_eq!(spoken(note_input(&wav, "The bridge is closed today"), "The bridge isn't closed today.").0, "words");
    assert_eq!(spoken(note_input(&wav, "This post shows real footage"), "This post shows no footage.").0, "words");
    assert_eq!(spoken(note_input(&wav, "We do approve this"), "We don't approve this.").0, "words");
    assert_eq!(spoken(note_input(&wav, "Open the bridge without tolls"), "Open the bridge tolls.").0, "words");
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
    // The note: 1 to 280 characters. The hash alone is not a note.
    for note in [json!(""), json!("   "), json!("n".repeat(281)), Value::Null] {
        let mut input = note_input(&wav, "The bridge stays open");
        input["request"]["note_text"] = note.clone();
        assert_eq!(spoken(input, "The bridge stays open").0, "unsupported", "{note}");
    }
    let mut longest = note_input(&wav, "The bridge stays open");
    longest["request"]["note_text"] = json!("é".repeat(280));
    assert_eq!(spoken(longest, "The bridge stays open").0, "accept");
    let mut hash_only = note_input(&wav, "The bridge stays open");
    hash_only["request"].as_object_mut().unwrap().remove("note_text");
    hash_only["request"]["note_sha256_hex"] = json!("ab".repeat(32));
    assert_eq!(spoken(hash_only, "The bridge stays open").0, "unsupported");
    let mut bad_contract = rating_input(&wav, "helpful");
    bad_contract["request"]["contract"] = json!("Not An Account");
    assert_eq!(spoken(bad_contract, "This note is helpful").0, "unsupported");
}

/// One verify call of a note whose summary the owner says exactly, with
/// JEV's answer `fit` (`None`: JEV does not answer).
fn note_with_fit(fit: Option<f64>) -> (String, Value, crate::fake::Fake) {
    let mut fake = enrolled();
    let wav = clip(0.03);
    fake.voice(&wav, crate::fake::embedding(0, 0.3));
    fake.transcript = Some("The bridge stays open.".into());
    fake.summary_fit = fit;
    let out = call(&mut fake, note_input(&wav, "The bridge stays open"));
    (outcome_name(&checked_verdict(&out)), out, fake)
}

#[test]
fn a_note_is_signed_only_if_its_summary_gives_its_main_point() {
    let (outcome, out, fake) = note_with_fit(Some(0.9));
    assert_eq!(outcome, "accept", "{out}");
    // JEV got the note and the said summary, in the batch of the transcript.
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, NEAR_AI_OHTTP_URL, NEAR_AI_SYSTEMONE_URL]);
    assert_eq!(fake.events, ["worker_get", "start", "get", "poll", "marker_set", "wait"]);
    assert_eq!(fake.summary_checks.len(), 1);
    assert_eq!(fake.summary_checks[0]["state"], json!({ "note": NOTE, "summary": "The bridge stays open" }));
    assert!(out["ms"]["summary"].is_u64(), "{out}");

    // At the limit and below it.
    assert_eq!(note_with_fit(Some(0.6)).0, "accept");
    let (outcome, out, _) = note_with_fit(Some(0.48));
    assert_eq!(outcome, "summary_mismatch");
    assert_eq!(out["detail"], "summary: fit_480");
    // The voice and the words passed, and the refusal is still signed.
    let verdict = checked_verdict(&out);
    assert_eq!(verdict.heard.as_deref(), Some("the bridge stays open"));
    assert!(verdict.spoken_text_digest.is_some());
}

#[test]
fn a_note_is_not_signed_without_the_answer_of_jev() {
    let (outcome, out, _) = note_with_fit(None);
    assert_eq!(outcome, "summary_check_unavailable");
    assert_eq!(out["detail"], "summary: status_503");
}

#[test]
fn the_words_are_checked_before_the_summary() {
    // Wrong words and a summary that does not fit: the words refuse first.
    let mut fake = enrolled();
    let wav = clip(0.03);
    fake.voice(&wav, crate::fake::embedding(0, 0.3));
    fake.transcript = Some("Something else entirely.".into());
    fake.summary_fit = Some(0.1);
    let out = call(&mut fake, note_input(&wav, "The bridge stays open"));
    assert_eq!(outcome_name(&checked_verdict(&out)), "words");
}

#[test]
fn a_rating_has_no_summary_check() {
    let mut fake = enrolled();
    let wav = clip(0.03);
    fake.voice(&wav, crate::fake::embedding(0, 0.3));
    fake.transcript = Some("This note is helpful.".into());
    fake.summary_fit = None;
    let out = call(&mut fake, rating_input(&wav, "helpful"));
    assert_eq!(outcome_name(&checked_verdict(&out)), "accept", "{out}");
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, NEAR_AI_OHTTP_URL]);
}
