//! An application owner (`app:<id>`): enrollment with no key, the
//! `confirmation` kind, and `select`.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use spoken_intent::{request_digest, AppOwner, ConfirmationContext, SpokenRequestV1, SpokenSummary};

use seams_voice_verifier::config::{template_key, SPEAKER_EMBED_URL};
use seams_voice_verifier::digest::{b64u, from_hex};
use seams_voice_verifier::ops::transfer_request;

use crate::fake::{
    call, call_local, checked_verdict, clip, embedding, enroll_input, enrolled, events_of, outcome_name, Fake,
    ONE_NEAR, OWNER, WORDS_URL,
};

const USER: &str = "app:user-42";
const PAYLOAD_HEX: &str = "4242424242424242424242424242424242424242424242424242424242424242";

fn app_enroll_input(owner: &str, clips: &[Vec<u8>]) -> Value {
    json!({
        "op": "enroll",
        "owner": owner,
        "audio_wav_b64": clips.iter().map(|wav| STANDARD.encode(wav)).collect::<Vec<_>>(),
    })
}

fn three_clips(fake: &mut Fake) -> [Vec<u8>; 3] {
    let clips = [clip(0.05), clip(0.06), clip(0.07)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(0, 0.1 * index as f32));
    }
    clips
}

/// A fake whose application owner `USER` is enrolled.
fn app_enrolled() -> Fake {
    let mut fake = Fake::new();
    let clips = three_clips(&mut fake);
    let out = call(&mut fake, app_enroll_input(USER, &clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    fake.events.clear();
    fake.posts.clear();
    fake
}

fn confirmation(context: &str, summary: &str) -> Value {
    json!({ "kind": "confirmation", "context": context, "payload_sha256_hex": PAYLOAD_HEX, "summary": summary })
}

fn confirmation_digest(context: &str, summary: &str) -> String {
    b64u(&request_digest(&SpokenRequestV1::Confirmation {
        owner: AppOwner::new(USER).unwrap(),
        context: ConfirmationContext::new(context).unwrap(),
        payload_sha256: [0x42; 32],
        summary: SpokenSummary::new(summary).unwrap(),
    }))
}

/// A new clip in the voice of the enrolled owner.
fn said(fake: &mut Fake, transcript: &str) -> Vec<u8> {
    fake.transcript = Some(transcript.into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    wav
}

fn verify_input(owner: &str, request: Value, wav: &[u8]) -> Value {
    json!({ "op": "verify", "owner": owner, "request": request, "contacts": [], "audio_wav_b64": STANDARD.encode(wav) })
}

fn select_input(owner: &str, requests: Vec<Value>, wav: &[u8]) -> Value {
    json!({
        "op": "select",
        "owner": owner,
        "requests": requests,
        "contacts": ["alice.testnet"],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

#[test]
fn an_application_owner_enrolls_with_no_key_and_no_rpc() {
    let mut fake = Fake::new();
    let clips = three_clips(&mut fake);
    let out = call(&mut fake, app_enroll_input(USER, &clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    assert_eq!(out["owner"], USER);
    assert_eq!(out["template_epoch"], 1);
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, SPEAKER_EMBED_URL, SPEAKER_EMBED_URL]);
    assert_eq!(out["ms"]["rpc"], Value::Null);
    assert!(fake.storage.contains_key(&template_key(USER)));

    // The caller can enroll the owner again: the epoch grows.
    let again = [clip(0.11), clip(0.12), clip(0.13)];
    let out = call(&mut fake, app_enroll_input(USER, &again));
    assert_eq!(out["template_epoch"], 2, "{out}");

    // The `local-speaker` variant sends no request at all.
    let mut local = Fake::new();
    let clips = three_clips(&mut local);
    let out = call_local(&mut local, app_enroll_input(USER, &clips));
    assert_eq!(out["outcome"], "accept", "{out}");
    assert!(local.posts.is_empty());
}

#[test]
fn the_authorization_goes_with_the_kind_of_owner() {
    // An application owner with an authorization.
    let mut fake = Fake::new();
    let clips = three_clips(&mut fake);
    let mut with_key = enroll_input(&clips);
    with_key["owner"] = json!(USER);
    assert_eq!(call(&mut fake, with_key)["reason"], "unsupported");
    // A NEAR owner with no authorization.
    let out = call(&mut fake, app_enroll_input(OWNER, &clips));
    assert_eq!(out["reason"], "unsupported");
    // An owner text that is neither.
    for owner in ["app:", "app:User", "app:a b", "APP:u"] {
        assert_eq!(call(&mut fake, app_enroll_input(owner, &clips))["reason"], "unsupported", "{owner}");
    }
    assert!(fake.storage.is_empty());
    assert!(fake.posts.is_empty());
}

#[test]
fn a_confirmation_binds_the_context_and_the_payload() {
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Log in to the example shop.");
    let out =
        call(&mut fake, verify_input(USER, confirmation("shop.example/login", "Log in to the example shop"), &wav));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(verdict.heard.as_deref(), Some("log in to the example shop"));
    assert_eq!(verdict.request_digest, Some(confirmation_digest("shop.example/login", "Log in to the example shop")));
    // The same digest as the golden vector of `spoken-intent`.
    let vectors: Value =
        serde_json::from_str(include_str!("../../../spoken-intent/fixtures/spoken_intent_vectors_v1.json")).unwrap();
    let vector =
        vectors["requests"].as_array().unwrap().iter().find(|case| case["name"] == "confirmation_login").unwrap();
    let digest = from_hex::<32>(vector["request_digest_hex"].as_str().unwrap()).unwrap();
    assert_eq!(verdict.request_digest, Some(b64u(&digest)));
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, WORDS_URL]);
    // Another context or another payload is another digest.
    assert_ne!(
        confirmation_digest("shop.example/login", "Log in to the example shop"),
        confirmation_digest("other.example/login", "Log in to the example shop")
    );
}

/// The model writes an amount of money with a symbol. The transcript of
/// OutLayer testnet for this summary was "Pay $40 for two books."
#[test]
fn a_summary_with_an_amount_matches_the_models_numerals() {
    for (index, transcript) in
        ["Pay $40 for two books.", "Pay 40 dollars for 2 books", "pay forty dollars for two books"]
            .into_iter()
            .enumerate()
    {
        let mut fake = app_enrolled();
        fake.transcript = Some(transcript.into());
        let wav = clip(0.3 + 0.01 * index as f32);
        fake.voice(&wav, embedding(0, 0.3));
        let request = confirmation("shop.example/order", "Pay forty dollars for two books");
        let out = call(&mut fake, verify_input(USER, request, &wav));
        let verdict = checked_verdict(&out);
        assert_eq!(outcome_name(&verdict), "accept", "{transcript}: {out}");
        assert_eq!(verdict.heard.as_deref(), Some("pay forty dollars for two books"));
    }
    // Another amount is other words.
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Pay $14 for two books.");
    let request = confirmation("shop.example/order", "Pay forty dollars for two books");
    let out = call(&mut fake, verify_input(USER, request, &wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "words");
    // A dropped number word is not forgiven. A dropped word that is not a
    // number is (a summary of 4 words or more).
    for (index, (transcript, outcome)) in
        [("Pay forty dollars for books.", "words"), ("Pay forty dollars two books.", "accept")].into_iter().enumerate()
    {
        let mut fake = app_enrolled();
        fake.transcript = Some(transcript.into());
        let wav = clip(0.4 + 0.01 * index as f32);
        fake.voice(&wav, embedding(0, 0.3));
        let request = confirmation("shop.example/order", "Pay forty dollars for two books");
        let out = call(&mut fake, verify_input(USER, request, &wav));
        assert_eq!(outcome_name(&checked_verdict(&out)), outcome, "{transcript}");
    }
}

#[test]
fn a_confirmation_refuses_other_words() {
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Do not log in to the example shop.");
    let out =
        call(&mut fake, verify_input(USER, confirmation("shop.example/login", "Log in to the example shop"), &wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "words");
}

#[test]
fn the_kind_goes_with_the_kind_of_owner() {
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Send 2 NEAR to alice.testnet.");
    // A NEAR kind for an application owner.
    let transfer =
        json!({ "kind": "transfer", "receiver": "alice.testnet", "amount_yocto": (2 * ONE_NEAR).to_string() });
    let out = call(&mut fake, verify_input(USER, transfer, &wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported");
    // A confirmation for a NEAR owner.
    let mut near = enrolled();
    let out = call(&mut near, verify_input(OWNER, confirmation("shop.example/login", "Log in"), &wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported");
    // A context or a payload that is not valid.
    for request in [
        json!({ "kind": "confirmation", "context": "Shop", "payload_sha256_hex": PAYLOAD_HEX, "summary": "Log in" }),
        json!({ "kind": "confirmation", "context": "shop", "payload_sha256_hex": "42", "summary": "Log in" }),
    ] {
        let out = call(&mut fake, verify_input(USER, request, &wav));
        assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported");
    }
    assert!(fake.posts.is_empty());
}

fn shop_actions() -> Vec<Value> {
    vec![
        confirmation("shop.example/order", "Pay forty dollars for two books"),
        confirmation("shop.example/order", "Cancel my order"),
        confirmation("shop.example/address", "Deliver it to my office"),
    ]
}

#[test]
fn select_signs_the_request_that_the_owner_said() {
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Cancel my order.");
    let out = call(&mut fake, select_input(USER, shop_actions(), &wav));
    assert_eq!(out["kind"], "seams_voice_verify_output_v2");
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(out["selected"], 1);
    assert_eq!(verdict.request_digest, Some(confirmation_digest("shop.example/order", "Cancel my order")));
    assert_eq!(verdict.heard.as_deref(), Some("cancel my order"));
    assert!(verdict.spoken_text_digest.is_some());
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, WORDS_URL]);
    assert_eq!(fake.events, events_of(&["start", "worker_get", "add", "get", "poll", "marker_set", "wait"]));

    // The `local-speaker` variant.
    let mut local = app_enrolled();
    let wav = said(&mut local, "Deliver it to my office");
    let out = call_local(&mut local, select_input(USER, shop_actions(), &wav));
    assert_eq!(out["selected"], 2, "{out}");
    assert_eq!(local.posts, [WORDS_URL]);
}

#[test]
fn select_refuses_words_of_no_candidate() {
    let mut fake = app_enrolled();
    // One word of the first candidate changed: `verify` forgives it in a
    // summary of 4 words or more, `select` does not.
    let transcripts = ["Pay fourteen dollars for two books.", "Cancel my order not.", "Hello there."];
    for (index, transcript) in transcripts.into_iter().enumerate() {
        let wav = said(&mut fake, transcript);
        let mut input = select_input(USER, shop_actions(), &wav);
        // A new clip for each try.
        let fresh = clip(0.2 + 0.01 * index as f32);
        fake.voice(&fresh, embedding(0, 0.3));
        input["audio_wav_b64"] = json!(STANDARD.encode(&fresh));
        let out = call(&mut fake, input);
        let verdict = checked_verdict(&out);
        assert_eq!(outcome_name(&verdict), "words", "{transcript}: {out}");
        assert!(out.get("selected").is_none());
        assert_eq!(verdict.request_digest, None);
        assert_eq!(verdict.spoken_text_digest, None);
        assert!(verdict.heard.is_some());
    }
}

#[test]
fn select_refuses_another_voice() {
    let mut fake = app_enrolled();
    fake.transcript = Some("Cancel my order.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(9, 0.0));
    let out = call(&mut fake, select_input(USER, shop_actions(), &wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "speaker");
    assert!(out.get("selected").is_none());
}

#[test]
fn select_refuses_a_bad_set_of_candidates() {
    let mut fake = app_enrolled();
    let wav = said(&mut fake, "Cancel my order.");
    let one = vec![confirmation("shop.example/order", "Cancel my order")];
    let same_sentence = vec![
        confirmation("shop.example/order", "Cancel my order"),
        confirmation("shop.example/other", "Cancel my order."),
    ];
    let too_many: Vec<Value> = (0..17).map(|_| confirmation("shop.example/order", "Cancel my order")).collect();
    let multisig = vec![
        confirmation("shop.example/order", "Cancel my order"),
        json!({ "kind": "multisig_hide_note", "multisig": "m.testnet", "proposal_id": 1, "note_id": 1 }),
    ];
    for requests in [Vec::new(), one, same_sentence, too_many, multisig] {
        let out = call(&mut fake, select_input(USER, requests, &wav));
        assert_eq!(outcome_name(&checked_verdict(&out)), "unsupported", "{out}");
    }
    assert!(fake.posts.is_empty());
    assert!(fake.markers.is_empty() || !fake.events.contains(&"marker_set"));
}

#[test]
fn select_works_for_near_requests_and_keeps_the_policy_step() {
    let transfer = |near: u128| json!({ "kind": "transfer", "receiver": "alice.testnet", "amount_yocto": (near * ONE_NEAR).to_string() });
    let mut fake = enrolled();
    let wav = said(&mut fake, "Send 2 NEAR to alice.testnet.");
    let out = call(&mut fake, select_input(OWNER, vec![transfer(5), transfer(2), transfer(11)], &wav));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(out["selected"], 1);
    let request = transfer_request(OWNER, "alice.testnet", 2 * ONE_NEAR).unwrap();
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    let mut fake = enrolled();
    let wav = said(&mut fake, "Send 11 NEAR to alice.testnet.");
    let out = call(&mut fake, select_input(OWNER, vec![transfer(5), transfer(2), transfer(11)], &wav));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "step_up", "{out}");
    assert_eq!(out["selected"], 2);
}
