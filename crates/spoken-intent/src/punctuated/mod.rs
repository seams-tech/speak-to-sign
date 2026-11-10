//! The reading of a transcript from a speech-to-text model that writes
//! numerals, punctuation and account ids (Whisper). It has three stages: the
//! text step (`text_step`), the send-slot rules (`slots`) and the recipient
//! match by sound (`recipient`).
//!
//! [`normalize`](crate::normalize()) stays the text step for CTC models,
//! which write words only.

mod recipient;
mod slots;
mod text_step;

use alloc::vec::Vec;

use crate::token::SpokenToken;
use crate::{normalize, SpokenAccount};

use recipient::match_recipient;
pub(crate) use slots::SEND_FORMS;
use slots::{two_heard_as_to, unit_slot};
use text_step::clean_punctuated;

/// Whole-word aliases: a word that Whisper writes for a grammar word. No
/// alias is a grammar word, and each target is one.
pub const PUNCTUATED_ALIASES: [(&str, &str); 3] =
    [("approved", "approve"), ("nir", "near"), ("neer", "near")];

/// Why [`normalize_punctuated`] refuses a transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PunctuatedRefusal {
    /// [`normalize`] refuses the cleaned text.
    NotNormalizable,
    /// A word after "to" is empty, or it is longer than 64 bytes (the
    /// longest NEAR account id), so it is not a word of any account.
    RecipientUnkeyable,
    /// The phonetic key of the words after "to" equals no contact's key.
    RecipientNotContact,
    /// The phonetic key of the words after "to" equals the keys of two or
    /// more contacts.
    RecipientAmbiguous,
}

/// Maps a transcript from a punctuating speech-to-text model to spoken
/// tokens.
///
/// Text step, for each whitespace-separated word of the lowercase,
/// trimmed transcript (final `. , ! ?` removed):
///
/// 1. If the word without edge punctuation is in [`PUNCTUATED_ALIASES`], it
///    becomes the alias target.
/// 2. If the word directly follows "version" and holds digits with only `,`
///    or `-` between them, each digit becomes one word ("10374" becomes
///    "one zero three seven four"). The check digits of a "set verifier
///    version" proposal are not a number.
/// 3. If the word without edge punctuation holds a letter and a separator
///    (`-` `_` `.`), or letters and digits, it is an account id: each digit
///    becomes one word and each separator its word ("ops-42.testnet" becomes
///    "ops dash four two dot testnet").
/// 4. Any other word keeps its letters and numerals: final `. , ! ?` are
///    removed, a `,` between two digits is removed, a `.` between two
///    characters that are not both digits becomes "dot", and `-` and `_`
///    become "dash" and "underscore".
///
/// Then [`normalize`] reads the text.
///
/// Slot rules, only in a send sentence:
///
/// - Verb: a first word that Whisper writes for "send" ("sent", "sends")
///   becomes "send".
/// - Amount: "to" or "too" alone between "send" and "near to" becomes
///   "two". In the amount slot, a word heard for a number word ("free",
///   "for", "oh") becomes that number word, "dot" becomes "point", "dash" is
///   removed, and an amount that starts with "point" gets "zero" first.
/// - Unit: a word heard for "near" ("nia", "here", "year") directly before
///   "to" becomes "near". If no unit is heard after the amount, "near" is put
///   in before "to".
/// - Network suffix, in the recipient step: a word heard for "testnet"
///   ("testnut", "test node") becomes "testnet", and a "dot" that Whisper
///   drops before a final "testnet" is put back.
///
/// The slot rules change only words that hold no value: the verb, the unit,
/// the network suffix and a number word heard as a word that is not a
/// number. [`crate::parse_transfer`] and the caller still compare the amount
/// and the receiver with the request.
///
/// Recipient step: if a token "to" follows, the tokens after the first "to"
/// must match exactly one account in `contacts` by [`crate::phonetic_key`].
/// They are then replaced by the spoken tokens of that account. The match
/// reads the words as heard, with other words for a separator ("period" for
/// "dot") and with the network suffix rules. It tries equal keys first, then
/// keys one edit apart that start with the same two letters, and then both
/// again without the separator words and the network suffix.
///
/// Joined words: Whisper can join "to" with the account ("near toucane" for
/// "near to ken"). So if no "to" is heard, or the words after it match no
/// contact, the sound of the words after the amount is compared with the
/// sound of "near to" and each contact. If exactly one contact matches, the
/// tokens become the transfer to that contact. If not, a sentence with no
/// "to" keeps its tokens.
///
/// `contacts` must hold no two confusable keys; the caller checks this.
/// Other sentences (a multisig approval) have no slot rules and no recipient
/// step. [`crate::parse_transfer`] with the same `contacts` then reads a
/// transfer.
pub fn normalize_punctuated(
    transcript: &str,
    contacts: &[SpokenAccount],
) -> Result<Vec<SpokenToken>, PunctuatedRefusal> {
    let cleaned = clean_punctuated(transcript);
    let mut tokens = normalize(&cleaned).ok_or(PunctuatedRefusal::NotNormalizable)?;
    if !tokens
        .first()
        .is_some_and(|token| SEND_FORMS.contains(&token.as_str()))
    {
        return Ok(tokens);
    }
    tokens[0] = SpokenToken::from_static("send");
    two_heard_as_to(&mut tokens);
    unit_slot(&mut tokens);
    match_recipient(tokens, contacts)
}

#[cfg(test)]
mod tests {
    use super::recipient::TESTNET_SOUND_ALIKES;
    use super::slots::{AMOUNT_SOUND_ALIKES, UNIT_SOUND_ALIKES};
    use super::*;

    /// The fixed words of every rendered request, near miss and account
    /// suffix, besides number words.
    const GRAMMAR_WORDS: [&str; 39] = [
        "send",
        "near",
        "to",
        "dot",
        "dash",
        "underscore",
        "point",
        "approve",
        "reject",
        "proposal",
        "add",
        "remove",
        "member",
        "set",
        "threshold",
        "verifier",
        "version",
        "testnet",
        "and",
        "not",
        "do",
        "dont",
        "never",
        "this",
        "note",
        "is",
        "somewhat",
        "helpful",
        "merge",
        "close",
        "pull",
        "request",
        "into",
        "main",
        "master",
        "develop",
        "dev",
        "staging",
        "release",
    ];

    #[test]
    fn aliases_are_not_grammar_words() {
        let grammar =
            |word: &str| crate::numbers::is_number_word(word) || GRAMMAR_WORDS.contains(&word);
        for (from, to) in PUNCTUATED_ALIASES {
            assert!(!grammar(from), "{from}");
            assert!(grammar(to), "{to}");
        }
        // The slot sound-alikes are not grammar words, so a slot rule never
        // changes a word that the grammar reads.
        assert_eq!(SEND_FORMS[0], "send");
        let slot_words = SEND_FORMS[1..]
            .iter()
            .chain(&UNIT_SOUND_ALIKES)
            .chain(AMOUNT_SOUND_ALIKES.iter().map(|(heard, _)| heard))
            .chain(&TESTNET_SOUND_ALIKES);
        for word in slot_words {
            assert!(!grammar(word), "{word}");
        }
        for (_, number) in AMOUNT_SOUND_ALIKES {
            assert!(crate::numbers::is_number_word(number), "{number}");
        }
    }
}
