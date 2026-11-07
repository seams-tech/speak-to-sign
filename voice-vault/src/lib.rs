//! `voice-vault`: the Speak-to-Sign vault of Refactor 210, HTTPS path (plan
//! Sections 4 and 7.5).
//!
//! Each owner has one vault: a balance, saved contacts, limits and a nonce.
//! The Wallet calls the verifier through OutLayer's HTTPS API and gets a
//! verdict signed by the verifier's project-bound key. It then sends one
//! transaction, `transfer_with_verdict`. The vault rebuilds the request from
//! its own state and the arguments, checks the signature against the key
//! pinned at `new`, checks the verdict, the nonce, the contact, the limits
//! and the audio digest, and pays in the same transaction. No yield and no
//! `request_execution`.
//!
//! A withdrawal to the owner needs no voice, but it waits for a delay.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, CurveType, Gas, NearToken, PanicOnDefault, Promise, PromiseResult, PublicKey};
use spoken_intent::{render, request_digest, spoken_text_digest, Network, SpokenRequestV1, RENDERER_VERSION};

pub mod enrollment;
mod error;
mod state;
mod verdict;

#[cfg(test)]
mod tests;

pub use error::VaultError;
use state::{
    Limits, PendingLimits, PendingWithdrawal, Speakable, Vault, CONTACT_DELAY_SECONDS, LIMITS_DELAY_NS, NS_PER_SECOND,
    WITHDRAWAL_DELAY_NS,
};

