//! The recipient step: the words after "to" become the spoken tokens of the
//! one contact that sounds like them.

use alloc::vec::Vec;

use super::slots::{amount_number, amount_slot_word, read_amount};
use super::PunctuatedRefusal;
use crate::account::MAX_ACCOUNT_ID_LEN;
use crate::phonetic::words_key;
use crate::spelling::is_separator_word;
use crate::token::{token_words, SpokenToken};
use crate::{PhoneticKey, SpokenAccount};

/// Other words that people say for a separator of an account name
/// ("seams hyphen v one period testnet"), in the recipient only.
const SEPARATOR_SAYINGS: [(&str, &str); 4] = [
    ("period", "dot"),
    ("point", "dot"),
    ("hyphen", "dash"),
    ("minus", "dash"),
];

/// Two-word sayings of a separator, in the recipient only.
const SEPARATOR_PAIR_SAYINGS: [(&str, &str, &str); 2] =
    [("full", "stop", "dot"), ("under", "score", "underscore")];

/// The network suffixes that a recipient can end with.
const NETWORK_WORDS: [&str; 2] = ["testnet", "near"];

/// Words that Whisper writes for the network suffix "testnet", as the last
/// word of the recipient.
pub(super) const TESTNET_SOUND_ALIKES: [&str; 10] = [
    "testnut",
    "testnit",
    "testnid",
    "testnode",
    "testmode",
    "testnote",
    "testament",
    "testnacht",
    "testnets",
    "testneat",
];

/// The second word when Whisper writes "testnet" as two words ("test node").
const TESTNET_SECOND_WORDS: [&str; 6] = ["net", "nut", "nit", "node", "note", "mode"];

/// The words that give the [`PhoneticKey`] of the recipient and of each
/// contact.
#[derive(Clone, Copy)]
enum KeyForm {
    /// All the words.
    Heard,
    /// The [`loose_words`]: no separator words and no network suffix.
    Loose,
}

/// How the key of a contact must compare with the key of the recipient.
#[derive(Clone, Copy)]
enum KeyMatch {
    /// The keys are equal.
    Equal,
    /// The keys are at most one edit apart, and they start with the same
    /// [`SAME_START_LETTERS`] letters.
    OneEditSameStart,
}

/// The passes of the recipient match, in order. Each pass tries every
/// reading of [`recipient_readings`].
const MATCH_PASSES: [(KeyForm, KeyMatch); 4] = [
    (KeyForm::Heard, KeyMatch::Equal),
    (KeyForm::Heard, KeyMatch::OneEditSameStart),
    (KeyForm::Loose, KeyMatch::Equal),
    (KeyForm::Loose, KeyMatch::OneEditSameStart),
];

/// The number of first key letters that a match one edit apart keeps. A
/// short name with another first sound ("zoe" for "leo", "jon" for "dan",
/// "anna" for "uma") is one edit away, so the first two letters must stay.
const SAME_START_LETTERS: usize = 2;

/// The recipient step of [`super::normalize_punctuated`], for a send
/// sentence after the slot rules.
pub(super) fn match_recipient(
    mut tokens: Vec<SpokenToken>,
    contacts: &[SpokenAccount],
) -> Result<Vec<SpokenToken>, PunctuatedRefusal> {
    let Some(to) = tokens.iter().position(|token| token.as_str() == "to") else {
        return Ok(joined_by_sound(&tokens, contacts).unwrap_or(tokens));
    };
    let recipient = token_words(&tokens[to + 1..]);
    // A spoken account word may be one letter: "v1" is spoken "v one". The
    // contacts hold no two keys that are equal or one edit apart, so short
    // words do not make two contacts confusable.
    if recipient
        .iter()
        .any(|word| word.is_empty() || word.len() > MAX_ACCOUNT_ID_LEN)
    {
        return Err(PunctuatedRefusal::RecipientUnkeyable);
    }
    let contact = match recipient_contact(&recipient, contacts) {
        Err(PunctuatedRefusal::RecipientNotContact) => {
            return joined_by_sound(&tokens, contacts)
                .ok_or(PunctuatedRefusal::RecipientNotContact);
        }
        other => other?,
    };
    tokens.truncate(to + 1);
    tokens.extend(contact.spoken_tokens());
    Ok(tokens)
}

