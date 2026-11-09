//! The spoken words of the characters of an account id that are not
//! letters: each separator and each digit is one word.

use alloc::vec::Vec;

use crate::numbers::digit_word;

/// The separators of a NEAR account id and their spoken words.
const SEPARATORS: [(char, &str); 3] = [('.', "dot"), ('-', "dash"), ('_', "underscore")];

/// The spoken word of a separator.
pub(crate) fn separator_word(c: char) -> Option<&'static str> {
    SEPARATORS
        .iter()
        .find(|(separator, _)| *separator == c)
        .map(|(_, word)| *word)
}

/// True for the spoken word of a separator.
pub(crate) fn is_separator_word(word: &str) -> bool {
    SEPARATORS.iter().any(|(_, spoken)| *spoken == word)
}

/// The words of `text`: each digit and each separator becomes its word, and
/// each run of other characters stays one word. "bob-1.testnet" gives "bob
/// dash one dot testnet".
pub(crate) fn spelled_parts(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut run_start: Option<usize> = None;
    for (index, c) in text.char_indices() {
        let Some(word) = char_word(c) else {
            run_start.get_or_insert(index);
            continue;
        };
        if let Some(start) = run_start.take() {
            parts.push(&text[start..index]);
        }
        parts.push(word);
    }
    if let Some(start) = run_start {
        parts.push(&text[start..]);
    }
    parts
}

/// The spoken word of a digit or a separator.
fn char_word(c: char) -> Option<&'static str> {
    if c.is_ascii_digit() {
        Some(digit_word(c as u8 - b'0'))
    } else {
        separator_word(c)
    }
}
