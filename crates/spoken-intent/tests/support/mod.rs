//! Helpers that the test files share. Each test file declares
//! `pub mod support;`: in a public module, a helper that one file does not
//! use gives no dead-code warning.

use spoken_intent::{
    normalize, parse_transfer, NearAccount, NearAmount, ParseResult, ParsedTransfer, SpokenAccount,
};

pub const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// An implicit account: 64 lowercase hex characters.
pub const IMPLICIT_ACCOUNT: &str =
    "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

pub fn account(id: &str) -> SpokenAccount {
    SpokenAccount::new(id).expect("speakable account")
}

pub fn near_account(id: &str) -> NearAccount {
    NearAccount::new(id).expect("valid account")
}

pub fn near(hundredths: u64) -> NearAmount {
    NearAmount::from_hundredths(hundredths).expect("speakable amount")
}

/// The salt of every multisig approval in the tests.
pub const MULTISIG_SALT: [u8; 32] = [0x5a; 32];

/// The contacts of the parse and transcript checks. No two keys are
/// confusable.
pub fn contacts() -> Vec<SpokenAccount> {
    ["alice.testnet", "bob.testnet", "bob-1.testnet"]
        .into_iter()
        .map(account)
        .collect()
}

/// `normalize` and then `parse_transfer`, with [`contacts`].
pub fn parse(transcript: &str) -> ParseResult {
    parse_transfer(&normalize(transcript).expect("normalizable"), &contacts())
}

/// The parse of a transfer of `hundredths` to `receiver`.
pub fn parsed(receiver: &str, hundredths: u64) -> ParseResult {
    ParseResult::Transfer(ParsedTransfer {
        receiver: account(receiver),
        amount: near(hundredths),
    })
}
