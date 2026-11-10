//! A voice multisig for the Speak-to-Sign demo, on testnet.
//!
//! Any account that is not an admin reads a proposal aloud: a transfer, or
//! "hide note N" for a harmful community note. The verifier checks the voice
//! and the words and signs a verdict. The account proposes with that
//! verdict, and this contract checks it on chain: the signature with the
//! pinned verifier key, the outcome, the expiry and the request digest. The
//! digest binds the proposer (the predecessor), this contract, the proposal
//! id and the commitment, a salted hash of the proposal. Then each admin
//! approves the proposal with a plain signed call, and the proposer or an
//! admin executes it. The chain sees the proposal only at `execute`.
//!
//! For "hide note N", this contract is the moderator of the notes contract
//! that `set_notes_contract` names, and `execute` calls its `hide_note`.
//!
//! The method names and JSON shapes are fixed: the demo page and the approve
//! route use them. See `README.md` and `docs/voice-multisig-guests.md`.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, IntoStorageKey, NearToken, PanicOnDefault, Promise, env, near,
};
use spoken_intent::{
    NearAccount, NearAmount, Network, ProposalV1, SpokenAccount, multisig_approval_digest,
    multisig_commitment,
};

mod verdict;

pub use verdict::{VERDICT_DOMAIN, VERDICT_KIND};

/// The fewest admins of a multisig.
const MIN_ADMINS: usize = 1;
/// The most admins of a multisig.
const MAX_ADMINS: usize = 10;
/// `get_proposals` returns at most this many proposals.
pub const MAX_PROPOSALS_PER_VIEW: u32 = 50;
/// The network that each request digest names.
const NETWORK: Network = Network::Testnet;
/// The gas for the callback after the transfer or the hide.
const CALLBACK_GAS: Gas = Gas::from_tgas(5);
/// The gas for `hide_note` on the notes contract.
const HIDE_GAS: Gas = Gas::from_tgas(10);

const EVENT_STANDARD: &str = "voice_multisig";
const EVENT_VERSION: &str = "2.1.0";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Admins can approve. When all admins approved, the proposer or an
    /// admin can execute.
    Open,
    /// The transfer was sent or the note was hidden, or the call is in
    /// flight.
    Executed,
}

/// A proposal as the contract stores it.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub commitment: [u8; 32],
    /// The account whose voice verdict opened the proposal. It is never an
    /// admin.
    pub proposer: AccountId,
    /// Each admin in the order they approved.
    pub approvals: Vec<AccountId>,
    pub status: Status,
    /// The block time of `propose`.
    pub created_at_ms: u64,
    /// Set only after the transfer succeeded.
    pub transfer: Option<(AccountId, u128)>,
}

impl Proposal {
    fn view(&self, id: u64, note_id: Option<u64>) -> ProposalView {
        let (receiver, amount_yocto) = match &self.transfer {
            Some((receiver, amount)) => (Some(receiver.clone()), Some(U128(*amount))),
            None => (None, None),
        };
        ProposalView {
            id,
            commitment_hex: to_hex(&self.commitment),
            proposer: self.proposer.clone(),
            approvals: self.approvals.clone(),
            status: self.status,
            created_at_ms: self.created_at_ms,
            receiver,
            amount_yocto,
            note_id,
        }
    }
}

/// A proposal as the view methods return it. `receiver` and `amount_yocto`
/// are absent until a transfer succeeds, and `note_id` until a note is
/// hidden.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalView {
    pub id: u64,
    pub commitment_hex: String,
    pub proposer: AccountId,
    pub approvals: Vec<AccountId>,
    pub status: Status,
    pub created_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver: Option<AccountId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_yocto: Option<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_id: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub admins: Vec<AccountId>,
    pub verifier_public_key: String,
}

/// The storage prefixes. New keys go at the end: the prefix of a key is its
/// position. The keys after `Proposals` live outside the contract state, so
/// an upgrade of the deployed contract needs no state migration.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Proposals,
    /// The notes contract whose moderator this multisig is.
    NotesContract,
    /// Proposal id to the id of the note that it hid.
    HiddenNotes,
}

