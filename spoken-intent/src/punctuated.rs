//! The text step for a speech-to-text model that writes numerals,
//! punctuation and account ids (Whisper), and the recipient match by sound.
//!
//! [`normalize`] stays the text step for CTC models, which write words only.

use alloc::string::String;
use alloc::vec::Vec;

use crate::numbers::{digit_word, is_number_word};
use crate::phonetic::words_key;
use crate::render::SpokenToken;
use crate::{normalize, phonetic_key, SpokenAccount};

/// Whole-word aliases: a word that Whisper writes for a grammar word. No
/// alias is a grammar word, and each target is one.
pub const PUNCTUATED_ALIASES: [(&str, &str); 3] =
    [("approved", "approve"), ("nir", "near"), ("neer", "near")];

/// Words that Whisper writes for the spoken verb "send", as the first word.
const SEND_SOUND_ALIKES: [&str; 2] = ["sent", "sends"];

/// Words that Whisper writes for the unit "near", in the unit slot of a send
/// sentence only. A transfer has one unit, so a word in this slot cannot
/// change the amount or the receiver.
const UNIT_SOUND_ALIKES: [&str; 16] = [
    "nia", "nir", "nair", "neer", "nier", "nea", "nit", "nid", "net", "nee", "knee", "here",
    "hear", "year", "ear", "mir",
];

/// Words that Whisper writes for a number word, in the amount slot of a send
/// sentence only. None of them is a number word, so a spoken number cannot
/// become another number.
const AMOUNT_SOUND_ALIKES: [(&str, &str); 7] = [
    ("oh", "zero"),
    ("free", "three"),
    ("tree", "three"),
    ("for", "four"),
    ("fore", "four"),
    ("won", "one"),
    ("ate", "eight"),
];

/// Words that Whisper writes for the network suffix "testnet", as the last
/// word of the recipient.
const TESTNET_SOUND_ALIKES: [&str; 10] = [
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

/// The spoken separators of an account name.
const SEPARATOR_WORDS: [&str; 3] = ["dot", "dash", "underscore"];

/// The network suffixes that a recipient can end with.
const NETWORK_WORDS: [&str; 2] = ["testnet", "near"];

/// Punctuation that is removed from the edges of a word before the alias and
/// account checks.
const EDGE: [char; 7] = [',', '.', '!', '?', ';', ':', '"'];

/// Why [`normalize_punctuated`] refuses a transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PunctuatedRefusal {
    /// [`normalize`] refuses the cleaned text.
    NotNormalizable,
    /// A word after "to" has one letter, so it has no phonetic key.
    RecipientUnkeyable,
    /// The phonetic key of the words after "to" equals no contact's key.
    RecipientNotContact,
    /// The phonetic key of the words after "to" equals the keys of two or
    /// more contacts.
    RecipientAmbiguous,
}

