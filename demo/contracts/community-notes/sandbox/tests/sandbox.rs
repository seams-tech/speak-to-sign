//! Deploys `res/community_notes.wasm` to a local nearcore sandbox and calls
//! it the way the Seams Wallet does: 30 Tgas attached, 0 deposit.
//!
//! Run `./build.sh` first, or set `COMMUNITY_NOTES_WASM` to a WASM path.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

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
    let contract = worker.dev_deploy(&wasm()?).await?;
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
    let contract = worker.dev_deploy(&wasm()?).await?;
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
    let contract = worker.dev_deploy(&wasm()?).await?;
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
