//! The word check, Rule A: `spoken_intent::normalize_punctuated` reads the
//! Whisper transcript, and its tokens must equal `render(request).spoken`.
use spoken_intent::{normalize_punctuated, spoken_text, SpokenAccount, SpokenRequestV1, SpokenToken};

use crate::config::MAX_HEARD_BYTES;

/// The result of the word check.
#[derive(Debug, PartialEq, Eq)]
pub struct WordCheck {
    /// The heard tokens joined with spaces, or the cleaned transcript if it
    /// does not normalize. At most [`MAX_HEARD_BYTES`].
    pub heard: String,
    /// The heard tokens equal the expected tokens.
    pub matched: bool,
    /// The word edit distance from the heard tokens to the expected tokens.
    /// `None` if the text does not normalize.
    pub distance: Option<usize>,
    /// (word edit distance to the closest near miss − distance to the
    /// expected text) × 1000 / expected word count. `None` if the confusion
    /// set is empty or the text does not normalize.
    pub margin_milli: Option<i32>,
}

/// Rule A. `contacts` are the known accounts from the input, with the
/// receiver; `confusions` is `confusion_set(request, contacts)`.
pub fn check_words(
    transcript: &str,
    contacts: &[SpokenAccount],
    expected: &[SpokenToken],
    confusions: &[Vec<SpokenToken>],
) -> WordCheck {
    let Ok(tokens) = normalize_punctuated(transcript, contacts) else {
        return WordCheck { heard: cut(&printable(transcript)), matched: false, distance: None, margin_milli: None };
    };
    let heard_words: Vec<&str> = tokens.iter().map(SpokenToken::as_str).collect();
    let expected_words: Vec<&str> = expected.iter().map(SpokenToken::as_str).collect();
    let to_expected = edit_distance(&heard_words, &expected_words);
    let to_near_miss = confusions
        .iter()
        .map(|variant| {
            let words: Vec<&str> = variant.iter().map(SpokenToken::as_str).collect();
            edit_distance(&heard_words, &words)
        })
        .min();
    let margin_milli = match to_near_miss {
        Some(near) if !expected.is_empty() => {
            Some(((near as i64 - to_expected as i64) * 1_000 / expected.len() as i64) as i32)
        }
        _ => None,
    };
    WordCheck {
        heard: cut(&spoken_text(&tokens)),
        matched: tokens.as_slice() == expected,
        distance: Some(to_expected),
        margin_milli,
    }
}

/// A note summary is free text, so one word heard in another way is
/// forgiven when the summary has at least this many words.
const SUMMARY_FORGIVE_MIN_WORDS: usize = 4;

/// The word decision. A transfer, an approval, a rating and a merge
/// approval need the exact words. A note summary also passes with one word
/// changed or dropped, when the heard words are still closer to the summary
/// than to every near miss. An added word is as close to the near miss with
/// "not" in its place, so it does not pass, and an added or dropped "not"
/// never passes.
pub(crate) fn words_pass(request: &SpokenRequestV1, check: &WordCheck, expected_words: usize) -> bool {
    if check.matched {
        return true;
    }
    matches!(request, SpokenRequestV1::CommunityNote { .. })
        && expected_words >= SUMMARY_FORGIVE_MIN_WORDS
        && check.distance == Some(1)
        && check.margin_milli.is_some_and(|margin| margin > 0)
}

/// Word-level Levenshtein distance.
fn edit_distance(left: &[&str], right: &[&str]) -> usize {
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (row, left_word) in left.iter().enumerate() {
        let mut next = Vec::with_capacity(right.len() + 1);
        next.push(row + 1);
        for (column, right_word) in right.iter().enumerate() {
            let substitute = previous[column] + usize::from(left_word != right_word);
            next.push(substitute.min(previous[column + 1] + 1).min(next[column] + 1));
        }
        previous = next;
    }
    previous[right.len()]
}

