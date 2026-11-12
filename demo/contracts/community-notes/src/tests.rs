use super::*;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn set_caller(name: &str) {
    set_caller_at(name, 1_700_000_000_000);
}

fn set_caller_at(name: &str, timestamp_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("notes"))
            .predecessor_account_id(account(name))
            .signer_account_id(account(name))
            .block_timestamp(timestamp_ms * 1_000_000)
            .build()
    );
}

/// A contract without the voice rule: a note and a rating need no verdict.
fn notes_without_voice() -> CommunityNotes {
    let mut contract = CommunityNotes::default();
    contract.set_voice_required(false);
    contract
}

/// A contract with one note (id 1) by alice on post 7.
fn contract_with_note() -> CommunityNotes {
    set_caller("alice");
    let mut contract = notes_without_voice();
    assert_eq!(
        contract.add_note(
            7,
            "The photo is from 2019.".into(),
            "Photo is from 2019".into(),
            None,
            None
        ),
        1
    );
    contract
}

fn rate(contract: &mut CommunityNotes, rater: &str, note_id: u64, rating: Rating) {
    set_caller(rater);
    contract.rate_note(note_id, rating, None, None);
}

fn note(contract: &CommunityNotes, note_id: u64) -> NoteView {
    contract.get_note(note_id).expect("the note exists")
}

fn event(log: &str) -> Value {
    let json = log.strip_prefix("EVENT_JSON:").expect("an EVENT_JSON log");
    serde_json::from_str(json).unwrap()
}

// --- add_note ---

#[test]
fn add_note_stores_the_note_and_counts_ids_from_1() {
    set_caller_at("alice", 1_731_000_000_123);
    let mut contract = notes_without_voice();
    let id = contract.add_note(
        7,
        "Context for the post.".into(),
        "Context".into(),
        None,
        None,
    );
    assert_eq!(id, 1);
    assert_eq!(
        note(&contract, 1),
        NoteView {
            id: 1,
            post_id: 7,
            author: account("alice"),
            text: "Context for the post.".into(),
            summary: "Context".into(),
            created_at_ms: 1_731_000_000_123,
            helpful: 0,
            somewhat_helpful: 0,
            not_helpful: 0,
            status: NoteStatus::NeedsMoreRatings,
            hidden: false,
        }
    );

    set_caller("bob");
    assert_eq!(
        contract.add_note(8, "Second.".into(), "Second".into(), None, None),
        2
    );
    assert_eq!(
        contract.add_note(7, "Third.".into(), "Third".into(), None, None),
        3
    );
    assert_eq!(note(&contract, 2).author, account("bob"));
    assert_eq!(note(&contract, 3).post_id, 7);
}

#[test]
fn add_note_logs_note_added() {
    let _contract = contract_with_note();
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert_eq!(
        logs[0],
        r#"EVENT_JSON:{"standard":"community_notes","version":"1.1.0","event":"note_added","data":[{"note_id":1,"post_id":7,"author":"alice.testnet"}]}"#
    );
}

#[test]
fn text_and_summary_accept_the_maximum_length_in_characters_not_bytes() {
    set_caller("alice");
    let mut contract = notes_without_voice();
    // Each "é" is 2 bytes and each "🗳" is 4 bytes in UTF-8.
    let text = "é".repeat(MAX_TEXT_CHARS);
    let summary = "🗳".repeat(MAX_SUMMARY_CHARS);
    let id = contract.add_note(1, text.clone(), summary.clone(), None, None);
    let view = note(&contract, id);
    assert_eq!(view.text, text);
    assert_eq!(view.summary, summary);
    // One character is the minimum.
    assert_eq!(contract.add_note(1, "a".into(), "b".into(), None, None), 2);
}

#[test]
#[should_panic(expected = "text has 281 characters; the maximum is 280")]
fn text_longer_than_280_characters_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, "é".repeat(281), "Summary".into(), None, None);
}

#[test]
#[should_panic(expected = "summary has 121 characters; the maximum is 120")]
fn summary_longer_than_120_characters_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, "Text".into(), "🗳".repeat(121), None, None);
}

#[test]
#[should_panic(expected = "text must not be empty")]
fn empty_text_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, String::new(), "Summary".into(), None, None);
}

#[test]
#[should_panic(expected = "text must not be empty")]
fn text_of_only_white_space_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, " \n\t ".into(), "Summary".into(), None, None);
}

#[test]
#[should_panic(expected = "summary must not be empty")]
fn empty_summary_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, "Text".into(), String::new(), None, None);
}

