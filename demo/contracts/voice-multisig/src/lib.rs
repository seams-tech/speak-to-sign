//! A voice multisig for the Speak-to-Sign demo, on testnet.
//!
//! The proposer reads a transfer aloud, and each other member says it from
//! memory. The verifier checks each voice and the words and signs a verdict.
//! This contract checks each verdict on chain: the signature with the pinned
//! verifier key, the outcome, the expiry and the request digest. The digest
//! binds the member (the predecessor), this contract, the proposal id and
//! the commitment, a salted hash of the transfer. The chain sees the
//! transfer only when a member who confirmed executes it.
//!
//! The method names and JSON shapes are fixed: the demo page uses them. See
//! `README.md` and `docs/voice-multisig.md`.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, near};
use spoken_intent::{
    NearAccount, NearAmount, Network, ProposalV1, SpokenAccount, multisig_approval_digest,
    multisig_commitment,
};

mod verdict;

pub use verdict::{VERDICT_DOMAIN, VERDICT_KIND};

/// The fewest members of a multisig.
pub const MIN_MEMBERS: usize = 2;
/// The most members of a multisig.
pub const MAX_MEMBERS: usize = 10;
/// `get_proposals` returns at most this many proposals.
pub const MAX_PROPOSALS_PER_VIEW: u32 = 50;
/// The network that each request digest names.
const NETWORK: Network = Network::Testnet;
/// The gas for the callback after the transfer.
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

const EVENT_STANDARD: &str = "voice_multisig";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Members can confirm, and at the threshold execute.
    Open,
    /// The transfer was sent, or is in flight.
    Executed,
}

/// A proposal as the contract stores it.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub commitment: [u8; 32],
    pub proposer: AccountId,
    /// The proposer first, then each member in the order they confirmed.
    pub confirmations: Vec<AccountId>,
    pub status: Status,
    /// Set only after the transfer succeeded.
    pub transfer: Option<(AccountId, u128)>,
}

impl Proposal {
    fn view(&self, id: u64) -> ProposalView {
        let (receiver, amount_yocto) = match &self.transfer {
            Some((receiver, amount)) => (Some(receiver.clone()), Some(U128(*amount))),
            None => (None, None),
        };
        ProposalView {
            id,
            commitment_hex: to_hex(&self.commitment),
            proposer: self.proposer.clone(),
            confirmations: self.confirmations.clone(),
            status: self.status,
            receiver,
            amount_yocto,
        }
    }
}

/// A proposal as the view methods return it. `receiver` and `amount_yocto`
/// are absent until a transfer succeeds.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalView {
    pub id: u64,
    pub commitment_hex: String,
    pub proposer: AccountId,
    pub confirmations: Vec<AccountId>,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver: Option<AccountId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_yocto: Option<U128>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub members: Vec<AccountId>,
    pub threshold: u8,
    pub verifier_public_key: String,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Proposals,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VoiceMultisig {
    members: Vec<AccountId>,
    threshold: u8,
    /// The ed25519 key of the verifier, which signs each verdict.
    verifier_key: [u8; 32],
    /// The id that the next proposal must use. The first is 1.
    next_proposal_id: u64,
    proposals: LookupMap<u64, Proposal>,
}

#[near]
impl VoiceMultisig {
    /// Sets the members, the threshold and the verifier key. Only the
    /// contract account can call it, in the deploy transaction.
    #[init]
    #[private]
    pub fn new(members: Vec<AccountId>, threshold: u8, verifier_public_key: String) -> Self {
        if !(MIN_MEMBERS..=MAX_MEMBERS).contains(&members.len()) {
            env::panic_str("members must have 2 to 10 accounts");
        }
        let mut sorted = members.clone();
        sorted.sort();
        sorted.dedup();
        if sorted.len() != members.len() {
            env::panic_str("members must be distinct");
        }
        if threshold == 0 || usize::from(threshold) > members.len() {
            env::panic_str("threshold must be 1 to the number of members");
        }
        let verifier_key = verdict::parse_ed25519_key(&verifier_public_key).unwrap_or_else(|| {
            env::panic_str("verifier_public_key must be ed25519:<base58 of 32 bytes>")
        });
        Self {
            members,
            threshold,
            verifier_key,
            next_proposal_id: 1,
            proposals: LookupMap::new(StorageKey::Proposals),
        }
    }

