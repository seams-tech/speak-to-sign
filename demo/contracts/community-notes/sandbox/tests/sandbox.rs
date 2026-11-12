//! Deploys `res/community_notes.wasm` to a local nearcore sandbox and calls
//! it the way the Seams Wallet does: 30 Tgas attached, 0 deposit.
//!
//! Run `./build.sh` first, or set `COMMUNITY_NOTES_WASM` to a WASM path.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use spoken_intent::{
    NearAccount, Network, NoteRatingV1, SpokenRequestV1, SpokenSummary, request_digest,
};

/// The gas that the Seams Wallet attaches to each call.
const WALLET_GAS: Gas = Gas::from_tgas(30);
/// `add_note` and `rate_note` must each burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);

fn wasm() -> anyhow::Result<Vec<u8>> {
    let path = std::env::var("COMMUNITY_NOTES_WASM").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../res/community_notes.wasm").to_string()
    });
    std::fs::read(&path)
        .map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ./build.sh first."))
}

/// Deploys the contract and turns the voice rule off, so a note and a rating
/// need no verdict. `spoken_notes_in_the_sandbox` tests the rule.
async fn deploy_without_voice(worker: &Worker<Sandbox>) -> anyhow::Result<Contract> {
    let contract = worker.dev_deploy(&wasm()?).await?;
    contract
        .call("set_voice_required")
        .args_json(json!({ "required": false }))
        .transact()
        .await?
        .into_result()?;
    Ok(contract)
}

async fn add_note(
    author: &Account,
    contract: &Contract,
    post_id: u64,
    text: &str,
    summary: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(author
        .call(contract.id(), "add_note")
        .args_json(json!({ "post_id": post_id, "text": text, "summary": summary }))
        .gas(WALLET_GAS)
        .transact()
        .await?)
}

async fn rate_note(
    rater: &Account,
    contract: &Contract,
    note_id: u64,
    rating: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(rater
        .call(contract.id(), "rate_note")
        .args_json(json!({ "note_id": note_id, "rating": rating }))
        .gas(WALLET_GAS)
        .transact()
        .await?)
}

/// Checks that the call succeeded within the gas budget and prints its gas.
fn check_success(label: &str, result: &ExecutionFinalResult) {
    assert!(result.is_success(), "{label} failed: {result:#?}");
    let burnt = result.total_gas_burnt;
    println!("{label}: {:.3} Tgas burnt", burnt.as_gas() as f64 / 1e12);
    assert!(
        burnt < GAS_BUDGET,
        "{label} burnt {burnt}, more than the budget of {GAS_BUDGET}"
    );
}

/// Checks that the call failed with a message that contains `expected`.
fn check_failure(label: &str, result: &ExecutionFinalResult, expected: &str) {
    assert!(!result.is_success(), "{label} succeeded, but it must fail");
    let text = format!("{:?}", result.failures());
    assert!(
        text.contains(expected),
        "{label}: the failure does not contain {expected:?}: {text}"
    );
    println!("{label}: fails with {expected:?}");
}

fn event(result: &ExecutionFinalResult) -> Value {
    let logs = result.logs();
    assert_eq!(logs.len(), 1, "one log: {logs:?}");
    serde_json::from_str(
        logs[0]
            .strip_prefix("EVENT_JSON:")
            .expect("an EVENT_JSON log"),
    )
    .unwrap()
}

async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn storage_usage(contract: &Contract) -> anyhow::Result<u64> {
    Ok(contract.view_account().await?.storage_usage)
}