#[test]
#[should_panic(expected = "summary must not be empty")]
fn summary_of_only_white_space_fails() {
    set_caller("alice");
    notes_without_voice().add_note(1, "Text".into(), "   ".into(), None, None);
}

// --- rate_note ---

#[test]
fn rate_note_counts_the_rating_and_logs_note_rated() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::SomewhatHelpful);
    let view = note(&contract, 1);
    assert_eq!(
        (view.helpful, view.somewhat_helpful, view.not_helpful),
        (0, 1, 0)
    );
    assert_eq!(
        contract.get_rating(1, account("bob")),
        Some(Rating::SomewhatHelpful)
    );

    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert_eq!(
        logs[0],
        r#"EVENT_JSON:{"standard":"community_notes","version":"1.1.0","event":"note_rated","data":[{"note_id":1,"account_id":"bob.testnet","rating":"somewhat_helpful","previous_rating":null,"status":"needs_more_ratings"}]}"#
    );
}

#[test]
#[should_panic(expected = "the author cannot rate their own note")]
fn author_cannot_rate_their_own_note() {
    let mut contract = contract_with_note();
    rate(&mut contract, "alice", 1, Rating::Helpful);
}

#[test]
fn a_later_rating_replaces_the_earlier_rating() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::Helpful);
    rate(&mut contract, "carol", 1, Rating::Helpful);
    assert_eq!(note(&contract, 1).status, NoteStatus::Helpful);

    rate(&mut contract, "bob", 1, Rating::NotHelpful);
    let view = note(&contract, 1);
    assert_eq!(
        (view.helpful, view.somewhat_helpful, view.not_helpful),
        (1, 0, 1)
    );
    assert_eq!(view.status, NoteStatus::NeedsMoreRatings);
    assert_eq!(
        contract.get_rating(1, account("bob")),
        Some(Rating::NotHelpful)
    );
    assert_eq!(
        contract.get_rating(1, account("carol")),
        Some(Rating::Helpful)
    );

    let logged = event(&get_logs()[0]);
    assert_eq!(logged["data"][0]["rating"], "not_helpful");
    assert_eq!(logged["data"][0]["previous_rating"], "helpful");
    assert_eq!(logged["data"][0]["status"], "needs_more_ratings");

    rate(&mut contract, "bob", 1, Rating::SomewhatHelpful);
    let view = note(&contract, 1);
    assert_eq!(
        (view.helpful, view.somewhat_helpful, view.not_helpful),
        (1, 1, 0)
    );
}

#[test]
fn the_same_rating_twice_counts_once() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::Helpful);
    rate(&mut contract, "bob", 1, Rating::Helpful);
    let view = note(&contract, 1);
    assert_eq!(
        (view.helpful, view.somewhat_helpful, view.not_helpful),
        (1, 0, 0)
    );
    assert_eq!(view.status, NoteStatus::NeedsMoreRatings);
}

#[test]
fn a_rating_is_per_note() {
    let mut contract = contract_with_note();
    set_caller("dave");
    let second = contract.add_note(7, "Another note.".into(), "Another".into(), None, None);
    rate(&mut contract, "bob", 1, Rating::Helpful);
    rate(&mut contract, "bob", second, Rating::NotHelpful);
    assert_eq!(
        contract.get_rating(1, account("bob")),
        Some(Rating::Helpful)
    );
    assert_eq!(
        contract.get_rating(second, account("bob")),
        Some(Rating::NotHelpful)
    );
    assert_eq!(note(&contract, 1).helpful, 1);
    assert_eq!(note(&contract, second).not_helpful, 1);
}

#[test]
#[should_panic(expected = "note 99 does not exist")]
fn rating_an_unknown_note_fails() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 99, Rating::Helpful);
}

#[test]
#[should_panic(expected = "note 0 does not exist")]
fn rating_note_0_fails() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 0, Rating::Helpful);
}

// --- status ---

#[test]
fn status_thresholds() {
    use NoteStatus::*;
    let cases = [
        // (helpful, not_helpful, status)
        (0, 0, NeedsMoreRatings),
        (1, 0, NeedsMoreRatings),
        (0, 1, NeedsMoreRatings),
        (2, 0, Helpful),
        (2, 1, Helpful),
        (2, 2, NeedsMoreRatings),
        (3, 2, Helpful),
        (0, 2, NotHelpful),
        (1, 2, NotHelpful),
        (2, 3, NotHelpful),
        (5, 5, NeedsMoreRatings),
        (1, 1, NeedsMoreRatings),
    ];
    for (helpful, not_helpful, expected) in cases {
        assert_eq!(
            NoteStatus::from_counts(helpful, not_helpful),
            expected,
            "helpful {helpful}, not_helpful {not_helpful}"
        );
    }
}

