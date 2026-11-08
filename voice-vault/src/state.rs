//! Vault state. Each type admits only the values that the rules allow; the
//! constructors are the only way in.

use near_sdk::{near, AccountId, NearToken};
use spoken_intent::{phonetic_key, NearAmount, SpokenAccount};

use crate::error::VaultError;

pub const NS_PER_SECOND: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * NS_PER_SECOND;
/// By default a new contact becomes active after 2 minutes (plan Section
/// 4.4, testnet). `new(.., contact_delay_seconds)` can set another delay.
pub const CONTACT_DELAY_SECONDS: u64 = 120;
/// Higher limits take effect after 10 minutes. Lower limits apply at once.
pub const LIMITS_DELAY_NS: u64 = 600 * NS_PER_SECOND;
/// A withdrawal to the owner waits 10 minutes (plan Section 4.8, testnet).
pub const WITHDRAWAL_DELAY_NS: u64 = 600 * NS_PER_SECOND;
/// The verifier input allows at most 32 contacts (plan Section 7.2).
pub const MAX_CONTACTS: usize = 32;

/// A NEAR account that the grammar can speak. Only [`Speakable::new`] makes
/// one, so the vault never stores an account that `render` cannot say.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Speakable(AccountId);

impl Speakable {
    pub fn new(account_id: &AccountId) -> Result<Self, VaultError> {
        SpokenAccount::new(account_id.as_str()).map_err(|_| VaultError::AccountNotSpeakable)?;
        Ok(Self(account_id.clone()))
    }

    pub fn account_id(&self) -> &AccountId {
        &self.0
    }

    pub fn spoken(&self) -> SpokenAccount {
        // `new` checked this account, and state is written only by the vault.
        SpokenAccount::new(self.0.as_str()).unwrap_or_else(|_| near_sdk::env::abort())
    }
}

/// Per-transfer and daily limits with `0 < per_transfer <= daily`.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    per_transfer: NearToken,
    daily: NearToken,
}

impl Limits {
    pub fn new(per_transfer: NearToken, daily: NearToken) -> Result<Self, VaultError> {
        if per_transfer.is_zero() || per_transfer > daily {
            return Err(VaultError::InvalidLimits);
        }
        Ok(Self { per_transfer, daily })
    }

    pub fn default_testnet() -> Self {
        Self { per_transfer: NearToken::from_near(5), daily: NearToken::from_near(20) }
    }

    pub fn per_transfer(&self) -> NearToken {
        self.per_transfer
    }

    pub fn daily(&self) -> NearToken {
        self.daily
    }

