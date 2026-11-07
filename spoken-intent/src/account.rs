use alloc::string::String;
use alloc::vec::Vec;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::numbers::digit_word;
use crate::render::SpokenToken;
use crate::UnsupportedReason;

/// A named NEAR account that the grammar can speak.
///
/// It follows the NEAR account id rules: 2 to 64 characters, parts split by
/// `.`, each part made of `a-z` and `0-9` with single `-` or `_` between
/// them. Implicit accounts (64 hex characters) and accounts that start with
/// `0x` are refused.
///
/// Borsh writes it as a string, and decoding refuses any other account.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SpokenAccount(String);

impl SpokenAccount {
    /// Accepts a speakable named account id.
    pub fn new(account_id: &str) -> Result<Self, UnsupportedReason> {
        if is_speakable(account_id) {
            Ok(Self(String::from(account_id)))
        } else {
            Err(UnsupportedReason::AccountNotSpeakable)
        }
    }

    /// The account id.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// "bob-1.testnet" gives "bob dash one dot testnet": each run of letters
    /// is one word, each digit is one word, and each separator is a word.
    pub(crate) fn spoken_tokens(&self) -> Vec<SpokenToken> {
        let mut tokens = Vec::new();
        let mut letters = String::new();
        for byte in self.0.bytes() {
            if byte.is_ascii_lowercase() {
                letters.push(char::from(byte));
                continue;
            }
            if !letters.is_empty() {
                tokens.push(SpokenToken::from_letters(core::mem::take(&mut letters)));
            }
            let word = match byte {
                b'.' => "dot",
                b'-' => "dash",
                b'_' => "underscore",
                digit => digit_word(digit - b'0'),
            };
            tokens.push(SpokenToken::from_static(word));
        }
        if !letters.is_empty() {
            tokens.push(SpokenToken::from_letters(letters));
        }
        tokens
    }
}

fn is_speakable(account_id: &str) -> bool {
    let bytes = account_id.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    if bytes.len() == 64 && bytes.iter().all(|byte| byte.is_ascii_hexdigit()) {
        return false;
    }
    if account_id.starts_with("0x") {
        return false;
    }
    account_id.split('.').all(is_valid_part)
}

fn is_valid_part(part: &str) -> bool {
    let bytes = part.as_bytes();
    let alphanumeric = |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    let (Some(first), Some(last)) = (bytes.first(), bytes.last()) else {
        return false;
    };
    if !alphanumeric(first) || !alphanumeric(last) {
        return false;
    }
    let mut previous_was_separator = false;
    for byte in bytes {
        let separator = *byte == b'-' || *byte == b'_';
        if !(separator || alphanumeric(byte)) || (separator && previous_was_separator) {
            return false;
        }
        previous_was_separator = separator;
    }
    true
}

impl BorshSerialize for SpokenAccount {
    fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
        self.0.serialize(writer)
    }
}

impl BorshDeserialize for SpokenAccount {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let account_id = String::deserialize_reader(reader)?;
        Self::new(&account_id).map_err(|_| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "account not speakable")
        })
    }
}
