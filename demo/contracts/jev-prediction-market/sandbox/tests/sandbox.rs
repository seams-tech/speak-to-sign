//! Deploys `res/jev_prediction_market.wasm`, `res/fake_usdc.wasm` and `res/fake_outlayer.wasm`
//! to a local nearcore sandbox and runs a market from create to claim: USDC bets through
//! `ft_transfer_call`, an OutLayer run that fails, an OutLayer answer at a grey weight, claims in
//! USDC (also to an account that the token does not know), and the admin fallback.
//!
//! Run `./build.sh` first, or set `PM_NOTES_WASM`, `FAKE_USDC_WASM` and `FAKE_OUTLAYER_WASM`.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

/// The gas that a wallet attaches to a normal call.
const CALL_GAS: Gas = Gas::from_tgas(30);
/// A claim calls the token: the page attaches 50 Tgas.
const CLAIM_GAS: Gas = Gas::from_tgas(50);
/// `ft_transfer_call` runs the token, the market and the token again.
const FT_CALL_GAS: Gas = Gas::from_tgas(100);
/// A normal call must burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);
/// `request_resolution` needs 300 Tgas.
const REQUEST_GAS: Gas = Gas::from_tgas(300);
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: u128 = 1_000_000;
const QUESTION: &str = "Will this note hold up?";

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

/// `who` sends `amount` USDC to the market with `msg`, as the page does.
async fn send_usdc(who: &Account, usdc: &Contract, market: &Contract, amount: u128, msg: Value) -> anyhow::Result<ExecutionFinalResult> {
    call(
        who,
        usdc,
        "ft_transfer_call",
        json!({ "receiver_id": market.id(), "amount": amount.to_string(), "msg": msg.to_string() }),
        1,
        FT_CALL_GAS,
    )
    .await
}

fn check_success(label: &str, result: &ExecutionFinalResult, budget: Gas) {
    assert!(result.is_success(), "{label} failed: {:#?}", result.failures());
    assert!(result.failures().is_empty(), "{label} has a failed receipt: {:#?}", result.failures());
    let burnt = result.total_gas_burnt;
    println!("{label}: {:.3} Tgas burnt", burnt.as_gas() as f64 / 1e12);
    assert!(burnt < budget, "{label} burnt {burnt}, more than the budget of {budget}");
}

fn check_failure(label: &str, result: &ExecutionFinalResult, expected: &str) {
    let text = format!("{:?}", result.failures());
    assert!(!result.failures().is_empty(), "{label} has no failed receipt");
    assert!(text.contains(expected), "{label}: the failure does not contain {expected:?}: {text}");
    println!("{label}: fails with {expected:?}");
}

/// The NEP-297 `pm_notes` events of a transaction, as (event, data[0]).
fn events(result: &ExecutionFinalResult) -> Vec<(String, Value)> {
    result
        .logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|json| serde_json::from_str::<Value>(json).unwrap())
        .filter(|event| event["standard"] == "pm_notes")
        .map(|event| {
            assert_eq!(event["version"], "1.0.0");
            (event["event"].as_str().unwrap().to_owned(), event["data"][0].clone())
        })
        .collect()
}

async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn usdc_of(usdc: &Contract, account: &Account) -> anyhow::Result<u128> {
    Ok(amount(&view(usdc, "ft_balance_of", json!({ "account_id": account.id() })).await?))
}

fn amount(value: &Value) -> u128 {
    value.as_str().expect("a U128 string").parse().unwrap()
}

fn keys(value: &Value) -> Vec<&str> {
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    keys
}

