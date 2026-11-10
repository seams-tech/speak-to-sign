//! Deploys `res/voice_multisig.wasm` to a local nearcore sandbox with 2
//! admins and runs three proposals the way the demo page and the approve
//! route do, with 30 Tgas and 0 deposit: one whose transfer arrives, one
//! whose receiver does not exist, so the callback opens the proposal again,
//! and one above the balance of the multisig, so `execute` fails and the
//! proposal stays open.
//!
//! Run `./build.sh` first, or set `VOICE_MULTISIG_WASM` to a WASM path.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use spoken_intent::{
    NearAccount, NearAmount, Network, ProposalV1, SpokenAccount, multisig_approval_digest,
    multisig_commitment,
};

/// The gas that the Seams Wallet and the approve route attach to each call.
const WALLET_GAS: Gas = Gas::from_tgas(30);
/// `new`, `propose` and `approve` must burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);

const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";
const SALT: [u8; 32] = [0x5a; 32];
const SALT_2: [u8; 32] = [0x6b; 32];
const SALT_3: [u8; 32] = [0x7c; 32];
/// 0.01 NEAR.
const ONE_HUNDREDTH_NEAR: u128 = 10_000_000_000_000_000_000_000;
/// The NEAR of the multisig account at its creation.
const MULTISIG_NEAR: u128 = 10;

fn wasm() -> anyhow::Result<Vec<u8>> {
    let path = std::env::var("VOICE_MULTISIG_WASM").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../res/voice_multisig.wasm").to_string()
    });
    std::fs::read(&path)
        .map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ./build.sh first."))
}

fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[0x2a; 32])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn near(account: &Account) -> NearAccount {
    NearAccount::new(account.id().as_str()).unwrap()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// The commitment of a transfer and the opening that `execute` takes.
struct Opening {
    commitment: [u8; 32],
    receiver: String,
    amount_yocto: u128,
    salt: [u8; 32],
}

fn opening(
    multisig: &Contract,
    proposal_id: u64,
    receiver: &str,
    hundredths: u128,
    salt: [u8; 32],
) -> Opening {
    let amount_yocto = hundredths * ONE_HUNDREDTH_NEAR;
    let proposal = ProposalV1::Transfer {
        receiver: SpokenAccount::new(receiver).unwrap(),
        amount: NearAmount::from_yocto(amount_yocto).unwrap(),
    };
    let multisig = NearAccount::new(multisig.id().as_str()).unwrap();
    Opening {
        commitment: multisig_commitment(&multisig, proposal_id, &proposal, &salt),
        receiver: receiver.to_string(),
        amount_yocto,
        salt,
    }
}

/// A signed accept verdict of `owner` for this proposal, in the verifier's
/// field order. Returns the JSON and the signature.
fn verdict(
    owner: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
    expires_at_ms: u64,
) -> (String, String) {
    let digest = multisig_approval_digest(
        Network::Testnet,
        &near(owner),
        &NearAccount::new(multisig.id().as_str()).unwrap(),
        proposal_id,
        commitment,
    );
    let json = format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.6.0","request_digest":"{}","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"approve proposal one"}}"#,
        URL_SAFE_NO_PAD.encode(digest)
    );
    let mut hasher = Sha256::new();
    hasher.update(VERDICT_DOMAIN);
    hasher.update(json.as_bytes());
    let message: [u8; 32] = hasher.finalize().into();
    let signature = STANDARD.encode(verifier().sign(&message).to_bytes());
    (json, signature)
}

fn fresh(
    owner: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
) -> (String, String) {
    verdict(owner, multisig, proposal_id, commitment, now_ms() + 600_000)
}

async fn call(
    who: &Account,
    contract: &Contract,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(contract.id(), method)
        .args_json(args)
        .deposit(deposit)
        .gas(WALLET_GAS)
        .transact()
        .await?)
}

fn propose_args(id: u64, open: &Opening, verdict: (String, String)) -> Value {
    json!({
        "proposal_id": id,
        "commitment_hex": hex(&open.commitment),
        "verdict_json": verdict.0,
        "signature_b64": verdict.1
    })
}

