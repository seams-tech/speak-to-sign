//! Helpers that the test files share. Each test file declares
//! `pub mod support;`: in a public module, a helper that one file does not
//! use gives no dead-code warning.

use spoken_intent::{
    normalize, parse_transfer, ChallengeWord, NearAccount, NearAmount, ParseResult, ParsedTransfer,
    SpokenAccount, CHALLENGE_WORDS,
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

pub fn challenge_word(word: &str) -> ChallengeWord {
    let index = CHALLENGE_WORDS
        .iter()
        .position(|candidate| *candidate == word)
        .expect("challenge word");
    ChallengeWord::from_index(index as u8).expect("index below 64")
}

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
