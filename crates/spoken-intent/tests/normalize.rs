//! Checks of `normalize`, the text step for models that write words only,
//! and of the transfers that `parse_transfer` reads from its tokens.

pub mod support;

use spoken_intent::{normalize, ParseRefusal, ParseResult};
use support::parse;

#[test]
fn speech_to_text_forms_normalize_to_the_rendered_tokens() {
    let expected = normalize("send one thousand two hundred fifty near to alice dot testnet");
    for transcript in [
        "Send 1,250 NEAR to alice.testnet.",
        "send 1250 near to alice dot testnet",
        "send one thousand two hundred and fifty near to alice dot testnet",
    ] {
        assert_eq!(normalize(transcript), expected, "{transcript}");
    }
    assert_eq!(
        normalize("send a hundred near to alice dot testnet"),
        normalize("send one hundred near to alice dot testnet")
    );
    assert_eq!(
        normalize("send twenty-five near to alice.testnet"),
        normalize("send twenty five near to alice dot testnet")
    );
    assert_eq!(normalize("send $25 to alice.testnet"), None);
}

#[test]
fn negations_and_added_clauses_are_refused() {
    let not_transfer = ParseResult::Refused(ParseRefusal::NotTransfer);
    assert_eq!(
        parse("do not send twenty five near to alice dot testnet"),
        not_transfer
    );
    assert_eq!(parse("Don't send 25 NEAR to alice.testnet"), not_transfer);
    assert_eq!(parse("never send 25 NEAR to alice.testnet"), not_transfer);
    assert_eq!(
        parse("send 25 NEAR to alice.testnet and send 100 NEAR to bob.testnet"),
        ParseResult::Refused(ParseRefusal::TrailingWords)
    );
    assert_eq!(
        parse("send 25 NEAR to alice.testnet not"),
        ParseResult::Refused(ParseRefusal::TrailingWords)
    );
    assert_eq!(
        parse("send 25 NEAR to alicia.testnet"),
        ParseResult::Refused(ParseRefusal::UnknownRecipient)
    );
}