/// Maps a transcript from a punctuating speech-to-text model to spoken
/// tokens.
///
/// Text step, for each whitespace-separated word of the lowercase,
/// trimmed transcript (final `. , ! ?` removed):
///
/// 1. If the word without edge punctuation is in [`PUNCTUATED_ALIASES`], it
///    becomes the alias target.
/// 2. If the word directly follows "version" and holds digits with only `,`
///    or `-` between them, each digit becomes one word ("10374" becomes
///    "one zero three seven four"). The check digits of a "set verifier
///    version" proposal are not a number.
/// 3. If the word without edge punctuation holds a letter and a separator
///    (`-` `_` `.`), or letters and digits, it is an account id: each digit
///    becomes one word and each separator its word ("ops-42.testnet" becomes
///    "ops dash four two dot testnet").
/// 4. Any other word keeps its letters and numerals: final `. , ! ?` are
///    removed, a `,` between two digits is removed, a `.` between two
///    characters that are not both digits becomes "dot", and `-` and `_`
///    become "dash" and "underscore".
///
/// Then [`normalize`] reads the text.
///
/// Slot rules, only in a send sentence. A first token in
/// [`SEND_SOUND_ALIKES`] ("sent") becomes "send" first.
///
/// - Amount: [`two_heard_as_to`], then [`unit_slot`].
/// - Network suffix: [`testnet_heard_differently`] and
///   [`dot_before_testnet`], in the recipient step.
///
/// The slot rules change only words that hold no value: the verb, the unit,
/// the network suffix and a number word heard as a word that is not a
/// number. [`crate::parse_transfer`] and the caller still compare the amount
/// and the receiver with the request.
///
/// Recipient step: if a token "to" follows, the tokens after the first "to"
/// must match exactly one account in `contacts` by [`phonetic_key`]. The
/// match tries each reading of [`recipient_readings`] with equal keys, and
/// then each reading with keys one edit apart. They are then replaced by the
/// spoken tokens of that account. `contacts` must hold no two confusable
/// keys; the caller checks this. Other sentences (a multisig approval) have
/// no slot rules and no recipient step. [`crate::parse_transfer`] with the
/// same `contacts` then reads a transfer.
pub fn normalize_punctuated(
    transcript: &str,
    contacts: &[SpokenAccount],
) -> Result<Vec<SpokenToken>, PunctuatedRefusal> {
    let cleaned = clean_punctuated(transcript);
    let mut tokens = normalize(&cleaned).ok_or(PunctuatedRefusal::NotNormalizable)?;
    if tokens
        .first()
        .is_some_and(|token| SEND_SOUND_ALIKES.contains(&token.as_str()))
    {
        tokens[0] = SpokenToken::from_static("send");
    }
    if tokens.first().map(SpokenToken::as_str) != Some("send") {
        return Ok(tokens);
    }
    two_heard_as_to(&mut tokens);
    unit_slot(&mut tokens);
    let Some(to) = tokens.iter().position(|token| token.as_str() == "to") else {
        return Ok(joined_by_sound(&tokens, contacts).unwrap_or(tokens));
    };
    let recipient: Vec<&str> = tokens[to + 1..].iter().map(SpokenToken::as_str).collect();
    // A spoken account word may be one letter: "v1" is spoken "v one". The
    // contacts hold no two keys that are equal or one edit apart, so short
    // words do not make two contacts confusable.
    if recipient
        .iter()
        .any(|word| word.is_empty() || word.len() > 64)
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

/// The recipient match, in this order: the readings with an equal key, the
/// readings with a key one edit apart, and then both again with loose keys
/// ([`loose_words`]: no separators and no network suffix). A reading that
/// matches two contacts ends the match as ambiguous.
fn recipient_contact<'a>(
    recipient: &[&str],
    contacts: &'a [SpokenAccount],
) -> Result<&'a SpokenAccount, PunctuatedRefusal> {
    let readings = recipient_readings(recipient);
    for (loose, one_edit) in [(false, false), (false, true), (true, false), (true, true)] {
        for words in &readings {
            match contact_by_key(words, contacts, loose, one_edit) {
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

/// Loose words: the account words without the separator words and without a
/// final network suffix (or a sound-alike of "testnet"). People leave out
/// "dot", "dash" and "testnet" ("seams v one" for `seams-v1.testnet`); the
/// request fixes the network, so the suffix holds no value.
fn loose_words<'a>(words: &[&'a str]) -> Vec<&'a str> {
    let mut loose: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| !SEPARATOR_WORDS.contains(word))
        .collect();
    let suffix = |word: &&str| NETWORK_WORDS.contains(word) || TESTNET_SOUND_ALIKES.contains(word);
    if loose.len() > 1 && loose.last().is_some_and(suffix) {
        loose.pop();
    }
    loose
}

/// The [`phonetic_key`] of the loose words of an account.
fn loose_key(account: &SpokenAccount) -> crate::PhoneticKey {
    let spoken = account.spoken_tokens();
    let words: Vec<&str> = spoken.iter().map(SpokenToken::as_str).collect();
    words_key(&loose_words(&words))
}

