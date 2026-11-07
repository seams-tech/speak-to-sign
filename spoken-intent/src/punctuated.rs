//! The text step for a speech-to-text model that writes numerals,
//! punctuation and account ids (Whisper), and the recipient match by sound.
//!
//! [`normalize`] stays the text step for CTC models, which write words only.

use alloc::string::String;
use alloc::vec::Vec;

use crate::numbers::digit_word;
use crate::phonetic::words_key;
use crate::render::SpokenToken;
use crate::{normalize, phonetic_key, SpokenAccount};

/// Whole-word aliases: a word that Whisper writes for a grammar word. No
/// alias is a grammar word, and each target is one.
pub const PUNCTUATED_ALIASES: [(&str, &str); 3] =
    [("approved", "approve"), ("nir", "near"), ("neer", "near")];

/// Punctuation that is removed from the edges of a word before the alias and
/// account checks.
const EDGE: [char; 7] = [',', '.', '!', '?', ';', ':', '"'];

/// Why [`normalize_punctuated`] refuses a transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PunctuatedRefusal {
    /// [`normalize`] refuses the cleaned text.
    NotNormalizable,
    /// A word after "to" has one letter, so it has no phonetic key.
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
/// Recipient step: if the first token is "send" and a token "to" follows,
/// the tokens after the first "to" must have the same [`phonetic_key`] as
/// exactly one account in `contacts`. They are then replaced by the spoken
/// tokens of that account. `contacts` must be a vault's contacts, which hold
/// no two confusable keys. Other sentences (a multisig approval) have no
/// recipient step. [`crate::parse_transfer`] with the same `contacts` then
/// reads a transfer.
pub fn normalize_punctuated(
    transcript: &str,
    contacts: &[SpokenAccount],
) -> Result<Vec<SpokenToken>, PunctuatedRefusal> {
    let cleaned = clean_punctuated(transcript);
    let mut tokens = normalize(&cleaned).ok_or(PunctuatedRefusal::NotNormalizable)?;
    if tokens.first().map(SpokenToken::as_str) != Some("send") {
        return Ok(tokens);
    }
    let Some(to) = tokens.iter().position(|token| token.as_str() == "to") else {
        return Ok(tokens);
    };
    let recipient: Vec<&str> = tokens[to + 1..].iter().map(SpokenToken::as_str).collect();
    // A spoken account word may be one letter: "v1" is spoken "v one". The
    // vault refuses a new contact whose key equals, or is one edit from, a
    // saved contact, so short words do not make two contacts confusable.
    if recipient
        .iter()
        .any(|word| word.is_empty() || word.len() > 64)
    {
        return Err(PunctuatedRefusal::RecipientUnkeyable);
    }
    let key = words_key(&recipient);
    let mut matches = contacts
        .iter()
        .filter(|contact| phonetic_key(contact) == key);
    let contact = matches
        .next()
        .ok_or(PunctuatedRefusal::RecipientNotContact)?;
    if matches.next().is_some() {
        return Err(PunctuatedRefusal::RecipientAmbiguous);
    }
    tokens.truncate(to + 1);
    tokens.extend(contact.spoken_tokens());
    Ok(tokens)
}

/// The text step of [`normalize_punctuated`], before [`normalize`].
fn clean_punctuated(transcript: &str) -> String {
    let text = strip_final_punctuation(transcript.trim()).to_ascii_lowercase();
    let mut out: Vec<String> = Vec::new();
    for word in text.split_ascii_whitespace() {
        let core = word.trim_matches(&EDGE[..]);
        let after_version = out.last().is_some_and(|last| last == "version");
        let spelled =
            if let Some((_, to)) = PUNCTUATED_ALIASES.iter().find(|(from, _)| *from == core) {
                String::from(*to)
            } else if after_version && is_check_digits(core) {
                spell_check_digits(core)
            } else if is_account_token(core) {
                spell_account(core)
            } else {
                clean_word(word)
            };
        out.push(spelled);
    }
    out.join(" ")
}

fn strip_final_punctuation(mut text: &str) -> &str {
    while let Some(rest) = text.strip_suffix(['.', ',', '!', '?']) {
        text = rest.trim_end();
    }
    text
}

