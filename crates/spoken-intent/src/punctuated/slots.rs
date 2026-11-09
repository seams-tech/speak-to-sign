//! The slot rules of a send sentence: the verb, the amount and the unit.

use alloc::vec::Vec;

use crate::numbers::is_number_word;
use crate::token::SpokenToken;

/// The verb "send", then the words that Whisper writes for it, as the first
/// word. A summary cannot start with one of them, so a summary is never read
/// as a send sentence.
pub(crate) const SEND_FORMS: [&str; 3] = ["send", "sent", "sends"];

/// Words that Whisper writes for the unit "near", in the unit slot of a send
/// sentence only. A transfer has one unit, so a word in this slot cannot
/// change the amount or the receiver.
pub(super) const UNIT_SOUND_ALIKES: [&str; 16] = [
    "nia", "nir", "nair", "neer", "nier", "nea", "nit", "nid", "net", "nee", "knee", "here",
    "hear", "year", "ear", "mir",
];

/// Words that Whisper writes for a number word, in the amount slot of a send
/// sentence only. None of them is a number word, so a spoken number cannot
/// become another number.
pub(super) const AMOUNT_SOUND_ALIKES: [(&str, &str); 7] = [
    ("oh", "zero"),
    ("free", "three"),
    ("tree", "three"),
    ("for", "four"),
    ("fore", "four"),
    ("won", "one"),
    ("ate", "eight"),
];

/// Amount slot rule. Whisper writes the spoken amount "two" as "to" or
/// "too" ("Send to near to alice testnet"). In "send to near to …" or
/// "send too near to …", the amount slot between "send" and "near" holds
/// only that word, so it is read as "two".
///
/// The rule needs "near" and then "to" directly after the word, so it does
/// not fill an empty amount: "send to alice dot testnet" (no amount and no
/// "near") and "send near to alice dot testnet" (no amount) keep their words
/// and [`crate::parse_transfer`] refuses them. It changes only the second
/// token, so a negation or a changed verb is still refused.
pub(super) fn two_heard_as_to(tokens: &mut [SpokenToken]) {
    let word = |index: usize| tokens.get(index).map(SpokenToken::as_str);
    if matches!(word(1), Some("to" | "too")) && word(2) == Some("near") && word(3) == Some("to") {
        tokens[1] = SpokenToken::from_static("two");
    }
}

/// Unit and amount slot rule. In "send <amount> <unit> to …", the amount
/// slot is the words after "send", and the unit slot is the word directly
/// before the first "to".
///
/// - A unit word in [`UNIT_SOUND_ALIKES`] becomes "near". If the word
///   before "to" is part of the amount, the unit was not heard, and "near"
///   is put in before "to".
/// - The amount slot is read by [`read_amount`].
///
/// The rule applies only if the amount slot holds a number word or an
/// amount sound-alike, and every other word in it is "point", "dot" or
/// "dash". So an empty amount ("send near to …"), a negation ("send not to
/// …") and any other unit ("send five dollars to …") keep their words.
pub(super) fn unit_slot(tokens: &mut Vec<SpokenToken>) {
    let Some(to) = tokens.iter().position(|token| token.as_str() == "to") else {
        return;
    };
    // The verb is token 0, so the unit slot is token 1 or later.
    let Some(before_to) = to.checked_sub(1).filter(|index| *index >= 1) else {
        return;
    };
    let word = tokens[before_to].as_str();
    let unit_heard = word == "near" || UNIT_SOUND_ALIKES.contains(&word);
    let amount_end = if unit_heard { before_to } else { to };
    let amount = &tokens[1..amount_end];
    if !amount.iter().any(|token| amount_number(token.as_str()))
        || !amount.iter().all(|token| amount_slot_word(token.as_str()))
    {
        return;
    }
    let mut read: Vec<SpokenToken> = Vec::with_capacity(tokens.len() + 2);
    read.push(SpokenToken::from_static("send"));
    read.extend(read_amount(amount));
    read.push(SpokenToken::from_static("near"));
    read.extend(tokens.drain(to..));
    *tokens = read;
}

/// A number word, or a word of [`AMOUNT_SOUND_ALIKES`].
pub(super) fn amount_number(word: &str) -> bool {
    is_number_word(word) || amount_sound_alike(word).is_some()
}

/// A word that the amount slot can hold.
pub(super) fn amount_slot_word(word: &str) -> bool {
    amount_number(word) || matches!(word, "point" | "dot" | "dash")
}

/// The amount words as the grammar reads them: a sound-alike becomes its
/// number word, "dot" becomes "point", "dash" is removed ("200-1587.5"), and
/// an amount that starts with "point" gets "zero" first ("point oh one").
pub(super) fn read_amount(amount: &[SpokenToken]) -> Vec<SpokenToken> {
    let mut read: Vec<SpokenToken> = Vec::with_capacity(amount.len() + 1);
    for token in amount {
        let word = token.as_str();
        match (word, amount_sound_alike(word)) {
            ("dash", _) => {}
            ("dot", _) => read.push(SpokenToken::from_static("point")),
            (_, Some(number)) => read.push(SpokenToken::from_static(number)),
            _ => read.push(token.clone()),
        }
    }
    if read.first().map(SpokenToken::as_str) == Some("point") {
        read.insert(0, SpokenToken::from_static("zero"));
    }
    read
}

/// The number word that a word of [`AMOUNT_SOUND_ALIKES`] stands for.
fn amount_sound_alike(word: &str) -> Option<&'static str> {
    AMOUNT_SOUND_ALIKES
        .iter()
        .find(|(heard, _)| *heard == word)
        .map(|(_, number)| *number)
}
