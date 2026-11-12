//! Deploys `res/voice_multisig.wasm` to a local nearcore sandbox with 3
//! signers and a threshold of 2, and runs three proposals with 30 Tgas and 0
//! deposit. Each approval is a signed voice verdict: one whose transfer arrives, one
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

/// The gas that the Seams Wallet attaches to each call.
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

fn request_digest(
    owner: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
) -> [u8; 32] {
    multisig_approval_digest(
        Network::Testnet,
        &near(owner),
        &NearAccount::new(multisig.id().as_str()).unwrap(),
        proposal_id,
        commitment,
    )
}

/// A signed accept verdict of `owner` for this proposal, in the verifier's
/// field order. Its recording is new: the audio digest is the SHA-256 of
/// the request digest and the expiry. Returns the JSON and the signature.
fn verdict(
    owner: &Account,
    multisig: &Contract,
    proposal_id: u64,
    commitment: &[u8; 32],
    expires_at_ms: u64,
) -> (String, String) {
    let digest = request_digest(owner, multisig, proposal_id, commitment);
    let mut hasher = Sha256::new();
    hasher.update(digest);
    hasher.update(expires_at_ms.to_le_bytes());
    let audio: [u8; 32] = hasher.finalize().into();
    verdict_with_audio(&digest, expires_at_ms, &audio)
}

