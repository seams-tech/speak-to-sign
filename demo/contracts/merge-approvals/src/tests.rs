use super::*;
use near_sdk::serde_json::{self, json};
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const REPO: &str = "seams-tech/speak-to-sign";
const HEAD: &str = "9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8";
const HEAD_2: &str = "0123456789abcdef0123456789abcdef01234567";

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn set_caller(name: &str) {
    set_caller_at(name, 1_700_000_000_000);
}

fn set_caller_at(name: &str, timestamp_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("merges"))
            .predecessor_account_id(account(name))
            .signer_account_id(account(name))
            .block_timestamp(timestamp_ms * 1_000_000)
            .build()
    );
}

fn approve(
    contract: &mut MergeApprovals,
    who: &str,
    pull_request: u64,
    base: &str,
    head: &str,
) -> u64 {
    set_caller(who);
    contract.approve_merge(REPO.into(), pull_request, base.into(), head.into())
}

// --- approve_merge ---

#[test]
fn approve_merge_stores_the_approval_and_counts_ids_from_1() {
    set_caller_at("maya", 1_731_000_000_123);
    let mut contract = MergeApprovals::default();
    let id = contract.approve_merge(REPO.into(), 412, "main".into(), HEAD.into());
    assert_eq!(id, 1);
    assert_eq!(
        contract.get_approval(1),
        Some(ApprovalView {
            id: 1,
            repo: REPO.into(),
            pull_request: 412,
            base: "main".into(),
            head_commit: HEAD.into(),
            approver: account("maya"),
            approved_at_ms: 1_731_000_000_123,
        })
    );
    assert_eq!(approve(&mut contract, "kenji", 412, "main", HEAD), 2);
    assert_eq!(approve(&mut contract, "maya", 413, "main", HEAD), 3);
}

#[test]
fn approve_merge_logs_merge_approved() {
    let mut contract = MergeApprovals::default();
    approve(&mut contract, "maya", 412, "main", HEAD);
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert_eq!(
        logs[0],
        format!(
            r#"EVENT_JSON:{{"standard":"merge_approvals","version":"1.0.0","event":"merge_approved","data":[{{"approval_id":1,"repo":"{REPO}","pull_request":412,"base":"main","head_commit":"{HEAD}","approver":"maya.testnet"}}]}}"#
        )
    );
}

#[test]
fn a_repeat_keeps_the_id_and_updates_the_time() {
    let mut contract = MergeApprovals::default();
    set_caller_at("maya", 1_000);
    assert_eq!(
        contract.approve_merge(REPO.into(), 412, "main".into(), HEAD.into()),
        1
    );
    set_caller_at("maya", 2_000);
    assert_eq!(
        contract.approve_merge(REPO.into(), 412, "main".into(), HEAD.into()),
        1
    );
    assert_eq!(contract.get_approval(1).unwrap().approved_at_ms, 2_000);
    assert_eq!(contract.get_approvals(REPO.into(), 412).len(), 1);
    assert_eq!(contract.get_approval(2), None);
    // The repeat logs the event again, with the same id.
    let logged: serde_json::Value =
        serde_json::from_str(get_logs()[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(logged["data"][0]["approval_id"], 1);
}

#[test]
fn a_new_commit_or_base_is_a_new_approval() {
    let mut contract = MergeApprovals::default();
    assert_eq!(approve(&mut contract, "maya", 412, "main", HEAD), 1);
    assert_eq!(approve(&mut contract, "maya", 412, "main", HEAD_2), 2);
    assert_eq!(approve(&mut contract, "maya", 412, "develop", HEAD_2), 3);
    let commits: Vec<(String, String)> = contract
        .get_approvals(REPO.into(), 412)
        .into_iter()
        .map(|a| (a.base, a.head_commit))
        .collect();
    assert_eq!(
        commits,
        vec![
            ("develop".into(), HEAD_2.into()),
            ("main".into(), HEAD_2.into()),
            ("main".into(), HEAD.into())
        ]
    );
}

#[test]
fn the_shortest_and_longest_valid_values_pass() {
    set_caller("maya");
    let mut contract = MergeApprovals::default();
    let owner = "a".repeat(MAX_OWNER_CHARS);
    let name = format!("{}.x_y-z", "n".repeat(MAX_NAME_CHARS - 6));
    let repo = format!("{owner}/{name}");
    contract.approve_merge(
        repo.clone(),
        u64::MAX,
        "z".repeat(MAX_BASE_CHARS),
        HEAD.into(),
    );
    contract.approve_merge("a/b".into(), 1, "m".into(), HEAD.into());
    contract.approve_merge("my-org/My.Repo_2".into(), 7, "develop".into(), HEAD.into());
    assert_eq!(contract.get_approvals(repo, u64::MAX).len(), 1);
}

// --- input rules ---

fn approve_args(repo: &str, pull_request: u64, base: &str, head: &str) {
    set_caller("maya");
    MergeApprovals::default().approve_merge(repo.into(), pull_request, base.into(), head.into());
}

#[test]
#[should_panic(expected = "repo must be owner/name")]
fn repo_without_a_slash_fails() {
    approve_args("speak-to-sign", 1, "main", HEAD);
}

#[test]
#[should_panic(expected = "repo owner must be 1 to 39 letters, digits or inner hyphens")]
fn repo_owner_of_40_characters_fails() {
    approve_args(&format!("{}/repo", "a".repeat(40)), 1, "main", HEAD);
}

#[test]
#[should_panic(expected = "repo owner must be 1 to 39 letters, digits or inner hyphens")]
fn repo_owner_with_a_leading_hyphen_fails() {
    approve_args("-seams/repo", 1, "main", HEAD);
}

#[test]
#[should_panic(expected = "repo owner must be 1 to 39 letters, digits or inner hyphens")]
fn empty_repo_owner_fails() {
    approve_args("/repo", 1, "main", HEAD);
}

#[test]
#[should_panic(
    expected = "repo name must be 1 to 100 letters, digits, dots, underscores or hyphens"
)]
fn repo_name_with_a_second_slash_fails() {
    approve_args("seams/a/b", 1, "main", HEAD);
}

