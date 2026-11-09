//! Spoken PR merge approvals for the Speak-to-Sign demo.
//!
//! A maintainer says "merge pull request four one two into main". The
//! verifier checks the voice and the words, and the Seams Wallet signs
//! `approve_merge` from the maintainer's own account with 0 deposit. This
//! contract records that approval of one commit. It does not merge anything:
//! the record is the signed merge message.
//!
//! The method names and JSON shapes are fixed: Seams Wallet core and the demo
//! page use them. See `README.md`.

use near_sdk::serde::Serialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, env, near};

/// The longest repository owner (a GitHub user or organization name).
pub const MAX_OWNER_CHARS: usize = 39;
/// The longest repository name.
pub const MAX_NAME_CHARS: usize = 100;
/// The longest base branch. It is spoken, so it is one lowercase word.
pub const MAX_BASE_CHARS: usize = 32;
/// A git commit id: SHA-1 as lowercase hex.
pub const HEAD_COMMIT_CHARS: usize = 40;
/// `get_approvals` returns at most this many approvals.
pub const MAX_APPROVALS_PER_VIEW: u32 = 50;

const EVENT_STANDARD: &str = "merge_approvals";
const EVENT_VERSION: &str = "1.0.0";

/// An approval as the contract stores it.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Approval {
    pub repo: String,
    pub pull_request: u64,
    pub base: String,
    pub head_commit: String,
    pub approver: AccountId,
    pub approved_at_ms: u64,
}

impl Approval {
    fn view(&self, id: u64) -> ApprovalView {
        ApprovalView {
            id,
            repo: self.repo.clone(),
            pull_request: self.pull_request,
            base: self.base.clone(),
            head_commit: self.head_commit.clone(),
            approver: self.approver.clone(),
            approved_at_ms: self.approved_at_ms,
        }
    }
}

/// An approval as the view methods return it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalView {
    pub id: u64,
    pub repo: String,
    pub pull_request: u64,
    pub base: String,
    pub head_commit: String,
    pub approver: AccountId,
    pub approved_at_ms: u64,
}

/// What one approval is about: the same approver, pull request, base and commit.
type ApprovalKey = (String, u64, String, String, AccountId);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Approvals,
    ByKey,
    PullRequestCounts,
    PullRequestApprovals,
}

#[near(contract_state)]
pub struct MergeApprovals {
    /// The id of the newest approval. The first approval gets id 1.
    last_approval_id: u64,
    approvals: LookupMap<u64, Approval>,
    /// (repo, pull request, base, head commit, approver) to approval id.
    by_key: LookupMap<ApprovalKey, u64>,
    /// The number of approvals on each pull request.
    pull_request_counts: LookupMap<(String, u64), u32>,
    /// (repo, pull request, index) to approval id, oldest first.
    pull_request_approvals: LookupMap<(String, u64, u32), u64>,
}

impl Default for MergeApprovals {
    fn default() -> Self {
        Self {
            last_approval_id: 0,
            approvals: LookupMap::new(StorageKey::Approvals),
            by_key: LookupMap::new(StorageKey::ByKey),
            pull_request_counts: LookupMap::new(StorageKey::PullRequestCounts),
            pull_request_approvals: LookupMap::new(StorageKey::PullRequestApprovals),
        }
    }
}

#[near]
impl MergeApprovals {
    /// Records that the predecessor account approves merging `head_commit` of
    /// a pull request into `base`, and returns the approval id. A repeat of
    /// the same approval keeps its id and updates its time. The call takes no
    /// deposit: the contract pays for the storage.
    pub fn approve_merge(
        &mut self,
        repo: String,
        pull_request: u64,
        base: String,
        head_commit: String,
    ) -> u64 {
        check_repo(&repo);
        if pull_request == 0 {
            env::panic_str("pull_request must be 1 or more");
        }
        check_base(&base);
        check_head_commit(&head_commit);
        let approver = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        let key: ApprovalKey = (
            repo.clone(),
            pull_request,
            base.clone(),
            head_commit.clone(),
            approver.clone(),
        );
        let approval_id = match self.by_key.get(&key).copied() {
            Some(id) => {
                if let Some(approval) = self.approvals.get_mut(&id) {
                    approval.approved_at_ms = now;
                }
                id
            }
            None => self.add(key, now),
        };

        emit(
            "merge_approved",
            MergeApproved {
                approval_id,
                repo: &repo,
                pull_request,
                base: &base,
                head_commit: &head_commit,
                approver: &approver,
            },
        );
        approval_id
    }

