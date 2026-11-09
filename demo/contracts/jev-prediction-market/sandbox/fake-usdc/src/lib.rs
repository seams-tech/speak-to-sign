//! A fake NEP-141 USDC (6 decimals) for the sandbox test. Anyone can register and mint. It
//! follows the NEP-141 transfer rules that the market needs: `ft_transfer` and
//! `ft_transfer_call` take exactly 1 yoctoNEAR, a receiver must be registered, and
//! `ft_transfer_call` gives back what the receiver did not use. Never deploy it to testnet.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FakeUsdc {
    /// A registered account has an entry, maybe 0.
    balances: LookupMap<AccountId, u128>,
}

#[near]
impl FakeUsdc {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b") }
    }

    /// Registers an account (free here; the real USDC asks 0.00125 NEAR).
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        if !self.balances.contains_key(&account) {
            self.balances.insert(account, 0);
        }
    }

    /// Removes a registration with no balance, so that a test can send to an unregistered account.
    pub fn unregister(&mut self) {
        let account = env::predecessor_account_id();
        if self.balances.get(&account).copied().unwrap_or(0) != 0 {
            env::panic_str("the balance is not 0");
        }
        self.balances.remove(&account);
    }

    /// Registers the account and adds `amount` to it.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let balance = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id, balance + amount.0);
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> serde_json::Value {
        json!({ "spec": "ft-1.0.0", "name": "USDC", "symbol": "USDC", "decimals": 6 })
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let _ = memo;
        one_yocto();
        self.move_tokens(&env::predecessor_account_id(), &receiver_id, amount.0);
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> Promise {
        let _ = memo;
        one_yocto();
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, amount.0);
        Promise::new(receiver_id.clone())
            .function_call(
                "ft_on_transfer".to_owned(),
                json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(30),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "ft_resolve_transfer".to_owned(),
                json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            ))
    }

    /// Gives back the unused amount: all of it if the receiver failed. Returns the used amount.
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> PromiseOrValue<U128> {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(bytes) => serde_json::from_slice::<U128>(&bytes).map_or(amount.0, |u| u.0.min(amount.0)),
            Err(_) => amount.0,
        };
        let refund = unused.min(self.balances.get(&receiver_id).copied().unwrap_or(0));
        if refund > 0 {
            self.move_tokens(&receiver_id, &sender_id, refund);
        }
        PromiseOrValue::Value(U128(amount.0 - refund))
    }
}

impl FakeUsdc {
    fn move_tokens(&mut self, from: &AccountId, to: &AccountId, amount: u128) {
        if amount == 0 {
            env::panic_str("The amount should be a positive number");
        }
        let Some(to_balance) = self.balances.get(to).copied() else {
            env::panic_str(&format!("The account {to} is not registered"));
        };
        let from_balance = self.balances.get(from).copied().unwrap_or(0);
        if from_balance < amount {
            env::panic_str("The account doesn't have enough balance");
        }
        self.balances.insert(from.clone(), from_balance - amount);
        self.balances.insert(to.clone(), to_balance + amount);
    }
}

fn one_yocto() {
    if env::attached_deposit() != NearToken::from_yoctonear(1) {
        env::panic_str("Requires attached deposit of exactly 1 yoctoNEAR");
    }
}
