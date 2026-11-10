//! A spoken bet in a local nearcore sandbox: the release WASM checks the voice verdict of a bet
//! with the chain's own ed25519 and SHA-256 host functions.
//!
//! The test signs each verdict with a test key, as the voice verifier signs with its own key.
//! Run `./build.sh` first.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use spoken_intent::{BetOutcomeV1, NearAccount, Network, SpokenRequestV1, UsdcAmount, request_digest};

const USDC: u128 = 1_000_000;
const CALL_GAS: Gas = Gas::from_tgas(100);
/// The gas that a spoken bet may burn in the market contract (`ft_on_transfer`).
const BET_BUDGET: Gas = Gas::from_tgas(15);
const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";

fn wasm(file: &str) -> anyhow::Result<Vec<u8>> {
    let path = format!("{}/../res/{file}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ./build.sh first."))
}

fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[0x2a; 32])
}

/// The verdict of "bet <amount> usdc <outcome> on market <id>" by `who`, and its signature.
fn verdict(key: &SigningKey, who: &Account, market: &Contract, usdc: &Contract, market_id: u64, outcome: BetOutcomeV1, amount: u128, expires_at_ms: u64, audio: u8) -> (String, String) {
    let digest = request_digest(&SpokenRequestV1::MarketBet {
        network: Network::Testnet,
        owner: NearAccount::new(who.id().as_str()).unwrap(),
        market: NearAccount::new(market.id().as_str()).unwrap(),
        token: NearAccount::new(usdc.id().as_str()).unwrap(),
        market_id,
        outcome,
        amount: UsdcAmount::from_units(amount).unwrap(),
    });
    let verdict_json = format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.8.0","request_digest":"{}","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"{}","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"bet zero point five usdc yes on market one"}}"#,
        URL_SAFE_NO_PAD.encode(digest),
        URL_SAFE_NO_PAD.encode([audio; 32]),
    );
    let mut hasher = Sha256::new();
    hasher.update(VERDICT_DOMAIN);
    hasher.update(verdict_json.as_bytes());
    let message: [u8; 32] = hasher.finalize().into();
    let signature = STANDARD.encode(key.sign(&message).to_bytes());
    (verdict_json, signature)
}

async fn send_usdc(who: &Account, usdc: &Contract, market: &Contract, amount: u128, msg: Value) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": market.id(), "amount": amount.to_string(), "msg": msg.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(CALL_GAS)
        .transact()
        .await?)
}

async fn usdc_of(usdc: &Contract, account: &Account) -> anyhow::Result<u128> {
    let balance: String = usdc.view("ft_balance_of").args_json(json!({ "account_id": account.id() })).await?.json()?;
    Ok(balance.parse()?)
}

/// True if a receipt of the transaction failed with `expected` in its message.
fn refused_with(result: &ExecutionFinalResult, expected: &str) -> bool {
    result.receipt_failures().iter().any(|failure| format!("{failure:?}").contains(expected))
}