/// The recipient match, pass by pass in the order of [`MATCH_PASSES`]. A
/// reading that matches two contacts ends the match as ambiguous.
fn recipient_contact<'a>(
    recipient: &[&str],
    contacts: &'a [SpokenAccount],
) -> Result<&'a SpokenAccount, PunctuatedRefusal> {
    let readings = recipient_readings(recipient);
    for (form, key_match) in MATCH_PASSES {
        for words in &readings {
            match contact_by_key(words, contacts, form, key_match) {
                Err(PunctuatedRefusal::RecipientNotContact) => continue,
                other => return other,
            }
        }
    }
    Err(PunctuatedRefusal::RecipientNotContact)
}

/// The recipient words as heard, then with the separators of
/// [`separators_said`], then each of these with the suffix of
/// [`testnet_heard_differently`], then each of these with
/// [`dot_before_testnet`].
fn recipient_readings<'a>(recipient: &[&'a str]) -> Vec<Vec<&'a str>> {
    let mut readings = Vec::from([recipient.to_vec()]);
    let said = separators_said(recipient);
    if said.as_slice() != recipient {
        readings.push(said);
    }
    let suffixed: Vec<Vec<&str>> = readings
        .iter()
        .filter_map(|words| testnet_heard_differently(words))
        .collect();
    readings.extend(suffixed);
    let with_dot: Vec<Vec<&str>> = readings
        .iter()
        .filter_map(|words| dot_before_testnet(words))
        .collect();
    readings.extend(with_dot);
    readings
}

/// Separator rule. A word of [`SEPARATOR_SAYINGS`] or a pair of
/// [`SEPARATOR_PAIR_SAYINGS`] in the recipient becomes its separator word
/// ("period" becomes "dot", "full stop" becomes "dot").
fn separators_said<'a>(recipient: &[&'a str]) -> Vec<&'a str> {
    let mut words = Vec::with_capacity(recipient.len());
    let mut index = 0;
    while index < recipient.len() {
        let word = recipient[index];
        let next = recipient.get(index + 1).copied();
        if let Some((_, _, separator)) = SEPARATOR_PAIR_SAYINGS
            .iter()
            .find(|(first, second, _)| *first == word && next == Some(*second))
        {
            words.push(*separator);
            index += 2;
            continue;
        }
        let said = SEPARATOR_SAYINGS.iter().find(|(said, _)| *said == word);
        words.push(said.map_or(word, |(_, separator)| *separator));
        index += 1;
    }
    words
}

/// Network suffix rule. If the recipient ends with a word of
/// [`TESTNET_SOUND_ALIKES`], or with "test" and a word of
/// [`TESTNET_SECOND_WORDS`], and an account word comes before it, it gives
/// the words with "testnet" in its place.
fn testnet_heard_differently<'a>(recipient: &[&'a str]) -> Option<Vec<&'a str>> {
    let (last, rest) = recipient.split_last()?;
    let rest = if TESTNET_SOUND_ALIKES.contains(last) {
        rest
    } else if TESTNET_SECOND_WORDS.contains(last) {
        rest.strip_suffix(&["test"])?
    } else {
        return None;
    };
    if rest.is_empty() {
        return None;
    }
    let mut words = rest.to_vec();
    words.push("testnet");
    Some(words)
}

/// Network suffix rule. Whisper can drop the spoken "dot" before the
/// network suffix ("seams v1 testnet", "alice testnet"). Its reading comes
/// after the reading as heard in [`recipient_readings`]. If the recipient
/// has a word and then ends with "testnet", and the word before "testnet"
/// is not "dot", it gives the words with "dot" before "testnet". These
/// words are then matched by [`crate::phonetic_key`] in the same way, so
/// they must still equal exactly one contact.
///
/// The rule adds no word that names an account: a recipient that is not a
/// contact stays refused, and a recipient of only "testnet" is not changed.
/// It does not replace a match as heard: "umidot testnet" keeps the key of
/// "uma dot testnet". On mainnet the suffix is "near", but this function
/// does not know the request network and "near" is also the amount unit, so
/// mainnet names have no such rule.
fn dot_before_testnet<'a>(recipient: &[&'a str]) -> Option<Vec<&'a str>> {
    let (last, rest) = recipient.split_last()?;
    if *last != "testnet" || rest.last().is_none_or(|word| *word == "dot") {
        return None;
    }
    let mut words = rest.to_vec();
    words.extend(["dot", "testnet"]);
    Some(words)
}

