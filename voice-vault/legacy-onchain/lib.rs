//! `voice-vault`: the Speak-to-Sign vault of Refactor 210 (plan Section 4).
//!
//! Each owner has one vault: a balance, saved contacts, limits and a nonce.
//! `request_transfer` reserves the amount and asks the pinned OutLayer
//! verifier to check the owner's voice against the vault's own text of the
//! request. `on_transfer_verdict` pays only on a matching `accept` verdict.
//! A withdrawal to the owner needs no voice, but it waits for a delay.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};
use spoken_intent::{
    render, request_digest, spoken_text_digest, Network, SpokenRequestV1, RENDERER_VERSION,
};

mod error;
mod state;
mod verdict;

#[cfg(test)]
mod tests;

pub use error::VaultError;
use state::{
    Audio, Limits, PendingLimits, PendingTransfer, PendingWithdrawal, Speakable, Vault,
    LIMITS_DELAY_NS, STALE_TRANSFER_NS, WITHDRAWAL_DELAY_NS,
};
use verdict::{decode_digest, encode_digest, Refusal};

/// Scope is testnet only (plan Section 4.1).
pub const NETWORK: Network = Network::Testnet;
/// Kept from each vault's first deposit for its storage (up to 32 contacts
/// and one pending record). It is not withdrawable.
pub const STORAGE_RESERVE: NearToken = NearToken::from_millinear(100);
/// The least deposit forwarded to `request_execution`. Live pricing gives
/// 0.007005 NEAR for the limits below; OutLayer refunds the unused part.
pub const MIN_EXECUTION_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// Gate 0 used 200 Tgas for `request_execution` on testnet.
pub const REQUEST_EXECUTION_GAS: Gas = Gas::from_tgas(200);
pub const VERDICT_CALLBACK_GAS: Gas = Gas::from_tgas(40);
pub const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The two calls above plus the work of `request_transfer` itself.
pub const MIN_TRANSFER_GAS: Gas = Gas::from_tgas(260);
/// About 3 times the 15-22 billion that Gate 0 measured for one `verify`.
pub const MAX_INSTRUCTIONS: u64 = 50_000_000_000;
pub const MAX_EXECUTION_SECONDS: u64 = 60;
pub const MAX_MEMORY_MB: u32 = 512;
/// 8 s of 16 kHz PCM16 is 256,000 bytes, plus the HPKE key and tag.
pub const MAX_AUDIO_BYTES: u32 = 262_144;
pub const MAX_AUDIO_URL_LEN: usize = 512;

/// The verifier that every vault trusts. It is fixed at deployment.
#[near(serializers = [borsh])]
pub struct VerifierPin {
    outlayer: AccountId,
    project_id: String,
    version_key: String,
    audio_key: [u8; 32],
    relay_host: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VoiceVault {
    pin: VerifierPin,
    vaults: LookupMap<AccountId, Vault>,
    next_request_id: u64,
}

/// What the Wallet sends: where the encrypted audio is.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AudioRef {
    /// `https://<pinned relay host>/...`
    pub url: String,
    /// Base64url (no padding) SHA-256 of the ciphertext.
    pub digest: String,
    /// Ciphertext length.
    pub bytes: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferOutcome {
    pub request_id: U64,
    pub sent: bool,
    /// `null` when sent; otherwise why not.
    pub reason: Option<String>,
}

#[near(serializers = [json])]
pub struct VerifierView {
    pub outlayer: AccountId,
    pub project_id: String,
    pub version_key: String,
    pub audio_key: String,
    pub relay_host: String,
    pub renderer: String,
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
pub struct PendingTransferView {
    pub request_id: U64,
    pub nonce: U64,
    pub receiver_id: AccountId,
    pub amount: U128,
    pub requested_at_ns: U64,
}

#[near(serializers = [json])]
pub struct PendingWithdrawalView {
    pub amount: U128,
    pub ready_at_ns: U64,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub balance: U128,
    pub limits: LimitsView,
    pub pending_limits: Option<LimitsView>,
    pub spent_today: U128,
    pub next_nonce: U64,
    pub template_epoch: u32,
    pub pending_transfer: Option<PendingTransferView>,
    pub pending_withdrawal: Option<PendingWithdrawalView>,
}

fn is_relay_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
}

fn is_plain_token(text: &str, extra: &[u8]) -> bool {
    !text.is_empty()
        && text.len() <= 128
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || extra.contains(&b))
}

/// The host must equal the pinned host exactly (no port, no user info) and
/// the path may hold only unreserved URL characters and `/`.
fn check_audio(audio: &AudioRef, relay_host: &str) -> Result<Audio, VaultError> {
    let path = audio
        .url
        .strip_prefix("https://")
        .and_then(|rest| rest.strip_prefix(relay_host))
        .and_then(|rest| rest.strip_prefix('/'))
        .ok_or(VaultError::BadAudioUrl)?;
    let path_ok = audio.url.len() <= MAX_AUDIO_URL_LEN
        && !path.is_empty()
        && path.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~/".contains(&b));
    if !path_ok {
        return Err(VaultError::BadAudioUrl);
    }
    let digest = decode_digest(&audio.digest).ok_or(VaultError::BadAudioDigest)?;
    if audio.bytes == 0 || audio.bytes > MAX_AUDIO_BYTES {
        return Err(VaultError::BadAudioSize);
    }
    Ok(Audio { url: audio.url.clone(), digest, bytes: audio.bytes })
}