/// A signed accept verdict for `digest` from the recording `audio`.
fn verdict_with_audio(digest: &[u8; 32], expires_at_ms: u64, audio: &[u8; 32]) -> (String, String) {
    let json = format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.13.0","request_digest":"{}","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"{}","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"approve proposal one"}}"#,
        URL_SAFE_NO_PAD.encode(digest),
        URL_SAFE_NO_PAD.encode(audio)
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

fn approve_args(id: u64, verdict: (String, String)) -> Value {
    json!({
        "proposal_id": id,
        "verdict_json": verdict.0,
        "signature_b64": verdict.1
    })
}

/// `who` approves with a fresh verdict of its own for `commitment`.
async fn approve(
    who: &Account,
    multisig: &Contract,
    id: u64,
    commitment: &[u8; 32],
) -> anyhow::Result<ExecutionFinalResult> {
    let args = approve_args(id, fresh(who, multisig, id, commitment));
    call(who, multisig, "approve", args, NearToken::from_yoctonear(0)).await
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

/// The signers and the verifier key of the tests, as `new` takes them.
fn init_args(signers: &[&Account], threshold: u32) -> Value {
    let verifier_public_key = format!(
        "ed25519:{}",
        bs58::encode(verifier().verifying_key().as_bytes()).into_string()
    );
    let signers: Vec<_> = signers.iter().map(|signer| signer.id()).collect();
    json!({
        "signers": signers,
        "threshold": threshold,
        "verifier_public_key": verifier_public_key
    })
}

#[tokio::test]
async fn voice_multisig_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let alice = subaccount(&root, "alice", 5).await?;
    let bob = subaccount(&root, "bob", 5).await?;
    let carol = subaccount(&root, "carol", 5).await?;
    let stranger = subaccount(&root, "stranger", 5).await?;
    let grants = subaccount(&root, "grants", 1).await?;
    let multisig_account = subaccount(&root, "multisig", MULTISIG_NEAR).await?;
    let multisig = multisig_account.deploy(&wasm()?).await?.into_result()?;
    let init_args = init_args(&[&alice, &bob, &carol], 2);
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
        "propose by a non-signer",
        &propose(&stranger, &multisig, 1, &open).await?,
        "the caller is not a signer",
    );
    let (verdict_json, _) = fresh(&alice, &multisig, 1, &open.commitment);
    let (_, other_signature) = fresh(&stranger, &multisig, 1, &open.commitment);
    let result = call(
        &alice,
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
    let expired = verdict(&alice, &multisig, 1, &open.commitment, now_ms() - 60_000);
    let result = call(
        &alice,
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
        &alice,
        &multisig,
        "propose",
        propose_args(1, &open, fresh(&bob, &multisig, 1, &open.commitment)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "propose with the verdict of another signer",
        &result,
        "the verdict is for another request",
    );

    let storage_before = multisig.view_account().await?.storage_usage;
    let result = propose(&alice, &multisig, 1, &open).await?;
    check_success("propose", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<u64>()?, 1);
    assert_eq!(events(&result)[0]["event"], "proposed");
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 1 })).await?;
    assert_eq!(
        proposal["approvals"],
        json!([alice.id()]),
        "the proposer's verdict is the first approval"
    );

    // Approve and execute rules that fail on the real chain.
    let result = call(
        &bob,
        &multisig,
        "approve",
        json!({ "proposal_id": 1 }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "a plain approve without a verdict",
        &result,
        "Failed to deserialize input from JSON",
    );
    check_failure(
        "approve by a non-signer",
        &approve(&stranger, &multisig, 1, &open.commitment).await?,
        "the caller is not a signer",
    );
    let result = call(
        &bob,
        &multisig,
        "approve",
        approve_args(1, fresh(&stranger, &multisig, 1, &open.commitment)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "approve with the verdict of a non-signer",
        &result,
        "the verdict is for another request",
    );
    let other = opening(&multisig, 1, stranger.id().as_str(), 1, SALT);
    check_failure(
        "approve with a verdict for another commitment",
        &approve(&bob, &multisig, 1, &other.commitment).await?,
        "the verdict is for another request",
    );
    check_failure(
        "approve by the proposer",
        &approve(&alice, &multisig, 1, &open.commitment).await?,
        "this signer already approved the proposal",
    );
    check_failure(
        "execute below the threshold",
        &execute(&alice, &multisig, 1, &open).await?,
        "the proposal has 1 of 2 approvals",
    );
    let bob_verdict = fresh(&bob, &multisig, 1, &open.commitment);
    let result = call(
        &bob,
        &multisig,
        "approve",
        approve_args(1, bob_verdict.clone()),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_success("approve (2 of 2)", &result, GAS_BUDGET);
    assert_eq!(result.clone().json::<u32>()?, 2);
    assert_eq!(
        events(&result),
        vec![json!({
            "standard": "voice_multisig",
            "version": "3.0.0",
            "event": "approved",
            "data": [{ "proposal_id": 1, "signer": bob.id(), "approvals": 2 }]
        })]
    );
    let result = call(
        &bob,
        &multisig,
        "approve",
        approve_args(1, bob_verdict),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "the same verdict twice",
        &result,
        "this signer already approved the proposal",
    );
    // Carol approves too, from a recording that the next check reuses.
    let shared_audio = [0x33; 32];
    let carol_digest = request_digest(&carol, &multisig, 1, &open.commitment);
    let first = call(
        &carol,
        &multisig,
        "approve",
        approve_args(1, verdict_with_audio(&carol_digest, now_ms() + 600_000, &shared_audio)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_success("approve (3 of 3 signers)", &first, GAS_BUDGET);
    println!(
        "one proposal with 3 voice approvals: {} bytes of contract storage",
        multisig.view_account().await?.storage_usage - storage_before
    );

    // Proposal 2 needs the recording of a new approval: the recording of
    // Carol's approval of proposal 1 is used.
    let missing = format!("nobody.{}", root.id());
    let open_2 = opening(&multisig, 2, &missing, 2, SALT_2);
    check_success(
        "propose 2",
        &propose(&alice, &multisig, 2, &open_2).await?,
        GAS_BUDGET,
    );
    let carol_digest_2 = request_digest(&carol, &multisig, 2, &open_2.commitment);
    let result = call(
        &carol,
        &multisig,
        "approve",
        approve_args(2, verdict_with_audio(&carol_digest_2, now_ms() + 600_000, &shared_audio)),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "approve with a recording that counted",
        &result,
        "this recording already counted",
    );

    check_failure(
        "execute by a non-signer",
        &execute(&stranger, &multisig, 1, &open).await?,
        "the caller is not a signer",
    );
    let wrong_salt = Opening {
        salt: SALT_2,
        ..opening(&multisig, 1, grants.id().as_str(), 1, SALT)
    };
    check_failure(
        "execute with a wrong salt",
        &execute(&bob, &multisig, 1, &wrong_salt).await?,
        "receiver, amount_yocto and salt_hex do not match the commitment",
    );

    // Deposits are refused on each change method.
    let one_yocto = NearToken::from_yoctonear(1);
    let deposit_calls = [
        (
            "propose",
            propose_args(3, &open, fresh(&bob, &multisig, 3, &open.commitment)),
        ),
        (
            "approve",
            approve_args(2, fresh(&bob, &multisig, 2, &open_2.commitment)),
        ),
        ("execute", execute_args(1, &open)),
    ];
    for (method, args) in deposit_calls {
        let result = call(&bob, &multisig, method, args, one_yocto).await?;
        check_failure(
            &format!("{method} with a deposit"),
            &result,
            &format!("Method {method} doesn't accept deposit"),
        );
    }

    let grants_before = grants.view_account().await?.balance;
    let result = execute(&bob, &multisig, 1, &open).await?;
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
            "version": "3.0.0",
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
            "proposer": alice.id(),
            "approvals": [alice.id(), bob.id(), carol.id()],
            "status": "executed",
            "created_at_ms": created_at_ms,
            "receiver": grants.id(),
            "amount_yocto": open.amount_yocto.to_string()
        })
    );
    check_failure(
        "a second execute",
        &execute(&alice, &multisig, 1, &open).await?,
        "the proposal is already executed",
    );

    // Proposal 2: 0.02 NEAR to an account that does not exist. The transfer
    // fails, the NEAR comes back and the proposal is open again.
    let result = approve(&bob, &multisig, 2, &open_2.commitment).await?;
    check_success("approve 2", &result, GAS_BUDGET);
    let balance_before = multisig.view_account().await?.balance;
    let result = execute(&alice, &multisig, 2, &open_2).await?;
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
    assert_eq!(proposal["approvals"], json!([alice.id(), bob.id()]));
    assert!(proposal.get("receiver").is_none());

    // Proposal 3: 2 NEAR more than the multisig had at its creation. No cap
    // stops it, but the runtime refuses a transfer above the balance in
    // `execute` itself. The call fails, its state change does not stay, and
    // the proposal stays open with its approvals.
    let above_balance = (MULTISIG_NEAR + 2) * 100;
    let open_3 = opening(&multisig, 3, grants.id().as_str(), above_balance, SALT_3);
    check_success(
        "propose 3",
        &propose(&carol, &multisig, 3, &open_3).await?,
        GAS_BUDGET,
    );
    check_success(
        "approve 3",
        &approve(&alice, &multisig, 3, &open_3.commitment).await?,
        GAS_BUDGET,
    );
    let grants_before = grants.view_account().await?.balance;
    let result = execute(&bob, &multisig, 3, &open_3).await?;
    check_failure(
        "execute above the balance",
        &result,
        "Exceeded the account balance.",
    );
    assert!(events(&result).is_empty(), "no callback runs");
    assert_eq!(grants.view_account().await?.balance, grants_before);
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 3 })).await?;
    assert_eq!(proposal["status"], "open");
    assert_eq!(proposal["approvals"], json!([carol.id(), alice.id()]));
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

    // Only the contract calls the callback and `new`. No method changes
    // the signers.
    let result = call(
        &alice,
        &multisig,
        "on_transfer",
        json!({ "proposal_id": 2, "receiver": missing, "amount_yocto": "1" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure(
        "on_transfer by a signer",
        &result,
        "Method on_transfer is private",
    );
    let result = call(
        &alice,
        &multisig,
        "new",
        init_args.clone(),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_failure("new by a signer", &result, "Method new is private");
    let result = multisig
        .call("new")
        .args_json(init_args.clone())
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_failure(
        "a second new",
        &result,
        "The contract has already been initialized",
    );
    assert_eq!(view(&multisig, "get_config", json!({})).await?, init_args);
    Ok(())
}

/// The community-notes WASM: `COMMUNITY_NOTES_WASM`, or the release build of
/// `../community-notes` (run its `./build.sh` first).
fn notes_wasm() -> anyhow::Result<Vec<u8>> {
    let path = std::env::var("COMMUNITY_NOTES_WASM").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../community-notes/res/community_notes.wasm").to_string()
    });
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ../community-notes/build.sh first."))
}

/// A multisig of two signers, both needed, hides a note of the
/// community-notes contract.
#[tokio::test]
async fn hide_a_note_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let alice = subaccount(&root, "alice", 5).await?;
    let bob = subaccount(&root, "bob", 5).await?;
    let author = subaccount(&root, "author", 5).await?;
    let multisig_account = subaccount(&root, "multisig", MULTISIG_NEAR).await?;
    let notes_account = subaccount(&root, "notes", 10).await?;
    let multisig = multisig_account.deploy(&wasm()?).await?.into_result()?;
    let notes = notes_account.deploy(&notes_wasm()?).await?.into_result()?;
    let init = multisig
        .call("new")
        .args_json(init_args(&[&alice, &bob], 2))
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_success("new", &init, GAS_BUDGET);

    // This test is about the multisig, so a note needs no voice verdict.
    notes.call("set_voice_required").args_json(json!({ "required": false })).transact().await?.into_result()?;
    let add = call(
        &author,
        &notes,
        "add_note",
        json!({ "post_id": 900, "text": "Call 555-0142 now to win 100 NEAR.", "summary": "Win 100 NEAR" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    check_success("add_note", &add, GAS_BUDGET);

    // The contract accounts link the two contracts.
    let linked = notes.call("set_moderator").args_json(json!({ "account_id": multisig.id() })).transact().await?;
    assert!(linked.is_success(), "set_moderator failed: {linked:#?}");
    let linked = multisig.call("set_notes_contract").args_json(json!({ "account_id": notes.id() })).transact().await?;
    assert!(linked.is_success(), "set_notes_contract failed: {linked:#?}");
    assert_eq!(view(&multisig, "get_notes_contract", json!({})).await?, json!(notes.id()));
    let result = call(&alice, &multisig, "set_notes_contract", json!({ "account_id": alice.id() }), NearToken::from_yoctonear(0)).await?;
    check_failure("set_notes_contract by a signer", &result, "is private");

    // Proposal 1: hide note 1.
    let hide = ProposalV1::HideNote { note_id: 1 };
    let commitment = multisig_commitment(&NearAccount::new(multisig.id().as_str()).unwrap(), 1, &hide, &SALT);
    let hide_open = Opening { commitment, receiver: String::new(), amount_yocto: 0, salt: SALT };
    check_success("alice proposes a hide", &propose(&alice, &multisig, 1, &hide_open).await?, GAS_BUDGET);

    let hide_args = |proposal_id: u64, note_id: u64, salt: &[u8; 32]| {
        json!({ "proposal_id": proposal_id, "note_id": note_id, "salt_hex": hex(salt) })
    };
    let execute_hide = |args: Value| {
        alice
            .call(multisig.id(), "execute")
            .args_json(args)
            .gas(Gas::from_tgas(50))
            .transact()
    };
    check_failure(
        "execute the hide below the threshold",
        &execute_hide(hide_args(1, 1, &SALT)).await?,
        "the proposal has 1 of 2 approvals",
    );
    check_success("bob approves by voice", &approve(&bob, &multisig, 1, &commitment).await?, GAS_BUDGET);
    check_failure(
        "execute with another note",
        &execute_hide(hide_args(1, 2, &SALT)).await?,
        "note_id and salt_hex do not match the commitment",
    );
    let result = execute_hide(hide_args(1, 1, &SALT)).await?;
    assert!(result.is_success(), "execute the hide failed: {result:#?}");
    println!("execute a hide: {:.3} Tgas burnt in all", tgas(result.total_gas_burnt));
    let logs = result.logs().join("\n");
    assert_eq!(result.json::<Value>()?, json!(true), "on_hide returns true");

    let note = view(&notes, "get_note", json!({ "note_id": 1 })).await?;
    assert_eq!((&note["text"], &note["summary"], &note["hidden"]), (&json!(""), &json!(""), &json!(true)));
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 1 })).await?;
    assert_eq!((&proposal["status"], &proposal["note_id"]), (&json!("executed"), &json!(1)));
    assert!(logs.contains(r#""event":"note_hidden""#), "the notes contract logs note_hidden: {logs}");
    assert!(logs.contains(r#""event":"executed","data":[{"proposal_id":1,"note_id":1}]"#), "{logs}");

    // A second proposal to hide the same note fails at the notes contract,
    // and the proposal opens again.
    let commitment = multisig_commitment(&NearAccount::new(multisig.id().as_str()).unwrap(), 2, &hide, &SALT_2);
    let again = Opening { commitment, receiver: String::new(), amount_yocto: 0, salt: SALT_2 };
    check_success("bob proposes the same hide", &propose(&bob, &multisig, 2, &again).await?, GAS_BUDGET);
    check_success("alice approves by voice", &approve(&alice, &multisig, 2, &commitment).await?, GAS_BUDGET);
    let result = execute_hide(hide_args(2, 1, &SALT_2)).await?;
    assert_eq!(result.json::<Value>()?, json!(false), "on_hide returns false");
    let proposal = view(&multisig, "get_proposal", json!({ "proposal_id": 2 })).await?;
    assert_eq!(proposal["status"], json!("open"));
    Ok(())
}
