//! The factory of voice multisigs for the Speak-to-Sign demo, on testnet.
//!
//! One `create` call makes one voice multisig: a new account `m<N>.<factory>`
//! that uses the global voice-multisig code (`../voice-multisig/`) by its
//! code hash, with the caller's signers and threshold. The four actions are
//! one receipt, so all happen or none does: create the account, send it the
//! attached NEAR, use the global code, and call `new`.
//!
//! The new account has no access key. So no key can deploy other code to it,
//! and the code hash names code that cannot change. The signers and the
//! threshold are fixed at `new`, as for each voice multisig.
//!
//! The factory keeps none of the attached NEAR, and it keeps no list of the
//! multisigs: each `created` event names one.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, CryptoHash, Gas, NearToken, PanicOnDefault, Promise, env, near, require};

#[cfg(test)]
mod tests;

/// The least NEAR of a `create`. A multisig with its config and a few
/// proposals uses about 1,500 bytes of storage, 0.015 NEAR.
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(50);

/// The gas of `new` on the multisig. The sandbox measured 1.7 Tgas.
const NEW_GAS: Gas = Gas::from_tgas(10);
const ON_CREATE_GAS: Gas = Gas::from_tgas(10);

const EVENT_STANDARD: &str = "voice_multisig_factory";
const EVENT_VERSION: &str = "1.0.0";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MultisigFactory {
    /// The code hash of the global voice-multisig code.
    code_hash: CryptoHash,
    /// The ed25519 key of the verifier, for the `new` of each multisig.
    verifier_public_key: String,
    /// The names that `create` gave. The next multisig is `m<names + 1>`.
    names: u64,
}

/// The factory's settings and state, for `get_config`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FactoryView {
    /// Base58, as an explorer shows a code hash.
    pub code_hash: String,
    pub verifier_public_key: String,
    pub names: u64,
}

#[near]
impl MultisigFactory {
    /// Sets the code hash of the global voice-multisig code (base58 of 32
    /// bytes) and the verifier key. Only the factory account can call it. No
    /// method changes them later.
    #[init]
    #[private]
    pub fn new(code_hash: String, verifier_public_key: String) -> Self {
        let code_hash = near_sdk::bs58::decode(&code_hash)
            .into_vec()
            .ok()
            .and_then(|bytes| CryptoHash::try_from(bytes).ok())
            .unwrap_or_else(|| env::panic_str("code_hash must be base58 of 32 bytes"));
        Self { code_hash, verifier_public_key, names: 0 }
    }

    /// Creates a voice multisig with these signers and this threshold, and
    /// sends it all of the attached NEAR. The caller is one of the signers.
    /// Returns the account of the multisig, or `null` if the creation failed
    /// (for example, `new` refused the signers); then the caller gets the
    /// NEAR back.
    #[payable]
    pub fn create(&mut self, signers: Vec<AccountId>, threshold: u32) -> Promise {
        let creator = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT, "attach at least 0.05 NEAR: it pays for the storage of the multisig");
        require!(signers.contains(&creator), "the caller must be one of the signers");

        // A name is never used again, also after a failed creation.
        self.names += 1;
        let account: AccountId = format!("m{}.{}", self.names, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("the factory account is too long for a subaccount"));

        let init = json!({
            "signers": signers,
            "threshold": threshold,
            "verifier_public_key": self.verifier_public_key,
        })
        .to_string()
        .into_bytes();
        Promise::new(account.clone())
            .create_account()
            .transfer(deposit)
            .use_global_contract(self.code_hash)
            .function_call("new".to_owned(), init, NearToken::from_yoctonear(0), NEW_GAS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_CREATE_GAS)
                    .on_create(account, creator, U128(deposit.as_yoctonear()), signers, threshold),
            )
    }

    /// Records the result of the creation. On a failure no account exists,
    /// the NEAR came back to the factory, and the factory sends it to the
    /// creator.
    #[private]
    pub fn on_create(
        &mut self,
        account: AccountId,
        creator: AccountId,
        deposit: U128,
        signers: Vec<AccountId>,
        threshold: u32,
    ) -> Option<AccountId> {
        if !near_sdk::is_promise_success() {
            Promise::new(creator.clone()).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            emit("create_failed", CreateFailed { account: &account, creator: &creator });
            return None;
        }
        emit("created", Created { account: &account, creator: &creator, signers: &signers, threshold });
        Some(account)
    }

    pub fn get_config(&self) -> FactoryView {
        FactoryView {
            code_hash: near_sdk::bs58::encode(self.code_hash).into_string(),
            verifier_public_key: self.verifier_public_key.clone(),
            names: self.names,
        }
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Created<'a> {
    account: &'a AccountId,
    creator: &'a AccountId,
    signers: &'a [AccountId],
    threshold: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct CreateFailed<'a> {
    account: &'a AccountId,
    creator: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [T; 1],
}

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"voice_multisig_factory",...}`.
fn emit<T: Serialize>(event: &str, data: T) {
    let log = EventLog { standard: EVENT_STANDARD, version: EVENT_VERSION, event, data: [data] };
    let json =
        near_sdk::serde_json::to_string(&log).unwrap_or_else(|_| env::panic_str("cannot serialize the event"));
    env::log_str(&format!("EVENT_JSON:{json}"));
}