#[test]
#[should_panic(
    expected = "repo name must be 1 to 100 letters, digits, dots, underscores or hyphens"
)]
fn repo_name_of_101_characters_fails() {
    approve_args(&format!("seams/{}", "n".repeat(101)), 1, "main", HEAD);
}

#[test]
#[should_panic(
    expected = "repo name must be 1 to 100 letters, digits, dots, underscores or hyphens"
)]
fn repo_name_dot_dot_fails() {
    approve_args("seams/..", 1, "main", HEAD);
}

#[test]
#[should_panic(expected = "pull_request must be 1 or more")]
fn pull_request_0_fails() {
    approve_args(REPO, 0, "main", HEAD);
}

#[test]
#[should_panic(expected = "base must be 1 to 32 lowercase letters a-z")]
fn base_with_capitals_fails() {
    approve_args(REPO, 1, "Main", HEAD);
}

#[test]
#[should_panic(expected = "base must be 1 to 32 lowercase letters a-z")]
fn base_with_a_slash_fails() {
    approve_args(REPO, 1, "release/v1", HEAD);
}

#[test]
#[should_panic(expected = "base must be 1 to 32 lowercase letters a-z")]
fn empty_base_fails() {
    approve_args(REPO, 1, "", HEAD);
}

#[test]
#[should_panic(expected = "base must be 1 to 32 lowercase letters a-z")]
fn base_of_33_letters_fails() {
    approve_args(REPO, 1, &"m".repeat(33), HEAD);
}

#[test]
#[should_panic(expected = "head_commit must be 40 lowercase hex characters")]
fn short_head_commit_fails() {
    approve_args(REPO, 1, "main", "9c1e2fa");
}

#[test]
#[should_panic(expected = "head_commit must be 40 lowercase hex characters")]
fn uppercase_head_commit_fails() {
    approve_args(REPO, 1, "main", &HEAD.to_uppercase());
}

#[test]
#[should_panic(expected = "head_commit must be 40 lowercase hex characters")]
fn head_commit_with_a_non_hex_letter_fails() {
    approve_args(REPO, 1, "main", &format!("{}g", &HEAD[..39]));
}

// --- views ---

#[test]
fn get_approvals_returns_the_newest_50_of_the_pull_request() {
    let mut contract = MergeApprovals::default();
    for n in 1..=55u64 {
        let pull_request = if n % 10 == 0 { 2 } else { 1 };
        approve(&mut contract, &format!("r{n}"), pull_request, "main", HEAD);
    }
    let ids: Vec<u64> = contract
        .get_approvals(REPO.into(), 1)
        .iter()
        .map(|a| a.id)
        .collect();
    let expected: Vec<u64> = (1..=55u64).rev().filter(|n| n % 10 != 0).collect();
    assert_eq!(ids, expected);
    let ids: Vec<u64> = contract
        .get_approvals(REPO.into(), 2)
        .iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, vec![50, 40, 30, 20, 10]);

    approve(&mut contract, "r56", 1, "main", HEAD);
    let ids: Vec<u64> = contract
        .get_approvals(REPO.into(), 1)
        .iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids.len(), 50);
    assert_eq!(ids[0], 56);
    assert_eq!(
        *ids.last().unwrap(),
        2,
        "approval 1 is older than the newest 50"
    );
}

#[test]
fn approvals_are_per_repository() {
    let mut contract = MergeApprovals::default();
    approve(&mut contract, "maya", 412, "main", HEAD);
    set_caller("maya");
    contract.approve_merge("other/repo".into(), 412, "main".into(), HEAD.into());
    assert_eq!(contract.get_approvals(REPO.into(), 412).len(), 1);
    assert_eq!(contract.get_approvals("other/repo".into(), 412)[0].id, 2);
}

#[test]
fn unknown_ids_in_views_give_empty_results() {
    let mut contract = MergeApprovals::default();
    approve(&mut contract, "maya", 412, "main", HEAD);
    assert_eq!(contract.get_approvals(REPO.into(), 999), vec![]);
    assert_eq!(contract.get_approvals("nobody/none".into(), 412), vec![]);
    assert_eq!(contract.get_approval(0), None);
    assert_eq!(contract.get_approval(2), None);
}

#[test]
fn approval_view_json_uses_numbers() {
    let mut contract = MergeApprovals::default();
    approve(&mut contract, "maya", 412, "main", HEAD);
    let value = serde_json::to_value(contract.get_approval(1).unwrap()).unwrap();
    assert_eq!(
        value,
        json!({
            "id": 1,
            "repo": REPO,
            "pull_request": 412,
            "base": "main",
            "head_commit": HEAD,
            "approver": "maya.testnet",
            "approved_at_ms": 1_700_000_000_000u64
        })
    );
}