async fn propose(
    who: &Account,
    multisig: &Contract,
    id: u64,
    open: &Opening,
) -> anyhow::Result<ExecutionFinalResult> {
    let args = propose_args(id, open, fresh(who, multisig, id, &open.commitment));
    call(who, multisig, "propose", args, NearToken::from_yoctonear(0)).await
}

async fn approve(
    who: &Account,
    multisig: &Contract,
    id: u64,
) -> anyhow::Result<ExecutionFinalResult> {
    call(
        who,
        multisig,
        "approve",
        json!({ "proposal_id": id }),
        NearToken::from_yoctonear(0),
    )
    .await
}

fn execute_args(id: u64, open: &Opening) -> Value {
    json!({
        "proposal_id": id,
        "receiver": open.receiver,
        "amount_yocto": open.amount_yocto.to_string(),
        "salt_hex": hex(&open.salt)
    })
}

async fn execute(
    who: &Account,
    multisig: &Contract,
    id: u64,
    open: &Opening,
) -> anyhow::Result<ExecutionFinalResult> {
    call(
        who,
        multisig,
        "execute",
        execute_args(id, open),
        NearToken::from_yoctonear(0),
    )
    .await
}

fn tgas(gas: Gas) -> f64 {
    gas.as_gas() as f64 / 1e12
}

fn check_success(label: &str, result: &ExecutionFinalResult, budget: Gas) {
    assert!(result.is_success(), "{label} failed: {result:#?}");
    let burnt = result.total_gas_burnt;
    println!("{label}: {:.3} Tgas burnt", tgas(burnt));
    assert!(
        burnt < budget,
        "{label} burnt {burnt}, more than the budget of {budget}"
    );
}

fn check_failure(label: &str, result: &ExecutionFinalResult, expected: &str) {
    assert!(!result.is_success(), "{label} succeeded, but it must fail");
    let text = format!("{:?}", result.failures());
    assert!(
        text.contains(expected),
        "{label}: the failure does not contain {expected:?}: {text}"
    );
    println!("{label}: fails with {expected:?}");
}

fn events(result: &ExecutionFinalResult) -> Vec<Value> {
    result
        .logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|json| serde_json::from_str(json).unwrap())
        .collect()
}

