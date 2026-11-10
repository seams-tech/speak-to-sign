//! Deploys `res/voice_multisig.wasm` to a local nearcore sandbox and runs
//! two proposals the way the demo page does, with 30 Tgas and 0 deposit:
//! one whose transfer arrives, and one whose receiver does not exist.
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

/// The gas that the Seams Wallet attaches to each call.
const WALLET_GAS: Gas = Gas::from_tgas(30);
/// `propose` and `confirm` must burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);

const VERDICT_DOMAIN: &[u8] = b"seams:outlayer:voice-verdict:v2";
const SALT: [u8; 32] = [0x5a; 32];
const SALT_2: [u8; 32] = [0x6b; 32];

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
    near: u128,
    salt: [u8; 32],
) -> Opening {
    let amount_yocto = near * 10u128.pow(24);
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

/// A signed accept verdict of `member` for this proposal, in the
/// verifier's field order. Returns the JSON and the signature.
fn verdict(
    member: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
    expires_at_ms: u64,
) -> (String, String) {
    let digest = multisig_approval_digest(
        Network::Testnet,
        &near(member),
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
    member: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
) -> (String, String) {
    verdict(
        member,
        multisig,
        proposal_id,
        commitment,
        now_ms() + 600_000,
    )
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

async fn propose(
    who: &Account,
    multisig: &Contract,
    id: u64,
    open: &Opening,
) -> anyhow::Result<ExecutionFinalResult> {
    let (verdict_json, signature_b64) = fresh(who, multisig, id, &open.commitment);
    call(
        who,
        multisig,
        "propose",
        json!({ "proposal_id": id, "commitment_hex": hex(&open.commitment), "verdict_json": verdict_json, "signature_b64": signature_b64 }),
        NearToken::from_yoctonear(0),
    )
    .await
}

async fn confirm(
    who: &Account,
    multisig: &Contract,
    id: u64,
    open: &Opening,
) -> anyhow::Result<ExecutionFinalResult> {
    let (verdict_json, signature_b64) = fresh(who, multisig, id, &open.commitment);
    call(
        who,
        multisig,
        "confirm",
        json!({ "proposal_id": id, "verdict_json": verdict_json, "signature_b64": signature_b64 }),
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

#[tokio::test]
async fn voice_multisig_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mut members = Vec::new();
    for name in ["alice", "bob", "carol"] {
        let account = root
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(20))
            .transact()
            .await?
            .into_result()?;
        members.push(account);
    }
    let (alice, bob, carol) = (&members[0], &members[1], &members[2]);
    let grants = root
        .create_subaccount("grants")
        .initial_balance(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    let team = root
        .create_subaccount("team")
        .initial_balance(NearToken::from_near(50))
        .transact()
        .await?
        .into_result()?;
    let multisig = team.deploy(&wasm()?).await?.into_result()?;
    let verifier_public_key = format!(
        "ed25519:{}",
        bs58::encode(verifier().verifying_key().as_bytes()).into_string()
    );
    let init = multisig
        .call("new")
        .args_json(json!({
            "members": [alice.id(), bob.id(), carol.id()],
            "threshold": 2,
            "verifier_public_key": verifier_public_key
        }))
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_success("new", &init, GAS_BUDGET);
    assert_eq!(
        view(&multisig, "next_proposal_id", json!({})).await?,
        json!(1)
    );
    assert_eq!(
        view(&multisig, "get_config", json!({})).await?,
        json!({
            "members": [alice.id(), bob.id(), carol.id()],
            "threshold": 2,
            "verifier_public_key": verifier_public_key
        })
    );

    // Proposal 1: 25 NEAR to grants, which arrives.
    let open = opening(&multisig, 1, grants.id().as_str(), 25, SALT);
    let storage_before = multisig.view_account().await?.storage_usage;
    let result = propose(alice, &multisig, 1, &open).await?;
    check_success("propose", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<u64>()?, 1);
    assert_eq!(events(&result)[0]["event"], "proposed");

    // Rules that fail on the real chain.
    let (verdict_json, signature_b64) = fresh(alice, &multisig, 1, &open.commitment);
    let result = call(
        bob,
        &multisig,
        "confirm",
        json!({ "proposal_id": 1, "verdict_json": verdict_json, "signature_b64": signature_b64 }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "confirm with alice's verdict",
        &result,
        "the verdict is for another request",
    );
    let (verdict_json, _) = fresh(bob, &multisig, 1, &open.commitment);
    let (_, other_signature) = fresh(carol, &multisig, 1, &open.commitment);
    let result = call(
        bob,
        &multisig,
        "confirm",
        json!({ "proposal_id": 1, "verdict_json": verdict_json, "signature_b64": other_signature }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "confirm with a wrong signature",
        &result,
        "the verdict signature does not match the verifier key",
    );
    let (verdict_json, signature_b64) =
        verdict(bob, &multisig, 1, &open.commitment, now_ms() - 60_000);
    let result = call(
        bob,
        &multisig,
        "confirm",
        json!({ "proposal_id": 1, "verdict_json": verdict_json, "signature_b64": signature_b64 }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "confirm with an expired verdict",
        &result,
        "the verdict has expired",
    );
    let result = execute(alice, &multisig, 1, &open).await?;
    check_failure(
        "execute before the threshold",
        &result,
        "the proposal has 1 of 2 confirmations",
    );

    let result = confirm(bob, &multisig, 1, &open).await?;
    check_success("confirm", &result, GAS_BUDGET);
    assert_eq!(result.json::<u32>()?, 2);
    println!(
        "one proposal with 2 confirmations: {} bytes of contract storage",
        multisig.view_account().await?.storage_usage - storage_before
    );
    let result = execute(carol, &multisig, 1, &open).await?;
    check_failure(
        "execute by carol",
        &result,
        "only a member who confirmed the proposal can execute it",
    );
    let wrong_salt = Opening {
        salt: SALT_2,
        ..opening(&multisig, 1, grants.id().as_str(), 25, SALT)
    };
    let result = execute(bob, &multisig, 1, &wrong_salt).await?;
    check_failure(
        "execute with a wrong salt",
        &result,
        "receiver, amount_yocto and salt_hex do not match the commitment",
    );

    // Deposits are refused on each change method.
    let one_yocto = NearToken::from_yoctonear(1);
    let (verdict_json, signature_b64) = fresh(carol, &multisig, 1, &open.commitment);
    let deposit_calls = [
        (
            "propose",
            json!({ "proposal_id": 2, "commitment_hex": hex(&open.commitment), "verdict_json": verdict_json, "signature_b64": signature_b64 }),
        ),
        (
            "confirm",
            json!({ "proposal_id": 1, "verdict_json": verdict_json, "signature_b64": signature_b64 }),
        ),
        ("execute", execute_args(1, &open)),
    ];
    for (method, args) in deposit_calls {
        let result = call(carol, &multisig, method, args, one_yocto).await?;
        check_failure(
            &format!("{method} with a deposit"),
            &result,
            &format!("Method {method} doesn't accept deposit"),
        );
    }

    let grants_before = grants.view_account().await?.balance;
    let result = execute(bob, &multisig, 1, &open).await?;
    check_success("execute (transfer arrives)", &result, WALLET_GAS);
    assert!(result.clone().json::<bool>()?);
    let grants_after = grants.view_account().await?.balance;
    assert_eq!(
        grants_after.as_yoctonear() - grants_before.as_yoctonear(),
        open.amount_yocto,
        "grants receives exactly 25 NEAR"
    );
    assert_eq!(
        events(&result),
        vec![json!({
            "standard": "voice_multisig",
            "version": "1.0.0",
            "event": "executed",
            "data": [{ "proposal_id": 1, "receiver": grants.id(), "amount_yocto": open.amount_yocto.to_string() }]
        })]
    );
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 1 })).await?;
    assert_eq!(
        proposal,
        json!({
            "id": 1,
            "commitment_hex": hex(&open.commitment),
            "proposer": alice.id(),
            "confirmations": [alice.id(), bob.id()],
            "status": "executed",
            "receiver": grants.id(),
            "amount_yocto": open.amount_yocto.to_string()
        })
    );
    let result = execute(alice, &multisig, 1, &open).await?;
    check_failure(
        "a second execute",
        &result,
        "the proposal is already executed",
    );

    // Proposal 2: 3 NEAR to an account that does not exist. The transfer
    // fails, the NEAR comes back and the proposal is open again.
    let missing = format!("nobody.{}", root.id());
    let open_2 = opening(&multisig, 2, &missing, 3, SALT_2);
    check_success(
        "propose 2",
        &propose(carol, &multisig, 2, &open_2).await?,
        GAS_BUDGET,
    );
    check_success(
        "confirm 2",
        &confirm(alice, &multisig, 2, &open_2).await?,
        GAS_BUDGET,
    );
    let team_before = multisig.view_account().await?.balance;
    let result = execute(alice, &multisig, 2, &open_2).await?;
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
    let team_after = multisig.view_account().await?.balance;
    assert!(
        team_after.as_yoctonear() >= team_before.as_yoctonear(),
        "the 3 NEAR came back: {team_before} then {team_after}"
    );
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 2 })).await?;
    assert_eq!(proposal["status"], "open");
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
    assert_eq!(ids, vec![2, 1], "newest first");
    assert_eq!(
        view(&multisig, "get_proposal", json!({ "proposal_id": 9 })).await?,
        Value::Null
    );
    assert_eq!(
        view(&multisig, "next_proposal_id", json!({})).await?,
        json!(3)
    );

    // Only the contract calls the callback and `new`.
    let result = call(
        alice,
        &multisig,
        "on_transfer",
        json!({ "proposal_id": 2, "receiver": missing, "amount_yocto": "1" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "on_transfer by a member",
        &result,
        "Method on_transfer is private",
    );
    let result = call(
        alice,
        &multisig,
        "new",
        json!({ "members": [alice.id(), bob.id()], "threshold": 1, "verifier_public_key": verifier_public_key }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure("new by a member", &result, "Method new is private");
    let result = multisig
        .call("new")
        .args_json(json!({ "members": [alice.id(), bob.id()], "threshold": 1, "verifier_public_key": verifier_public_key }))
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
