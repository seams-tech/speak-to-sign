//! English number words without "and" or hyphens: "one thousand two hundred
//! fifty". Parsing accepts only the canonical form that rendering produces.

use alloc::vec::Vec;

const ONES: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];

const TENS: [&str; 10] = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

const HUNDRED: &str = "hundred";

const SCALES: [(&str, u64); 6] = [
    ("quintillion", 1_000_000_000_000_000_000),
    ("quadrillion", 1_000_000_000_000_000),
    ("trillion", 1_000_000_000_000),
    ("billion", 1_000_000_000),
    ("million", 1_000_000),
    ("thousand", 1_000),
];

/// The word for one decimal digit.
pub(crate) fn digit_word(digit: u8) -> &'static str {
    ONES[usize::from(digit % 10)]
}

/// The digit that a digit word names.
pub(crate) fn digit_value(word: &str) -> Option<u8> {
    ONES[..10]
        .iter()
        .position(|candidate| *candidate == word)
        .map(|index| index as u8)
}

/// Pushes the canonical words of `value`.
pub(crate) fn push_integer_words(value: u64, out: &mut Vec<&'static str>) {
    if value == 0 {
        out.push(ONES[0]);
        return;
    }
    let mut rest = value;
    for (word, scale) in SCALES {
        let group = rest / scale;
        if group > 0 {
            push_below_thousand(group, out);
            out.push(word);
            rest %= scale;
        }
    }
    if rest > 0 {
        push_below_thousand(rest, out);
    }
}

fn push_below_thousand(value: u64, out: &mut Vec<&'static str>) {
    let hundreds = (value / 100) as usize;
    let rest = (value % 100) as usize;
    if hundreds > 0 {
        out.push(ONES[hundreds]);
        out.push(HUNDRED);
    }
    if rest >= 20 {
        out.push(TENS[rest / 10]);
        if rest % 10 != 0 {
            out.push(ONES[rest % 10]);
        }
    } else if rest > 0 {
        out.push(ONES[rest]);
    }
}

/// Parses canonical integer words. Any other word order gives `None`.
pub(crate) fn parse_integer_words(words: &[&str]) -> Option<u64> {
    if words.is_empty() {
        return None;
    }
    let mut total: u64 = 0;
    let mut group: u64 = 0;
    for word in words {
        if let Some(value) = small_value(word) {
            group = group.checked_add(value)?;
        } else if *word == HUNDRED {
            group = group.checked_mul(100)?;
        } else {
            let scale = scale_value(word)?;
            total = total.checked_add(group.checked_mul(scale)?)?;
            group = 0;
        }
    }
    let value = total.checked_add(group)?;
    let mut canonical = Vec::new();
    push_integer_words(value, &mut canonical);
    (canonical.as_slice() == words).then_some(value)
}

fn small_value(word: &str) -> Option<u64> {
    if let Some(index) = ONES.iter().position(|candidate| *candidate == word) {
        return Some(index as u64);
    }
    TENS.iter()
        .skip(2)
        .position(|candidate| *candidate == word)
        .map(|index| (index as u64 + 2) * 10)
}

fn scale_value(word: &str) -> Option<u64> {
    SCALES
        .iter()
        .find(|(candidate, _)| *candidate == word)
        .map(|(_, scale)| *scale)
}

/// True for "hundred" and the scale words.
pub(crate) fn is_multiplier_word(word: &str) -> bool {
    word == HUNDRED || scale_value(word).is_some()
}

/// True for every word that can appear in an integer.
pub(crate) fn is_number_word(word: &str) -> bool {
    small_value(word).is_some() || is_multiplier_word(word)
}

/// For "twenty-five": the two words, if both halves are number words.
pub(crate) fn split_hyphenated_tens(word: &str) -> Option<(&'static str, &'static str)> {
    let (tens, ones) = word.split_once('-')?;
    let tens = *TENS.iter().skip(2).find(|candidate| **candidate == tens)?;
    let ones = *ONES[1..10].iter().find(|candidate| **candidate == ones)?;
    Some((tens, ones))
}
