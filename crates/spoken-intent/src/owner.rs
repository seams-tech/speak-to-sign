use alloc::string::String;

use borsh::{BorshDeserialize, BorshSerialize};

/// The prefix of an [`AppOwner`]. A NEAR account id cannot hold ":", so an
/// application owner is never a NEAR account.
pub const APP_OWNER_PREFIX: &str = "app:";

/// The most bytes of an [`AppOwner`], with its prefix.
pub const MAX_APP_OWNER_BYTES: usize = 100;

/// The most bytes of a [`ConfirmationContext`].
pub const MAX_CONTEXT_BYTES: usize = 64;

/// The text is not a valid [`AppOwner`] or [`ConfirmationContext`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidIdentifier;

/// An owner that an application names: `app:` and then the id that the
/// application gives its user, for example `app:user-42` or
/// `app:shop.example:42`. The id is 1 or more characters of `a-z`, `0-9`,
/// `.`, `_`, `-` and `:`. The whole text is at most
/// [`MAX_APP_OWNER_BYTES`] bytes.
///
/// No key proves this owner. The application is trusted for the identity of
/// its users. The text never says the owner.
///
/// Borsh writes it as a string, and decoding refuses any other text.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AppOwner(String);

impl AppOwner {
    /// Accepts `app:<id>`.
    pub fn new(text: &str) -> Result<Self, InvalidIdentifier> {
        let id = text.strip_prefix(APP_OWNER_PREFIX).ok_or(InvalidIdentifier)?;
        let allowed = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-:".contains(&byte);
        if id.is_empty() || text.len() > MAX_APP_OWNER_BYTES || !id.bytes().all(allowed) {
            return Err(InvalidIdentifier);
        }
        Ok(Self(String::from(text)))
    }

    /// The owner text, with its prefix.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The name of the action that a confirmation is for, which the application
/// selects: for example `shop.example/checkout` or `eip155:1/transfer`. It
/// is 1 to [`MAX_CONTEXT_BYTES`] characters of `a-z`, `0-9`, `.`, `_`, `-`,
/// `:` and `/`.
///
/// It separates the applications and the actions: a verdict for one context
/// does not pass for another. The text never says it.
///
/// Borsh writes it as a string, and decoding refuses any other text.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConfirmationContext(String);

impl ConfirmationContext {
    /// Accepts a context name.
    pub fn new(text: &str) -> Result<Self, InvalidIdentifier> {
        let allowed = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-:/".contains(&byte);
        if text.is_empty() || text.len() > MAX_CONTEXT_BYTES || !text.bytes().all(allowed) {
            return Err(InvalidIdentifier);
        }
        Ok(Self(String::from(text)))
    }

    /// The context name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

macro_rules! borsh_as_checked_string {
    ($name:ident, $message:literal) => {
        impl BorshSerialize for $name {
            fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
                self.0.serialize(writer)
            }
        }

        impl BorshDeserialize for $name {
            fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
                let text = String::deserialize_reader(reader)?;
                Self::new(&text).map_err(|_| borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, $message))
            }
        }
    };
}

borsh_as_checked_string!(AppOwner, "invalid application owner");
borsh_as_checked_string!(ConfirmationContext, "invalid confirmation context");

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NearAccount;
    use alloc::format;

    #[test]
    fn app_owners() {
        for text in ["app:u", "app:user-42", "app:shop.example:42", "app:a_b.c-d:9"] {
            assert_eq!(AppOwner::new(text).unwrap().as_str(), text);
            // An application owner is never a NEAR account.
            assert!(NearAccount::new(text).is_err(), "{text}");
        }
        let longest = format!("app:{}", "a".repeat(MAX_APP_OWNER_BYTES - 4));
        assert!(AppOwner::new(&longest).is_ok());
        let too_long = format!("{longest}a");
        for text in ["", "app:", "alice.testnet", "app:User", "app:a b", "app:a/b", "App:a", "app:é", &too_long] {
            assert_eq!(AppOwner::new(text), Err(InvalidIdentifier), "{text}");
        }
    }

    #[test]
    fn contexts() {
        for text in ["a", "shop.example/checkout", "eip155:1/transfer", "login"] {
            assert_eq!(ConfirmationContext::new(text).unwrap().as_str(), text);
        }
        let too_long = "a".repeat(MAX_CONTEXT_BYTES + 1);
        for text in ["", "Shop", "a b", "a?b", &too_long] {
            assert_eq!(ConfirmationContext::new(text), Err(InvalidIdentifier), "{text}");
        }
    }

    #[test]
    fn borsh_refuses_other_text() {
        let good = borsh::to_vec(&AppOwner::new("app:u1").unwrap()).unwrap();
        assert_eq!(borsh::from_slice::<AppOwner>(&good).unwrap().as_str(), "app:u1");
        let bad = borsh::to_vec("alice.testnet").unwrap();
        assert!(borsh::from_slice::<AppOwner>(&bad).is_err());
        let bad = borsh::to_vec("A").unwrap();
        assert!(borsh::from_slice::<ConfirmationContext>(&bad).is_err());
    }
}
