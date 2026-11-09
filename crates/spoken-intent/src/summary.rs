use alloc::string::String;
use alloc::vec::Vec;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::normalize_punctuated;
use crate::token::SpokenToken;

/// The most words of a [`SpokenSummary`]. Twelve plain words fit in one
/// 8 s clip.
pub const MAX_SUMMARY_WORDS: usize = 12;

/// The most bytes of a [`SpokenSummary`].
pub const MAX_SUMMARY_BYTES: usize = 120;

/// The first words that start the transfer grammar of
/// [`normalize_punctuated`]. A summary cannot start with one of them.
const TRANSFER_VERBS: [&str; 3] = ["send", "sent", "sends"];

/// The marks that can end a summary.
const END_PUNCTUATION: [char; 3] = ['.', '!', '?'];

/// Why a text is not a [`SpokenSummary`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum InvalidSummary {
    /// The text is empty.
    Empty,
    /// The text has more than [`MAX_SUMMARY_BYTES`] bytes.
    TooLong,
    /// The text has more than [`MAX_SUMMARY_WORDS`] words.
    TooManyWords,
    /// The text holds a character that a speech-to-text model can write in
    /// another way: a digit, an apostrophe, a hyphen, `@`, `#`, a URL, a
    /// space at an edge or two spaces together.
    Character,
    /// The first word is "send", "sent" or "sends".
    TransferVerb,
}

/// The short summary of a community note, which the author says aloud.
///
/// It is the only free text that a request holds. It has 1 to
/// [`MAX_SUMMARY_WORDS`] words of ASCII letters, with one space between two
/// words. A word can end with a comma, and the text can end with one `.`,
/// `!` or `?`. Its spoken words are the words that [`normalize_punctuated`]
/// reads from it, so the summary and a transcript of it give the same
/// tokens.
///
/// Borsh writes it as a string, and decoding refuses any text that
/// [`SpokenSummary::new`] refuses.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize)]
pub struct SpokenSummary(String);

impl SpokenSummary {
    /// Accepts only a speakable summary.
    pub fn new(text: &str) -> Result<Self, InvalidSummary> {
        if text.is_empty() {
            return Err(InvalidSummary::Empty);
        }
        if text.len() > MAX_SUMMARY_BYTES {
            return Err(InvalidSummary::TooLong);
        }
        let body = text.strip_suffix(END_PUNCTUATION).unwrap_or(text);
        let mut words = 0usize;
        for word in body.split(' ') {
            let letters = word.strip_suffix(',').unwrap_or(word);
            if letters.is_empty() || !letters.bytes().all(|byte| byte.is_ascii_alphabetic()) {
                return Err(InvalidSummary::Character);
            }
            if words == 0
                && TRANSFER_VERBS
                    .iter()
                    .any(|verb| letters.eq_ignore_ascii_case(verb))
            {
                return Err(InvalidSummary::TransferVerb);
            }
            words += 1;
        }
        if words > MAX_SUMMARY_WORDS {
            return Err(InvalidSummary::TooManyWords);
        }
        Ok(Self(String::from(text)))
    }

    /// The summary as the author wrote it.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The words that the author says.
    pub(crate) fn spoken_tokens(&self) -> Vec<SpokenToken> {
        // `new` admits only words of letters that do not start a transfer,
        // which the text step always reads.
        normalize_punctuated(&self.0, &[]).expect("a summary normalizes")
    }
}

impl BorshDeserialize for SpokenSummary {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let text = String::deserialize_reader(reader)?;
        Self::new(&text).map_err(|_| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "summary not speakable")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spoken(text: &str) -> String {
        let tokens = SpokenSummary::new(text).expect("summary").spoken_tokens();
        crate::token::spoken_text(&tokens)
    }

    #[test]
    fn plain_sentences_are_summaries() {
        assert_eq!(
            spoken("The bridge stays open, only one lane closes."),
            "the bridge stays open only one lane closes"
        );
        assert_eq!(spoken("Repairs take two weeks!"), "repairs take two weeks");
        // The aliases of the text step apply to the summary and to a
        // transcript of it in the same way.
        assert_eq!(
            spoken("The city approved the repairs"),
            "the city approve the repairs"
        );
        assert_eq!(
            spoken("A hundred people were there"),
            "one hundred people were there"
        );
    }

    #[test]
    fn transcripts_of_a_summary_match() {
        let expected =
            SpokenSummary::new("The bridge stays open, only one lane closes for two weeks.")
                .expect("summary")
                .spoken_tokens();
        for heard in [
            "the bridge stays open only one lane closes for two weeks",
            " The bridge stays open. Only one lane closes for 2 weeks.",
            "The bridge stays open! Only one lane closes, for two weeks?",
        ] {
            assert_eq!(
                normalize_punctuated(heard, &[]).as_deref(),
                Ok(expected.as_slice()),
                "{heard}"
            );
        }
        let negated = normalize_punctuated(
            "The bridge stays not open only one lane closes for two weeks",
            &[],
        );
        assert_ne!(negated.as_deref(), Ok(expected.as_slice()));
    }

    #[test]
    fn twelve_words_is_the_limit() {
        let twelve = "one two three four five six seven eight nine ten eleven twelve";
        assert!(SpokenSummary::new(twelve).is_ok());
        assert_eq!(
            SpokenSummary::new(&alloc::format!("{twelve} thirteen")),
            Err(InvalidSummary::TooManyWords)
        );
    }

    #[test]
    fn unstable_text_is_refused() {
        for (text, reason) in [
            ("", InvalidSummary::Empty),
            ("It isn't closed", InvalidSummary::Character),
            ("Closed for 6 months", InvalidSummary::Character),
            ("A two-week closure", InvalidSummary::Character),
            ("See city.gov", InvalidSummary::Character),
            ("Ask @metro", InvalidSummary::Character),
            (" Leading space", InvalidSummary::Character),
            ("Two  spaces", InvalidSummary::Character),
            ("Trailing space ", InvalidSummary::Character),
            ("Ends twice..", InvalidSummary::Character),
            (".", InvalidSummary::Character),
            ("Send help to the city", InvalidSummary::TransferVerb),
            ("SENT by the city", InvalidSummary::TransferVerb),
        ] {
            assert_eq!(SpokenSummary::new(text), Err(reason), "{text}");
        }
        let long = "abcdefghij ".repeat(12);
        assert_eq!(
            SpokenSummary::new(long.trim_end()),
            Err(InvalidSummary::TooLong)
        );
    }

    #[test]
    fn borsh_refuses_unspeakable_text() {
        let valid = borsh::to_vec(&SpokenSummary::new("The bridge stays open").unwrap()).unwrap();
        assert!(borsh::from_slice::<SpokenSummary>(&valid).is_ok());
        let invalid = borsh::to_vec(&String::from("Closed for 6 months")).unwrap();
        assert!(borsh::from_slice::<SpokenSummary>(&invalid).is_err());
    }
}