#[test]
fn status_follows_the_ratings_on_the_contract() {
    let mut contract = contract_with_note();
    let status = |contract: &CommunityNotes| note(contract, 1).status;

    rate(&mut contract, "r1", 1, Rating::Helpful);
    assert_eq!(status(&contract), NoteStatus::NeedsMoreRatings);
    rate(&mut contract, "r2", 1, Rating::Helpful);
    assert_eq!(status(&contract), NoteStatus::Helpful);
    rate(&mut contract, "r3", 1, Rating::NotHelpful);
    assert_eq!(status(&contract), NoteStatus::Helpful);
    rate(&mut contract, "r4", 1, Rating::NotHelpful);
    assert_eq!(status(&contract), NoteStatus::NeedsMoreRatings);
    rate(&mut contract, "r5", 1, Rating::NotHelpful);
    assert_eq!(status(&contract), NoteStatus::NotHelpful);
    let logged = event(&get_logs()[0]);
    assert_eq!(logged["data"][0]["status"], "not_helpful");
}

#[test]
fn somewhat_helpful_does_not_change_the_status() {
    let mut contract = contract_with_note();
    for rater in ["r1", "r2", "r3"] {
        rate(&mut contract, rater, 1, Rating::SomewhatHelpful);
    }
    assert_eq!(note(&contract, 1).status, NoteStatus::NeedsMoreRatings);
    rate(&mut contract, "r4", 1, Rating::Helpful);
    rate(&mut contract, "r5", 1, Rating::Helpful);
    let view = note(&contract, 1);
    assert_eq!(
        (view.helpful, view.somewhat_helpful, view.not_helpful),
        (2, 3, 0)
    );
    assert_eq!(view.status, NoteStatus::Helpful);
}

// --- views ---

#[test]
fn get_notes_returns_the_newest_50_of_the_post() {
    set_caller("alice");
    let mut contract = notes_without_voice();
    for n in 1..=55u64 {
        let post_id = if n % 10 == 0 { 2 } else { 1 };
        contract.add_note(
            post_id,
            format!("Note {n}"),
            format!("Summary {n}"),
            None,
            None,
        );
    }
    // Post 1 has the 50 notes that are not multiples of 10. Post 2 has 5.
    let post_1 = contract.get_notes(1);
    assert_eq!(post_1.len(), 50);
    let ids: Vec<u64> = post_1.iter().map(|n| n.id).collect();
    let expected: Vec<u64> = (1..=55u64).rev().filter(|n| n % 10 != 0).collect();
    assert_eq!(ids, expected);
    assert!(post_1.iter().all(|n| n.post_id == 1));

    let post_2: Vec<u64> = contract.get_notes(2).iter().map(|n| n.id).collect();
    assert_eq!(post_2, vec![50, 40, 30, 20, 10]);

    // Two more notes on post 1 push the two oldest out of the view.
    contract.add_note(1, "Note 56".into(), "Summary 56".into(), None, None);
    contract.add_note(1, "Note 57".into(), "Summary 57".into(), None, None);
    let ids: Vec<u64> = contract.get_notes(1).iter().map(|n| n.id).collect();
    assert_eq!(ids.len(), 50);
    assert_eq!(&ids[..3], &[57, 56, 55]);
    assert_eq!(
        *ids.last().unwrap(),
        3,
        "notes 1 and 2 are older than the newest 50"
    );
}

#[test]
fn get_notes_shows_current_counts() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::Helpful);
    rate(&mut contract, "carol", 1, Rating::Helpful);
    let notes = contract.get_notes(7);
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].helpful, 2);
    assert_eq!(notes[0].status, NoteStatus::Helpful);
}

#[test]
fn unknown_ids_in_views_give_empty_results() {
    let contract = contract_with_note();
    assert_eq!(contract.get_notes(999), vec![]);
    assert_eq!(contract.get_note(0), None);
    assert_eq!(contract.get_note(2), None);
    assert_eq!(contract.get_rating(99, account("bob")), None);
    assert_eq!(
        contract.get_rating(1, account("bob")),
        None,
        "bob has not rated note 1"
    );
}

// --- JSON shapes ---