/// The one contact whose [`phonetic_key`] equals the key of `words`, or,
/// with `one_edit`, is at most one edit from it and starts with the same
/// two letters. With `loose`, both keys come from [`loose_words`]. A short
/// name with another first sound ("zoe" for "leo", "jon" for "dan", "anna"
/// for "uma") is one edit away, so the first two letters must stay.
fn contact_by_key<'a>(
    words: &[&str],
    contacts: &'a [SpokenAccount],
    loose: bool,
    one_edit: bool,
) -> Result<&'a SpokenAccount, PunctuatedRefusal> {
    let key = if loose {
        words_key(&loose_words(words))
    } else {
        words_key(words)
    };
    let mut matches = contacts.iter().filter(|contact| {
        let contact_key = if loose {
            loose_key(contact)
        } else {
            phonetic_key(contact)
        };
        if one_edit {
            contact_key
                .as_str()
                .bytes()
                .take(2)
                .eq(key.as_str().bytes().take(2))
                && contact_key.is_confusable_with(&key)
        } else {
            contact_key == key
        }
    });
    let contact = matches
        .next()
        .ok_or(PunctuatedRefusal::RecipientNotContact)?;
    if matches.next().is_some() {
        return Err(PunctuatedRefusal::RecipientAmbiguous);
    }
    Ok(contact)
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
fn unit_slot(tokens: &mut Vec<SpokenToken>) {
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
fn amount_number(word: &str) -> bool {
    is_number_word(word) || amount_sound_alike(word).is_some()
}

/// A word that the amount slot can hold.
fn amount_slot_word(word: &str) -> bool {
    amount_number(word) || matches!(word, "point" | "dot" | "dash")
}

/// The amount words as the grammar reads them: a sound-alike becomes its
/// number word, "dot" becomes "point", "dash" is removed ("200-1587.5"), and
/// an amount that starts with "point" gets "zero" first ("point oh one").
fn read_amount(amount: &[SpokenToken]) -> Vec<SpokenToken> {
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
    let tail: Vec<&str> = tokens[1 + amount_len..]
        .iter()
        .map(SpokenToken::as_str)
        .collect();
    let heard = words_key(&loose_words(&tail));
    let mut matches = contacts.iter().filter(|contact| {
        let spoken = contact.spoken_tokens();
        let mut words: Vec<&str> = Vec::from(["near", "to"]);
        let account: Vec<&str> = spoken.iter().map(SpokenToken::as_str).collect();
        words.extend(loose_words(&account));
        words_key(&words) == heard
    });
    let contact = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    let mut read = Vec::from([SpokenToken::from_static("send")]);
    read.extend(read_amount(amount));
    read.push(SpokenToken::from_static("near"));
    read.push(SpokenToken::from_static("to"));
    read.extend(contact.spoken_tokens());
    Some(read)
}

/// The number word that a word of [`AMOUNT_SOUND_ALIKES`] stands for.
fn amount_sound_alike(word: &str) -> Option<&'static str> {
    AMOUNT_SOUND_ALIKES
        .iter()
        .find(|(heard, _)| *heard == word)
        .map(|(_, number)| *number)
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
fn two_heard_as_to(tokens: &mut [SpokenToken]) {
    let word = |index: usize| tokens.get(index).map(SpokenToken::as_str);
    if matches!(word(1), Some("to" | "too")) && word(2) == Some("near") && word(3) == Some("to") {
        tokens[1] = SpokenToken::from_static("two");
    }
}

/// Network suffix rule. Whisper can drop the spoken "dot" before the
/// network suffix ("seams v1 testnet", "alice testnet"). Its reading comes
/// after the reading as heard in [`recipient_readings`]. If the recipient
/// has a word and then ends with "testnet", and the word before "testnet"
/// is not "dot", it gives the words with "dot" before "testnet". These
/// words are then matched by [`phonetic_key`] in the same way, so they must
/// still equal exactly one contact.
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

/// The text step of [`normalize_punctuated`], before [`normalize`].
fn clean_punctuated(transcript: &str) -> String {
    let text = strip_final_punctuation(transcript.trim()).to_ascii_lowercase();
    let mut out: Vec<String> = Vec::new();
    for word in text.split_ascii_whitespace() {
        let core = word.trim_matches(&EDGE[..]);
        let after_version = out.last().is_some_and(|last| last == "version");
        let spelled =
            if let Some((_, to)) = PUNCTUATED_ALIASES.iter().find(|(from, _)| *from == core) {
                String::from(*to)
            } else if after_version && is_check_digits(core) {
                spell_check_digits(core)
            } else if is_account_token(core) {
                spell_account(core)
            } else {
                clean_word(word)
            };
        out.push(spelled);
    }
    out.join(" ")
}

fn strip_final_punctuation(mut text: &str) -> &str {
    while let Some(rest) = text.strip_suffix(['.', ',', '!', '?']) {
        text = rest.trim_end();
    }
    text
}

/// Digits, with only `,` or `-` between two of them: "10374", "115-54".
fn is_check_digits(core: &str) -> bool {
    let bytes = core.as_bytes();
    let digit = |index: usize| bytes.get(index).is_some_and(u8::is_ascii_digit);
    !bytes.is_empty()
        && bytes.iter().enumerate().all(|(index, byte)| {
            byte.is_ascii_digit()
                || (matches!(byte, b',' | b'-')
                    && index > 0
                    && digit(index - 1)
                    && digit(index + 1))
        })
}

fn is_account_token(core: &str) -> bool {
    let letter = core.bytes().any(|byte| byte.is_ascii_alphabetic());
    let separator = core.bytes().any(|byte| matches!(byte, b'-' | b'_' | b'.'));
    let digit = core.bytes().any(|byte| byte.is_ascii_digit());
    letter && (separator || digit)
}

/// One word for each digit; the `,` and `-` between digits are dropped.
fn spell_check_digits(core: &str) -> String {
    let words: Vec<&str> = core
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|byte| digit_word(byte - b'0'))
        .collect();
    words.join(" ")
}