#[tokio::test]
async fn a_usdc_market_from_create_to_claim_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let outlayer = worker.dev_deploy(&wasm("FAKE_OUTLAYER_WASM", "fake_outlayer.wasm")?).await?;
    let usdc = worker.dev_deploy(&wasm("FAKE_USDC_WASM", "fake_usdc.wasm")?).await?;
    let market = worker.dev_deploy(&wasm("PM_NOTES_WASM", "jev_prediction_market.wasm")?).await?;
    usdc.call("new").transact().await?.into_result()?;
    let admin = worker.dev_create_account().await?;
    let maya = worker.dev_create_account().await?;
    let kenji = worker.dev_create_account().await?;
    let ana = worker.dev_create_account().await?;
    let zed = worker.dev_create_account().await?;
    println!("pm-notes code: {} bytes", market.view_code().await?.len());

    let result = market
        .call("new")
        .args_json(json!({
            "admin": admin.id(),
            "token": usdc.id(),
            "resolver": {
                "outlayer_account": outlayer.id(),
                "project_id": "seams-v1.testnet/pm-notes-resolver",
                "secrets_ref": { "profile": "main", "account_id": admin.id() },
            },
        }))
        .transact()
        .await?;
    assert!(result.is_success(), "new failed: {:#?}", result.failures());
    // The market must be registered with the token, as on testnet (storage_deposit).
    usdc.call("storage_deposit").args_json(json!({ "account_id": market.id() })).transact().await?.into_result()?;
    for account in [&maya, &kenji, &ana, &zed] {
        usdc.call("mint").args_json(json!({ "account_id": account.id(), "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    }

    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let closes_at_ms = now_ms + 60 * 60 * 1_000;
    let create = |question: &str, context: &str, note_id: u64| {
        json!({ "action": "create_market", "question": question, "context": context, "note_id": note_id, "closes_at_ms": closes_at_ms })
    };
    let bet = |market_id: u64, outcome: &str| json!({ "action": "bet", "market_id": market_id, "outcome": outcome });

    // Create with a 10 USDC seed: 5 on YES and 5 on NO.
    let storage_before = market.view_account().await?.storage_usage;
    let result = send_usdc(&maya, &usdc, &market, 10 * USDC, create(QUESTION, &"c".repeat(1_000), 2)).await?;
    check_success("create_market (longest context)", &result, Gas::from_tgas(20));
    println!(
        "largest market: {} bytes of contract storage",
        market.view_account().await?.storage_usage - storage_before
    );
    assert_eq!(events(&result)[0].0, "market_created");
    assert_eq!(events(&result)[0].1["seed"], (10 * USDC).to_string());
    assert_eq!(usdc_of(&usdc, &maya).await?, 90 * USDC);

    // Bets.
    let result = send_usdc(&kenji, &usdc, &market, 20 * USDC, bet(1, "yes")).await?;
    check_success("bet (new stake)", &result, Gas::from_tgas(20));
    assert_eq!(events(&result)[0].1["yes_share_bps"], 8_333);
    let result = send_usdc(&kenji, &usdc, &market, 5 * USDC, bet(1, "yes")).await?;
    check_success("bet (same stake)", &result, Gas::from_tgas(20));
    let result = send_usdc(&ana, &usdc, &market, 5 * USDC, bet(1, "no")).await?;
    check_success("bet NO", &result, Gas::from_tgas(20));
    let result = send_usdc(&ana, &usdc, &market, USDC / 2, bet(1, "no")).await?;
    check_failure("bet below 1 USDC", &result, "bet at least 1 USDC");
    assert_eq!(usdc_of(&usdc, &ana).await?, 95 * USDC, "the token gave the refused bet back");
    let result = call(&kenji, &market, "ft_on_transfer", json!({ "sender_id": kenji.id(), "amount": "1000000", "msg": bet(1, "yes").to_string() }), 0, CALL_GAS).await?;
    check_failure("ft_on_transfer from an account", &result, "only the market token can send to this contract");

    let view_market = view(&market, "get_market", json!({ "market_id": 1 })).await?;
    assert_eq!(
        keys(&view_market),
        vec![
            "bets", "closes_at_ms", "context", "created_at_ms", "creator", "id", "no_pool", "note_id",
            "paid_out", "pending", "question", "refund_all", "resolution", "status", "total_pool",
            "yes_pool", "yes_share_bps",
        ]
    );
    assert_eq!(view_market["status"], "open");
    assert_eq!(view_market["bets"], 3);
    assert_eq!(view_market["yes_share_bps"], 7_500, "YES 30 of 40 USDC");
    assert_eq!(amount(&view_market["total_pool"]), 40 * USDC);
    assert_eq!(usdc_of(&usdc, market.as_account()).await?, 40 * USDC);
    let position = view(&market, "get_position", json!({ "market_id": 1, "account_id": kenji.id() })).await?;
    assert_eq!(keys(&position), vec!["claimed", "no", "payout", "yes"]);
    assert_eq!(position["payout"], Value::Null);
    let quote = view(&market, "quote_bet", json!({ "market_id": 1, "outcome": "no", "amount": (10 * USDC).to_string() })).await?;
    assert_eq!(keys(&quote), vec!["amount", "payout_if_right", "yes_share_bps"]);
    let odds = view(&market, "get_odds_history", json!({ "market_id": 1 })).await?;
    let odds: Vec<u64> = odds.as_array().unwrap().iter().map(|p| p["yes_bps"].as_u64().unwrap()).collect();
    assert_eq!(odds, vec![5_000, 8_333, 8_571, 7_500]);

    // Zed bets all his USDC, then leaves the token, so that his claim cannot arrive.
    let result = send_usdc(&zed, &usdc, &market, 100 * USDC, bet(1, "no")).await?;
    check_success("bet (all of an account's USDC)", &result, Gas::from_tgas(20));
    zed.call(usdc.id(), "unregister").transact().await?.into_result()?;

    // Resolve: not before the close.
    let result = call(&kenji, &market, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_failure("request_resolution while open", &result, "this market is still open for betting");
    let result = call(&kenji, &market, "close_market", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
    check_failure("close_market by a bettor", &result, "only the creator or the admin can close this market");
    let result = call(&maya, &market, "close_market", json!({ "market_id": 1 }), 0, CALL_GAS).await?;
    check_success("close_market", &result, GAS_BUDGET);
    let result = send_usdc(&kenji, &usdc, &market, 10 * USDC, bet(1, "yes")).await?;
    check_failure("bet after the close", &result, "this market is closed for betting");

    // An OutLayer run that fails: the market stays closed for a new request.
    outlayer.call("set_failure").transact().await?.into_result()?;
    let result = call(&kenji, &market, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    assert!(result.is_success());
    assert!(!result.clone().json::<bool>()?);
    let failed = events(&result);
    assert_eq!(failed[0].0, "resolution_requested");
    assert_eq!(
        failed[1],
        ("resolution_failed".to_owned(), json!({ "market_id": 1, "request_id": 1, "reason": "the OutLayer call failed" }))
    );
    assert_eq!(view(&market, "get_market", json!({ "market_id": 1 })).await?["status"], "closed");

    // The worker's own error.
    outlayer
        .call("set_answer")
        .args_json(json!({ "answer": { "error": "JEV: HTTP 401; NEAR AI: HTTP 429" } }))
        .transact()
        .await?
        .into_result()?;
    let result = call(&ana, &market, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_success("request_resolution (worker error)", &result, REQUEST_GAS);
    assert_eq!(events(&result)[1].1["reason"], "the resolver failed: JEV: HTTP 401; NEAR AI: HTTP 429");

    // A grey answer from JEV: 73%.
    outlayer
        .call("set_answer")
        .args_json(json!({ "answer": {
            "yes_bps": 7_300,
            "provider": "jev",
            "model": "jev-1.14.0",
            "rationale": "JEV (jev-1.14.0) gave a YES probability of 73%.",
        }}))
        .transact()
        .await?
        .into_result()?;
    let result = call(&kenji, &market, "request_resolution", json!({ "market_id": 1 }), NEAR / 20, REQUEST_GAS).await?;
    check_success("request_resolution (answer)", &result, REQUEST_GAS);
    assert!(result.clone().json::<bool>()?);
    assert_eq!(events(&result)[1].0, "market_resolved");
    let request = view(&outlayer, "get_last_request", json!({})).await?;
    assert_eq!(amount(&request["deposit"]), NEAR / 20, "the NEAR fee goes to OutLayer");
    assert_eq!(request["input"]["question"], QUESTION);
    let result = call(&kenji, &market, "on_resolution", json!({ "market_id": 1, "request_id": 4 }), 0, CALL_GAS).await?;
    check_failure("on_resolution from outside", &result, "Method on_resolution is private");

    // Claims in USDC. T = 140 (YES 30, NO 110), w = 0.73: YES bets share 102.2, NO bets 37.8.
    // Kenji: 25 / 30 × 102.2 = 85.166666. Ana: 5 / 110 × 37.8 = 1.718181.
    // Maya: 5 / 30 × 102.2 + 5 / 110 × 37.8 = 17.033333 + 1.718181 = 18.751514.
    let mut paid = 0;
    for (label, who, expected) in [
        ("claim (YES bettor)", &kenji, 85_166_666),
        ("claim (NO bettor)", &ana, 1_718_181),
        ("claim (creator seed)", &maya, 18_751_514),
    ] {
        let position = view(&market, "get_position", json!({ "market_id": 1, "account_id": who.id() })).await?;
        assert_eq!(amount(&position["payout"]), expected, "{label}");
        let before = usdc_of(&usdc, who).await?;
        let result = call(who, &market, "claim", json!({ "market_id": 1 }), 0, CLAIM_GAS).await?;
        check_success(label, &result, Gas::from_tgas(15));
        assert_eq!(amount(&result.json::<Value>()?), expected);
        assert_eq!(usdc_of(&usdc, who).await? - before, expected, "{label}: the USDC arrived");
        paid += expected;
    }
    // Zed is not registered with the token: the transfer fails, and the claim opens again.
    let zed_payout = amount(&view(&market, "get_position", json!({ "market_id": 1, "account_id": zed.id() })).await?["payout"]);
    assert_eq!(zed_payout, 34_363_636, "100 / 110 × 37.8");
    let result = call(&zed, &market, "claim", json!({ "market_id": 1 }), 0, CLAIM_GAS).await?;
    assert_eq!(amount(&result.clone().json::<Value>()?), 0);
    check_failure("claim to an unregistered account", &result, "is not registered");
    assert_eq!(events(&result).last().unwrap().0, "claim_failed");
    assert_eq!(view(&market, "get_position", json!({ "market_id": 1, "account_id": zed.id() })).await?["claimed"], false);
    usdc.call("storage_deposit").args_json(json!({ "account_id": zed.id() })).transact().await?.into_result()?;
    let result = call(&zed, &market, "claim", json!({ "market_id": 1 }), 0, CLAIM_GAS).await?;
    check_success("claim after the registration", &result, Gas::from_tgas(15));
    assert_eq!(usdc_of(&usdc, &zed).await?, zed_payout);
    paid += zed_payout;
    let pool = 140 * USDC;
    assert!(paid <= pool && pool - paid <= 8, "paid {paid} of {pool}");
    assert_eq!(usdc_of(&usdc, market.as_account()).await?, pool - paid, "the dust stays in the market");
    let result = call(&kenji, &market, "claim", json!({ "market_id": 1 }), 0, CLAIM_GAS).await?;
    check_failure("claim twice", &result, "already claimed");

    // The admin fallback on a second market with a 1 USDC seed.
    let result = send_usdc(&ana, &usdc, &market, USDC, create("Does the note cite a primary source?", "", 3)).await?;
    check_success("create_market (short)", &result, Gas::from_tgas(20));
    let result = call(&admin, &market, "close_market", json!({ "market_id": 2 }), 0, CALL_GAS).await?;
    check_success("close_market (admin)", &result, GAS_BUDGET);
    let result = call(&kenji, &market, "resolve", json!({ "market_id": 2, "yes_bps": 9_500 }), 0, CALL_GAS).await?;
    check_failure("resolve by a bettor", &result, "only the admin can resolve a market");
    let result = call(&admin, &market, "resolve", json!({ "market_id": 2, "yes_bps": 9_500, "rationale": "Checked by hand." }), 0, CALL_GAS).await?;
    check_success("resolve (admin)", &result, GAS_BUDGET);
    let resolved = view(&market, "get_market", json!({ "market_id": 2 })).await?;
    assert_eq!(resolved["resolution"]["payout_yes_bps"], 10_000, "95% snaps to a full YES");
    assert_eq!(resolved["resolution"]["source"], "admin");
    let result = call(&ana, &market, "claim", json!({ "market_id": 2 }), 0, CLAIM_GAS).await?;
    check_success("claim (creator, admin market)", &result, Gas::from_tgas(15));
    assert_eq!(amount(&result.json::<Value>()?), USDC, "the seed alone pays itself back");

    // Views.
    let markets = view(&market, "get_markets", json!({})).await?;
    let ids: Vec<u64> = markets.as_array().unwrap().iter().map(|m| m["id"].as_u64().unwrap()).collect();
    assert_eq!(ids, vec![2, 1], "newest first");
    assert_eq!(view(&market, "get_market_for_note", json!({ "note_id": 2 })).await?["id"], 1);
    assert_eq!(view(&market, "get_market_for_note", json!({ "note_id": 4 })).await?, Value::Null);
    let config = view(&market, "get_config", json!({})).await?;
    assert_eq!(config["token"], json!(usdc.id()));
    assert_eq!(config["min_bet"], USDC.to_string());
    Ok(())
}
