//! Deploys `res/jev_prediction_market.wasm` and `res/fake_outlayer.wasm` to a local nearcore
//! sandbox and runs a market from create to redeem: trades, an OutLayer run that fails, an
//! OutLayer answer at a grey weight, and the admin fallback.
//!
//! Run `./build.sh` first, or set `PM_NOTES_WASM` and `FAKE_OUTLAYER_WASM` to WASM paths.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

/// The gas that a wallet attaches to a normal call.
const CALL_GAS: Gas = Gas::from_tgas(30);
/// A normal call must burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);
/// `request_resolution` needs 300 Tgas.
const REQUEST_GAS: Gas = Gas::from_tgas(300);
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const QUESTION: &str = "Is this note accurate and helpful context for this post?";

fn wasm(env_name: &str, file: &str) -> anyhow::Result<Vec<u8>> {
    let path = std::env::var(env_name)
        .unwrap_or_else(|_| format!("{}/../res/{file}", env!("CARGO_MANIFEST_DIR")));
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ./build.sh first."))
}

async fn call(
    who: &Account,
    contract: &Contract,
    method: &str,
    args: Value,
    deposit: u128,
    gas: Gas,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(contract.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(gas)
        .transact()
        .await?)
}

fn check_success(label: &str, result: &ExecutionFinalResult, budget: Gas) {
    assert!(result.is_success(), "{label} failed: {:#?}", result.failures());
    let burnt = result.total_gas_burnt;
    println!("{label}: {:.3} Tgas burnt", burnt.as_gas() as f64 / 1e12);
    assert!(burnt < budget, "{label} burnt {burnt}, more than the budget of {budget}");
}

fn check_failure(label: &str, result: &ExecutionFinalResult, expected: &str) {
    assert!(!result.is_success(), "{label} succeeded, but it must fail");
    let text = format!("{:?}", result.failures());
    assert!(text.contains(expected), "{label}: the failure does not contain {expected:?}: {text}");
    println!("{label}: fails with {expected:?}");
}

/// The NEP-297 events of a transaction, as (event, data[0]).
fn events(result: &ExecutionFinalResult) -> Vec<(String, Value)> {
    result
        .logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|json| {
            let event: Value = serde_json::from_str(json).unwrap();
            assert_eq!(event["standard"], "pm_notes");
            assert_eq!(event["version"], "1.0.0");
            (event["event"].as_str().unwrap().to_owned(), event["data"][0].clone())
        })
        .collect()
}

async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn balance(account: &Account) -> anyhow::Result<u128> {
    Ok(account.view_account().await?.balance.as_yoctonear())
}

fn yocto(value: &Value) -> u128 {
    value.as_str().expect("a yoctoNEAR string").parse().unwrap()
}

fn keys(value: &Value) -> Vec<&str> {
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    keys
}

