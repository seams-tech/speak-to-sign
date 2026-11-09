use alloc::string::String;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::SpokenToken;

/// The most letters of a [`SpokenBranch`].
pub const MAX_BRANCH_LETTERS: usize = 32;

/// Why a text is not a [`SpokenBranch`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum InvalidBranch {
    /// The text is empty.
    Empty,
    /// The text has more than [`MAX_BRANCH_LETTERS`] letters.
    TooLong,
    /// The text holds a character that is not `a-z`: an uppercase letter, a
    /// digit, a separator or a space.
    Character,
}

/// The base branch of a pull request, which the approver says aloud.
///
/// It is one spoken word: 1 to [`MAX_BRANCH_LETTERS`] ASCII lowercase
/// letters (`a-z`), such as "main" or "develop". A branch name with a
/// digit, a separator or an uppercase letter has no stable spoken form, so
/// it is refused.
///
/// Borsh writes it as a string, and decoding refuses any text that
/// [`SpokenBranch::new`] refuses.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize)]
pub struct SpokenBranch(String);

impl SpokenBranch {
    /// Accepts only a speakable branch name.
    pub fn new(text: &str) -> Result<Self, InvalidBranch> {
        if text.is_empty() {
            return Err(InvalidBranch::Empty);
        }
        if !text.bytes().all(|byte| byte.is_ascii_lowercase()) {
            return Err(InvalidBranch::Character);
        }
        if text.len() > MAX_BRANCH_LETTERS {
            return Err(InvalidBranch::TooLong);
        }
        Ok(Self(String::from(text)))
    }

    /// The branch name.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The one word that the approver says.
    pub(crate) fn spoken_token(&self) -> SpokenToken {
        SpokenToken::from_letters(self.0.clone())
    }
}

impl BorshDeserialize for SpokenBranch {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let text = String::deserialize_reader(reader)?;
        Self::new(&text).map_err(|_| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "branch not speakable")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::format;

    #[test]
    fn lowercase_words_are_branches() {
        for text in ["main", "develop", "a", "abcdefghijklmnopqrstuvwxyzabcdef"] {
            assert_eq!(SpokenBranch::new(text).map(|b| b.0), Ok(String::from(text)));
        }
    }

    #[test]
    fn unspeakable_branches_are_refused() {
        for (text, reason) in [
            ("", InvalidBranch::Empty),
            ("Main", InvalidBranch::Character),
            ("v2", InvalidBranch::Character),
            ("release-1", InvalidBranch::Character),
            ("feature/x", InvalidBranch::Character),
            ("my_branch", InvalidBranch::Character),
            ("two words", InvalidBranch::Character),
            (" main", InvalidBranch::Character),
            ("ma\u{ef}n", InvalidBranch::Character),
        ] {
            assert_eq!(SpokenBranch::new(text), Err(reason), "{text}");
        }
        assert_eq!(
            SpokenBranch::new(&"a".repeat(MAX_BRANCH_LETTERS + 1)),
            Err(InvalidBranch::TooLong)
        );
        assert_eq!(
            SpokenBranch::new(&format!("{}A", "a".repeat(MAX_BRANCH_LETTERS))),
            Err(InvalidBranch::Character)
        );
    }

    #[test]
    fn borsh_refuses_unspeakable_text() {
        let valid = borsh::to_vec(&SpokenBranch::new("main").unwrap()).unwrap();
        assert_eq!(valid, [4, 0, 0, 0, b'm', b'a', b'i', b'n']);
        assert!(borsh::from_slice::<SpokenBranch>(&valid).is_ok());
        for text in ["Main", "", "v2"] {
            let invalid = borsh::to_vec(&String::from(text)).unwrap();
            assert!(
                borsh::from_slice::<SpokenBranch>(&invalid).is_err(),
                "{text}"
            );
        }
    }
}