/// Digits, with only `,` or `-` between two of them: "10374", "115-54".
fn is_check_digits(core: &str) -> bool {
    let bytes = core.as_bytes();
    let digit = |index: usize| bytes.get(index).is_some_and(u8::is_ascii_digit);
    !bytes.is_empty()
        && bytes.iter().enumerate().all(|(index, byte)| {
            byte.is_ascii_digit()
                || (matches!(byte, b',' | b'-')
                    && index > 0
                    && digit(index - 1)
                    && digit(index + 1))
        })
}

fn is_account_token(core: &str) -> bool {
    let letter = core.bytes().any(|byte| byte.is_ascii_alphabetic());
    let separator = core.bytes().any(|byte| matches!(byte, b'-' | b'_' | b'.'));
    let digit = core.bytes().any(|byte| byte.is_ascii_digit());
    letter && (separator || digit)
}

/// One word for each digit; the `,` and `-` between digits are dropped.
fn spell_check_digits(core: &str) -> String {
    let words: Vec<&str> = core
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|byte| digit_word(byte - b'0'))
        .collect();
    words.join(" ")
}

/// One word for each digit and each separator; other characters stay
/// together as words.
fn spell_account(core: &str) -> String {
    let mut words: Vec<&str> = Vec::new();
    let mut run_start: Option<usize> = None;
    for (index, c) in core.char_indices() {
        let word = match c {
            '0'..='9' => digit_word(c as u8 - b'0'),
            '.' => "dot",
            '-' => "dash",
            '_' => "underscore",
            _ => {
                run_start.get_or_insert(index);
                continue;
            }
        };
        if let Some(start) = run_start.take() {
            words.push(&core[start..index]);
        }
        words.push(word);
    }
    if let Some(start) = run_start {
        words.push(&core[start..]);
    }
    words.join(" ")
}

/// Step 4 of the text step for one word.
fn clean_word(word: &str) -> String {
    let word = strip_final_punctuation(word);
    let chars: Vec<char> = word.chars().collect();
    let mut out = String::with_capacity(word.len() + 8);
    for (index, &c) in chars.iter().enumerate() {
        let previous = index.checked_sub(1).map(|before| chars[before]);
        let next = chars.get(index + 1).copied();
        let alphanumeric = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
        let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
        match c {
            ',' if digit(previous) && digit(next) => {}
            '.' if alphanumeric(previous)
                && alphanumeric(next)
                && !(digit(previous) && digit(next)) =>
            {
                out.push_str(" dot ")
            }
            '-' => out.push_str(" dash "),
            '_' => out.push_str(" underscore "),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_step_matches_rule_w2() {
        for (heard, cleaned) in [
            (
                "Send 74.15 near to ops-42.testnet.",
                "send 74.15 near to ops dash four two dot testnet",
            ),
            (
                "Send 1,300 NIR to rent-2026.testnet",
                "send 1300 near to rent dash two zero two six dot testnet",
            ),
            (
                "Approved Proposal 13 Ad Member Alice 2.Testnet",
                "approve proposal 13 ad member alice two dot testnet",
            ),
            (
                "to max99.testnet, neer",
                "to max nine nine dot testnet near",
            ),
            (
                "Version 10374 kim-08.testnet",
                "version one zero three seven four kim dash zero eight dot testnet",
            ),
            (
                "Set Verifier Version 115-54 Trumpet.",
                "set verifier version one one five five four trumpet",
            ),
            ("version 1,037 x", "version one zero three seven x"),
            (
                "version 10374. and",
                "version one zero three seven four and",
            ),
            ("send 100 near", "send 100 near"),
        ] {
            assert_eq!(clean_punctuated(heard), cleaned, "{heard}");
        }
    }

    /// The fixed words of every rendered request, near miss and account
    /// suffix, besides number words and challenge words.
    const GRAMMAR_WORDS: [&str; 23] = [
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
    ];

    #[test]
    fn aliases_are_not_grammar_words() {
        let grammar = |word: &str| {
            crate::numbers::is_number_word(word)
                || crate::CHALLENGE_WORDS.contains(&word)
                || GRAMMAR_WORDS.contains(&word)
        };
        for (from, to) in PUNCTUATED_ALIASES {
            assert!(!grammar(from), "{from}");
            assert!(grammar(to), "{to}");
        }
    }
}