#[tokio::test]
async fn a_market_from_create_to_redeem_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let outlayer = worker.dev_deploy(&wasm("FAKE_OUTLAYER_WASM", "fake_outlayer.wasm")?).await?;
    let contract = worker.dev_deploy(&wasm("PM_NOTES_WASM", "jev_prediction_market.wasm")?).await?;
    let admin = worker.dev_create_account().await?;
    let maya = worker.dev_create_account().await?;
    let kenji = worker.dev_create_account().await?;
    let ana = worker.dev_create_account().await?;
    println!("pm-notes code: {} bytes", contract.view_code().await?.len());

    let result = contract
        .call("new")
        .args_json(json!({
            "admin": admin.id(),
            "resolver": {
                "outlayer_account": outlayer.id(),
                "project_id": "seams-v1.testnet/pm-notes-resolver",
                "secrets_ref": { "profile": "main", "account_id": admin.id() },
            },
        }))
        .transact()
        .await?;
    assert!(result.is_success(), "new failed: {:#?}", result.failures());

    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let closes_at_ms = now_ms + 60 * 60 * 1_000;

    // Create.
    let storage_before = contract.view_account().await?.storage_usage;
    let result = call(
        &maya,
        &contract,
        "create_market",
        json!({ "question": QUESTION, "context": "c".repeat(1_000), "note_id": 2, "closes_at_ms": closes_at_ms }),
        NEAR,
        CALL_GAS,
    )
    .await?;
    check_success("create_market (longest context)", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<Value>()?, json!(1), "the first market id is the JSON number 1");
    println!(
        "largest market: {} bytes of contract storage",
        contract.view_account().await?.storage_usage - storage_before
    );
    assert_eq!(events(&result)[0].0, "market_created");

    // Trade.
    let result = call(&kenji, &contract, "buy", json!({ "market_id": 1, "outcome": "yes" }), 2 * NEAR, CALL_GAS).await?;
    check_success("buy (new position)", &result, GAS_BUDGET);
    let kenji_yes = yocto(&result.json::<Value>()?);
    assert_eq!(kenji_yes, 2_666_666 * NEAR / 1_000_000, "1 NEAR pool, 2 NEAR of YES");
    let result = call(&kenji, &contract, "buy", json!({ "market_id": 1, "outcome": "yes" }), NEAR / 100, CALL_GAS).await?;
    check_success("buy (same position)", &result, GAS_BUDGET);
    let result = call(&ana, &contract, "buy", json!({ "market_id": 1, "outcome": "no" }), NEAR, CALL_GAS).await?;
    check_success("buy NO", &result, GAS_BUDGET);
    let before = balance(&kenji).await?;
    let result = call(
        &kenji,
        &contract,
        "sell",
        json!({ "market_id": 1, "outcome": "yes", "amount": (NEAR / 5).to_string() }),
        0,
        CALL_GAS,
    )
    .await?;
    check_success("sell", &result, GAS_BUDGET);
    let gained = balance(&kenji).await? - before;
    assert!(gained > NEAR / 5 - NEAR / 100 && gained <= NEAR / 5, "the sell paid {gained}");

    let market = view(&contract, "get_market", json!({ "market_id": 1 })).await?;
    assert_eq!(
        keys(&market),
        vec![
            "closes_at_ms", "collateral", "context", "created_at_ms", "creator", "id", "no_pool",
            "note_id", "pending", "question", "resolution", "status", "yes_pool", "yes_price_bps",
        ]
    );
    assert_eq!(market["status"], "open");
    assert_eq!(yocto(&market["collateral"]), NEAR + 2 * NEAR + NEAR / 100 + NEAR - NEAR / 5);
    let position = view(&contract, "get_position", json!({ "market_id": 1, "account_id": kenji.id() })).await?;
    assert_eq!(keys(&position), vec!["no", "redeemable", "yes"]);
    assert_eq!(position["redeemable"], Value::Null);
    let quote = view(&contract, "quote_buy", json!({ "market_id": 1, "outcome": "no", "amount": NEAR.to_string() })).await?;
    assert_eq!(keys(&quote), vec!["amount", "shares", "yes_price_bps"]);

    // Resolve: not before the close.
    let result = call(&kenji, &contract, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_failure("request_resolution while open", &result, "this market is still open for trading");
    let result = call(&kenji, &contract, "close_market", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
    check_failure("close_market by a trader", &result, "only the creator or the admin can close this market");
    let result = call(&maya, &contract, "close_market", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
    check_success("close_market", &result, GAS_BUDGET);
    let result = call(&kenji, &contract, "buy", json!({ "market_id": 1, "outcome": "yes" }), NEAR, CALL_GAS).await?;
    check_failure("buy after the close", &result, "this market is closed for trading");

    // An OutLayer run that fails: the market stays closed for a new request.
    outlayer.call("set_failure").transact().await?.into_result()?;
    let result = call(&kenji, &contract, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_success("request_resolution (failed run)", &result, REQUEST_GAS);
    assert_eq!(result.clone().json::<bool>()?, false);
    let failed = events(&result);
    assert_eq!(failed[0].0, "resolution_requested");
    assert_eq!(
        failed[1],
        ("resolution_failed".to_owned(), json!({ "market_id": 1, "request_id": 1, "reason": "the OutLayer call failed" }))
    );
    assert_eq!(view(&contract, "get_market", json!({ "market_id": 1 })).await?["status"], "closed");

    // A null answer (a failed worker run).
    outlayer.call("set_answer").args_json(json!({ "answer": null })).transact().await?.into_result()?;
    let result = call(&ana, &contract, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_success("request_resolution (null answer)", &result, REQUEST_GAS);
    assert_eq!(events(&result)[1].1["reason"], "the resolver returned no answer");

    // A grey answer from JEV: 73% YES pays 0.73 NEAR a YES share.
    outlayer
        .call("set_answer")
        .args_json(json!({ "answer": {
            "yes_bps": 7_300,
            "provider": "jev",
            "model": "jev-1.14.0",
            "rationale": "JEV jev-1.14.0 gave a YES probability of 0.73.",
        }}))
        .transact()
        .await?
        .into_result()?;
    let result = call(&kenji, &contract, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_success("request_resolution (answer)", &result, REQUEST_GAS);
    assert_eq!(result.clone().json::<bool>()?, true);
    let resolved = events(&result);
    assert_eq!(
        resolved[1],
        (
            "market_resolved".to_owned(),
            json!({
                "market_id": 1,
                "source": "ai",
                "raw_yes_bps": 7_300,
                "payout_yes_bps": 7_300,
                "provider": "jev",
                "model": "jev-1.14.0",
                "resolved_by": kenji.id(),
            })
        )
    );
    let request = view(&outlayer, "get_last_request", json!({})).await?;
    assert_eq!(request["caller"], json!(contract.id()));
    assert_eq!(yocto(&request["deposit"]), NEAR / 20, "the deposit goes to OutLayer");
    assert_eq!(request["source"], json!({ "Project": { "project_id": "seams-v1.testnet/pm-notes-resolver", "version_key": null } }));
    assert_eq!(request["secrets_ref"], json!({ "profile": "main", "account_id": admin.id() }));
    assert_eq!(request["response_format"], "Json");
    assert_eq!(
        request["input"],
        json!({ "market_id": 1, "question": QUESTION, "context": "c".repeat(1_000), "note_id": 2, "contract": contract.id() })
    );
    assert_eq!(view(&outlayer, "get_calls", json!({})).await?, json!(2), "the failed call kept no state");
    let market = view(&contract, "get_market", json!({ "market_id": 1 })).await?;
    assert_eq!(market["status"], "resolved");
    assert_eq!(market["resolution"]["rationale"], "JEV jev-1.14.0 gave a YES probability of 0.73.");
    let result = call(&ana, &contract, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_failure("request_resolution when resolved", &result, "this market is resolved");

    // The callback is private.
    let result = call(&kenji, &contract, "on_resolution", json!({ "market_id": 1, "request_id": 3 }), 0, CALL_GAS).await?;
    check_failure("on_resolution from outside", &result, "Method on_resolution is private");

    // Redeem at the weight. First let the gas refunds of the 300 Tgas requests arrive, so that
    // they do not count as payouts.
    worker.fast_forward(5).await?;
    let collateral = yocto(&market["collateral"]);
    let mut paid = 0;
    for (label, who) in [("redeem (YES holder)", &kenji), ("redeem (NO holder)", &ana), ("redeem (creator)", &maya)] {
        let expected = yocto(&view(&contract, "get_position", json!({ "market_id": 1, "account_id": who.id() })).await?["redeemable"]);
        let before = balance(who).await?;
        let result = call(who, &contract, "redeem", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
        check_success(label, &result, GAS_BUDGET);
        assert_eq!(yocto(&result.json::<Value>()?), expected);
        let gained = balance(who).await? - before;
        assert!(gained > expected - NEAR / 100 && gained <= expected, "{label}: gained {gained} of {expected}");
        paid += expected;
    }
    assert!(paid <= collateral && collateral - paid <= 3 * 1_000_000_000_000_000_000);
    let result = call(&kenji, &contract, "redeem", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
    check_failure("redeem twice", &result, "nothing to redeem");

    // The admin fallback on a second market.
    let result = call(
        &ana,
        &contract,
        "create_market",
        json!({ "question": "Does the note cite a primary source?", "closes_at_ms": closes_at_ms }),
        NEAR / 10,
        CALL_GAS,
    )
    .await?;
    check_success("create_market (short)", &result, GAS_BUDGET);
    let result = call(&admin, &contract, "close_market", json!({ "market_id": 2 }), 0, CALL_GAS).await?;
    check_success("close_market (admin)", &result, GAS_BUDGET);
    let result = call(&kenji, &contract, "resolve", json!({ "market_id": 2, "yes_bps": 9_500 }), 0, CALL_GAS).await?;
    check_failure("resolve by a trader", &result, "only the admin can resolve a market");
    let result = call(&admin, &contract, "resolve", json!({ "market_id": 2, "yes_bps": 9_500, "rationale": "Checked by hand." }), 0, CALL_GAS).await?;
    check_success("resolve (admin)", &result, GAS_BUDGET);
    let market = view(&contract, "get_market", json!({ "market_id": 2 })).await?;
    assert_eq!(market["resolution"]["payout_yes_bps"], 10_000, "95% snaps to a full YES");
    assert_eq!(market["resolution"]["source"], "admin");
    let result = call(&ana, &contract, "redeem", json!({ "market_id": 2 }), 0, CALL_GAS).await?;
    check_success("redeem (creator, admin market)", &result, GAS_BUDGET);
    assert_eq!(yocto(&result.json::<Value>()?), NEAR / 10, "the creator's pool pays the liquidity back");

    // Views.
    let markets = view(&contract, "get_markets", json!({})).await?;
    let ids: Vec<u64> = markets.as_array().unwrap().iter().map(|m| m["id"].as_u64().unwrap()).collect();
    assert_eq!(ids, vec![2, 1], "newest first");
    assert_eq!(view(&contract, "get_market_for_note", json!({ "note_id": 2 })).await?["id"], 1);
    assert_eq!(view(&contract, "get_market_for_note", json!({ "note_id": 3 })).await?, Value::Null);
    let config = view(&contract, "get_config", json!({})).await?;
    assert_eq!(config["resolver"]["outlayer_account"], json!(outlayer.id()));
    assert_eq!(config["snap_high_bps"], 9_000);
    Ok(())
}