#[tokio::test]
async fn community_notes_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let contract = deploy_without_voice(&worker).await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let carol = worker.dev_create_account().await?;

    // add_note with the longest text and summary, 4 bytes per character.
    let text = "🗳".repeat(280);
    let summary = "🗳".repeat(120);
    let storage_before = storage_usage(&contract).await?;
    let result = add_note(&alice, &contract, 42, &text, &summary).await?;
    check_success("add_note (280 + 120 characters of 4 bytes)", &result);
    let added = event(&result);
    assert_eq!(
        added,
        json!({
            "standard": "community_notes",
            "version": "1.1.0",
            "event": "note_added",
            "data": [{ "note_id": 1, "post_id": 42, "author": alice.id() }]
        })
    );
    assert_eq!(
        result.json::<Value>()?,
        json!(1),
        "the first note id is the JSON number 1"
    );

    // The call attached 0 deposit, so the contract balance pays for this storage.
    let note_bytes = storage_usage(&contract).await? - storage_before;
    println!("largest note: {note_bytes} bytes of contract storage");
    assert!(
        note_bytes > 1600,
        "the note text and summary are stored: {note_bytes} bytes"
    );

    // A short note on the same post, and one on another post.
    let result = add_note(
        &bob,
        &contract,
        42,
        "The video is from 2021.",
        "Video is from 2021",
    )
    .await?;
    check_success("add_note (short)", &result);
    assert_eq!(result.json::<u64>()?, 2);
    let result = add_note(&bob, &contract, 7, "Other post.", "Other").await?;
    assert_eq!(result.json::<u64>()?, 3);

    // rate_note: a first rating, then a replacement.
    let storage_before = storage_usage(&contract).await?;
    let result = rate_note(&bob, &contract, 1, "helpful").await?;
    check_success("rate_note (first rating)", &result);
    let rating_bytes = storage_usage(&contract).await? - storage_before;
    println!("one rating: {rating_bytes} bytes of storage");
    assert_eq!(event(&result)["data"][0]["status"], "needs_more_ratings");

    let result = rate_note(&carol, &contract, 1, "helpful").await?;
    check_success("rate_note (second rating)", &result);
    assert_eq!(
        event(&result),
        json!({
            "standard": "community_notes",
            "version": "1.1.0",
            "event": "note_rated",
            "data": [{
                "note_id": 1,
                "account_id": carol.id(),
                "rating": "helpful",
                "previous_rating": null,
                "status": "helpful"
            }]
        })
    );

    let result = rate_note(&bob, &contract, 1, "not_helpful").await?;
    check_success("rate_note (replacement)", &result);
    assert_eq!(event(&result)["data"][0]["previous_rating"], "helpful");
    let result = rate_note(&carol, &contract, 2, "somewhat_helpful").await?;
    check_success("rate_note (somewhat_helpful)", &result);

    // Rules that fail.
    let result = rate_note(&alice, &contract, 1, "helpful").await?;
    check_failure(
        "rate own note",
        &result,
        "the author cannot rate their own note",
    );
    let result = rate_note(&bob, &contract, 99, "helpful").await?;
    check_failure("rate unknown note", &result, "note 99 does not exist");
    let result = rate_note(&bob, &contract, 1, "very_helpful").await?;
    check_failure("unknown rating", &result, "unknown variant");
    let result = add_note(&alice, &contract, 42, &"a".repeat(281), "Summary").await?;
    check_failure(
        "text of 281 characters",
        &result,
        "text has 281 characters; the maximum is 280",
    );
    let result = add_note(&alice, &contract, 42, "Text", &"a".repeat(121)).await?;
    check_failure(
        "summary of 121 characters",
        &result,
        "summary has 121 characters; the maximum is 120",
    );
    let result = add_note(&alice, &contract, 42, "", "Summary").await?;
    check_failure("empty text", &result, "text must not be empty");
    let result = alice
        .call(contract.id(), "add_note")
        .args_json(json!({ "post_id": 42, "text": "Text", "summary": "Summary" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_failure("add_note with a deposit", &result, "doesn't accept deposit");

    // Views, as raw JSON.
    let notes = view(&contract, "get_notes", json!({ "post_id": 42 })).await?;
    let notes = notes.as_array().expect("an array");
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0]["id"], json!(2), "newest first");
    assert_eq!(notes[1]["id"], json!(1));
    let first = &notes[1];
    let keys: Vec<&str> = first
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    let mut expected_keys = vec![
        "id",
        "post_id",
        "author",
        "text",
        "summary",
        "created_at_ms",
        "helpful",
        "somewhat_helpful",
        "not_helpful",
        "status",
        "hidden",
    ];
    expected_keys.sort();
    let mut keys = keys;
    keys.sort();
    assert_eq!(keys, expected_keys);
    assert_eq!(first["post_id"], json!(42));
    assert_eq!(first["author"], json!(alice.id()));
    assert_eq!(first["text"], json!(text));
    assert_eq!(first["summary"], json!(summary));
    assert!(first["created_at_ms"].as_u64().unwrap() > 0);
    assert_eq!(
        (
            &first["helpful"],
            &first["somewhat_helpful"],
            &first["not_helpful"],
            &first["status"]
        ),
        (
            &json!(1),
            &json!(0),
            &json!(1),
            &json!("needs_more_ratings")
        )
    );
    assert_eq!(notes[0]["somewhat_helpful"], json!(1));

    let note = view(&contract, "get_note", json!({ "note_id": 3 })).await?;
    assert_eq!(note["post_id"], json!(7));
    assert_eq!(
        view(&contract, "get_note", json!({ "note_id": 99 })).await?,
        Value::Null
    );
    assert_eq!(
        view(&contract, "get_notes", json!({ "post_id": 1000 })).await?,
        json!([])
    );
    assert_eq!(
        view(
            &contract,
            "get_rating",
            json!({ "note_id": 1, "account_id": bob.id() })
        )
        .await?,
        json!("not_helpful")
    );
    assert_eq!(
        view(
            &contract,
            "get_rating",
            json!({ "note_id": 1, "account_id": alice.id() })
        )
        .await?,
        Value::Null
    );
    assert_eq!(
        view(
            &contract,
            "get_rating",
            json!({ "note_id": 99, "account_id": bob.id() })
        )
        .await?,
        Value::Null
    );
    Ok(())
}