fn hidden_notes() -> LookupMap<u64, u64> {
    LookupMap::new(StorageKey::HiddenNotes)
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VoiceMultisig {
    /// The accounts that approve each proposal by key.
    admins: Vec<AccountId>,
    /// The ed25519 key of the verifier, which signs each verdict.
    verifier_key: [u8; 32],
    /// The id that the next proposal must use. The first is 1.
    next_proposal_id: u64,
    proposals: LookupMap<u64, Proposal>,
}

#[near]
impl VoiceMultisig {
    /// Sets the admins and the verifier key. Only the contract account can
    /// call it, in the deploy transaction.
    #[init]
    #[private]
    pub fn new(admins: Vec<AccountId>, verifier_public_key: String) -> Self {
        if !(MIN_ADMINS..=MAX_ADMINS).contains(&admins.len()) {
            env::panic_str("admins must have 1 to 10 accounts");
        }
        let mut sorted = admins.clone();
        sorted.sort();
        sorted.dedup();
        if sorted.len() != admins.len() {
            env::panic_str("admins must be distinct");
        }
        let verifier_key = verdict::parse_ed25519_key(&verifier_public_key).unwrap_or_else(|| {
            env::panic_str("verifier_public_key must be ed25519:<base58 of 32 bytes>")
        });
        Self {
            admins,
            verifier_key,
            next_proposal_id: 1,
            proposals: LookupMap::new(StorageKey::Proposals),
        }
    }

    /// Opens a proposal with the commitment of a hidden transfer. The
    /// caller is the proposer, and the verdict is the caller's spoken
    /// approval. An admin approves by key, so it cannot also be the voice
    /// that proposes. Returns the proposal id.
    pub fn propose(
        &mut self,
        proposal_id: u64,
        commitment_hex: String,
        verdict_json: String,
        signature_b64: String,
    ) -> u64 {
        let proposer = env::predecessor_account_id();
        if self.is_admin(&proposer) {
            env::panic_str("an admin cannot propose");
        }
        if proposal_id != self.next_proposal_id {
            env::panic_str(&format!(
                "proposal_id must be next_proposal_id, {}",
                self.next_proposal_id
            ));
        }
        let commitment = from_hex32(&commitment_hex).unwrap_or_else(|| {
            env::panic_str("commitment_hex must be 64 lowercase hex characters")
        });
        self.check_verdict(
            &proposer,
            proposal_id,
            &commitment,
            &verdict_json,
            &signature_b64,
        );

        self.next_proposal_id += 1;
        self.proposals.insert(
            proposal_id,
            Proposal {
                commitment,
                proposer: proposer.clone(),
                approvals: Vec::new(),
                status: Status::Open,
                created_at_ms: env::block_timestamp_ms(),
                transfer: None,
            },
        );
        emit(
            "proposed",
            Proposed {
                proposal_id,
                commitment_hex: &commitment_hex,
                proposer: &proposer,
            },
        );
        proposal_id
    }

    /// Adds the caller's approval to an open proposal. The caller is an
    /// admin and signs a plain call, with no verdict. Returns the number of
    /// admin approvals.
    pub fn approve(&mut self, proposal_id: u64) -> u32 {
        let admin = env::predecessor_account_id();
        if !self.is_admin(&admin) {
            env::panic_str("the caller is not an admin");
        }
        if self.open_proposal(proposal_id).approvals.contains(&admin) {
            env::panic_str("this admin already approved the proposal");
        }

        let proposal = self.proposals.get_mut(&proposal_id).expect("checked above");
        proposal.approvals.push(admin.clone());
        let approvals = proposal.approvals.len() as u32;
        emit(
            "approved",
            Approved {
                proposal_id,
                admin: &admin,
                approvals,
            },
        );
        approvals
    }

    /// Runs a proposal that all admins approved. The caller is the proposer
    /// or an admin, and knows the opening: the salt, and either the receiver
    /// and the amount of a transfer or the `note_id` of a note to hide.
    ///
    /// A transfer: the result is `true` if the transfer arrived and `false`
    /// if it failed; on a failure the proposal is open again. If the amount
    /// is above the balance of this account, the runtime refuses the
    /// transfer in this call ("Exceeded the account balance."), so the call
    /// fails and the proposal stays open.
    ///
    /// A hide: the call goes to `hide_note` of the notes contract. The
    /// result is `true` if the note is hidden; on a failure the proposal is
    /// open again.
    pub fn execute(
        &mut self,
        proposal_id: u64,
        receiver: Option<AccountId>,
        amount_yocto: Option<U128>,
        salt_hex: String,
        note_id: Option<u64>,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        let proposal = self.open_proposal(proposal_id);
        if caller != proposal.proposer && !self.is_admin(&caller) {
            env::panic_str("only the proposer or an admin can execute the proposal");
        }
        if proposal.approvals.len() < self.admins.len() {
            env::panic_str(&format!(
                "the proposal has {} of {} admin approvals",
                proposal.approvals.len(),
                self.admins.len()
            ));
        }
        let salt = from_hex32(&salt_hex)
            .unwrap_or_else(|| env::panic_str("salt_hex must be 64 lowercase hex characters"));
        let (receiver, amount_yocto) = match (receiver, amount_yocto, note_id) {
            (Some(receiver), Some(amount_yocto), None) => (receiver, amount_yocto),
            (None, None, Some(note_id)) => return self.execute_hide(proposal_id, note_id, &salt),
            _ => env::panic_str(
                "execute takes receiver and amount_yocto for a transfer, or note_id for a hide",
            ),
        };
        let spoken_receiver = SpokenAccount::new(receiver.as_str()).unwrap_or_else(|_| {
            env::panic_str("receiver must be a named account that the grammar can speak")
        });
        let amount = NearAmount::from_yocto(amount_yocto.0).unwrap_or_else(|_| {
            env::panic_str(
                "amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR",
            )
        });
        let transfer = ProposalV1::Transfer {
            receiver: spoken_receiver,
            amount,
        };
        let multisig = near_account(&env::current_account_id());
        if multisig_commitment(&multisig, proposal_id, &transfer, &salt) != proposal.commitment {
            env::panic_str("receiver, amount_yocto and salt_hex do not match the commitment");
        }

        // Marked before the transfer, so a second execute fails while this
        // one is in flight.
        self.proposals
            .get_mut(&proposal_id)
            .expect("checked above")
            .status = Status::Executed;
        Promise::new(receiver.clone())
            .transfer(NearToken::from_yoctonear(amount_yocto.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_transfer(proposal_id, receiver, amount_yocto),
            )
    }

    /// Records the result of the transfer. On a failure the NEAR came back
    /// to this account, and the proposal is open again with its approvals.
    #[private]
    pub fn on_transfer(
        &mut self,
        proposal_id: u64,
        receiver: AccountId,
        amount_yocto: U128,
    ) -> bool {
        let sent = near_sdk::is_promise_success();
        let proposal = self
            .proposals
            .get_mut(&proposal_id)
            .unwrap_or_else(|| env::panic_str("no proposal has this id"));
        if sent {
            proposal.transfer = Some((receiver.clone(), amount_yocto.0));
            emit(
                "executed",
                Executed {
                    proposal_id,
                    receiver: &receiver,
                    amount_yocto,
                },
            );
        } else {
            proposal.status = Status::Open;
            emit("execute_failed", ExecuteFailed { proposal_id });
        }
        sent
    }

    /// Records the result of `hide_note`. On a failure the proposal is open
    /// again with its approvals.
    #[private]
    pub fn on_hide(&mut self, proposal_id: u64, note_id: u64) -> bool {
        let hidden = near_sdk::is_promise_success();
        let proposal = self
            .proposals
            .get_mut(&proposal_id)
            .unwrap_or_else(|| env::panic_str("no proposal has this id"));
        if hidden {
            hidden_notes().insert(proposal_id, note_id);
            emit(
                "executed",
                Hidden {
                    proposal_id,
                    note_id,
                },
            );
        } else {
            proposal.status = Status::Open;
            emit("execute_failed", ExecuteFailed { proposal_id });
        }
        hidden
    }

    /// Names the notes contract whose moderator this multisig is. Only the
    /// contract account can call it.
    #[private]
    pub fn set_notes_contract(&mut self, account_id: AccountId) {
        env::storage_write(
            &StorageKey::NotesContract.into_storage_key(),
            account_id.as_bytes(),
        );
    }

    pub fn get_notes_contract(&self) -> Option<AccountId> {
        env::storage_read(&StorageKey::NotesContract.into_storage_key())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|text| text.parse().ok())
    }

    pub fn get_proposal(&self, proposal_id: u64) -> Option<ProposalView> {
        self.proposals.get(&proposal_id).map(|proposal| {
            let note_id = hidden_notes().get(&proposal_id).copied();
            proposal.view(proposal_id, note_id)
        })
    }

    /// Proposals newest first. `from_index` 0 is the newest; `limit` is at
    /// most 50 (the default).
    pub fn get_proposals(&self, from_index: Option<u64>, limit: Option<u32>) -> Vec<ProposalView> {
        let newest = self.next_proposal_id - 1;
        let first = newest.saturating_sub(from_index.unwrap_or(0));
        let limit = limit
            .unwrap_or(MAX_PROPOSALS_PER_VIEW)
            .min(MAX_PROPOSALS_PER_VIEW);
        (1..=first)
            .rev()
            .take(limit as usize)
            .filter_map(|id| self.get_proposal(id))
            .collect()
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admins: self.admins.clone(),
            verifier_public_key: verdict::format_ed25519_key(&self.verifier_key),
        }
    }

    pub fn next_proposal_id(&self) -> u64 {
        self.next_proposal_id
    }
}

