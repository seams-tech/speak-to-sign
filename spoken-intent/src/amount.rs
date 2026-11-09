use alloc::string::String;
use alloc::vec::Vec;
use core::fmt::Write;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::numbers::{digit_value, digit_word, parse_integer_words, push_integer_words};
use crate::UnsupportedReason;

const YOCTO_PER_HUNDREDTH: u128 = 10_000_000_000_000_000_000_000;
const MAX_HUNDREDTHS: u64 = 100_000_000;

/// A NEAR amount that the grammar can speak: a whole multiple of 0.01 NEAR,
/// from 0.01 NEAR to 1,000,000 NEAR.
///
/// Borsh writes it as the `u128` yoctoNEAR value, and decoding refuses any
/// other value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NearAmount {
    hundredths: u32,
}

impl NearAmount {
    /// Accepts an exact yoctoNEAR amount. The crate never rounds.
    pub fn from_yocto(amount_yocto: u128) -> Result<Self, UnsupportedReason> {
        if amount_yocto % YOCTO_PER_HUNDREDTH != 0 {
            return Err(UnsupportedReason::AmountNotSpeakable);
        }
        let hundredths = u64::try_from(amount_yocto / YOCTO_PER_HUNDREDTH)
            .map_err(|_| UnsupportedReason::AmountNotSpeakable)?;
        Self::from_hundredths(hundredths)
    }

    /// Accepts an amount in units of 0.01 NEAR.
    pub fn from_hundredths(hundredths: u64) -> Result<Self, UnsupportedReason> {
        if hundredths == 0 || hundredths > MAX_HUNDREDTHS {
            return Err(UnsupportedReason::AmountNotSpeakable);
        }
        Ok(Self {
            hundredths: hundredths as u32,
        })
    }

    /// The amount in yoctoNEAR.
    pub fn yocto(self) -> u128 {
        u128::from(self.hundredths) * YOCTO_PER_HUNDREDTH
    }

    /// The amount in units of 0.01 NEAR.
    pub fn hundredths(self) -> u64 {
        u64::from(self.hundredths)
    }

    /// "1,250", "2.5" or "0.05".
    pub(crate) fn display(self) -> String {
        let whole = self.hundredths / 100;
        let fraction = self.hundredths % 100;
        let digits = alloc::format!("{whole}");
        let mut out = String::new();
        for (index, digit) in digits.chars().enumerate() {
            if index > 0 && (digits.len() - index) % 3 == 0 {
                out.push(',');
            }
            out.push(digit);
        }
        if fraction != 0 {
            let _ = write!(out, ".{}", fraction / 10);
            if fraction % 10 != 0 {
                let _ = write!(out, "{}", fraction % 10);
            }
        }
        out
    }

    /// "two point five": the integer words, then "point" and one word for
    /// each decimal digit, with no trailing zero.
    pub(crate) fn push_spoken_words(self, out: &mut Vec<&'static str>) {
        push_integer_words(u64::from(self.hundredths / 100), out);
        let fraction = (self.hundredths % 100) as u8;
        if fraction != 0 {
            out.push("point");
            out.push(digit_word(fraction / 10));
            if fraction % 10 != 0 {
                out.push(digit_word(fraction % 10));
            }
        }
    }

    /// Parses the canonical words of an amount.
    pub(crate) fn parse_spoken_words(words: &[&str]) -> Option<Self> {
        let (whole_words, fraction_words) = match words.iter().position(|word| *word == "point") {
            Some(index) => (&words[..index], &words[index + 1..]),
            None => (words, &[][..]),
        };
        let whole = parse_integer_words(whole_words)?;
        if fraction_words.len() > 2 || (words.contains(&"point") && fraction_words.is_empty()) {
            return None;
        }
        let mut fraction: u64 = 0;
        for (index, word) in fraction_words.iter().enumerate() {
            let digit = u64::from(digit_value(word)?);
            fraction += if index == 0 { digit * 10 } else { digit };
        }
        let amount = Self::from_hundredths(whole.checked_mul(100)?.checked_add(fraction)?).ok()?;
        let mut canonical = Vec::new();
        amount.push_spoken_words(&mut canonical);
        (canonical.as_slice() == words).then_some(amount)
    }
}

impl BorshSerialize for NearAmount {
    fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
        self.yocto().serialize(writer)
    }
}

impl BorshDeserialize for NearAmount {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let amount_yocto = u128::deserialize_reader(reader)?;
        Self::from_yocto(amount_yocto).map_err(|_| {
            borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "amount not speakable")
        })
    }
}