/// The largest `get_notes` reply: 50 notes of the maximum size. The view must
/// stay within the RPC view gas limit, and the 51st (oldest) note drops out.
#[tokio::test]
async fn get_notes_with_50_of_the_largest_notes() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let contract = deploy_without_voice(&worker).await?;
    let author = worker.dev_create_account().await?;
    let text = "🗳".repeat(280);
    let summary = "🗳".repeat(120);
    for n in 1..=51u64 {
        let result = add_note(&author, &contract, 5, &text, &summary).await?;
        assert!(result.is_success(), "note {n}: {result:#?}");
    }
    let notes = view(&contract, "get_notes", json!({ "post_id": 5 })).await?;
    let ids: Vec<u64> = notes
        .as_array()
        .expect("an array")
        .iter()
        .map(|note| note["id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, (2..=51).rev().collect::<Vec<u64>>());
    println!(
        "get_notes with 50 of the largest notes: {} bytes of JSON",
        serde_json::to_string(&notes)?.len()
    );
    Ok(())
}

#[tokio::test]
async fn the_moderator_hides_a_note() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let contract = deploy_without_voice(&worker).await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let moderator = worker.dev_create_account().await?;

    check_success(
        "add_note",
        &add_note(&alice, &contract, 900, "Call 555-0142 for the truth.", "Spam").await?,
    );

    // Only the contract account sets the moderator.
    let result = bob
        .call(contract.id(), "set_moderator")
        .args_json(json!({ "account_id": bob.id() }))
        .transact()
        .await?;
    check_failure("set_moderator by another account", &result, "is private");
    let result = contract
        .call("set_moderator")
        .args_json(json!({ "account_id": moderator.id() }))
        .transact()
        .await?;
    assert!(result.is_success(), "set_moderator failed: {result:#?}");
    assert_eq!(view(&contract, "get_moderator", json!({})).await?, json!(moderator.id()));

    let hide = |caller: &Account| {
        caller
            .call(contract.id(), "hide_note")
            .args_json(json!({ "note_id": 1, "proposal_id": 3 }))
            .gas(Gas::from_tgas(10))
            .transact()
    };
    check_failure("hide_note by another account", &hide(&bob).await?, "only the moderator can hide a note");
    let result = hide(&moderator).await?;
    check_success("hide_note", &result);
    assert_eq!(
        event(&result),
        json!({
            "standard": "community_notes",
            "version": "1.1.0",
            "event": "note_hidden",
            "data": [{ "note_id": 1, "post_id": 900, "moderator": moderator.id(), "proposal_id": 3 }]
        })
    );
    let note = view(&contract, "get_note", json!({ "note_id": 1 })).await?;
    assert_eq!((&note["text"], &note["summary"], &note["hidden"]), (&json!(""), &json!(""), &json!(true)));
    check_failure("hide_note twice", &hide(&moderator).await?, "this note is already hidden");
    check_failure("rate a hidden note", &rate_note(&bob, &contract, 1, "helpful").await?, "this note is hidden");
    Ok(())
}

/// The test key of the voice verifier.
fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[0x2a; 32])
}

fn near_account(id: &AccountId) -> NearAccount {
    NearAccount::new(id.as_str()).unwrap()
}