fn log_event(event: &str, data: serde_json::Value) {
    let record = json!({ "standard": "seams_voice_vault", "version": "1.0.0", "event": event, "data": data });
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
    /// Pins the verifier. `verifier_audio_key` is the base64url X25519 public
    /// key that the verifier's `audio_key` operation returned.
    #[init]
    #[handle_result]
    pub fn new(
        outlayer_account_id: AccountId,
        verifier_project_id: String,
        verifier_version_key: String,
        verifier_audio_key: String,
        relay_host: String,
    ) -> Result<Self, VaultError> {
        Speakable::new(&env::current_account_id())?;
        let audio_key = decode_digest(&verifier_audio_key).ok_or(VaultError::BadConfig)?;
        let config_ok = is_plain_token(&verifier_project_id, b"._-/")
            && is_plain_token(&verifier_version_key, b"")
            && is_relay_host(&relay_host);
        if !config_ok {
            return Err(VaultError::BadConfig);
        }
        Ok(Self {
            pin: VerifierPin {
                outlayer: outlayer_account_id,
                project_id: verifier_project_id,
                version_key: verifier_version_key,
                audio_key,
                relay_host,
            },
            vaults: LookupMap::new(b"v"),
            next_request_id: 0,
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
        let balance = env::attached_deposit()
            .checked_sub(STORAGE_RESERVE)
            .ok_or(VaultError::InsufficientDeposit)?;
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

    /// Saves a contact. It becomes active after `CONTACT_DELAY_NS`. Returns
    /// that time. `remove_contact` cancels it.
    #[handle_result]
    pub fn add_contact(&mut self, account_id: AccountId) -> Result<U64, VaultError> {
        let owner_id = env::predecessor_account_id();
        if account_id == owner_id || account_id == env::current_account_id() {
            return Err(VaultError::BadContact);
        }
        let now = env::block_timestamp();
        let active_at = self.owner_vault()?.add_contact(&account_id, now)?;
        log_event("contact_added", json!({ "owner": owner_id, "contact": account_id, "active_at_ns": U64(active_at) }));
        Ok(U64(active_at))
    }

    /// Removes a contact at once. A pending transfer to it will not pay.
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

    /// Reserves `amount` and asks the pinned verifier to check the owner's
    /// voice. Every field of the verifier input comes from vault state,
    /// except `audio`. Attach at least `MIN_EXECUTION_DEPOSIT` and
    /// `MIN_TRANSFER_GAS`; the whole deposit goes to OutLayer.
    #[payable]
    #[handle_result]
    pub fn request_transfer(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        nonce: U64,
        audio: AudioRef,
    ) -> Result<Promise, VaultError> {
        if env::prepaid_gas() < MIN_TRANSFER_GAS {
            return Err(VaultError::NotEnoughGas);
        }
        let execution_deposit = env::attached_deposit();
        if execution_deposit < MIN_EXECUTION_DEPOSIT {
            return Err(VaultError::ExecutionDepositTooLow);
        }
        let audio = check_audio(&audio, &self.pin.relay_host)?;
        let owner_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        let request_id = self.next_request_id;
        let vault_id = env::current_account_id();
        let vault_spoken = Speakable::new(&vault_id)?.spoken();

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
        let request_bytes = near_sdk::borsh::to_vec(&request).unwrap_or_else(|_| env::abort());
        let pending = PendingTransfer {
            request_id,
            nonce: nonce.0,
            receiver,
            amount,
            spent_day: vault.spent.day,
            request_digest: request_digest(&request),
            spoken_text_digest: spoken_text_digest(&render(&request)),
            audio,
            template_epoch: vault.template_epoch,
            requested_at_ns: now,
        };
        let contacts: Vec<&str> = vault.contacts.iter().map(|c| c.account.account_id().as_str()).collect();
        let input = json!({
            "kind": "seams_voice_verify_input_v1",
            "op": "verify",
            "renderer": RENDERER_VERSION,
            "request_id": request_id.to_string(),
            "request": near_sdk::base64::Engine::encode(
                &near_sdk::base64::engine::general_purpose::URL_SAFE_NO_PAD,
                &request_bytes,
            ),
            "subject": owner_id,
            "template_epoch": pending.template_epoch,
            "contacts": contacts,
            "audio": {
                "url": pending.audio.url,
                "digest": encode_digest(&pending.audio.digest),
                "bytes": pending.audio.bytes,
            },
        });

        // Reserve. A refusal in the callback gives it back.
        vault.balance = vault.balance.saturating_sub(amount);
        vault.spent.amount = vault.spent.amount.saturating_add(amount);
        vault.next_nonce += 1;
        vault.pending_transfer = Some(pending);
        self.next_request_id += 1;

        let args = json!({
            "source": { "Project": { "project_id": self.pin.project_id, "version_key": self.pin.version_key } },
            "input_data": input.to_string(),
            "resource_limits": {
                "max_instructions": MAX_INSTRUCTIONS,
                "max_memory_mb": MAX_MEMORY_MB,
                "max_execution_seconds": MAX_EXECUTION_SECONDS,
            },
            "response_format": "Json",
            "payer_account_id": owner_id,
        });
        log_event(
            "transfer_requested",
            json!({ "owner": owner_id, "request_id": U64(request_id), "receiver": receiver_id, "amount": U128(amount.as_yoctonear()) }),
        );
        Ok(Promise::new(self.pin.outlayer.clone())
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                execution_deposit,
                REQUEST_EXECUTION_GAS,
            )
            .then(
                Self::ext(vault_id)
                    .with_static_gas(VERDICT_CALLBACK_GAS)
                    .on_transfer_verdict(owner_id, U64(request_id)),
            ))
    }

    /// Releases a reservation whose callback never ran, for example when it
    /// ran out of gas. Waits `STALE_TRANSFER_NS`. A late callback then finds
    /// no matching request and pays nothing.
    #[handle_result]
    pub fn cancel_stale_transfer(&mut self) -> Result<(), VaultError> {
        let now = env::block_timestamp();
        let vault = self.owner_vault()?;
        let pending = vault.pending_transfer.as_ref().ok_or(VaultError::NoPendingTransfer)?;
        if now < pending.requested_at_ns.saturating_add(STALE_TRANSFER_NS) {
            return Err(VaultError::TransferNotStale);
        }
        let pending = vault.pending_transfer.take().unwrap_or_else(|| env::abort());
        vault.release(pending.amount, Some(pending.spent_day));
        Ok(())
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

    // ---- Callbacks: never panic --------------------------------------

    /// Pays only on a well-formed `accept` verdict whose request id, request
    /// digest, spoken-text digest, audio digest and template epoch match the
    /// pending transfer. `null`, a promise error and any other value release
    /// the reservation. The pending record is always deleted.
    #[private]
    pub fn on_transfer_verdict(&mut self, owner_id: AccountId, request_id: U64) -> TransferOutcome {
        let refused = |reason: &str| TransferOutcome { request_id, sent: false, reason: Some(reason.to_string()) };
        let result = if env::promise_results_count() == 1 { env::promise_result(0) } else { PromiseResult::Failed };
        let Some(vault) = self.vaults.get_mut(&owner_id) else {
            return refused("no_pending_request");
        };
        let pending = match vault.pending_transfer.take() {
            Some(pending) if pending.request_id == request_id.0 => pending,
            other => {
                vault.pending_transfer = other;
                return refused("no_pending_request");
            }
        };
        let now = env::block_timestamp();
        let receiver_id = pending.receiver.account_id().clone();
        let judged = verdict::judge(&pending, &result).and_then(|()| {
            match vault.contact(&receiver_id) {
                Some(contact) if contact.is_active(now) => Ok(()),
                _ => Err(Refusal::ContactRemoved),
            }
        });
        let outcome = match judged {
            Ok(()) => {
                Self::payout(owner_id.clone(), receiver_id.clone(), pending.amount, Some(pending.spent_day))
                    .detach();
                TransferOutcome { request_id, sent: true, reason: None }
            }
            Err(refusal) => {
                vault.release(pending.amount, Some(pending.spent_day));
                refused(refusal.as_str())
            }
        };
        log_event(
            if outcome.sent { "transfer_sent" } else { "transfer_refused" },
            json!({ "owner": owner_id, "request_id": request_id, "receiver": receiver_id, "reason": outcome.reason }),
        );
        outcome
    }

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
        VerifierView {
            outlayer: self.pin.outlayer.clone(),
            project_id: self.pin.project_id.clone(),
            version_key: self.pin.version_key.clone(),
            audio_key: encode_digest(&self.pin.audio_key),
            relay_host: self.pin.relay_host.clone(),
            renderer: RENDERER_VERSION.to_string(),
        }
    }

    pub fn get_verifier_audio_key(&self) -> String {
        encode_digest(&self.pin.audio_key)
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
            template_epoch: vault.template_epoch,
            pending_transfer: vault.pending_transfer.as_ref().map(|p| PendingTransferView {
                request_id: U64(p.request_id),
                nonce: U64(p.nonce),
                receiver_id: p.receiver.account_id().clone(),
                amount: U128(p.amount.as_yoctonear()),
                requested_at_ns: U64(p.requested_at_ns),
            }),
            pending_withdrawal: vault.pending_withdrawal.as_ref().map(|w| PendingWithdrawalView {
                amount: U128(w.amount.as_yoctonear()),
                ready_at_ns: U64(w.ready_at_ns),
            }),
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
    fn payout(owner_id: AccountId, receiver_id: AccountId, amount: NearToken, spent_day: Option<u64>) -> Promise {
        Promise::new(receiver_id).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(PAYOUT_CALLBACK_GAS)
                .on_payout_settled(owner_id, U128(amount.as_yoctonear()), spent_day.map(U64)),
        )
    }
}
