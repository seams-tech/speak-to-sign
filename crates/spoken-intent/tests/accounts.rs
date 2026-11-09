//! Checks of the account rules: which accounts the grammar speaks, which
//! accounts sound alike, and implicit owners.

pub mod support;

use spoken_intent::{
    phonetic_key, render, NearAccount, Network, SpokenAccount, SpokenRequestV1, UnsupportedReason,
};
use support::{account, near, near_account, IMPLICIT_ACCOUNT};

#[test]
fn sound_alike_accounts_are_confusable() {
    let confusable =
        |a: &str, b: &str| phonetic_key(&account(a)).is_confusable_with(&phonetic_key(&account(b)));
    assert!(confusable("alice.testnet", "alicia.testnet"));
    assert!(confusable("jon.testnet", "john.testnet"));
    assert!(confusable("rob.testnet", "bob.testnet"));
    assert!(confusable("payroll.testnet", "payrolls.testnet"));
    assert!(confusable("philip.testnet", "filip.testnet"));
    assert!(!confusable("alice.testnet", "bob.testnet"));
    assert!(!confusable("alice.testnet", "alice.near"));
}

#[test]
fn unspeakable_accounts_are_refused() {
    let unsupported = Err(UnsupportedReason::AccountNotSpeakable);
    assert_eq!(SpokenAccount::new(IMPLICIT_ACCOUNT), unsupported);
    assert_eq!(
        SpokenAccount::new(&format!("0x{}", "ab".repeat(20))),
        unsupported
    );
    assert_eq!(SpokenAccount::new("Alice.testnet"), unsupported);
    assert_eq!(SpokenAccount::new("alice..testnet"), unsupported);
}

#[test]
fn an_implicit_owner_is_valid_and_not_said() {
    let eth = format!("0x{}", "ab".repeat(20));
    for owner in [IMPLICIT_ACCOUNT, eth.as_str()] {
        let request = SpokenRequestV1::AccountTransfer {
            network: Network::Testnet,
            owner: near_account(owner),
            receiver: account("alice.testnet"),
            amount: near(50),
        };
        assert_eq!(
            render(&request).spoken_text,
            "send zero point five near to alice dot testnet"
        );
        let bytes = borsh::to_vec(&request).expect("serializes");
        assert_eq!(
            borsh::from_slice::<SpokenRequestV1>(&bytes).expect("decodes"),
            request
        );
    }
    assert!(NearAccount::new("Alice.testnet").is_err());
    assert!(NearAccount::new("alice..testnet").is_err());
    assert!(NearAccount::new("a").is_err());
}
