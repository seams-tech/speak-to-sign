use alloc::borrow::ToOwned;
use alloc::string::String;
use alloc::vec::Vec;

/// One spoken word: lowercase ASCII letters only.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SpokenToken(String);

impl SpokenToken {
    pub(crate) fn from_static(word: &'static str) -> Self {
        Self(word.to_owned())
    }

    /// `letters` holds only `a-z` and is not empty.
    pub(crate) fn from_letters(letters: String) -> Self {
        debug_assert!(!letters.is_empty() && letters.bytes().all(|byte| byte.is_ascii_lowercase()));
        Self(letters)
    }

    /// The word.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The words of `tokens`, in order.
pub(crate) fn token_words(tokens: &[SpokenToken]) -> Vec<&str> {
    tokens.iter().map(SpokenToken::as_str).collect()
}

/// The words of `tokens` joined with single spaces. For the rendered tokens
/// of a request, this is [`RenderedIntentV1::spoken_text`], the text that
/// [`spoken_text_digest`](crate::spoken_text_digest) hashes.
///
/// [`RenderedIntentV1::spoken_text`]: crate::RenderedIntentV1::spoken_text
pub fn spoken_text(tokens: &[SpokenToken]) -> String {
    token_words(tokens).join(" ")
}
