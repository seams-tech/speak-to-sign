//! A local stand-in for testnet, for a visual check of the market strip. Not a test: it is
//! ignored by default. It deploys the notes contract, a fake USDC and pm-notes to a sandbox,
//! writes four notes on post 1, opens USDC markets in three states (open, closed, resolved by a
//! fake JEV), and keeps the sandbox running.
//!
//! ```bash
//! NOTES_WASM=../community-notes/res/community_notes.wasm UI_DEMO_OUT=/tmp/ui-demo.json \
//!   cargo test -p jev-prediction-market-sandbox --test ui_demo -- --ignored --nocapture
//! ```
//!
//! Then run the page with the printed `VITE_NEAR_RPC_URL`, `VITE_NOTES_CONTRACT`,
//! `VITE_MARKET_CONTRACT` and `VITE_MARKET_TOKEN`, and open `#/notes/post/1`.

use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: u128 = 1_000_000;
const GAS: Gas = Gas::from_tgas(30);

async fn call(who: &Account, contract: &Contract, method: &str, args: Value, deposit: u128, gas: Gas) -> anyhow::Result<Value> {
    let result = who
        .call(contract.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(gas)
        .transact()
        .await?;
    anyhow::ensure!(result.is_success(), "{method} failed: {:?}", result.failures());
    Ok(result.json::<Value>().unwrap_or(Value::Null))
}

#[tokio::test]
#[ignore = "a local stand-in for testnet, for a visual check of the page"]
async fn ui_demo_sandbox() -> anyhow::Result<()> {
    let read = |name: &str, default: &str| -> anyhow::Result<Vec<u8>> {
        let path = std::env::var(name).unwrap_or_else(|_| format!("{}/{default}", env!("CARGO_MANIFEST_DIR")));
        std::fs::read(&path).map_err(|e| anyhow::anyhow!("cannot read {path}: {e}"))
    };
    let worker = near_workspaces::sandbox().await?;
    let notes = worker.dev_deploy(&read("NOTES_WASM", "../../community-notes/res/community_notes.wasm")?).await?;
    let outlayer = worker.dev_deploy(&read("FAKE_OUTLAYER_WASM", "../res/fake_outlayer.wasm")?).await?;
    let market = worker.dev_deploy(&read("PM_NOTES_WASM", "../res/jev_prediction_market.wasm")?).await?;
    let usdc = worker.dev_deploy(&read("FAKE_USDC_WASM", "../res/fake_usdc.wasm")?).await?;
    usdc.call("new").transact().await?.into_result()?;
    let admin = worker.dev_create_account().await?;
    market
        .call("new")
        .args_json(json!({ "admin": admin.id(), "token": usdc.id(), "resolver": { "outlayer_account": outlayer.id(), "project_id": "seams-v1.testnet/pm-notes-resolver" } }))
        .transact()
        .await?
        .into_result()?;
    // The seeded bets of this demo data have no voice.
    admin.call(market.id(), "set_voice_required").args_json(json!({ "required": false })).transact().await?.into_result()?;
    usdc.call("storage_deposit").args_json(json!({ "account_id": market.id() })).transact().await?.into_result()?;
    let mut people = Vec::new();
    for _ in 0..5 {
        let person = worker.dev_create_account().await?;
        usdc.call("mint").args_json(json!({ "account_id": person.id(), "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
        people.push(person);
    }
    // A bet or a seed: USDC through the token's ft_transfer_call.
    let send = |who: &Account, amount: u128, msg: Value| {
        let (who, usdc, market) = (who.clone(), usdc.clone(), market.clone());
        async move {
            call(&who, &usdc, "ft_transfer_call", json!({ "receiver_id": market.id(), "amount": amount.to_string(), "msg": msg.to_string() }), 1, Gas::from_tgas(100)).await
        }
    };
    let [alice, bob, carol, dave, maya] = &people[..] else { unreachable!() };

    let texts = [
        ("The account posts AI-written stories every day to farm engagement. The numbers change in each version of the story.", "the account invents numbers for engagement"),
        ("iPhones keep deleted photos for 30 days. Older photos cannot come back from the phone itself.", "deleted photos stay for thirty days only"),
        ("The video in the post shows a different app, not Claude Code.", "the video shows a different app"),
        ("Claude Code is a coding tool. It cannot read the photo library of an iPhone.", "claude code cannot read the photo library"),
    ];
    for (text, summary) in texts {
        call(alice, &notes, "add_note", json!({ "post_id": 1, "text": text, "summary": summary }), 0, GAS).await?;
    }
    for rater in [bob, carol] {
        call(rater, &notes, "rate_note", json!({ "note_id": 1, "rating": "helpful" }), 0, GAS).await?;
    }

    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let question = "Will this note hold up?";
    let context = |id: usize| format!("Post by Engagement account: Claude Code just found 145,763 photos I deleted from my iPhone.\n\nCommunity note: {}", texts[id - 1].0);
    // Note 1: open, closes in 2 days.
    send(maya, 5 * USDC, json!({ "action": "create_market", "question": question, "context": context(1), "note_id": 1, "closes_at_ms": now_ms + 2 * 86_400_000 })).await?;
    for (who, outcome, amount) in [(bob, "yes", 20 * USDC), (carol, "no", 6 * USDC), (dave, "yes", 5 * USDC), (alice, "yes", USDC), (bob, "no", USDC)] {
        send(who, amount, json!({ "action": "bet", "market_id": 1, "outcome": outcome })).await?;
    }
    // Note 2: resolved by the fake JEV at 72%.
    send(maya, 5 * USDC, json!({ "action": "create_market", "question": question, "context": context(2), "note_id": 2, "closes_at_ms": now_ms + 3_600_000 })).await?;
    for (who, outcome, amount) in [(bob, "yes", 20 * USDC), (carol, "no", 10 * USDC), (dave, "yes", 5 * USDC), (alice, "no", 7 * USDC)] {
        send(who, amount, json!({ "action": "bet", "market_id": 2, "outcome": outcome })).await?;
    }
    call(maya, &market, "close_market", json!({ "market_id": 2 }), 0, GAS).await?;
    outlayer
        .call("set_answer")
        .args_json(json!({ "answer": {
            "yes_bps": 7_200,
            "provider": "jev",
            "model": "jev-1.14.0",
            "rationale": "JEV (jev-1.14.0) gave a YES probability of 72%."
        }}))
        .transact()
        .await?
        .into_result()?;
    call(dave, &market, "request_resolution", json!({ "market_id": 2 }), NEAR / 20, Gas::from_tgas(300)).await?;
    // Note 3: closed, waiting for "Ask JEV".
    send(maya, USDC, json!({ "action": "create_market", "question": question, "context": context(3), "note_id": 3, "closes_at_ms": now_ms + 3_600_000 })).await?;
    send(bob, 10 * USDC, json!({ "action": "bet", "market_id": 3, "outcome": "no" })).await?;
    call(maya, &market, "close_market", json!({ "market_id": 3 }), 0, GAS).await?;
    // Note 4: no market.

    let out = json!({
        "VITE_NEAR_RPC_URL": worker.rpc_addr(),
        "VITE_NOTES_CONTRACT": notes.id(),
        "VITE_MARKET_CONTRACT": market.id(),
        "VITE_MARKET_TOKEN": usdc.id(),
        "bettor_account": bob.id(),
    });
    println!("{out:#}");
    if let Ok(path) = std::env::var("UI_DEMO_OUT") {
        std::fs::write(path, out.to_string())?;
    }
    let seconds: u64 = std::env::var("UI_DEMO_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(1_200);
    tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
    Ok(())
}
