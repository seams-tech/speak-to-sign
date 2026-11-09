use alloc::string::String;
use alloc::vec::Vec;

use crate::numbers::{
    digit_word, is_multiplier_word, is_number_word, push_integer_words, split_hyphenated_tens,
};
use crate::token::SpokenToken;

/// The punctuation that speech-to-text output may put around a word.
/// [`normalize`] accepts it in a transcript and removes it from the edges of
/// each word.
const TRANSCRIPT_PUNCTUATION: [char; 9] = [',', '.', '!', '?', ';', ':', '\'', '"', '\u{2019}'];

/// The apostrophes, which [`normalize`] also removes inside a word ("don't"
/// becomes "dont").
const APOSTROPHES: [char; 2] = ['\'', '\u{2019}'];

/// Maps a speech-to-text transcript to spoken tokens.
///
/// - Letters become lowercase. Edge punctuation and apostrophes are dropped.
/// - A numeral ("25", "1,250", "2.5") becomes its number words, and each
///   digit after the point becomes one word.
/// - "twenty-five" becomes "twenty five".
/// - In any other word, `.`, `-` and `_` become "dot", "dash" and
///   "underscore", and each digit becomes one word ("bob-1.testnet").
/// - "a" before "hundred", "thousand" or a larger scale becomes "one".
/// - "and" between two number words is dropped.
///
/// Gives `None` for any other character, for a numeral above `u64::MAX`,
/// and for a transcript with no words.
pub fn normalize(transcript: &str) -> Option<Vec<SpokenToken>> {
    let mut words: Vec<String> = Vec::new();
    for raw in transcript.split(|c: char| c.is_ascii_whitespace()) {
        push_raw_word(raw, &mut words)?;
    }
    let mut tokens: Vec<SpokenToken> = Vec::with_capacity(words.len());
    for (index, word) in words.iter().enumerate() {
        let next = words.get(index + 1).map(String::as_str);
        if word == "a" && next.is_some_and(is_multiplier_word) {
            tokens.push(SpokenToken::from_static("one"));
            continue;
        }
        let previous_is_number = tokens
            .last()
            .is_some_and(|token| is_number_word(token.as_str()));
        if word == "and" && previous_is_number && next.is_some_and(is_number_word) {
            continue;
        }
        tokens.push(SpokenToken::from_letters(word.clone()));
    }
    (!tokens.is_empty()).then_some(tokens)
}

fn push_raw_word(raw: &str, words: &mut Vec<String>) -> Option<()> {
    let allowed = |c: char| {
        c.is_ascii_alphanumeric() || c == '-' || c == '_' || TRANSCRIPT_PUNCTUATION.contains(&c)
    };
    if !raw.chars().all(allowed) {
        return None;
    }
    let word: String = raw
        .trim_matches(&TRANSCRIPT_PUNCTUATION[..])
        .chars()
        .filter(|c| !APOSTROPHES.contains(c))
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if word.is_empty() {
        return Some(());
    }
    if is_numeral(&word) {
        return push_numeral(&word, words);
    }
    if let Some((tens, ones)) = split_hyphenated_tens(&word) {
        words.push(String::from(tens));
        words.push(String::from(ones));
        return Some(());
    }
    let mut letters = String::new();
    for c in word.chars() {
        if c.is_ascii_lowercase() {
            letters.push(c);
            continue;
        }
        if !letters.is_empty() {
            words.push(core::mem::take(&mut letters));
        }
        let spoken = match c {
            '.' => "dot",
            '-' => "dash",
            '_' => "underscore",
            '0'..='9' => digit_word(c as u8 - b'0'),
            _ => return None,
        };
        words.push(String::from(spoken));
    }
    if !letters.is_empty() {
        words.push(letters);
    }
    Some(())
}

/// "25", "1000", "2.5" or "1,250.75": digits, commas only in groups of
/// three, and at most one decimal point.
fn is_numeral(word: &str) -> bool {
    let (whole, fraction) = match word.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (word, None),
    };
    if let Some(fraction) = fraction {
        if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    let mut groups = whole.split(',');
    let Some(first) = groups.next() else {
        return false;
    };
    if first.is_empty() || !first.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let mut grouped = false;
    for group in groups {
        grouped = true;
        if group.len() != 3 || !group.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    !grouped || first.len() <= 3
}

fn push_numeral(word: &str, words: &mut Vec<String>) -> Option<()> {
    let (whole, fraction) = match word.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (word, ""),
    };
    let mut value: u64 = 0;
    for byte in whole.bytes().filter(u8::is_ascii_digit) {
        value = value.checked_mul(10)?.checked_add(u64::from(byte - b'0'))?;
    }
    let mut number_words = Vec::new();
    push_integer_words(value, &mut number_words);
    if !fraction.is_empty() {
        number_words.push("point");
        for byte in fraction.bytes() {
            number_words.push(digit_word(byte - b'0'));
        }
    }
    words.extend(number_words.into_iter().map(String::from));
    Some(())
}