impl VoiceMultisig {
    fn is_admin(&self, account: &AccountId) -> bool {
        self.admins.contains(account)
    }

    /// The hide of `execute`, after the caller and approval checks.
    fn execute_hide(&mut self, proposal_id: u64, note_id: u64, salt: &[u8; 32]) -> Promise {
        let notes = self
            .get_notes_contract()
            .unwrap_or_else(|| env::panic_str("this multisig has no notes contract"));
        let hide = ProposalV1::HideNote { note_id };
        let multisig = near_account(&env::current_account_id());
        let proposal = self.open_proposal(proposal_id);
        if multisig_commitment(&multisig, proposal_id, &hide, salt) != proposal.commitment {
            env::panic_str("note_id and salt_hex do not match the commitment");
        }

        // Marked before the call, so a second execute fails while this one
        // is in flight.
        self.proposals
            .get_mut(&proposal_id)
            .expect("checked above")
            .status = Status::Executed;
        Promise::new(notes)
            .function_call(
                "hide_note".to_owned(),
                near_sdk::serde_json::to_vec(&HideArgs {
                    note_id,
                    proposal_id,
                })
                .unwrap_or_else(|_| env::panic_str("cannot serialize the hide_note arguments")),
                NearToken::from_yoctonear(0),
                HIDE_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_hide(proposal_id, note_id),
            )
    }

