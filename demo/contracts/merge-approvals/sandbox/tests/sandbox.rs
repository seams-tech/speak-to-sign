//! Deploys `res/merge_approvals.wasm` to a local nearcore sandbox and calls it
//! the way the Seams Wallet does: 30 Tgas attached, 0 deposit.
//!
//! Run `./build.sh` first, or set `MERGE_APPROVALS_WASM` to a WASM path.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

/// The gas that the Seams Wallet attaches to each call.
const WALLET_GAS: Gas = Gas::from_tgas(30);
/// `approve_merge` must burn less than this.
const GAS_BUDGET: Gas = Gas::from_tgas(10);

const REPO: &str = "seams-tech/speak-to-sign";
const HEAD: &str = "9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8";

fn wasm() -> anyhow::Result<Vec<u8>> {
    let path = std::env::var("MERGE_APPROVALS_WASM").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../res/merge_approvals.wasm").to_string()
    });
    std::fs::read(&path)
        .map_err(|e| anyhow::anyhow!("cannot read {path}: {e}. Run ./build.sh first."))
}

async fn approve(
    approver: &Account,
    contract: &Contract,
    repo: &str,
    pull_request: u64,
    base: &str,
    head: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(approver
        .call(contract.id(), "approve_merge")
        .args_json(json!({ "repo": repo, "pull_request": pull_request, "base": base, "head_commit": head }))
        .gas(WALLET_GAS)
        .transact()
        .await?)
}

fn check_success(label: &str, result: &ExecutionFinalResult) {
    assert!(result.is_success(), "{label} failed: {result:#?}");
    let burnt = result.total_gas_burnt;
    println!("{label}: {:.3} Tgas burnt", burnt.as_gas() as f64 / 1e12);
    assert!(
        burnt < GAS_BUDGET,
        "{label} burnt {burnt}, more than the budget of {GAS_BUDGET}"
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

async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

#[tokio::test]
async fn merge_approvals_in_the_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm()?).await?;
    let maya = worker.dev_create_account().await?;
    let kenji = worker.dev_create_account().await?;

    // The longest repository, as the Wallet sends it.
    let long_repo = format!("{}/{}", "a".repeat(39), "n".repeat(100));
    let storage_before = contract.view_account().await?.storage_usage;
    let result = approve(&maya, &contract, &long_repo, 412, "main", HEAD).await?;
    check_success("approve_merge (longest repo)", &result);
    println!(
        "largest approval: {} bytes of contract storage",
        contract.view_account().await?.storage_usage - storage_before
    );
    let logs = result.logs();
    assert_eq!(logs.len(), 1);
    let event: Value = serde_json::from_str(logs[0].strip_prefix("EVENT_JSON:").unwrap())?;
    assert_eq!(
        event,
        json!({
            "standard": "merge_approvals",
            "version": "1.0.0",
            "event": "merge_approved",
            "data": [{
                "approval_id": 1,
                "repo": long_repo,
                "pull_request": 412,
                "base": "main",
                "head_commit": HEAD,
                "approver": maya.id()
            }]
        })
    );
    assert_eq!(
        result.json::<Value>()?,
        json!(1),
        "the first approval id is the JSON number 1"
    );

    let result = approve(&maya, &contract, REPO, 412, "main", HEAD).await?;
    check_success("approve_merge", &result);
    assert_eq!(result.json::<u64>()?, 2);
    let result = approve(&maya, &contract, REPO, 412, "main", HEAD).await?;
    check_success("approve_merge (repeat)", &result);
    assert_eq!(result.json::<u64>()?, 2, "a repeat keeps its id");
    let result = approve(&kenji, &contract, REPO, 412, "main", HEAD).await?;
    assert_eq!(result.json::<u64>()?, 3);

    // Rules that fail.
    let result = approve(&maya, &contract, "speak-to-sign", 412, "main", HEAD).await?;
    check_failure("repo without owner", &result, "repo must be owner/name");
    let result = approve(&maya, &contract, REPO, 0, "main", HEAD).await?;
    check_failure("pull request 0", &result, "pull_request must be 1 or more");
    let result = approve(&maya, &contract, REPO, 412, "release/v1", HEAD).await?;
    check_failure(
        "base with a slash",
        &result,
        "base must be 1 to 32 lowercase letters a-z",
    );
    let result = approve(&maya, &contract, REPO, 412, "main", "9c1e2fa").await?;
    check_failure(
        "short commit",
        &result,
        "head_commit must be 40 lowercase hex characters",
    );
    let result = maya
        .call(contract.id(), "approve_merge")
        .args_json(
            json!({ "repo": REPO, "pull_request": 412, "base": "main", "head_commit": HEAD }),
        )
        .deposit(NearToken::from_yoctonear(1))
        .gas(WALLET_GAS)
        .transact()
        .await?;
    check_failure(
        "approve_merge with a deposit",
        &result,
        "doesn't accept deposit",
    );

    // Views, as raw JSON.
    let approvals = view(
        &contract,
        "get_approvals",
        json!({ "repo": REPO, "pull_request": 412 }),
    )
    .await?;
    let approvals = approvals.as_array().expect("an array");
    assert_eq!(approvals.len(), 2);
    assert_eq!(approvals[0]["id"], json!(3), "newest first");
    assert_eq!(approvals[0]["approver"], json!(kenji.id()));
    assert_eq!(approvals[1]["id"], json!(2));
    let mut keys: Vec<&str> = approvals[1]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        vec![
            "approved_at_ms",
            "approver",
            "base",
            "head_commit",
            "id",
            "pull_request",
            "repo"
        ]
    );
    assert!(approvals[1]["approved_at_ms"].as_u64().unwrap() > 0);
    assert_eq!(
        view(&contract, "get_approval", json!({ "approval_id": 99 })).await?,
        Value::Null
    );
    assert_eq!(
        view(
            &contract,
            "get_approvals",
            json!({ "repo": REPO, "pull_request": 1 })
        )
        .await?,
        json!([])
    );
    Ok(())
}
