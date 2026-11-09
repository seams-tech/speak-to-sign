//! A testnet faucet for the Speak-to-Sign demo.
//!
//! One `drip` call is one transaction for a new account: the faucet registers the account
//! with the USDC token and sends it USDC (two actions in one receipt, so both happen or
//! neither does), then sends it NEAR for gas. Each account gets the faucet once.
//!
//! Only the owner calls `drip`. On testnet the owner is the faucet account itself, and the
//! demo's API holds a function-call key that can call `drip` and nothing else.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupSet;
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, near, require};

#[cfg(test)]
mod tests;

/// The USDC token's `storage_balance_bounds` (min = max = 0.00125 NEAR).
pub const TOKEN_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
/// NEAR the faucet keeps free for the gas of its own calls.
pub const GAS_RESERVE: NearToken = NearToken::from_millinear(50);

const TOKEN_GAS: Gas = Gas::from_tgas(30);
const ON_DRIP_GAS: Gas = Gas::from_tgas(15);
const MEMO: &str = "Speak-to-Sign testnet faucet";

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Claimed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Faucet {
    owner: AccountId,
    token: AccountId,
    near_amount: NearToken,
    token_amount: u128,
    claimed: LookupSet<AccountId>,
    /// The drips that completed.
    drips: u64,
}

/// The faucet's settings and state, for `get_config`.
#[near(serializers = [json])]
pub struct FaucetView {
    pub owner: AccountId,
    pub token: AccountId,
    /// yoctoNEAR for each account.
    pub near_amount: U128,
    /// Token base units for each account.
    pub token_amount: U128,
    pub drips: u64,
    /// The NEAR the faucet can still give, after its storage and the gas reserve.
    pub free_near: U128,
}

#[near]
impl Faucet {
    #[init]
    pub fn new(owner: AccountId, token: AccountId, near_amount: U128, token_amount: U128) -> Self {
        Self {
            owner,
            token,
            near_amount: NearToken::from_yoctonear(near_amount.0),
            token_amount: token_amount.0,
            claimed: LookupSet::new(StorageKey::Claimed),
            drips: 0,
        }
    }

    /// Sends `account_id` the token amount and the NEAR amount, once. Owner only.
    pub fn drip(&mut self, account_id: AccountId) -> Promise {
        self.assert_owner();
        require!(!self.claimed.contains(&account_id), "This account already got the faucet");
        let needed = self.near_amount.saturating_add(TOKEN_STORAGE).saturating_add(GAS_RESERVE);
        require!(self.free_near() >= needed, "The faucet is out of NEAR");
        self.claimed.insert(account_id.clone());

        let register = json!({ "account_id": account_id, "registration_only": true }).to_string().into_bytes();
        let transfer = json!({ "receiver_id": account_id, "amount": U128(self.token_amount), "memo": MEMO })
            .to_string()
            .into_bytes();
        let callback = json!({ "account_id": account_id }).to_string().into_bytes();
        Promise::new(self.token.clone())
            .function_call("storage_deposit".to_owned(), register, TOKEN_STORAGE, TOKEN_GAS)
            .function_call("ft_transfer".to_owned(), transfer, NearToken::from_yoctonear(1), TOKEN_GAS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_drip".to_owned(),
                callback,
                NearToken::from_yoctonear(0),
                ON_DRIP_GAS,
            ))
    }

    /// After the token's register and transfer. If they failed (for example, the faucet has no
    /// USDC left), the account can try again and gets no NEAR. Otherwise it gets the NEAR.
    #[private]
    pub fn on_drip(&mut self, account_id: AccountId) -> bool {
        if env::promise_result_checked(0, 64).is_err() {
            self.claimed.remove(&account_id);
            env::log_str(&format!("The USDC transfer to {account_id} failed. Nothing was sent."));
            return false;
        }
        self.drips += 1;
        let _ = Promise::new(account_id).transfer(self.near_amount);
        true
    }

    /// Changes the amounts for the next drips. Owner only.
    pub fn set_amounts(&mut self, near_amount: U128, token_amount: U128) {
        self.assert_owner();
        self.near_amount = NearToken::from_yoctonear(near_amount.0);
        self.token_amount = token_amount.0;
    }

    pub fn has_claimed(&self, account_id: AccountId) -> bool {
        self.claimed.contains(&account_id)
    }

    pub fn get_config(&self) -> FaucetView {
        FaucetView {
            owner: self.owner.clone(),
            token: self.token.clone(),
            near_amount: U128(self.near_amount.as_yoctonear()),
            token_amount: U128(self.token_amount),
            drips: self.drips,
            free_near: U128(self.free_near().saturating_sub(GAS_RESERVE).as_yoctonear()),
        }
    }
}

impl Faucet {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the faucet owner can call this");
    }

    /// The balance that is not locked for the contract's storage.
    fn free_near(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
        env::account_balance().saturating_sub(storage)
    }
}
