use alloc::vec::Vec;

use crate::render::SpokenToken;
use crate::{NearAmount, SpokenAccount};

/// The spoken fields of a transfer. The owner and the network are not spoken;
/// the caller takes them from the request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedTransfer {
    /// The account that receives the amount.
    pub receiver: SpokenAccount,
    /// The amount.
    pub amount: NearAmount,
}

/// Why a token list is not a transfer sentence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ParseRefusal {
    /// The words do not have the form "send <amount> near to <contact>".
    /// A negation ("do not send") or another verb gives this.
    NotTransfer,
    /// The amount words are not the canonical words of a speakable amount.
    Amount,
    /// The words after "to" are not the words of any contact.
    UnknownRecipient,
    /// A contact matches, but more words follow it.
    TrailingWords,
}

/// The result of [`parse_transfer`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseResult {
    /// The tokens are exactly the spoken form of this transfer.
    Transfer(ParsedTransfer),
    /// The tokens are refused.
    Refused(ParseRefusal),
}

/// Parses "send <amount> near to <contact>". It is the inverse of
/// [`crate::render`]: for each accepted list, the rendered `spoken` tokens
/// of the transfer equal `tokens`.
pub fn parse_transfer(tokens: &[SpokenToken], contacts: &[SpokenAccount]) -> ParseResult {
    let words: Vec<&str> = tokens.iter().map(SpokenToken::as_str).collect();
    if words.first() != Some(&"send") {
        return ParseResult::Refused(ParseRefusal::NotTransfer);
    }
    let Some(near_index) = words.iter().position(|word| *word == "near") else {
        return ParseResult::Refused(ParseRefusal::NotTransfer);
    };
    if words.get(near_index + 1) != Some(&"to") {
        return ParseResult::Refused(ParseRefusal::NotTransfer);
    }
    let Some(amount) = NearAmount::parse_spoken_words(&words[1..near_index]) else {
        return ParseResult::Refused(ParseRefusal::Amount);
    };
    let recipient = &tokens[near_index + 2..];
    let mut trailing = false;
    for contact in contacts {
        let contact_tokens = contact.spoken_tokens();
        if recipient == contact_tokens.as_slice() {
            return ParseResult::Transfer(ParsedTransfer {
                receiver: contact.clone(),
                amount,
            });
        }
        trailing |= recipient.starts_with(&contact_tokens);
    }
    ParseResult::Refused(if trailing {
        ParseRefusal::TrailingWords
    } else {
        ParseRefusal::UnknownRecipient
    })
}