/// One word for each digit and each separator; other characters stay
/// together as words.
fn spell_account(core: &str) -> String {
    let mut words: Vec<&str> = Vec::new();
    let mut run_start: Option<usize> = None;
    for (index, c) in core.char_indices() {
        let word = match c {
            '0'..='9' => digit_word(c as u8 - b'0'),
            '.' => "dot",
            '-' => "dash",
            '_' => "underscore",
            _ => {
                run_start.get_or_insert(index);
                continue;
            }
        };
        if let Some(start) = run_start.take() {
            words.push(&core[start..index]);
        }
        words.push(word);
    }
    if let Some(start) = run_start {
        words.push(&core[start..]);
    }
    words.join(" ")
}

/// Step 4 of the text step for one word.
fn clean_word(word: &str) -> String {
    let word = strip_final_punctuation(word);
    let chars: Vec<char> = word.chars().collect();
    let mut out = String::with_capacity(word.len() + 8);
    for (index, &c) in chars.iter().enumerate() {
        let previous = index.checked_sub(1).map(|before| chars[before]);
        let next = chars.get(index + 1).copied();
        let alphanumeric = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
        let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
        match c {
            ',' if digit(previous) && digit(next) => {}
            '.' if alphanumeric(previous)
                && alphanumeric(next)
                && !(digit(previous) && digit(next)) =>
            {
                out.push_str(" dot ")
            }
            '-' => out.push_str(" dash "),
            '_' => out.push_str(" underscore "),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_step_matches_rule_w2() {
        for (heard, cleaned) in [
            (
                "Send 74.15 near to ops-42.testnet.",
                "send 74.15 near to ops dash four two dot testnet",
            ),
            (
                "Send 1,300 NIR to rent-2026.testnet",
                "send 1300 near to rent dash two zero two six dot testnet",
            ),
            (
                "Approved Proposal 13 Ad Member Alice 2.Testnet",
                "approve proposal 13 ad member alice two dot testnet",
            ),
            (
                "to max99.testnet, neer",
                "to max nine nine dot testnet near",
            ),
            (
                "Version 10374 kim-08.testnet",
                "version one zero three seven four kim dash zero eight dot testnet",
            ),
            (
                "Set Verifier Version 115-54 Trumpet.",
                "set verifier version one one five five four trumpet",
            ),
            ("version 1,037 x", "version one zero three seven x"),
            (
                "version 10374. and",
                "version one zero three seven four and",
            ),
            ("send 100 near", "send 100 near"),
        ] {
            assert_eq!(clean_punctuated(heard), cleaned, "{heard}");
        }
    }

    /// The fixed words of every rendered request, near miss and account
    /// suffix, besides number words and challenge words.
    const GRAMMAR_WORDS: [&str; 28] = [
        "send",
        "near",
        "to",
        "dot",
        "dash",
        "underscore",
        "point",
        "approve",
        "reject",
        "proposal",
        "add",
        "remove",
        "member",
        "set",
        "threshold",
        "verifier",
        "version",
        "testnet",
        "and",
        "not",
        "do",
        "dont",
        "never",
        "this",
        "note",
        "is",
        "somewhat",
        "helpful",
    ];

    #[test]
    fn aliases_are_not_grammar_words() {
        let grammar = |word: &str| {
            crate::numbers::is_number_word(word)
                || crate::CHALLENGE_WORDS.contains(&word)
                || GRAMMAR_WORDS.contains(&word)
        };
        for (from, to) in PUNCTUATED_ALIASES {
            assert!(!grammar(from), "{from}");
            assert!(grammar(to), "{to}");
        }
        // The slot sound-alikes are not grammar words, so a slot rule never
        // changes a word that the grammar reads.
        let slot_words = SEND_SOUND_ALIKES
            .iter()
            .chain(&UNIT_SOUND_ALIKES)
            .chain(AMOUNT_SOUND_ALIKES.iter().map(|(heard, _)| heard))
            .chain(&TESTNET_SOUND_ALIKES);
        for word in slot_words {
            assert!(!grammar(word), "{word}");
        }
        for (_, number) in AMOUNT_SOUND_ALIKES {
            assert!(crate::numbers::is_number_word(number), "{number}");
        }
    }
}
