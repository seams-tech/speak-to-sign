//! The text step: the transcript as plain words, before
//! [`normalize`](crate::normalize()) reads it.

use alloc::string::String;
use alloc::vec::Vec;

use super::PUNCTUATED_ALIASES;
use crate::numbers::digit_word;
use crate::spelling::{separator_word, spelled_parts};

/// Punctuation that is removed from the edges of a word before the alias,
/// check digit and account id checks.
const CHECK_EDGE_PUNCTUATION: [char; 7] = [',', '.', '!', '?', ';', ':', '"'];

/// Punctuation that the text step removes from the end of the transcript and
/// from the end of each word.
const FINAL_PUNCTUATION: [char; 4] = ['.', ',', '!', '?'];

/// The text step of [`super::normalize_punctuated`].
pub(super) fn clean_punctuated(transcript: &str) -> String {
    let text = strip_final_punctuation(transcript.trim()).to_ascii_lowercase();
    let mut out: Vec<String> = Vec::new();
    for word in text.split_ascii_whitespace() {
        let core = word.trim_matches(&CHECK_EDGE_PUNCTUATION[..]);
        let after_version = out.last().is_some_and(|last| last == "version");
        let spelled =
            if let Some((_, to)) = PUNCTUATED_ALIASES.iter().find(|(from, _)| *from == core) {
                String::from(*to)
            } else if let Some(words) = symbol_amount(core) {
                words
            } else if after_version && is_check_digits(core) {
                spell_check_digits(core)
            } else if is_account_token(core) {
                spelled_parts(core).join(" ")
            } else {
                clean_word(word)
            };
        out.push(spelled);
    }
    out.join(" ")
}

/// The money symbols that a model writes before an amount, with the word
/// for one unit and for more.
const MONEY_SYMBOLS: [(char, &str, &str); 3] =
    [('$', "dollar", "dollars"), ('\u{20ac}', "euro", "euros"), ('\u{a3}', "pound", "pounds")];

/// An amount that a model writes with a symbol, as the words that a person
/// says: "$40" is "40 dollars", "$1" is "1 dollar", "10%" is "10 percent".
/// The numeral stays a numeral: [`normalize`](crate::normalize()) reads it.
///
/// A money amount is a whole number, with `,` only between groups of three
/// digits. An amount with a decimal point ("$2.50") has no single spoken
/// form, so it is not read, and the transcript does not normalize.
fn symbol_amount(core: &str) -> Option<String> {
    let whole = |text: &str| {
        !text.is_empty()
            && text.split(',').enumerate().all(|(index, group)| {
                !group.is_empty()
                    && group.bytes().all(|byte| byte.is_ascii_digit())
                    && (index == 0 || group.len() == 3)
            })
            && (!text.contains(',') || text.split(',').next().is_some_and(|first| first.len() <= 3))
    };
    if let Some(number) = core.strip_suffix('%') {
        let (units, fraction) = number.split_once('.').unwrap_or((number, "0"));
        let digits = !fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit());
        return (whole(units) && digits).then(|| alloc::format!("{number} percent"));
    }
    let (_, one, many) = MONEY_SYMBOLS.iter().find(|(symbol, ..)| core.starts_with(*symbol))?;
    let number = &core[core.chars().next()?.len_utf8()..];
    if !whole(number) {
        return None;
    }
    let single = number.trim_start_matches('0') == "1";
    Some(alloc::format!("{number} {}", if single { one } else { many }))
}

fn strip_final_punctuation(mut text: &str) -> &str {
    while let Some(rest) = text.strip_suffix(FINAL_PUNCTUATION) {
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

/// One word for each digit; the `,` and `-` between digits are dropped.
fn spell_check_digits(core: &str) -> String {
    let words: Vec<&str> = core
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|byte| digit_word(byte - b'0'))
        .collect();
    words.join(" ")
}

fn is_account_token(core: &str) -> bool {
    let letter = core.bytes().any(|byte| byte.is_ascii_alphabetic());
    let separator = core.chars().any(|c| separator_word(c).is_some());
    let digit = core.bytes().any(|byte| byte.is_ascii_digit());
    letter && (separator || digit)
}

/// A word that is not an alias, check digits or an account id. It keeps its
/// letters and numerals, and its separators that are not part of a number
/// become words.
fn clean_word(word: &str) -> String {
    let word = strip_final_punctuation(word);
    let chars: Vec<char> = word.chars().collect();
    let mut out = String::with_capacity(word.len() + 8);
    for (index, &c) in chars.iter().enumerate() {
        let previous = index.checked_sub(1).map(|before| chars[before]);
        let next = chars.get(index + 1).copied();
        let alphanumeric = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
        let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
        let between_digits = digit(previous) && digit(next);
        match c {
            // A thousands separator: "1,300".
            ',' if between_digits => {}
            // A decimal point ("2.5") stays, and so does a point that is not
            // between two letters or digits.
            '.' if between_digits || !(alphanumeric(previous) && alphanumeric(next)) => out.push(c),
            _ => match separator_word(c) {
                Some(word) => {
                    out.push(' ');
                    out.push_str(word);
                    out.push(' ');
                }
                None => out.push(c),
            },
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
            // An amount with a symbol becomes the amount and its word.
            ("Pay $40 for two books.", "pay 40 dollars for two books"),
            ("It costs $1,250, I think", "it costs 1,250 dollars i think"),
            ("Give $1 to charity", "give 1 dollar to charity"),
            ("Pay \u{20ac}40 now", "pay 40 euros now"),
            ("\u{a3}1 each", "1 pound each"),
            ("Top 10% of users", "top 10 percent of users"),
            ("a 2.5% fee", "a 2.5 percent fee"),
            // An amount with cents has no single spoken form.
            ("Pay $2.50 now", "pay $2.50 now"),
            ("$ 40", "$ 40"),
        ] {
            assert_eq!(clean_punctuated(heard), cleaned, "{heard}");
        }
    }
}