    /// The approvals of a pull request, newest first, at most 50.
    pub fn get_approvals(&self, repo: String, pull_request: u64) -> Vec<ApprovalView> {
        let pr = (repo, pull_request);
        let count = self.pull_request_counts.get(&pr).copied().unwrap_or(0);
        let first = count.saturating_sub(MAX_APPROVALS_PER_VIEW);
        (first..count)
            .rev()
            .filter_map(|index| {
                self.pull_request_approvals
                    .get(&(pr.0.clone(), pr.1, index))
                    .copied()
            })
            .filter_map(|id| self.get_approval(id))
            .collect()
    }

    pub fn get_approval(&self, approval_id: u64) -> Option<ApprovalView> {
        self.approvals
            .get(&approval_id)
            .map(|approval| approval.view(approval_id))
    }
}

impl MergeApprovals {
    fn add(&mut self, key: ApprovalKey, now: u64) -> u64 {
        self.last_approval_id = self
            .last_approval_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("no approval ids are left"));
        let id = self.last_approval_id;
        let (repo, pull_request, base, head_commit, approver) = key.clone();

        let pr = (repo.clone(), pull_request);
        let index = self.pull_request_counts.get(&pr).copied().unwrap_or(0);
        let next_index = index.checked_add(1).unwrap_or_else(|| {
            env::panic_str("this pull request has the maximum number of approvals")
        });
        self.pull_request_approvals
            .insert((repo.clone(), pull_request, index), id);
        self.pull_request_counts.insert(pr, next_index);
        self.by_key.insert(key, id);
        self.approvals.insert(
            id,
            Approval {
                repo,
                pull_request,
                base,
                head_commit,
                approver,
                approved_at_ms: now,
            },
        );
        id
    }
}

/// `owner/name`, as on GitHub: the owner has letters, digits and inner
/// hyphens (1 to 39); the name has letters, digits, `.`, `_` and `-` (1 to
/// 100) and is not `.` or `..`.
fn check_repo(repo: &str) {
    let Some((owner, name)) = repo.split_once('/') else {
        env::panic_str("repo must be owner/name");
    };
    let owner_ok = (1..=MAX_OWNER_CHARS).contains(&owner.len())
        && owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !owner.starts_with('-')
        && !owner.ends_with('-');
    if !owner_ok {
        env::panic_str("repo owner must be 1 to 39 letters, digits or inner hyphens");
    }
    let name_ok = (1..=MAX_NAME_CHARS).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && name != "."
        && name != "..";
    if !name_ok {
        env::panic_str("repo name must be 1 to 100 letters, digits, dots, underscores or hyphens");
    }
}

/// The base branch is spoken, so it is one word of lowercase letters.
fn check_base(base: &str) {
    if !(1..=MAX_BASE_CHARS).contains(&base.len()) || !base.bytes().all(|b| b.is_ascii_lowercase())
    {
        env::panic_str("base must be 1 to 32 lowercase letters a-z");
    }
}

fn check_head_commit(head_commit: &str) {
    if head_commit.len() != HEAD_COMMIT_CHARS
        || !head_commit
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        env::panic_str("head_commit must be 40 lowercase hex characters");
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MergeApproved<'a> {
    approval_id: u64,
    repo: &'a str,
    pull_request: u64,
    base: &'a str,
    head_commit: &'a str,
    approver: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [T; 1],
}

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"merge_approvals",...}`.
fn emit<T: Serialize>(event: &str, data: T) {
    let log = EventLog {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event,
        data: [data],
    };
    let json = near_sdk::serde_json::to_string(&log)
        .unwrap_or_else(|_| env::panic_str("cannot serialize the event"));
    env::log_str(&format!("EVENT_JSON:{json}"));
}

#[cfg(test)]
mod tests;
