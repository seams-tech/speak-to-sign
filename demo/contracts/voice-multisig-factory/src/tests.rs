use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 10u128.pow(24);
/// The code hash of the tests: base58 of 32 bytes of 0x07.
const CODE_HASH: [u8; 32] = [7; 32];
const VERIFIER_KEY: &str = "ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U";

fn factory_id() -> AccountId {
    "vm.seams-v1.testnet".parse().unwrap()
}

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn code_hash_text() -> String {
    near_sdk::bs58::encode(CODE_HASH).into_string()
}

/// A call from `who` with `deposit` yoctoNEAR attached.
fn call(who: &AccountId, deposit: u128) {
    let context = VMContextBuilder::new()
        .current_account_id(factory_id())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .account_balance(NearToken::from_yoctonear(5 * NEAR))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build();
    testing_env!(context);
}

/// The factory's own callback, with `result` as the result of the creation.
fn callback(result: PromiseResult) {
    let context = VMContextBuilder::new()
        .current_account_id(factory_id())
        .predecessor_account_id(factory_id())
        .account_balance(NearToken::from_yoctonear(5 * NEAR))
        .build();
    testing_env!(context, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn setup() -> MultisigFactory {
    call(&factory_id(), 0);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    MultisigFactory::new(code_hash_text(), VERIFIER_KEY.to_owned())
}

fn signers() -> Vec<AccountId> {
    vec![account("alice"), account("bob")]
}

fn event(log: &str) -> Value {
    serde_json::from_str(log.strip_prefix("EVENT_JSON:").expect("an event log")).unwrap()
}

#[test]
fn new_keeps_the_settings() {
    let factory = setup();
    assert_eq!(
        factory.get_config(),
        FactoryView { code_hash: code_hash_text(), verifier_public_key: VERIFIER_KEY.to_owned(), names: 0 }
    );
}

#[test]
#[should_panic(expected = "code_hash must be base58 of 32 bytes")]
fn new_refuses_a_short_code_hash() {
    call(&factory_id(), 0);
    MultisigFactory::new(near_sdk::bs58::encode([7u8; 31]).into_string(), VERIFIER_KEY.to_owned());
}

#[test]
#[should_panic(expected = "code_hash must be base58 of 32 bytes")]
fn new_refuses_a_code_hash_that_is_not_base58() {
    call(&factory_id(), 0);
    MultisigFactory::new("0OIl".to_owned(), VERIFIER_KEY.to_owned());
}

#[test]
fn create_makes_the_account_in_one_receipt() {
    let mut factory = setup();
    call(&account("alice"), NEAR / 10);
    factory.create(signers(), 2).detach();

    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id.as_str(), "m1.vm.seams-v1.testnet");
    match receipts[0].actions.as_slice() {
        [
            MockAction::CreateAccount { .. },
            MockAction::Transfer { deposit, .. },
            MockAction::UseGlobalContract { contract_id, .. },
            MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. },
        ] => {
            assert_eq!(deposit.as_yoctonear(), NEAR / 10);
            // The Debug text of a code hash is its base58 text.
            assert!(format!("{contract_id:?}").contains(&code_hash_text()), "{contract_id:?}");
            assert_eq!(method_name, b"new");
            assert_eq!(attached_deposit.as_yoctonear(), 0);
            let args: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(
                args,
                serde_json::json!({
                    "signers": ["alice.testnet", "bob.testnet"],
                    "threshold": 2,
                    "verifier_public_key": VERIFIER_KEY,
                })
            );
        }
        other => panic!("unexpected actions: {other:?}"),
    }
    // The second receipt is the callback on the factory.
    assert_eq!(receipts[1].receiver_id, factory_id());
    assert_eq!(factory.get_config().names, 1);
}

#[test]
fn each_create_gets_the_next_name() {
    let mut factory = setup();
    call(&account("alice"), NEAR / 10);
    factory.create(signers(), 2).detach();
    call(&account("bob"), NEAR / 10);
    factory.create(signers(), 1).detach();
    assert_eq!(get_created_receipts()[0].receiver_id.as_str(), "m2.vm.seams-v1.testnet");
    assert_eq!(factory.get_config().names, 2);
}

#[test]
#[should_panic(expected = "attach at least 0.05 NEAR")]
fn create_refuses_a_small_deposit() {
    let mut factory = setup();
    call(&account("alice"), MIN_DEPOSIT.as_yoctonear() - 1);
    factory.create(signers(), 2).detach();
}

#[test]
#[should_panic(expected = "the caller must be one of the signers")]
fn create_refuses_a_caller_who_is_not_a_signer() {
    let mut factory = setup();
    call(&account("carol"), NEAR / 10);
    factory.create(signers(), 2).detach();
}

#[test]
fn on_create_names_the_multisig() {
    let mut factory = setup();
    let multisig: AccountId = "m1.vm.seams-v1.testnet".parse().unwrap();
    callback(PromiseResult::Successful(vec![]));
    let result = factory.on_create(multisig.clone(), account("alice"), U128(NEAR / 10), signers(), 2);
    assert_eq!(result, Some(multisig));
    assert!(get_created_receipts().is_empty());
    assert_eq!(
        event(&get_logs()[0]),
        serde_json::json!({
            "standard": "voice_multisig_factory",
            "version": "1.0.0",
            "event": "created",
            "data": [{
                "account": "m1.vm.seams-v1.testnet",
                "creator": "alice.testnet",
                "signers": ["alice.testnet", "bob.testnet"],
                "threshold": 2,
            }],
        })
    );
}

#[test]
fn on_create_sends_the_near_back_after_a_failure() {
    let mut factory = setup();
    let multisig: AccountId = "m1.vm.seams-v1.testnet".parse().unwrap();
    callback(PromiseResult::Failed);
    let result = factory.on_create(multisig, account("alice"), U128(NEAR / 10), signers(), 2);
    assert_eq!(result, None);

    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id, account("alice"));
    assert!(matches!(
        receipts[0].actions.as_slice(),
        [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == NEAR / 10
    ));
    assert_eq!(event(&get_logs()[0])["event"], "create_failed");
}