/// Scope is testnet only (plan Section 4.1).
pub const NETWORK: Network = Network::Testnet;
/// Kept from each vault's first deposit for its storage (up to 32 contacts).
/// It is not withdrawable.
pub const STORAGE_RESERVE: NearToken = NearToken::from_millinear(100);
pub const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The checks, the payout and its callback.
pub const MIN_TRANSFER_GAS: Gas = Gas::from_tgas(30);
/// Storage bytes charged to the balance for one used-audio record: a
/// 33-byte key, an empty value and the runtime's 40 bytes for each record,
/// rounded up.
pub const USED_AUDIO_RECORD_BYTES: u64 = 100;
/// The longest contact delay that `new` accepts: one week.
pub const MAX_CONTACT_DELAY_SECONDS: u64 = 7 * 86_400;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VoiceVault {
    /// The verifier's project-bound ed25519 key. Fixed at deployment.
    verifier_public_key: [u8; 32],
    contact_delay_ns: u64,
    vaults: LookupMap<AccountId, Vault>,
    /// Every audio digest that paid a transfer, for all vaults.
    used_audio: LookupSet<[u8; 32]>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferReceipt {
    pub receiver_id: AccountId,
    pub amount: U128,
    pub nonce: U64,
    /// Base64url SHA-256 of the canonical WAV.
    pub audio_digest: String,
    /// Taken from the balance for the used-audio record.
    pub storage_fee: U128,
}

#[near(serializers = [json])]
pub struct VerifierView {
    pub verifier_public_key: String,
    pub renderer: String,
    pub contact_delay_seconds: U64,
}

#[near(serializers = [json])]
pub struct LimitsView {
    pub per_transfer: U128,
    pub daily: U128,
    pub effective_at_ns: Option<U64>,
}

#[near(serializers = [json])]
pub struct ContactView {
    pub account_id: AccountId,
    pub active_at_ns: U64,
    pub active: bool,
}

#[near(serializers = [json])]
pub struct PendingWithdrawalView {
    pub amount: U128,
    pub ready_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingEnrollmentView {
    /// base64url, as `authorize_enrollment` received it.
    pub enrollment_digest: String,
    pub expires_at_ns: U64,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub balance: U128,
    pub limits: LimitsView,
    pub pending_limits: Option<LimitsView>,
    pub spent_today: U128,
    pub next_nonce: U64,
    pub pending_withdrawal: Option<PendingWithdrawalView>,
}

fn log_event(event: &str, data: serde_json::Value) {
    let record = json!({ "standard": "seams_voice_vault", "version": "2.0.0", "event": event, "data": data });
    env::log_str(&format!("EVENT_JSON:{record}"));
}

fn limits_view(limits: &Limits, effective_at_ns: Option<u64>) -> LimitsView {
    LimitsView {
        per_transfer: U128(limits.per_transfer().as_yoctonear()),
        daily: U128(limits.daily().as_yoctonear()),
        effective_at_ns: effective_at_ns.map(U64),
    }
}

#[near]
impl VoiceVault {
    /// Pins the verifier key: the `public_key` that the verifier's `verify`
    /// (or `verifier_public_key` of `enroll`) returns, `ed25519:<base58>`.
    /// `contact_delay_seconds` defaults to 120; a demo can set 0.
    #[init]
    #[handle_result]
    pub fn new(verifier_public_key: PublicKey, contact_delay_seconds: Option<u64>) -> Result<Self, VaultError> {
        Speakable::new(&env::current_account_id())?;
        if verifier_public_key.curve_type() != CurveType::ED25519 {
            return Err(VaultError::BadConfig);
        }
        let key: [u8; 32] = verifier_public_key.as_bytes()[1..].try_into().map_err(|_| VaultError::BadConfig)?;
        let delay = contact_delay_seconds.unwrap_or(CONTACT_DELAY_SECONDS);
        if delay > MAX_CONTACT_DELAY_SECONDS {
            return Err(VaultError::BadConfig);
        }
        Ok(Self {
            verifier_public_key: key,
            contact_delay_ns: delay * NS_PER_SECOND,
            vaults: LookupMap::new(b"v"),
            used_audio: LookupSet::new(b"a"),
        })
    }

    // ---- Owner calls -------------------------------------------------

    /// Creates the caller's vault. The deposit, less the storage reserve,
    /// becomes the balance.
    #[payable]
    #[handle_result]
    pub fn create_vault(&mut self) -> Result<(), VaultError> {
        let owner_id = env::predecessor_account_id();
        let owner = Speakable::new(&owner_id)?;
        if self.vaults.contains_key(&owner_id) {
            return Err(VaultError::AlreadyExists);
        }
        let balance = env::attached_deposit().checked_sub(STORAGE_RESERVE).ok_or(VaultError::InsufficientDeposit)?;
        self.vaults.insert(owner_id.clone(), Vault::new(owner, balance, env::block_timestamp()));
        log_event("vault_created", json!({ "owner": owner_id, "balance": U128(balance.as_yoctonear()) }));
        Ok(())
    }

    #[payable]
    #[handle_result]
    pub fn deposit(&mut self) -> Result<U128, VaultError> {
        let deposit = env::attached_deposit();
        if deposit.is_zero() {
            return Err(VaultError::ZeroDeposit);
        }
        let vault = self.owner_vault()?;
        vault.balance = vault.balance.saturating_add(deposit);
        Ok(U128(vault.balance.as_yoctonear()))
    }

    /// Saves a contact. It becomes active after the contact delay. Returns
    /// that time. `remove_contact` cancels it.
    #[handle_result]
    pub fn add_contact(&mut self, account_id: AccountId) -> Result<U64, VaultError> {
        let owner_id = env::predecessor_account_id();
        if account_id == owner_id || account_id == env::current_account_id() {
            return Err(VaultError::BadContact);
        }
        let now = env::block_timestamp();
        let delay = self.contact_delay_ns;
        let active_at = self.owner_vault()?.add_contact(&account_id, now, delay)?;
        log_event("contact_added", json!({ "owner": owner_id, "contact": account_id, "active_at_ns": U64(active_at) }));
        Ok(U64(active_at))
    }

    /// Authorizes one enrollment of the caller's voice: the verifier enrolls
    /// only audio whose enrollment digest (base64url, see [`enrollment`])
    /// equals this one, until the expiry that this call returns (10 minutes).
    /// A new call replaces the pending digest.
    #[handle_result]
    pub fn authorize_enrollment(&mut self, enrollment_digest: String) -> Result<U64, VaultError> {
        let owner_id = env::predecessor_account_id();
        if !self.vaults.contains_key(&owner_id) {
            return Err(VaultError::NoVault);
        }
        let digest = verdict::decode_digest(&enrollment_digest).ok_or(VaultError::BadEnrollmentDigest)?;
        let expires_at_ns = env::block_timestamp().saturating_add(enrollment::ENROLLMENT_TTL_NS);
        enrollment::write(&owner_id, &enrollment::PendingEnrollment { digest, expires_at_ns });
        log_event(
            "enrollment_authorized",
            json!({ "owner": owner_id, "enrollment_digest": enrollment_digest, "expires_at_ns": U64(expires_at_ns) }),
        );
        Ok(U64(expires_at_ns))
    }

    /// Removes a contact at once.
    #[handle_result]
    pub fn remove_contact(&mut self, account_id: AccountId) -> Result<(), VaultError> {
        let vault = self.owner_vault()?;
        let before = vault.contacts.len();
        vault.contacts.retain(|contact| contact.account.account_id() != &account_id);
        if vault.contacts.len() == before {
            return Err(VaultError::ContactNotFound);
        }
        Ok(())
    }

    /// Lower (or equal) limits apply at once. A higher limit waits for
    /// `LIMITS_DELAY_NS`; `cancel_limits_change` drops it.
    #[handle_result]
    pub fn set_limits(&mut self, per_transfer: U128, daily: U128) -> Result<Option<U64>, VaultError> {
        let limits = Limits::new(NearToken::from_yoctonear(per_transfer.0), NearToken::from_yoctonear(daily.0))?;
        let now = env::block_timestamp();
        let vault = self.owner_vault()?;
        vault.settle(now);
        if limits.is_tighter_or_equal(&vault.limits) {
            vault.limits = limits;
            vault.pending_limits = None;
            return Ok(None);
        }
        let effective_at_ns = now.saturating_add(LIMITS_DELAY_NS);
        vault.pending_limits = Some(PendingLimits { limits, effective_at_ns });
        Ok(Some(U64(effective_at_ns)))
    }

    #[handle_result]
    pub fn cancel_limits_change(&mut self) -> Result<(), VaultError> {
        let now = env::block_timestamp();
        let vault = self.owner_vault()?;
        vault.settle(now);
        vault.pending_limits.take().map(|_| ()).ok_or(VaultError::NoLimitsChange)
    }

    /// Pays `amount` to an active contact on a verdict that the pinned
    /// verifier key signed. The caller is the owner. The vault rebuilds the
    /// request (network, vault, owner, receiver, amount, nonce) from its own
    /// state and these arguments; the verdict's request digest and
    /// spoken-text digest must equal its own, and its audio digest must be
    /// new. Any failure changes no state.
    #[handle_result]
    pub fn transfer_with_verdict(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        nonce: U64,
        verdict_json: String,
        signature_b64: String,
    ) -> Result<Promise, VaultError> {
        if env::prepaid_gas() < MIN_TRANSFER_GAS {
            return Err(VaultError::NotEnoughGas);
        }
        verdict::check_signature(&verdict_json, &signature_b64, &self.verifier_public_key)?;
        let accepted = verdict::parse_accepted(&verdict_json)?;

        let owner_id = env::predecessor_account_id();
        let vault_spoken = Speakable::new(&env::current_account_id())?.spoken();
        let now = env::block_timestamp();
        let vault = self.vaults.get_mut(&owner_id).ok_or(VaultError::NoVault)?;
        vault.settle(now);
        let amount = NearToken::from_yoctonear(amount.0);
        let (receiver, spoken_amount) = vault.check_transfer(&receiver_id, amount, nonce.0, now)?;
        let request = SpokenRequestV1::VaultTransfer {
            network: NETWORK,
            vault: vault_spoken,
            owner: vault.owner.spoken(),
            receiver: receiver.spoken(),
            amount: spoken_amount,
            nonce: nonce.0,
        };
        if accepted.request_digest != request_digest(&request)
            || accepted.spoken_text_digest != spoken_text_digest(&render(&request))
        {
            return Err(VaultError::VerdictMismatch);
        }

        // The used-audio record; its storage is paid from the balance.
        if !self.used_audio.insert(accepted.audio_digest) {
            return Err(VaultError::AudioReused);
        }
        let storage_fee = env::storage_byte_cost().saturating_mul(u128::from(USED_AUDIO_RECORD_BYTES));

        let vault = self.vaults.get_mut(&owner_id).ok_or(VaultError::NoVault)?;
        let total = amount.checked_add(storage_fee).ok_or(VaultError::InsufficientBalance)?;
        vault.balance = vault.balance.checked_sub(total).ok_or(VaultError::InsufficientBalance)?;
        vault.spent.amount = vault.spent.amount.saturating_add(amount);
        vault.next_nonce += 1;
        let spent_day = vault.spent.day;

        let receipt = TransferReceipt {
            receiver_id: receiver_id.clone(),
            amount: U128(amount.as_yoctonear()),
            nonce,
            audio_digest: verdict::encode_digest(&accepted.audio_digest),
            storage_fee: U128(storage_fee.as_yoctonear()),
        };
        log_event("transfer_sent", json!({ "owner": owner_id, "receipt": receipt }));
        Ok(Self::payout(owner_id, receiver_id, amount, Some(spent_day)))
    }

    /// Starts a withdrawal to the owner. No voice; waits `WITHDRAWAL_DELAY_NS`.
    #[handle_result]
    pub fn request_withdrawal(&mut self, amount: U128) -> Result<U64, VaultError> {
        let amount = NearToken::from_yoctonear(amount.0);
        if amount.is_zero() {
            return Err(VaultError::ZeroAmount);
        }
        let now = env::block_timestamp();
        let vault = self.owner_vault()?;
        if vault.pending_withdrawal.is_some() {
            return Err(VaultError::WithdrawalPending);
        }
        if amount > vault.balance {
            return Err(VaultError::InsufficientBalance);
        }
        let ready_at_ns = now.saturating_add(WITHDRAWAL_DELAY_NS);
        vault.balance = vault.balance.saturating_sub(amount);
        vault.pending_withdrawal = Some(PendingWithdrawal { amount, ready_at_ns });
        Ok(U64(ready_at_ns))
    }

    #[handle_result]
    pub fn cancel_withdrawal(&mut self) -> Result<(), VaultError> {
        let vault = self.owner_vault()?;
        let pending = vault.pending_withdrawal.take().ok_or(VaultError::NoPendingWithdrawal)?;
        vault.release(pending.amount, None);
        Ok(())
    }

    #[handle_result]
    pub fn complete_withdrawal(&mut self) -> Result<Promise, VaultError> {
        let owner_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        let vault = self.owner_vault()?;
        let ready_at = vault.pending_withdrawal.as_ref().ok_or(VaultError::NoPendingWithdrawal)?.ready_at_ns;
        if now < ready_at {
            return Err(VaultError::WithdrawalNotReady);
        }
        let pending = vault.pending_withdrawal.take().unwrap_or_else(|| env::abort());
        Ok(Self::payout(owner_id.clone(), owner_id, pending.amount, None))
    }

    // ---- Callback: never panics ----------------------------------------

    /// Gives a failed payout back to the balance (for example, a receiver
    /// account that does not exist).
    #[private]
    pub fn on_payout_settled(&mut self, owner_id: AccountId, amount: U128, spent_day: Option<U64>) -> bool {
        let paid = env::promise_results_count() == 1 && matches!(env::promise_result(0), PromiseResult::Successful(_));
        if !paid {
            if let Some(vault) = self.vaults.get_mut(&owner_id) {
                vault.release(NearToken::from_yoctonear(amount.0), spent_day.map(|day| day.0));
            }
        }
        paid
    }

    // ---- Views -------------------------------------------------------

    pub fn get_verifier(&self) -> VerifierView {
        let key = PublicKey::from_parts(CurveType::ED25519, self.verifier_public_key.to_vec())
            .unwrap_or_else(|_| env::abort());
        VerifierView {
            verifier_public_key: String::from(&key),
            renderer: RENDERER_VERSION.to_string(),
            contact_delay_seconds: U64(self.contact_delay_ns / NS_PER_SECOND),
        }
    }

    /// True if this base64url audio digest already paid a transfer.
    pub fn is_audio_used(&self, audio_digest: String) -> bool {
        verdict::decode_digest(&audio_digest).is_some_and(|digest| self.used_audio.contains(&digest))
    }

    pub fn get_vault(&self, owner_id: AccountId) -> Option<VaultView> {
        let vault = self.vaults.get(&owner_id)?;
        let now = env::block_timestamp();
        let pending_limits = vault
            .pending_limits
            .as_ref()
            .filter(|pending| now < pending.effective_at_ns)
            .map(|pending| limits_view(&pending.limits, Some(pending.effective_at_ns)));
        Some(VaultView {
            balance: U128(vault.balance.as_yoctonear()),
            limits: limits_view(&vault.effective_limits(now), None),
            pending_limits,
            spent_today: U128(vault.spent_today(now).as_yoctonear()),
            next_nonce: U64(vault.next_nonce),
            pending_withdrawal: vault.pending_withdrawal.as_ref().map(|w| PendingWithdrawalView {
                amount: U128(w.amount.as_yoctonear()),
                ready_at_ns: U64(w.ready_at_ns),
            }),
        })
    }

    /// The owner's unexpired enrollment authorization, or `null`. The
    /// verifier reads this with finality `final`.
    pub fn get_pending_enrollment(&self, owner_id: AccountId) -> Option<PendingEnrollmentView> {
        enrollment::read(&owner_id).filter(|pending| pending.is_live(env::block_timestamp())).map(|pending| {
            PendingEnrollmentView {
                enrollment_digest: verdict::encode_digest(&pending.digest),
                expires_at_ns: U64(pending.expires_at_ns),
            }
        })
    }

    pub fn get_contacts(&self, owner_id: AccountId) -> Vec<ContactView> {
        let now = env::block_timestamp();
        self.vaults
            .get(&owner_id)
            .map(|vault| {
                vault
                    .contacts
                    .iter()
                    .map(|c| ContactView {
                        account_id: c.account.account_id().clone(),
                        active_at_ns: U64(c.active_at_ns),
                        active: c.is_active(now),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl VoiceVault {
    fn owner_vault(&mut self) -> Result<&mut Vault, VaultError> {
        self.vaults.get_mut(&env::predecessor_account_id()).ok_or(VaultError::NoVault)
    }

    /// Sends `amount` and gives it back to the vault if the transfer fails.
    ///
    /// The callback stays. A transfer to a named account fails if the
    /// account does not exist when the transfer receipt runs. A contract
    /// cannot check that in the same call, and a contact (or the owner) can
    /// delete its account after it was checked. A failed transfer refunds the
    /// NEAR to this contract, so without the callback the owner's balance
    /// here would lose it. The vault's state (nonce, used audio, balance)
    /// is final when `transfer_with_verdict` succeeds; the client reports
    /// that first receipt as "vault accepted", and all receipts as "settled".
    fn payout(owner_id: AccountId, receiver_id: AccountId, amount: NearToken, spent_day: Option<u64>) -> Promise {
        Promise::new(receiver_id).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(PAYOUT_CALLBACK_GAS)
                .on_payout_settled(owner_id, U128(amount.as_yoctonear()), spent_day.map(U64)),
        )
    }
}