#[test]
fn note_view_json_uses_numbers_and_snake_case() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::Helpful);
    let value = serde_json::to_value(note(&contract, 1)).unwrap();
    assert_eq!(
        value,
        json!({
            "id": 1,
            "post_id": 7,
            "author": "alice.testnet",
            "text": "The photo is from 2019.",
            "summary": "Photo is from 2019",
            "created_at_ms": 1_700_000_000_000u64,
            "helpful": 1,
            "somewhat_helpful": 0,
            "not_helpful": 0,
            "status": "needs_more_ratings",
            "hidden": false
        })
    );
    assert!(value["id"].is_u64() && value["post_id"].is_u64() && value["created_at_ms"].is_u64());
}

#[test]
fn rating_and_status_json_strings() {
    let ratings = [
        (Rating::Helpful, "\"helpful\""),
        (Rating::SomewhatHelpful, "\"somewhat_helpful\""),
        (Rating::NotHelpful, "\"not_helpful\""),
    ];
    for (rating, json) in ratings {
        assert_eq!(serde_json::to_string(&rating).unwrap(), json);
        assert_eq!(serde_json::from_str::<Rating>(json).unwrap(), rating);
    }
    assert!(serde_json::from_str::<Rating>("\"very_helpful\"").is_err());
    assert!(serde_json::from_str::<Rating>("\"Helpful\"").is_err());

    let statuses = [
        (NoteStatus::Helpful, "\"helpful\""),
        (NoteStatus::NotHelpful, "\"not_helpful\""),
        (NoteStatus::NeedsMoreRatings, "\"needs_more_ratings\""),
    ];
    for (status, json) in statuses {
        assert_eq!(serde_json::to_string(&status).unwrap(), json);
    }
}

// --- hide_note ---

fn set_moderator(contract: &mut CommunityNotes) {
    set_caller("notes");
    contract.set_moderator(account("multisig"));
}

#[test]
fn the_moderator_hides_a_note() {
    let mut contract = contract_with_note();
    rate(&mut contract, "bob", 1, Rating::Helpful);
    set_moderator(&mut contract);
    assert_eq!(contract.get_moderator(), Some(account("multisig")));

    set_caller_at("multisig", 1_731_000_000_500);
    contract.hide_note(1, Some(12));
    let hidden = note(&contract, 1);
    assert!(hidden.hidden);
    assert_eq!(hidden.text, "");
    assert_eq!(hidden.summary, "");
    assert_eq!((hidden.post_id, hidden.helpful), (7, 1));
    assert_eq!(hidden.author, account("alice"));
    assert_eq!(contract.get_notes(7), vec![hidden]);

    let logs = get_logs();
    assert_eq!(
        event(logs.last().unwrap()),
        json!({
            "standard": "community_notes",
            "version": "1.1.0",
            "event": "note_hidden",
            "data": [{ "note_id": 1, "post_id": 7, "moderator": "multisig.testnet", "proposal_id": 12 }],
        })
    );
}

#[test]
fn the_event_leaves_out_a_missing_proposal_id() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("multisig");
    contract.hide_note(1, None);
    let logs = get_logs();
    assert_eq!(
        event(logs.last().unwrap())["data"][0],
        json!({ "note_id": 1, "post_id": 7, "moderator": "multisig.testnet" })
    );
}

#[test]
#[should_panic(expected = "only the moderator can hide a note")]
fn without_a_moderator_no_one_can_hide_a_note() {
    let mut contract = contract_with_note();
    set_caller("notes");
    contract.hide_note(1, None);
}

#[test]
#[should_panic(expected = "only the moderator can hide a note")]
fn another_account_cannot_hide_a_note() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("bob");
    contract.hide_note(1, None);
}

#[test]
#[should_panic(expected = "this note is already hidden")]
fn a_note_is_hidden_once() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("multisig");
    contract.hide_note(1, None);
    contract.hide_note(1, None);
}

#[test]
#[should_panic(expected = "note 9 does not exist")]
fn hiding_an_unknown_note_fails() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("multisig");
    contract.hide_note(9, None);
}

#[test]
#[should_panic(expected = "this note is hidden")]
fn a_hidden_note_takes_no_ratings() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("multisig");
    contract.hide_note(1, None);
    rate(&mut contract, "bob", 1, Rating::Helpful);
}

#[test]
fn a_new_moderator_replaces_the_old_one() {
    let mut contract = contract_with_note();
    set_moderator(&mut contract);
    set_caller("notes");
    contract.set_moderator(account("council"));
    assert_eq!(contract.get_moderator(), Some(account("council")));
}