#[tokio::test]
async fn a_bet_needs_the_verdict_of_its_own_spoken_sentence() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let outlayer = worker.dev_deploy(&wasm("fake_outlayer.wasm")?).await?;
    let usdc = worker.dev_deploy(&wasm("fake_usdc.wasm")?).await?;
    let market = worker.dev_deploy(&wasm("jev_prediction_market.wasm")?).await?;
    usdc.call("new").transact().await?.into_result()?;
    let admin = worker.dev_create_account().await?;
    let maya = worker.dev_create_account().await?;
    let kenji = worker.dev_create_account().await?;
    let ana = worker.dev_create_account().await?;
    market
        .call("new")
        .args_json(json!({ "admin": admin.id(), "token": usdc.id(), "resolver": { "outlayer_account": outlayer.id(), "project_id": "seams-v1.testnet/pm-notes-resolver" } }))
        .transact()
        .await?
        .into_result()?;
    usdc.call("storage_deposit").args_json(json!({ "account_id": market.id() })).transact().await?.into_result()?;
    for account in [&maya, &kenji, &ana] {
        usdc.call("mint").args_json(json!({ "account_id": account.id(), "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    }

    // A new contract needs a voice for each bet, with the Seams verifier's key.
    let config: Value = market.view("get_voice_config").args_json(json!({})).await?.json()?;
    assert_eq!(config["required"], true);
    assert_eq!(config["verifier_public_key"], "ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U");
    // The test verifier takes its place.
    let key = verifier();
    let public_key = format!("ed25519:{}", bs58::encode(key.verifying_key().to_bytes()).into_string());
    admin.call(market.id(), "set_voice_verifier_key").args_json(json!({ "verifier_public_key": public_key })).transact().await?.into_result()?;

    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let expires_at_ms = now_ms + 10 * 60 * 1_000;
    // A market needs no voice: only a bet does.
    let create = json!({ "action": "create_market", "question": "Is this note true?", "context": "A post and its note.", "note_id": 2, "closes_at_ms": now_ms + 60 * 60 * 1_000 });
    send_usdc(&maya, &usdc, &market, 10 * USDC, create).await?.into_result()?;

    let half = USDC / 2;
    let bet = |outcome: &str, spoken: &(String, String)| json!({ "action": "bet", "market_id": 1, "outcome": outcome, "verdict_json": spoken.0, "signature_b64": spoken.1 });

    // 1. A bet without a verdict fails, and the token gives the USDC back.
    let result = send_usdc(&kenji, &usdc, &market, half, json!({ "action": "bet", "market_id": 1, "outcome": "yes" })).await?;
    assert!(refused_with(&result, "say the bet"), "{:#?}", result.receipt_failures());
    assert_eq!(usdc_of(&usdc, &kenji).await?, 100 * USDC);

    // 2. Kenji says "bet zero point five usdc yes on market one": the bet is in.
    let spoken = verdict(&key, &kenji, &market, &usdc, 1, BetOutcomeV1::Yes, half, expires_at_ms, 7);
    let result = send_usdc(&kenji, &usdc, &market, half, bet("yes", &spoken)).await?;
    assert!(result.receipt_failures().is_empty(), "{:#?}", result.receipt_failures());
    assert_eq!(usdc_of(&usdc, &kenji).await?, 100 * USDC - half);
    let position: Value = market.view("get_position").args_json(json!({ "market_id": 1, "account_id": kenji.id() })).await?.json()?;
    assert_eq!(position["yes"], half.to_string());
    let burnt = result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| outcome.executor_id == *market.id())
        .map(|outcome| outcome.gas_burnt.as_gas())
        .sum::<u64>();
    println!("a spoken bet burns {:.2} Tgas in the market contract", burnt as f64 / 1e12);
    assert!(burnt <= BET_BUDGET.as_gas(), "the bet burnt {burnt} gas");

    // 3. The same verdict does not pass again.
    let result = send_usdc(&kenji, &usdc, &market, half, bet("yes", &spoken)).await?;
    assert!(refused_with(&result, "this verdict was used"), "{:#?}", result.receipt_failures());

    // 4. Kenji's verdict does not pass for another outcome, another amount or another account.
    let fresh = verdict(&key, &kenji, &market, &usdc, 1, BetOutcomeV1::Yes, half, expires_at_ms, 8);
    for (who, amount, outcome) in [(&kenji, half, "no"), (&kenji, USDC, "yes"), (&ana, half, "yes")] {
        let result = send_usdc(who, &usdc, &market, amount, bet(outcome, &fresh)).await?;
        assert!(refused_with(&result, "the verdict is for another request"), "{:#?}", result.receipt_failures());
    }
    // 5. A verdict that another key signed does not pass.
    let forged = verdict(&SigningKey::from_bytes(&[0x07; 32]), &ana, &market, &usdc, 1, BetOutcomeV1::No, half, expires_at_ms, 9);
    let result = send_usdc(&ana, &usdc, &market, half, bet("no", &forged)).await?;
    assert!(refused_with(&result, "the verdict signature does not match"), "{:#?}", result.receipt_failures());
    // 6. An old verdict does not pass.
    let old = verdict(&key, &ana, &market, &usdc, 1, BetOutcomeV1::No, half, now_ms - 60_000, 10);
    let result = send_usdc(&ana, &usdc, &market, half, bet("no", &old)).await?;
    assert!(refused_with(&result, "the verdict has expired"), "{:#?}", result.receipt_failures());
    // Each refused bet came back.
    assert_eq!(usdc_of(&usdc, &kenji).await?, 100 * USDC - half);
    assert_eq!(usdc_of(&usdc, &ana).await?, 100 * USDC);

    // 7. Ana's own spoken bet passes.
    let ana_no = verdict(&key, &ana, &market, &usdc, 1, BetOutcomeV1::No, USDC, expires_at_ms, 11);
    let result = send_usdc(&ana, &usdc, &market, USDC, bet("no", &ana_no)).await?;
    assert!(result.receipt_failures().is_empty(), "{:#?}", result.receipt_failures());
    let view: Value = market.view("get_market").args_json(json!({ "market_id": 1 })).await?.json()?;
    assert_eq!(view["bets"], 2);
    assert_eq!(view["yes_pool"], (5 * USDC + half).to_string());
    assert_eq!(view["no_pool"], (6 * USDC).to_string());
    Ok(())
}