/// The one contact whose key in `form` matches the key of `words` by
/// `key_match`.
fn contact_by_key<'a>(
    words: &[&str],
    contacts: &'a [SpokenAccount],
    form: KeyForm,
    key_match: KeyMatch,
) -> Result<&'a SpokenAccount, PunctuatedRefusal> {
    let heard = form.key(words);
    only_match(
        contacts
            .iter()
            .filter(|contact| key_match.accepts(&form.contact_key(contact), &heard)),
    )
}

impl KeyForm {
    /// The key of spoken words in this form.
    fn key(self, words: &[&str]) -> PhoneticKey {
        match self {
            Self::Heard => words_key(words),
            Self::Loose => words_key(&loose_words(words)),
        }
    }

    /// The key of the spoken words of a contact in this form.
    fn contact_key(self, contact: &SpokenAccount) -> PhoneticKey {
        self.key(&token_words(&contact.spoken_tokens()))
    }
}

impl KeyMatch {
    fn accepts(self, contact_key: &PhoneticKey, heard: &PhoneticKey) -> bool {
        match self {
            Self::Equal => contact_key == heard,
            Self::OneEditSameStart => {
                let contact_start = contact_key.as_str().bytes().take(SAME_START_LETTERS);
                let heard_start = heard.as_str().bytes().take(SAME_START_LETTERS);
                contact_start.eq(heard_start) && contact_key.is_confusable_with(heard)
            }
        }
    }
}

/// The one item of `matches`. No item is
/// [`PunctuatedRefusal::RecipientNotContact`], and two or more are
/// [`PunctuatedRefusal::RecipientAmbiguous`].
fn only_match<T>(mut matches: impl Iterator<Item = T>) -> Result<T, PunctuatedRefusal> {
    let first = matches
        .next()
        .ok_or(PunctuatedRefusal::RecipientNotContact)?;
    if matches.next().is_some() {
        return Err(PunctuatedRefusal::RecipientAmbiguous);
    }
    Ok(first)
}

/// Loose words: the account words without the separator words and without a
/// final network suffix (or a sound-alike of "testnet"). People leave out
/// "dot", "dash" and "testnet" ("seams v one" for `seams-v1.testnet`); the
/// request fixes the network, so the suffix holds no value.
fn loose_words<'a>(words: &[&'a str]) -> Vec<&'a str> {
    let mut loose: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| !is_separator_word(word))
        .collect();
    let suffix = |word: &&str| NETWORK_WORDS.contains(word) || TESTNET_SOUND_ALIKES.contains(word);
    if loose.len() > 1 && loose.last().is_some_and(suffix) {
        loose.pop();
    }
    loose
}

/// Joined-words rule. Whisper can join "to" with the account ("near
/// toucane" for "near to ken", "near today in a" for "near to dana"), so no
/// "to" is heard, or the words after it match no contact. The rule compares
/// the sound of all the words after the amount with the sound of "near to"
/// and the loose words of each contact ([`loose_words`]). The keys must be
/// equal, and exactly one contact must match. The amount is read by
/// [`read_amount`] and must hold a number word.
fn joined_by_sound(tokens: &[SpokenToken], contacts: &[SpokenAccount]) -> Option<Vec<SpokenToken>> {
    let amount_len = tokens
        .iter()
        .skip(1)
        .take_while(|token| amount_slot_word(token.as_str()))
        .count();
    let amount = &tokens[1..1 + amount_len];
    if !amount.iter().any(|token| amount_number(token.as_str())) {
        return None;
    }
    let tail = token_words(&tokens[1 + amount_len..]);
    let heard = words_key(&loose_words(&tail));
    let contact = only_match(contacts.iter().filter(|contact| {
        let spoken = contact.spoken_tokens();
        let mut words: Vec<&str> = Vec::from(["near", "to"]);
        words.extend(loose_words(&token_words(&spoken)));
        words_key(&words) == heard
    }))
    .ok()?;
    let mut read = Vec::from([SpokenToken::from_static("send")]);
    read.extend(read_amount(amount));
    read.push(SpokenToken::from_static("near"));
    read.push(SpokenToken::from_static("to"));
    read.extend(contact.spoken_tokens());
    Some(read)
}