    /// Opens a proposal with the commitment of a hidden transfer, and
    /// counts it as the proposer's confirmation. Returns the proposal id.
    pub fn propose(
        &mut self,
        proposal_id: u64,
        commitment_hex: String,
        verdict_json: String,
        signature_b64: String,
    ) -> u64 {
        let proposer = self.caller_member();
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
                confirmations: vec![proposer.clone()],
                status: Status::Open,
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

    /// Adds the caller's confirmation to an open proposal. Returns the
    /// number of confirmations.
    pub fn confirm(
        &mut self,
        proposal_id: u64,
        verdict_json: String,
        signature_b64: String,
    ) -> u32 {
        let member = self.caller_member();
        let proposal = self.open_proposal(proposal_id);
        if proposal.confirmations.contains(&member) {
            env::panic_str("this member already confirmed the proposal");
        }
        let commitment = proposal.commitment;
        self.check_verdict(
            &member,
            proposal_id,
            &commitment,
            &verdict_json,
            &signature_b64,
        );

        let proposal = self.proposals.get_mut(&proposal_id).expect("checked above");
        proposal.confirmations.push(member.clone());
        let confirmations = proposal.confirmations.len() as u32;
        emit(
            "confirmed",
            Confirmed {
                proposal_id,
                member: &member,
                confirmations,
            },
        );
        confirmations
    }

    /// Sends the transfer of a proposal that has enough confirmations. The
    /// caller is a member who confirmed and who knows the opening: the
    /// receiver, the amount and the salt. The result is `true` if the
    /// transfer arrived and `false` if it failed; on a failure the proposal
    /// is open again.
    pub fn execute(
        &mut self,
        proposal_id: u64,
        receiver: AccountId,
        amount_yocto: U128,
        salt_hex: String,
    ) -> Promise {
        let member = self.caller_member();
        let threshold = self.threshold;
        let proposal = self.open_proposal(proposal_id);
        if !proposal.confirmations.contains(&member) {
            env::panic_str("only a member who confirmed the proposal can execute it");
        }
        if proposal.confirmations.len() < usize::from(threshold) {
            env::panic_str(&format!(
                "the proposal has {} of {threshold} confirmations",
                proposal.confirmations.len()
            ));
        }
        let spoken_receiver = SpokenAccount::new(receiver.as_str()).unwrap_or_else(|_| {
            env::panic_str("receiver must be a named account that the grammar can speak")
        });
        let amount = NearAmount::from_yocto(amount_yocto.0).unwrap_or_else(|_| {
            env::panic_str(
                "amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR",
            )
        });
        let salt = from_hex32(&salt_hex)
            .unwrap_or_else(|| env::panic_str("salt_hex must be 64 lowercase hex characters"));
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
    /// to this account, and the proposal is open again.
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

    pub fn get_proposal(&self, proposal_id: u64) -> Option<ProposalView> {
        self.proposals
            .get(&proposal_id)
            .map(|proposal| proposal.view(proposal_id))
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
            members: self.members.clone(),
            threshold: self.threshold,
            verifier_public_key: verdict::format_ed25519_key(&self.verifier_key),
        }
    }

    pub fn next_proposal_id(&self) -> u64 {
        self.next_proposal_id
    }
}

impl VoiceMultisig {
    fn caller_member(&self) -> AccountId {
        let caller = env::predecessor_account_id();
        if !self.members.contains(&caller) {
            env::panic_str("the caller is not a member");
        }
        caller
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

    /// Panics unless the verdict accepts the request of `member` for this
    /// proposal and commitment.
    fn check_verdict(
        &self,
        member: &AccountId,
        proposal_id: u64,
        commitment: &[u8; 32],
        verdict_json: &str,
        signature_b64: &str,
    ) {
        let digest = multisig_approval_digest(
            NETWORK,
            &near_account(member),
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
struct Confirmed<'a> {
    proposal_id: u64,
    member: &'a AccountId,
    confirmations: u32,
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