/// A verdict as the verifier serializes it, with its signature, as the two
/// arguments of a call.
fn verdict(digest: &[u8; 32], expires_at_ms: u64, audio: u8) -> Value {
    let verdict_json = format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.8.0","request_digest":"{}","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"{}","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"the photo is old"}}"#,
        URL_SAFE_NO_PAD.encode(digest),
        URL_SAFE_NO_PAD.encode([audio; 32]),
    );
    let mut preimage = b"seams:outlayer:voice-verdict:v2".to_vec();
    preimage.extend_from_slice(verdict_json.as_bytes());
    let signature = verifier().sign(&Sha256::digest(&preimage));
    json!({ "verdict_json": verdict_json, "signature_b64": STANDARD.encode(signature.to_bytes()) })
}

/// The arguments of a call with the two arguments of its verdict.
fn with_verdict(mut args: Value, verdict: &Value) -> Value {
    args.as_object_mut().unwrap().extend(verdict.as_object().unwrap().clone());
    args
}

/// The voice rule: the contract takes a note and a rating only with the
/// verdict of the voice verifier for that note or rating, and takes a verdict
/// once. The check must fit in the gas budget.
#[tokio::test]
async fn spoken_notes_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm()?).await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;

    // Only the contract account sets the verifier key.
    let key = format!("ed25519:{}", bs58::encode(verifier().verifying_key().as_bytes()).into_string());
    let set_key = |caller: &Account| {
        caller
            .call(contract.id(), "set_voice_verifier_key")
            .args_json(json!({ "verifier_public_key": key }))
            .transact()
    };
    check_failure("set_voice_verifier_key by another account", &set_key(&alice).await?, "Method set_voice_verifier_key is private");
    set_key(contract.as_account()).await?.into_result()?;
    assert_eq!(
        view(&contract, "get_voice_config", json!({})).await?,
        json!({ "required": true, "verifier_public_key": key })
    );

    let call = |who: &Account, method: &str, args: Value| {
        who.call(contract.id(), method).args_json(args).gas(WALLET_GAS).transact()
    };
    let expires_at_ms = worker.view_block().await?.timestamp() / 1_000_000 + 600_000;

    // A note: the longest text, and a summary of twelve words.
    let text = "🗳".repeat(280);
    let summary = "The photo in this post is old and it shows another city.";
    let note = json!({ "post_id": 42, "text": text, "summary": summary });
    let note_verdict = verdict(
        &request_digest(&SpokenRequestV1::CommunityNote {
            network: Network::Testnet,
            owner: near_account(alice.id()),
            contract: near_account(contract.id()),
            post_id: 42,
            note_sha256: Sha256::digest(text.as_bytes()).into(),
            summary: SpokenSummary::new(summary).unwrap(),
        }),
        expires_at_ms,
        1,
    );
    check_failure(
        "add_note without a verdict",
        &call(&alice, "add_note", note.clone()).await?,
        "say the note: it needs verdict_json and signature_b64 from the voice verifier",
    );
    check_failure(
        "add_note from another account",
        &call(&bob, "add_note", with_verdict(note.clone(), &note_verdict)).await?,
        "the verdict is for another request",
    );
    let result = call(&alice, "add_note", with_verdict(note.clone(), &note_verdict)).await?;
    check_success("add_note with a verdict (280 characters of 4 bytes)", &result);
    assert_eq!(result.json::<u64>()?, 1);
    check_failure(
        "add_note with a used verdict",
        &call(&alice, "add_note", with_verdict(note, &note_verdict)).await?,
        "this verdict was used before",
    );

    // A rating.
    let rating = json!({ "note_id": 1, "rating": "helpful" });
    let rating_verdict = verdict(
        &request_digest(&SpokenRequestV1::NoteRating {
            network: Network::Testnet,
            owner: near_account(bob.id()),
            contract: near_account(contract.id()),
            note_id: 1,
            rating: NoteRatingV1::Helpful,
        }),
        expires_at_ms,
        2,
    );
    check_failure(
        "rate_note without a verdict",
        &call(&bob, "rate_note", rating.clone()).await?,
        "say the rating: it needs verdict_json and signature_b64 from the voice verifier",
    );
    check_failure(
        "rate_note with the verdict of another rating",
        &call(&bob, "rate_note", with_verdict(json!({ "note_id": 1, "rating": "not_helpful" }), &rating_verdict)).await?,
        "the verdict is for another request",
    );
    check_success("rate_note with a verdict", &call(&bob, "rate_note", with_verdict(rating, &rating_verdict)).await?);
    assert_eq!(view(&contract, "get_note", json!({ "note_id": 1 })).await?["helpful"], json!(1));
    Ok(())
}