// --- the voice verdict of a note and of a rating ---

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};

const T0: u64 = 1_700_000_000_000;
const NOTE_TEXT: &str = "The photo is from 2019.";
const NOTE_SUMMARY: &str = "The photo is old";

/// The test key of the voice verifier.
fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[0x2a; 32])
}

fn public_key(key: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        near_sdk::bs58::encode(key.verifying_key().to_bytes()).into_string()
    )
}

/// A contract with the voice rule on and the test verifier key.
fn notes_with_voice() -> CommunityNotes {
    set_caller("notes");
    let mut contract = CommunityNotes::default();
    contract.set_voice_verifier_key(public_key(&verifier()));
    contract
}

fn near_account_of(name: &str) -> NearAccount {
    NearAccount::new(account(name).as_str()).unwrap()
}

/// The request digest of a spoken note, as the verifier computes it.
fn note_digest(who: &str, post_id: u64, text: &str, summary: &str) -> [u8; 32] {
    request_digest(&SpokenRequestV1::CommunityNote {
        network: Network::Testnet,
        owner: near_account_of(who),
        contract: near_account_of("notes"),
        post_id,
        note_sha256: env::sha256_array(text.as_bytes()),
        summary: SpokenSummary::new(summary).unwrap(),
    })
}

/// The request digest of a spoken rating, as the verifier computes it.
fn rating_digest(who: &str, note_id: u64, rating: NoteRatingV1) -> [u8; 32] {
    request_digest(&SpokenRequestV1::NoteRating {
        network: Network::Testnet,
        owner: near_account_of(who),
        contract: near_account_of("notes"),
        note_id,
        rating,
    })
}

/// A verdict as the verifier serializes it, with its signature. `audio`
/// makes two verdicts of one request differ, as two recordings do.
fn signed(
    key: &SigningKey,
    digest: &[u8; 32],
    outcome: &str,
    expires_at_ms: u64,
    audio: u8,
) -> (Option<String>, Option<String>) {
    let json = format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.8.0","request_digest":"{}","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"{}","outcome":"{outcome}","reason":null,"policy_rule":null,"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"the photo is old"}}"#,
        URL_SAFE_NO_PAD.encode(digest),
        URL_SAFE_NO_PAD.encode([audio; 32]),
    );
    let mut preimage = verdict::VERDICT_DOMAIN.to_vec();
    preimage.extend_from_slice(json.as_bytes());
    let signature = STANDARD.encode(key.sign(&env::sha256_array(&preimage)).to_bytes());
    (Some(json), Some(signature))
}

/// An accepted verdict of the test verifier that expires 120 s after `T0`.
fn accepted(digest: &[u8; 32], audio: u8) -> (Option<String>, Option<String>) {
    signed(&verifier(), digest, "accept", T0 + 120_000, audio)
}

/// Alice says the summary of her note on post 7 and the verifier accepts it.
fn alice_note(audio: u8) -> (Option<String>, Option<String>) {
    accepted(&note_digest("alice", 7, NOTE_TEXT, NOTE_SUMMARY), audio)
}

fn add_spoken(
    contract: &mut CommunityNotes,
    who: &str,
    at_ms: u64,
    text: &str,
    verdict: (Option<String>, Option<String>),
) -> u64 {
    set_caller_at(who, at_ms);
    contract.add_note(7, text.into(), NOTE_SUMMARY.into(), verdict.0, verdict.1)
}

/// A contract with the voice rule and Alice's spoken note (id 1) on post 7.
fn voice_contract_with_note() -> CommunityNotes {
    let mut contract = notes_with_voice();
    assert_eq!(
        add_spoken(&mut contract, "alice", T0, NOTE_TEXT, alice_note(1)),
        1
    );
    contract
}

fn rate_spoken(
    contract: &mut CommunityNotes,
    who: &str,
    rating: Rating,
    verdict: (Option<String>, Option<String>),
) {
    set_caller_at(who, T0 + 1);
    contract.rate_note(1, rating, verdict.0, verdict.1);
}

#[test]
fn the_voice_rule_is_on_by_default_with_the_testnet_key() {
    set_caller("notes");
    let mut contract = CommunityNotes::default();
    assert_eq!(
        contract.get_voice_config(),
        VoiceConfigView {
            required: true,
            verifier_public_key: DEFAULT_VOICE_VERIFIER_KEY.into(),
        }
    );
    contract.set_voice_required(false);
    assert!(!contract.get_voice_config().required);
    contract.set_voice_required(true);
    contract.set_voice_verifier_key(public_key(&verifier()));
    assert_eq!(
        contract.get_voice_config(),
        VoiceConfigView {
            required: true,
            verifier_public_key: public_key(&verifier()),
        }
    );
}