/// Keeps `a-z`, digits, apostrophes and spaces, so the public `heard` field
/// holds no other characters.
fn printable(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '\'' { c.to_ascii_lowercase() } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Cuts ASCII text at a word end at or below [`MAX_HEARD_BYTES`].
fn cut(text: &str) -> String {
    cut_at(text, MAX_HEARD_BYTES)
}

/// Cuts ASCII text at a word end at or below `max` bytes.
pub fn cut_at(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let head = &text[..end];
    match head.rfind(' ') {
        Some(end) => head[..end].to_string(),
        None => head.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use spoken_intent::{confusion_set, render, NearAccount, NearAmount, Network, SpokenRequestV1};

    fn account(id: &str) -> SpokenAccount {
        SpokenAccount::new(id).unwrap()
    }

    fn transfer(receiver: &str, hundredths: u64) -> SpokenRequestV1 {
        SpokenRequestV1::AccountTransfer {
            network: Network::Testnet,
            owner: NearAccount::new("owner.testnet").unwrap(),
            receiver: account(receiver),
            amount: NearAmount::from_hundredths(hundredths).unwrap(),
        }
    }

    #[test]
    fn exact_text_matches() {
        let request = transfer("alice.testnet", 2_500);
        let rendered = render(&request);
        let contacts = [account("alice.testnet"), account("bob.testnet")];
        let confusions = confusion_set(&request, &contacts);
        let check = check_words("send twenty five near to alice dot testnet", &contacts, &rendered.spoken, &confusions);
        assert!(check.matched);
        assert_eq!(check.heard, "send twenty five near to alice dot testnet");
        // The closest near miss is one word away, of eight words.
        assert_eq!(check.margin_milli, Some(125));
    }

    #[test]
    fn whisper_style_transcripts_match() {
        let contacts = [account("alice.testnet"), account("bob-1.testnet"), account("seams-v1.testnet")];
        for (heard, receiver, hundredths) in [
            (" Send 25 NEAR to alice.testnet.", "alice.testnet", 2_500),
            ("Send 2.5 NEAR to bob-1.testnet.", "bob-1.testnet", 250),
            ("Send 1,300 NIR to alice.testnet", "alice.testnet", 130_000),
            // Staging: the unit heard as "year".
            ("Send 0.01 year to seams-v1.testnet.", "seams-v1.testnet", 1),
            ("Sent 25 NIA to alice.testnode.", "alice.testnet", 2_500),
            // Separators said differently or left out, and "oh" for zero.
            ("Send 0.01 NEAR to seams v one.", "seams-v1.testnet", 1),
            ("Send point oh one NEAR to seams hyphen v1 period testnet.", "seams-v1.testnet", 1),
            ("Send 25 NEAR to alice.", "alice.testnet", 2_500),
        ] {
            let request = transfer(receiver, hundredths);
            let rendered = render(&request);
            let check = check_words(heard, &contacts, &rendered.spoken, &[]);
            assert!(check.matched, "{heard}: {check:?}");
            assert_eq!(check.heard, rendered.spoken_text);
            assert_eq!(check.margin_milli, None);
        }
    }

    #[test]
    fn near_misses_are_refused() {
        let request = transfer("alice.testnet", 2_500);
        let rendered = render(&request);
        let contacts = [account("alice.testnet"), account("alicia.testnet")];
        let confusions = confusion_set(&request, &contacts);
        for heard in [
            "send twenty six near to alice dot testnet",
            "Send 26 NEAR to alice.testnet.",
            "send two hundred fifty near to alice dot testnet",
            "send twenty five near to alicia dot testnet",
            "do not send twenty five near to alice dot testnet",
            "send twenty five near to alice dot testnet and send one hundred near to bob dot testnet",
            "send near to alice dot testnet",
            "approve twenty five near to alice dot testnet",
            "send twenty five near to alice dot testnet please",
            "Send 25 NEAR to mallory.testnet.",
            "",
        ] {
            let check = check_words(heard, &contacts, &rendered.spoken, &confusions);
            assert!(!check.matched, "{heard}");
        }
        let check = check_words("send twenty six near to alice dot testnet", &contacts, &rendered.spoken, &confusions);
        // One word from the expected text and zero from a near miss.
        assert_eq!(check.margin_milli, Some(-125));
    }

    #[test]
    fn text_that_does_not_normalize_is_refused_and_cleaned() {
        let rendered = render(&transfer("alice.testnet", 100));
        let check = check_words("Send <unk> one NEAR!", &[account("alice.testnet")], &rendered.spoken, &[]);
        assert!(!check.matched);
        assert_eq!(check.heard, "send unk one near");
        assert_eq!(check.margin_milli, None);
    }

    #[test]
    fn heard_is_cut_at_a_word_end() {
        let rendered = render(&transfer("alice.testnet", 100));
        let long = "near ".repeat(100);
        let check = check_words(&long, &[], &rendered.spoken, &[]);
        assert!(check.heard.len() <= MAX_HEARD_BYTES);
        assert!(check.heard.ends_with("near"));
    }

    #[test]
    fn word_edit_distance() {
        assert_eq!(edit_distance(&["a", "b", "c"], &["a", "b", "c"]), 0);
        assert_eq!(edit_distance(&["a", "c"], &["a", "b", "c"]), 1);
        assert_eq!(edit_distance(&[], &["a", "b"]), 2);
        assert_eq!(edit_distance(&["x", "b", "c"], &["a", "b", "c"]), 1);
    }
}
