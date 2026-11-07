use alloc::borrow::ToOwned;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use crate::numbers::{digit_word, push_integer_words};
use crate::{NearAmount, ProposalV1, SpokenAccount, SpokenRequestV1};

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

/// The text of one request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderedIntentV1 {
    /// The sentence that the confirm screen shows.
    pub display_text: String,
    /// The words that the person says.
    pub spoken: Vec<SpokenToken>,
    /// `spoken`, joined with single spaces.
    pub spoken_text: String,
}

/// Renders the one canonical sentence of a request.
pub fn render(request: &SpokenRequestV1) -> RenderedIntentV1 {
    let mut words = Words::default();
    let display_text = match request {
        SpokenRequestV1::VaultTransfer {
            receiver, amount, ..
        } => {
            words.push("send");
            push_transfer_words(&mut words, receiver, *amount);
            format!("Send {} NEAR to {}", amount.display(), receiver.as_str())
        }
        SpokenRequestV1::MultisigApproval {
            proposal_id,
            proposal,
            challenge,
            ..
        } => {
            words.push("approve");
            words.push("proposal");
            words.push_integer(*proposal_id);
            let body = push_proposal_words(&mut words, proposal);
            words.push(challenge[0].as_str());
            words.push(challenge[1].as_str());
            format!(
                "Approve proposal {proposal_id}: {body}. Then say: {} {}.",
                challenge[0].as_str(),
                challenge[1].as_str()
            )
        }
    };
    let spoken = words.0;
    let spoken_text = join_tokens(&spoken);
    RenderedIntentV1 {
        display_text,
        spoken,
        spoken_text,
    }
}

pub(crate) fn join_tokens(tokens: &[SpokenToken]) -> String {
    let mut text = String::new();
    for (index, token) in tokens.iter().enumerate() {
        if index > 0 {
            text.push(' ');
        }
        text.push_str(token.as_str());
    }
    text
}

#[derive(Default)]
struct Words(Vec<SpokenToken>);

impl Words {
    fn push(&mut self, word: &'static str) {
        self.0.push(SpokenToken::from_static(word));
    }

    fn push_integer(&mut self, value: u64) {
        let mut words = Vec::new();
        push_integer_words(value, &mut words);
        for word in words {
            self.push(word);
        }
    }

    fn push_account(&mut self, account: &SpokenAccount) {
        self.0.extend(account.spoken_tokens());
    }
}

/// "ten near to payroll dot testnet", after the verb.
fn push_transfer_words(words: &mut Words, receiver: &SpokenAccount, amount: NearAmount) {
    let mut amount_words = Vec::new();
    amount.push_spoken_words(&mut amount_words);
    for word in amount_words {
        words.push(word);
    }
    words.push("near");
    words.push("to");
    words.push_account(receiver);
}

/// Pushes the spoken words of a proposal and returns its display text.
fn push_proposal_words(words: &mut Words, proposal: &ProposalV1) -> String {
    match proposal {
        ProposalV1::Transfer { receiver, amount } => {
            words.push("send");
            push_transfer_words(words, receiver, *amount);
            format!("send {} NEAR to {}", amount.display(), receiver.as_str())
        }
        ProposalV1::AddMember { member } => {
            words.push("add");
            words.push("member");
            words.push_account(member);
            format!("add member {}", member.as_str())
        }
        ProposalV1::RemoveMember { member } => {
            words.push("remove");
            words.push("member");
            words.push_account(member);
            format!("remove member {}", member.as_str())
        }
        ProposalV1::SetThreshold { threshold } => {
            words.push("set");
            words.push("threshold");
            words.push("to");
            words.push_integer(u64::from(threshold.get()));
            format!("set threshold to {threshold}")
        }
        ProposalV1::SetVerifierVersion { version_hash } => {
            let digits = version_check_digits(version_hash);
            words.push("set");
            words.push("verifier");
            words.push("version");
            let mut display = String::from("set verifier version ");
            for digit in digits {
                words.push(digit_word(digit));
                display.push(char::from(b'0' + digit));
            }
            display
        }
    }
}

/// The number of version check digits that a "set verifier version"
/// proposal speaks. With eight, an attacker needs about 10^8 builds to find
/// another hash with the same spoken digits.
pub(crate) const VERSION_CHECK_DIGITS: usize = 8;

/// The first eight digits of the hash read as a big-endian integer in
/// decimal, without leading zeros. A value below 10,000,000 is padded with
/// leading zeros to eight digits.
pub(crate) fn version_check_digits(version_hash: &[u8; 32]) -> [u8; VERSION_CHECK_DIGITS] {
    let mut value = *version_hash;
    // Remainders of repeated division by 10 give the decimal digits, lowest
    // first. 2^256 has 78 decimal digits.
    let mut digits_low_first = Vec::with_capacity(78);
    while value.iter().any(|byte| *byte != 0) {
        let mut remainder: u16 = 0;
        for byte in value.iter_mut() {
            let current = (remainder << 8) | u16::from(*byte);
            *byte = (current / 10) as u8;
            remainder = current % 10;
        }
        digits_low_first.push(remainder as u8);
    }
    while digits_low_first.len() < VERSION_CHECK_DIGITS {
        digits_low_first.push(0);
    }
    let mut out = [0u8; VERSION_CHECK_DIGITS];
    for (slot, digit) in out.iter_mut().zip(digits_low_first.iter().rev()) {
        *slot = *digit;
    }
    out
}