#[test]
#[should_panic(expected = "verifier_public_key must be ed25519:<base58 of 32 bytes>")]
fn a_verifier_key_of_another_form_fails() {
    notes_with_voice().set_voice_verifier_key("secp256k1:abc".into());
}

#[test]
fn a_spoken_note_with_its_verdict_is_added() {
    let mut contract = voice_contract_with_note();
    assert_eq!(note(&contract, 1).summary, NOTE_SUMMARY);
    // A second recording of the same summary is a new verdict, and a new note.
    assert_eq!(
        add_spoken(&mut contract, "alice", T0 + 1, NOTE_TEXT, alice_note(2)),
        2
    );
}

#[test]
#[should_panic(
    expected = "say the note: it needs verdict_json and signature_b64 from the voice verifier"
)]
fn a_note_without_a_verdict_fails() {
    add_spoken(
        &mut notes_with_voice(),
        "alice",
        T0,
        NOTE_TEXT,
        (None, None),
    );
}

#[test]
#[should_panic(expected = "this verdict was used before")]
fn a_verdict_passes_only_once() {
    let mut contract = voice_contract_with_note();
    add_spoken(&mut contract, "alice", T0 + 1, NOTE_TEXT, alice_note(1));
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_text_fails() {
    add_spoken(
        &mut notes_with_voice(),
        "alice",
        T0,
        "The photo is from 2021.",
        alice_note(1),
    );
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_of_another_account_fails() {
    add_spoken(&mut notes_with_voice(), "bob", T0, NOTE_TEXT, alice_note(1));
}

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_verdict_of_another_key_fails() {
    let digest = note_digest("alice", 7, NOTE_TEXT, NOTE_SUMMARY);
    let verdict = signed(
        &SigningKey::from_bytes(&[0x07; 32]),
        &digest,
        "accept",
        T0 + 120_000,
        1,
    );
    add_spoken(&mut notes_with_voice(), "alice", T0, NOTE_TEXT, verdict);
}

#[test]
#[should_panic(expected = "the verdict has expired")]
fn an_expired_verdict_fails() {
    add_spoken(
        &mut notes_with_voice(),
        "alice",
        T0 + 120_001,
        NOTE_TEXT,
        alice_note(1),
    );
}

#[test]
#[should_panic(expected = "the verdict outcome must be accept")]
fn a_step_up_verdict_is_not_a_note() {
    let digest = note_digest("alice", 7, NOTE_TEXT, NOTE_SUMMARY);
    let verdict = signed(&verifier(), &digest, "step_up", T0 + 120_000, 1);
    add_spoken(&mut notes_with_voice(), "alice", T0, NOTE_TEXT, verdict);
}

#[test]
#[should_panic(expected = "the summary is not a summary that a person can say")]
fn a_summary_that_a_person_cannot_say_fails_with_the_voice_rule() {
    set_caller_at("alice", T0);
    let (json, signature) = alice_note(1);
    notes_with_voice().add_note(
        7,
        NOTE_TEXT.into(),
        "Photo is from 2019".into(),
        json,
        signature,
    );
}

#[test]
fn a_spoken_rating_with_its_verdict_counts() {
    let mut contract = voice_contract_with_note();
    let verdict = accepted(&rating_digest("bob", 1, NoteRatingV1::Helpful), 3);
    rate_spoken(&mut contract, "bob", Rating::Helpful, verdict);
    assert_eq!(note(&contract, 1).helpful, 1);
}

#[test]
#[should_panic(
    expected = "say the rating: it needs verdict_json and signature_b64 from the voice verifier"
)]
fn a_rating_without_a_verdict_fails() {
    rate_spoken(
        &mut voice_contract_with_note(),
        "bob",
        Rating::Helpful,
        (None, None),
    );
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_rating_fails() {
    let verdict = accepted(&rating_digest("bob", 1, NoteRatingV1::Helpful), 3);
    rate_spoken(
        &mut voice_contract_with_note(),
        "bob",
        Rating::NotHelpful,
        verdict,
    );
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn the_verdict_of_a_note_is_not_a_rating() {
    rate_spoken(
        &mut voice_contract_with_note(),
        "bob",
        Rating::Helpful,
        alice_note(4),
    );
}