    fn open_proposal(&self, proposal_id: u64) -> &Proposal {
        let proposal = self
            .proposals
            .get(&proposal_id)
            .unwrap_or_else(|| env::panic_str("no proposal has this id"));
        if proposal.status != Status::Open {
            env::panic_str("the proposal is already executed");
        }
        proposal
    }

    /// Panics unless the verdict accepts the request of `owner` for this
    /// proposal and commitment.
    fn check_verdict(
        &self,
        owner: &AccountId,
        proposal_id: u64,
        commitment: &[u8; 32],
        verdict_json: &str,
        signature_b64: &str,
    ) {
        let digest = multisig_approval_digest(
            NETWORK,
            &near_account(owner),
            &near_account(&env::current_account_id()),
            proposal_id,
            commitment,
        );
        verdict::check_verdict(&self.verifier_key, &digest, verdict_json, signature_b64);
    }
}

/// NEAR and `spoken-intent` have the same account id rules, so this holds
/// for each valid `AccountId`.
fn near_account(account: &AccountId) -> NearAccount {
    NearAccount::new(account.as_str())
        .unwrap_or_else(|_| env::panic_str("the account id is not valid for spoken-intent"))
}

/// Decodes 64 lowercase hex characters.
fn from_hex32(text: &str) -> Option<[u8; 32]> {
    let bytes = text.as_bytes();
    if bytes.len() != 64 {
        return None;
    }
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; 32];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = (nibble(bytes[2 * index])? << 4) | nibble(bytes[2 * index + 1])?;
    }
    Some(out)
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Proposed<'a> {
    proposal_id: u64,
    commitment_hex: &'a str,
    proposer: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Approved<'a> {
    proposal_id: u64,
    admin: &'a AccountId,
    approvals: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Executed<'a> {
    proposal_id: u64,
    receiver: &'a AccountId,
    amount_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Hidden {
    proposal_id: u64,
    note_id: u64,
}

/// The arguments of `hide_note` on the notes contract.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct HideArgs {
    note_id: u64,
    proposal_id: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ExecuteFailed {
    proposal_id: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [T; 1],
}

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"voice_multisig",...}`.
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