    /// True if neither limit grows.
    pub fn is_tighter_or_equal(&self, current: &Limits) -> bool {
        self.per_transfer <= current.per_transfer && self.daily <= current.daily
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingLimits {
    pub limits: Limits,
    pub effective_at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contact {
    pub account: Speakable,
    pub active_at_ns: u64,
}

impl Contact {
    pub fn is_active(&self, now_ns: u64) -> bool {
        now_ns >= self.active_at_ns
    }
}

/// The spent amount of one UTC day (`block_timestamp / DAY_NS`).
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailySpend {
    pub day: u64,
    pub amount: NearToken,
}

/// A withdrawal to the owner. The amount is already out of `balance`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingWithdrawal {
    pub amount: NearToken,
    pub ready_at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    /// Any NEAR account, named or implicit. The spoken text does not say it.
    pub owner: AccountId,
    /// Funds that are free to send. A pending withdrawal and a payout in
    /// flight are already out of it.
    pub balance: NearToken,
    pub contacts: Vec<Contact>,
    pub limits: Limits,
    pub pending_limits: Option<PendingLimits>,
    pub spent: DailySpend,
    pub next_nonce: u64,
    pub pending_withdrawal: Option<PendingWithdrawal>,
}

impl Vault {
    pub fn new(owner: AccountId, balance: NearToken, now_ns: u64) -> Self {
        Self {
            owner,
            balance,
            contacts: Vec::new(),
            limits: Limits::default_testnet(),
            pending_limits: None,
            spent: DailySpend { day: now_ns / DAY_NS, amount: NearToken::from_yoctonear(0) },
            next_nonce: 0,
            pending_withdrawal: None,
        }
    }

    /// Applies a due limit change and starts a new day.
    pub fn settle(&mut self, now_ns: u64) {
        if let Some(pending) = &self.pending_limits {
            if now_ns >= pending.effective_at_ns {
                self.limits = pending.limits;
                self.pending_limits = None;
            }
        }
        let today = now_ns / DAY_NS;
        if self.spent.day != today {
            self.spent = DailySpend { day: today, amount: NearToken::from_yoctonear(0) };
        }
    }

    pub fn effective_limits(&self, now_ns: u64) -> Limits {
        match &self.pending_limits {
            Some(pending) if now_ns >= pending.effective_at_ns => pending.limits,
            _ => self.limits,
        }
    }

    pub fn spent_today(&self, now_ns: u64) -> NearToken {
        if self.spent.day == now_ns / DAY_NS {
            self.spent.amount
        } else {
            NearToken::from_yoctonear(0)
        }
    }

    pub fn contact(&self, account_id: &AccountId) -> Option<&Contact> {
        self.contacts.iter().find(|contact| contact.account.account_id() == account_id)
    }

    /// Refuses an unspeakable account, a duplicate, a full list and a
    /// sound-alike of any saved contact (active or in its delay).
    pub fn add_contact(&mut self, account_id: &AccountId, now_ns: u64, delay_ns: u64) -> Result<u64, VaultError> {
        let account = Speakable::new(account_id)?;
        if self.contact(account_id).is_some() {
            return Err(VaultError::ContactExists);
        }
        if self.contacts.len() >= MAX_CONTACTS {
            return Err(VaultError::TooManyContacts);
        }
        let key = phonetic_key(&account.spoken());
        if self.contacts.iter().any(|other| key.is_confusable_with(&phonetic_key(&other.account.spoken()))) {
            return Err(VaultError::SoundsLikeContact);
        }
        let active_at_ns = now_ns.saturating_add(delay_ns);
        self.contacts.push(Contact { account, active_at_ns });
        Ok(active_at_ns)
    }

    /// Checks a transfer against the nonce, contacts and limits. Returns the
    /// receiver and the speakable amount.
    pub fn check_transfer(
        &self,
        receiver_id: &AccountId,
        amount: NearToken,
        nonce: u64,
        now_ns: u64,
    ) -> Result<(Speakable, NearAmount), VaultError> {
        if nonce != self.next_nonce {
            return Err(VaultError::BadNonce);
        }
        let contact = self.contact(receiver_id).ok_or(VaultError::NotAContact)?;
        if !contact.is_active(now_ns) {
            return Err(VaultError::ContactNotActive);
        }
        let spoken_amount =
            NearAmount::from_yocto(amount.as_yoctonear()).map_err(|_| VaultError::AmountNotSpeakable)?;
        let limits = self.effective_limits(now_ns);
        if amount > limits.per_transfer() {
            return Err(VaultError::OverTransferLimit);
        }
        let spent = self.spent_today(now_ns).saturating_add(amount);
        if spent > limits.daily() {
            return Err(VaultError::OverDailyLimit);
        }
        if amount > self.balance {
            return Err(VaultError::InsufficientBalance);
        }
        Ok((contact.account.clone(), spoken_amount))
    }

    /// Returns a reservation to the balance and to today's limit.
    pub fn release(&mut self, amount: NearToken, spent_day: Option<u64>) {
        self.balance = self.balance.saturating_add(amount);
        if spent_day == Some(self.spent.day) {
            self.spent.amount = self.spent.amount.saturating_sub(amount);
        }
    }
}
