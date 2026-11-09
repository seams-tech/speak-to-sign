use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 10u128.pow(24);
const USDC: u128 = 1_000_000;

fn faucet_id() -> AccountId {
    "seams-faucet.testnet".parse().unwrap()
}

fn token_id() -> AccountId {
    "usdc.testnet".parse().unwrap()
}

fn user() -> AccountId {
    "alice.testnet".parse().unwrap()
}

/// A call from `who`, with `balance_near` NEAR on the faucet account.
fn call(who: &AccountId, balance_near: u128) {
    let context = VMContextBuilder::new()
        .current_account_id(faucet_id())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .account_balance(NearToken::from_yoctonear(balance_near * NEAR))
        .build();
    testing_env!(context);
}

/// The faucet's own callback, with `result` as the token's answer.
fn callback(result: PromiseResult) {
    let context = VMContextBuilder::new()
        .current_account_id(faucet_id())
        .predecessor_account_id(faucet_id())
        .account_balance(NearToken::from_yoctonear(5 * NEAR))
        .build();
    testing_env!(context, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn setup() -> Faucet {
    call(&faucet_id(), 5);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    Faucet::new(faucet_id(), token_id(), U128(NEAR / 5), U128(2 * USDC))
}

#[test]
fn new_keeps_the_settings() {
    let faucet = setup();
    let view = faucet.get_config();
    assert_eq!(view.owner, faucet_id());
    assert_eq!(view.token, token_id());
    assert_eq!(view.near_amount, U128(NEAR / 5));
    assert_eq!(view.token_amount, U128(2 * USDC));
    assert_eq!(view.drips, 0);
}

#[test]
fn drip_marks_the_account() {
    let mut faucet = setup();
    call(&faucet_id(), 5);
    let _ = faucet.drip(user());
    assert!(faucet.has_claimed(user()));
    assert!(!faucet.has_claimed("bob.testnet".parse().unwrap()));
}

#[test]
#[should_panic(expected = "This account already got the faucet")]
fn drip_twice_fails() {
    let mut faucet = setup();
    call(&faucet_id(), 5);
    let _ = faucet.drip(user());
    let _ = faucet.drip(user());
}

#[test]
#[should_panic(expected = "Only the faucet owner can call this")]
fn only_the_owner_drips() {
    let mut faucet = setup();
    call(&user(), 5);
    let _ = faucet.drip(user());
}

#[test]
#[should_panic(expected = "The faucet is out of NEAR")]
fn drip_needs_free_near() {
    let mut faucet = setup();
    // 0.2 NEAR + 0.00125 NEAR + the 0.05 NEAR reserve is more than 0.2 NEAR.
    call(&faucet_id(), 0);
    let _ = faucet.drip(user());
}

#[test]
fn a_good_transfer_counts_the_drip() {
    let mut faucet = setup();
    call(&faucet_id(), 5);
    let _ = faucet.drip(user());
    callback(PromiseResult::Successful(Vec::new()));
    assert!(faucet.on_drip(user()));
    assert_eq!(faucet.get_config().drips, 1);
    assert!(faucet.has_claimed(user()));
}

#[test]
fn a_failed_transfer_lets_the_account_try_again() {
    let mut faucet = setup();
    call(&faucet_id(), 5);
    let _ = faucet.drip(user());
    callback(PromiseResult::Failed);
    assert!(!faucet.on_drip(user()));
    assert_eq!(faucet.get_config().drips, 0);
    assert!(!faucet.has_claimed(user()));
    assert!(get_logs()[0].contains("failed"));
}

#[test]
fn the_owner_changes_the_amounts() {
    let mut faucet = setup();
    call(&faucet_id(), 5);
    faucet.set_amounts(U128(NEAR / 10), U128(USDC));
    let view = faucet.get_config();
    assert_eq!(view.near_amount, U128(NEAR / 10));
    assert_eq!(view.token_amount, U128(USDC));
}

#[test]
#[should_panic(expected = "Only the faucet owner can call this")]
fn others_cannot_change_the_amounts() {
    let mut faucet = setup();
    call(&user(), 5);
    faucet.set_amounts(U128(NEAR), U128(USDC));
}