async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn subaccount(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

#[tokio::test]
async fn voice_multisig_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let admin_a = subaccount(&root, "admin-a", 5).await?;
    let admin_b = subaccount(&root, "admin-b", 5).await?;
    let visitor = subaccount(&root, "visitor", 5).await?;
    let stranger = subaccount(&root, "stranger", 5).await?;
    let grants = subaccount(&root, "grants", 1).await?;
    let multisig_account = subaccount(&root, "multisig", MULTISIG_NEAR).await?;
    let multisig = multisig_account.deploy(&wasm()?).await?.into_result()?;
    let verifier_public_key = format!(
        "ed25519:{}",
        bs58::encode(verifier().verifying_key().as_bytes()).into_string()
    );
    let init_args = json!({
        "admins": [admin_a.id(), admin_b.id()],
        "verifier_public_key": verifier_public_key
    });
    let init = multisig
        .call("new")
        .args_json(init_args.clone())
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_success("new", &init, GAS_BUDGET);
    assert_eq!(
        view(&multisig, "next_proposal_id", json!({})).await?,
        json!(1)
    );
    assert_eq!(view(&multisig, "get_config", json!({})).await?, init_args);

    // Proposal 1: 0.01 NEAR to grants, which arrives.
    let open = opening(&multisig, 1, grants.id().as_str(), 1, SALT);

    // Propose rules that fail on the real chain.
    check_failure(
        "propose by an admin",
        &propose(&admin_a, &multisig, 1, &open).await?,
        "an admin cannot propose",
    );
    let (verdict_json, _) = fresh(&visitor, &multisig, 1, &open.commitment);
    let (_, other_signature) = fresh(&stranger, &multisig, 1, &open.commitment);
    let result = call(
        &visitor,
        &multisig,
        "propose",
        propose_args(1, &open, (verdict_json, other_signature)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "propose with a wrong signature",
        &result,
        "the verdict signature does not match the verifier key",
    );
    let expired = verdict(&visitor, &multisig, 1, &open.commitment, now_ms() - 60_000);
    let result = call(
        &visitor,
        &multisig,
        "propose",
        propose_args(1, &open, expired),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "propose with an expired verdict",
        &result,
        "the verdict has expired",
    );
    let result = call(
        &visitor,
        &multisig,
        "propose",
        propose_args(1, &open, fresh(&stranger, &multisig, 1, &open.commitment)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "propose with the verdict of another account",
        &result,
        "the verdict is for another request",
    );

    let storage_before = multisig.view_account().await?.storage_usage;
    let result = propose(&visitor, &multisig, 1, &open).await?;
    check_success("propose", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<u64>()?, 1);
    assert_eq!(events(&result)[0]["event"], "proposed");

    // Approve and execute rules that fail on the real chain.
    check_failure(
        "approve by the proposer",
        &approve(&visitor, &multisig, 1).await?,
        "the caller is not an admin",
    );
    check_failure(
        "execute with no approvals",
        &execute(&visitor, &multisig, 1, &open).await?,
        "the proposal has 0 of 2 admin approvals",
    );
    let result = approve(&admin_a, &multisig, 1).await?;
    check_success("approve (1 of 2)", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<u32>()?, 1);
    assert_eq!(
        events(&result),
        vec![json!({
            "standard": "voice_multisig",
            "version": "2.0.0",
            "event": "approved",
            "data": [{ "proposal_id": 1, "admin": admin_a.id(), "approvals": 1 }]
        })]
    );
    check_failure(
        "approve twice",
        &approve(&admin_a, &multisig, 1).await?,
        "this admin already approved the proposal",
    );
    check_failure(
        "execute before all approvals",
        &execute(&admin_a, &multisig, 1, &open).await?,
        "the proposal has 1 of 2 admin approvals",
    );
    let result = approve(&admin_b, &multisig, 1).await?;
    check_success("approve (2 of 2)", &result, GAS_BUDGET);
    assert_eq!(result.json::<u32>()?, 2);
    println!(
        "one proposal with 2 admin approvals: {} bytes of contract storage",
        multisig.view_account().await?.storage_usage - storage_before
    );
    check_failure(
        "execute by a stranger",
        &execute(&stranger, &multisig, 1, &open).await?,
        "only the proposer or an admin can execute the proposal",
    );
    let wrong_salt = Opening {
        salt: SALT_2,
        ..opening(&multisig, 1, grants.id().as_str(), 1, SALT)
    };
    check_failure(
        "execute with a wrong salt",
        &execute(&admin_b, &multisig, 1, &wrong_salt).await?,
        "receiver, amount_yocto and salt_hex do not match the commitment",
    );

    // Deposits are refused on each change method.
    let one_yocto = NearToken::from_yoctonear(1);
    let deposit_calls = [
        (
            "propose",
            propose_args(2, &open, fresh(&stranger, &multisig, 2, &open.commitment)),
        ),
        ("approve", json!({ "proposal_id": 1 })),
        ("execute", execute_args(1, &open)),
    ];
    for (method, args) in deposit_calls {
        let result = call(&admin_b, &multisig, method, args, one_yocto).await?;
        check_failure(
            &format!("{method} with a deposit"),
            &result,
            &format!("Method {method} doesn't accept deposit"),
        );
    }

    let grants_before = grants.view_account().await?.balance;
    let result = execute(&admin_b, &multisig, 1, &open).await?;
    check_success("execute (transfer arrives)", &result, WALLET_GAS);
    assert!(result.clone().json::<bool>()?);
    let grants_after = grants.view_account().await?.balance;
    assert_eq!(
        grants_after.as_yoctonear() - grants_before.as_yoctonear(),
        open.amount_yocto,
        "grants receives exactly 0.01 NEAR"
    );
    assert_eq!(
        events(&result),
        vec![json!({
            "standard": "voice_multisig",
            "version": "2.0.0",
            "event": "executed",
            "data": [{ "proposal_id": 1, "receiver": grants.id(), "amount_yocto": open.amount_yocto.to_string() }]
        })]
    );
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 1 })).await?;
    let created_at_ms = proposal["created_at_ms"].as_u64().unwrap();
    assert!(created_at_ms > 0 && created_at_ms <= now_ms());
    assert_eq!(
        proposal,
        json!({
            "id": 1,
            "commitment_hex": hex(&open.commitment),
            "proposer": visitor.id(),
            "approvals": [admin_a.id(), admin_b.id()],
            "status": "executed",
            "created_at_ms": created_at_ms,
            "receiver": grants.id(),
            "amount_yocto": open.amount_yocto.to_string()
        })
    );
    check_failure(
        "a second execute",
        &execute(&visitor, &multisig, 1, &open).await?,
        "the proposal is already executed",
    );

    // Proposal 2: 0.02 NEAR to an account that does not exist. The transfer
    // fails, the NEAR comes back and the proposal is open again.
    let missing = format!("nobody.{}", root.id());
    let open_2 = opening(&multisig, 2, &missing, 2, SALT_2);
    check_success(
        "propose 2",
        &propose(&visitor, &multisig, 2, &open_2).await?,
        GAS_BUDGET,
    );
    for admin in [&admin_a, &admin_b] {
        check_success(
            "approve 2",
            &approve(admin, &multisig, 2).await?,
            GAS_BUDGET,
        );
    }
    let balance_before = multisig.view_account().await?.balance;
    let result = execute(&visitor, &multisig, 2, &open_2).await?;
    assert!(
        result.is_success(),
        "the callback must not fail: {result:#?}"
    );
    println!(
        "execute (transfer fails): {:.3} Tgas burnt",
        tgas(result.total_gas_burnt)
    );
    assert!(!result.clone().json::<bool>()?);
    assert_eq!(events(&result)[0]["event"], "execute_failed");
    let balance_after = multisig.view_account().await?.balance;
    assert!(
        balance_after.as_yoctonear() >= balance_before.as_yoctonear(),
        "the 0.02 NEAR came back: {balance_before} then {balance_after}"
    );
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 2 })).await?;
    assert_eq!(proposal["status"], "open");
    assert_eq!(proposal["approvals"], json!([admin_a.id(), admin_b.id()]));
    assert!(proposal.get("receiver").is_none());

    // Proposal 3: 2 NEAR more than the multisig had at its creation. No cap
    // stops it, but the runtime refuses a transfer above the balance in
    // `execute` itself. The call fails, its state change does not stay, and
    // the proposal stays open with its approvals.
    let above_balance = (MULTISIG_NEAR + 2) * 100;
    let open_3 = opening(&multisig, 3, grants.id().as_str(), above_balance, SALT_3);
    check_success(
        "propose 3",
        &propose(&visitor, &multisig, 3, &open_3).await?,
        GAS_BUDGET,
    );
    for admin in [&admin_a, &admin_b] {
        check_success(
            "approve 3",
            &approve(admin, &multisig, 3).await?,
            GAS_BUDGET,
        );
    }
    let grants_before = grants.view_account().await?.balance;
    let result = execute(&admin_b, &multisig, 3, &open_3).await?;
    check_failure(
        "execute above the balance",
        &result,
        "Exceeded the account balance.",
    );
    assert!(events(&result).is_empty(), "no callback runs");
    assert_eq!(grants.view_account().await?.balance, grants_before);
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 3 })).await?;
    assert_eq!(proposal["status"], "open");
    assert_eq!(proposal["approvals"], json!([admin_a.id(), admin_b.id()]));
    assert!(proposal.get("receiver").is_none());

    // Views.
    let list = view(
        &multisig,
        "get_proposals",
        json!({ "from_index": 0, "limit": 50 }),
    )
    .await?;
    let ids: Vec<u64> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, vec![3, 2, 1], "newest first");
    assert_eq!(
        view(&multisig, "get_proposal", json!({ "proposal_id": 9 })).await?,
        Value::Null
    );
    assert_eq!(
        view(&multisig, "next_proposal_id", json!({})).await?,
        json!(4)
    );

    // Only the contract calls the callback and `new`.
    let result = call(
        &admin_a,
        &multisig,
        "on_transfer",
        json!({ "proposal_id": 2, "receiver": missing, "amount_yocto": "1" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "on_transfer by an admin",
        &result,
        "Method on_transfer is private",
    );
    let result = call(
        &admin_a,
        &multisig,
        "new",
        init_args.clone(),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure("new by an admin", &result, "Method new is private");
    let result = multisig
        .call("new")
        .args_json(init_args)
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_failure(
        "a second new",
        &result,
        "The contract has already been initialized",
    );
    Ok(())
}
