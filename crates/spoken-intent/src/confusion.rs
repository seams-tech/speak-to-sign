use alloc::collections::BTreeSet;
use alloc::vec;
use alloc::vec::Vec;
use core::ops::Range;

use crate::numbers::{digit_value, digit_word, push_integer_words};
use crate::render::VERSION_CHECK_DIGITS;
use crate::token::SpokenToken;
use crate::{
    render, NearAmount, NoteRatingV1, ProposalV1, SpokenAccount, SpokenBranch, SpokenRequestV1,
};

/// The verbs of the grammar: the two request verbs, "reject" (the opposite
/// of "approve") and the proposal verbs.
const VERBS: [&str; 6] = ["send", "approve", "reject", "add", "remove", "set"];

/// Negations that a near miss puts before a verb, as `normalize` gives them
/// ("don't" becomes "dont").
const NEGATION_PREFIXES: [&[&str]; 4] = [&["do", "not"], &["dont"], &["never"], &["not"]];

/// Negation words that a near miss of a note or a rating drops.
const NEGATION_WORDS: [&str; 4] = ["not", "never", "no", "dont"];

/// The bases that a near miss of a merge approval says in place of its own.
const MERGE_BASES: [&str; 6] = ["main", "master", "develop", "dev", "staging", "release"];

/// The fewest digits of an amount in hundredths that the digit changes
/// cover, so that "0.05 NEAR" (005) also changes its whole NEAR digit.
const MIN_AMOUNT_DIGITS: u32 = 3;

/// The spoken forms of near misses.
type NearMisses = BTreeSet<Vec<SpokenToken>>;

/// The spoken forms of the near misses of a request, sorted and without the
/// request's own form. A decision rule must refuse each of them.
///
/// Field changes:
///
/// - An amount: ten times, one hundred times, one tenth and one hundredth
///   (if exact), and each digit of the amount in hundredths (padded to three
///   digits) changed to each other digit, where the result is speakable.
/// - A receiver or member: each other account in `contacts`.
/// - A proposal: the id one lower and one higher, add and remove member
///   exchanged, the threshold one lower and one
///   higher, each of the eight version digits changed to each other digit,
///   and the note id of a hidden note one lower, one higher, and with each
///   decimal digit changed to each other digit.
///
/// Sentence changes, at each verb (the first word, and for an approval also
/// the first word of the proposal):
///
/// - A changed verb: each other word of `VERBS`.
/// - A negation: each of `NEGATION_PREFIXES` before the verb, and "not"
///   after it.
/// - A dropped clause: a transfer without its amount, without its amount and
///   "near", without its receiver, or without its verb; an approval without
///   "proposal" and its id, or without its proposal.
/// - An added clause: "and" and the transfer or proposal again, for the
///   request itself and for each of its field changes with the same id.
///
/// A community note or a note rating moves no value, so its near misses
/// guard only the meaning of the sentence: "not" added at each position,
/// each word of `NEGATION_WORDS` removed, and for a rating each other
/// rating.
///
/// A merge approval also moves no value. Its near misses are the pull
/// request number one lower and one higher, and with each decimal digit
/// changed to each other digit (only numbers of 1 or more); the base
/// replaced by each other base of `MERGE_BASES`; "not" added at each
/// position; and the verb "close" in place of "merge".
pub fn confusion_set(
    request: &SpokenRequestV1,
    contacts: &[SpokenAccount],
) -> Vec<Vec<SpokenToken>> {
    let expected = render(request).spoken;
    // Each arm gives the spoken form of the request with other field values.
    let mut set = match request {
        SpokenRequestV1::AccountTransfer {
            network,
            owner,
            receiver,
            amount,
        } => {
            let transfer = |receiver, amount| {
                render(&SpokenRequestV1::AccountTransfer {
                    network: *network,
                    owner: owner.clone(),
                    receiver,
                    amount,
                })
                .spoken
            };
            transfer_near_misses(&expected, receiver, *amount, contacts, transfer)
        }
        SpokenRequestV1::MultisigApproval {
            network,
            owner,
            multisig,
            proposal_id,
            proposal,
            salt,
        } => {
            let approval = |proposal_id, proposal| {
                render(&SpokenRequestV1::MultisigApproval {
                    network: *network,
                    owner: owner.clone(),
                    multisig: multisig.clone(),
                    proposal_id,
                    proposal,
                    salt: *salt,
                })
                .spoken
            };
            approval_near_misses(&expected, *proposal_id, proposal, contacts, approval)
        }
        SpokenRequestV1::CommunityNote { .. } => note_near_misses(&expected, Vec::new()),
        SpokenRequestV1::NoteRating {
            network,
            owner,
            contract,
            note_id,
            rating,
        } => {
            let rated = |rating| {
                render(&SpokenRequestV1::NoteRating {
                    network: *network,
                    owner: owner.clone(),
                    contract: contract.clone(),
                    note_id: *note_id,
                    rating,
                })
                .spoken
            };
            let other_ratings = NoteRatingV1::ALL
                .into_iter()
                .filter(|other| other != rating)
                .map(rated);
            note_near_misses(&expected, other_ratings)
        }
        SpokenRequestV1::MergeApproval {
            network,
            owner,
            contract,
            repo_sha256,
            pull_request,
            base,
            head_commit,
        } => {
            let merge = |pull_request, base| {
                render(&SpokenRequestV1::MergeApproval {
                    network: *network,
                    owner: owner.clone(),
                    contract: contract.clone(),
                    repo_sha256: *repo_sha256,
                    pull_request,
                    base,
                    head_commit: *head_commit,
                })
                .spoken
            };
            merge_near_misses(&expected, *pull_request, base, merge)
        }
    };
    set.remove(&expected);
    set.into_iter().collect()
}

/// The near misses of an account transfer. `transfer` gives the spoken form
/// of the transfer to another receiver or of another amount.
fn transfer_near_misses(
    expected: &[SpokenToken],
    receiver: &SpokenAccount,
    amount: NearAmount,
    contacts: &[SpokenAccount],
    transfer: impl Fn(SpokenAccount, NearAmount) -> Vec<SpokenToken>,
) -> NearMisses {
    let mut set = NearMisses::new();
    verb_changes(expected, 0, &mut set);
    transfer_drops(expected, 0..expected.len(), &mut set);
    set.insert(added_clause(expected, expected));
    for (receiver, amount) in transfer_variants(receiver, amount, contacts) {
        let variant = transfer(receiver, amount);
        set.insert(added_clause(expected, &variant));
        set.insert(variant);
    }
    set
}

/// The near misses of a multisig approval. `approval` gives the spoken form
/// of the approval with another id or proposal.
fn approval_near_misses(
    expected: &[SpokenToken],
    proposal_id: u64,
    proposal: &ProposalV1,
    contacts: &[SpokenAccount],
    approval: impl Fn(u64, ProposalV1) -> Vec<SpokenToken>,
) -> NearMisses {
    let mut set = NearMisses::new();
    let clause = proposal_clause(proposal_id, expected);

    for id in [proposal_id.checked_sub(1), proposal_id.checked_add(1)]
        .into_iter()
        .flatten()
    {
        set.insert(approval(id, proposal.clone()));
    }
    set.insert(added_clause(expected, &expected[clause.clone()]));
    for variant in proposal_variants(proposal, contacts) {
        let variant = approval(proposal_id, variant);
        set.insert(added_clause(
            expected,
            &variant[proposal_clause(proposal_id, &variant)],
        ));
        set.insert(variant);
    }
    if let ProposalV1::SetVerifierVersion { .. } = proposal {
        // The check digits are the last words of the proposal.
        for position in clause.end - VERSION_CHECK_DIGITS..clause.end {
            let current = digit_value(expected[position].as_str());
            for digit in (0..10u8).filter(|digit| Some(*digit) != current) {
                let changed = [word(digit_word(digit))];
                set.insert(spliced(expected, position, position + 1, &changed));
            }
        }
    }

    verb_changes(expected, 0, &mut set);
    verb_changes(expected, clause.start, &mut set);
    if let ProposalV1::Transfer { .. } = proposal {
        transfer_drops(expected, clause.clone(), &mut set);
    }
    // Without "proposal" and its id, and without the proposal.
    set.insert(spliced(expected, 1, clause.start, &[]));
    set.insert(spliced(expected, clause.start, clause.end, &[]));
    set
}

/// The near misses of a community note or a note rating. `other_ratings`
/// are the spoken forms of the other ratings of a rating.
fn note_near_misses(
    expected: &[SpokenToken],
    other_ratings: impl IntoIterator<Item = Vec<SpokenToken>>,
) -> NearMisses {
    let mut set: NearMisses = other_ratings.into_iter().collect();
    insert_not_everywhere(expected, &mut set);
    for (position, token) in expected.iter().enumerate() {
        if NEGATION_WORDS.contains(&token.as_str()) {
            set.insert(spliced(expected, position, position + 1, &[]));
        }
    }
    set
}

/// The near misses of a merge approval. `merge` gives the spoken form of the
/// approval with another pull request number or base.
fn merge_near_misses(
    expected: &[SpokenToken],
    pull_request: u64,
    base: &SpokenBranch,
    merge: impl Fn(u64, SpokenBranch) -> Vec<SpokenToken>,
) -> NearMisses {
    let mut set = NearMisses::new();
    let neighbours = [pull_request.checked_sub(1), pull_request.checked_add(1)];
    let numbers = neighbours
        .into_iter()
        .flatten()
        .chain(digit_changes(pull_request, 1));
    for number in numbers.filter(|number| *number >= 1) {
        set.insert(merge(number, base.clone()));
    }
    for other in MERGE_BASES.iter().filter(|other| **other != base.as_str()) {
        let other = SpokenBranch::new(other).expect("each listed base is speakable");
        set.insert(merge(pull_request, other));
    }
    insert_not_everywhere(expected, &mut set);
    set.insert(spliced(expected, 0, 1, &[word("close")]));
    set
}

fn transfer_variants(
    receiver: &SpokenAccount,
    amount: NearAmount,
    contacts: &[SpokenAccount],
) -> Vec<(SpokenAccount, NearAmount)> {
    let mut variants: Vec<(SpokenAccount, NearAmount)> = amount_neighbours(amount)
        .into_iter()
        .map(|amount| (receiver.clone(), amount))
        .collect();
    for contact in contacts.iter().filter(|contact| *contact != receiver) {
        variants.push((contact.clone(), amount));
    }
    variants
}

fn amount_neighbours(amount: NearAmount) -> Vec<NearAmount> {
    let hundredths = amount.hundredths();
    let mut candidates = vec![
        hundredths.saturating_mul(10),
        hundredths.saturating_mul(100),
    ];
    if hundredths % 10 == 0 {
        candidates.push(hundredths / 10);
    }
    if hundredths % 100 == 0 {
        candidates.push(hundredths / 100);
    }
    candidates.extend(digit_changes(hundredths, MIN_AMOUNT_DIGITS));
    candidates
        .into_iter()
        .filter_map(|candidate| NearAmount::from_hundredths(candidate).ok())
        .collect()
}

/// Each number that `value` gives with one decimal digit changed to each
/// other digit. The digits are those of `value`, with leading zeros up to
/// `min_digits` digits. A leading zero reads as the shorter number, and a
/// change above `u64::MAX` gives no number.
fn digit_changes(value: u64, min_digits: u32) -> Vec<u64> {
    let mut changes = Vec::new();
    let mut position = 0;
    while let Some(place) = 10u64.checked_pow(position) {
        if position >= min_digits && value / place == 0 {
            break;
        }
        let current = value / place % 10;
        let without_digit = value - current * place;
        for digit in (0..10).filter(|digit| *digit != current) {
            let changed = digit
                .checked_mul(place)
                .and_then(|digit_value| without_digit.checked_add(digit_value));
            changes.extend(changed);
        }
        position += 1;
    }
    changes
}

fn proposal_variants(proposal: &ProposalV1, contacts: &[SpokenAccount]) -> Vec<ProposalV1> {
    let other_members = |member: &SpokenAccount| -> Vec<SpokenAccount> {
        contacts
            .iter()
            .filter(|contact| *contact != member)
            .cloned()
            .collect()
    };
    match proposal {
        ProposalV1::Transfer { receiver, amount } => transfer_variants(receiver, *amount, contacts)
            .into_iter()
            .map(|(receiver, amount)| ProposalV1::Transfer { receiver, amount })
            .collect(),
        ProposalV1::AddMember { member } => {
            let mut variants = vec![ProposalV1::RemoveMember {
                member: member.clone(),
            }];
            variants.extend(
                other_members(member)
                    .into_iter()
                    .map(|member| ProposalV1::AddMember { member }),
            );
            variants
        }
        ProposalV1::RemoveMember { member } => {
            let mut variants = vec![ProposalV1::AddMember {
                member: member.clone(),
            }];
            variants.extend(
                other_members(member)
                    .into_iter()
                    .map(|member| ProposalV1::RemoveMember { member }),
            );
            variants
        }
        ProposalV1::SetThreshold { threshold } => {
            let value = threshold.get();
            [value.checked_sub(1), value.checked_add(1)]
                .into_iter()
                .flatten()
                .filter_map(core::num::NonZeroU8::new)
                .map(|threshold| ProposalV1::SetThreshold { threshold })
                .collect()
        }
        ProposalV1::SetVerifierVersion { .. } => Vec::new(),
        ProposalV1::HideNote { note_id } => note_id_variants(*note_id)
            .into_iter()
            .map(|note_id| ProposalV1::HideNote { note_id })
            .collect(),
    }
}

/// The other note ids of a hidden note: one lower, one higher, and each
/// decimal digit changed to each other digit. A changed first digit is never
/// zero, so each variant has as many digits as the id or one less.
fn note_id_variants(note_id: u64) -> BTreeSet<u64> {
    let mut variants = BTreeSet::new();
    variants.extend(note_id.checked_sub(1));
    variants.extend(note_id.checked_add(1));
    let mut digits = Vec::new();
    let mut rest = note_id;
    loop {
        digits.push((rest % 10) as u8);
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    digits.reverse();
    for position in 0..digits.len() {
        for digit in 0..10u8 {
            if digit == digits[position] || (position == 0 && digit == 0 && digits.len() > 1) {
                continue;
            }
            let mut changed = digits.clone();
            changed[position] = digit;
            let value = changed
                .iter()
                .try_fold(0u64, |value, digit| value.checked_mul(10)?.checked_add(u64::from(*digit)));
            variants.extend(value);
        }
    }
    variants.remove(&note_id);
    variants
}

/// The position of the proposal in the spoken form of an approval with
/// `proposal_id`: after "approve proposal" and the id words, to the end.
fn proposal_clause(proposal_id: u64, approval: &[SpokenToken]) -> Range<usize> {
    let mut id_words = Vec::new();
    push_integer_words(proposal_id, &mut id_words);
    2 + id_words.len()..approval.len()
}

/// A changed verb at `position`, each negation before it, and "not" after
/// it.
fn verb_changes(expected: &[SpokenToken], position: usize, set: &mut NearMisses) {
    for verb in VERBS
        .iter()
        .filter(|verb| **verb != expected[position].as_str())
    {
        set.insert(spliced(expected, position, position + 1, &[word(verb)]));
    }
    for negation in NEGATION_PREFIXES {
        let words: Vec<SpokenToken> = negation.iter().map(|w| word(w)).collect();
        set.insert(spliced(expected, position, position, &words));
    }
    set.insert(spliced(
        expected,
        position + 1,
        position + 1,
        &[word("not")],
    ));
}

/// The transfer clause at `clause` without its amount, without its amount
/// and "near", without its receiver, and without its verb.
fn transfer_drops(expected: &[SpokenToken], clause: Range<usize>, set: &mut NearMisses) {
    let verb = clause.start;
    if let Some(near) = expected[clause.clone()]
        .iter()
        .position(|w| w.as_str() == "near")
    {
        let near = verb + near;
        set.insert(spliced(expected, verb + 1, near, &[]));
        set.insert(spliced(expected, verb + 1, near + 1, &[]));
        set.insert(spliced(expected, near + 1, clause.end, &[]));
    }
    set.insert(spliced(expected, verb, verb + 1, &[]));
}

/// The sentence, then "and" and `clause`.
fn added_clause(expected: &[SpokenToken], clause: &[SpokenToken]) -> Vec<SpokenToken> {
    let mut added = expected.to_vec();
    added.push(word("and"));
    added.extend_from_slice(clause);
    added
}

/// "not" added at each position.
fn insert_not_everywhere(expected: &[SpokenToken], set: &mut NearMisses) {
    for position in 0..=expected.len() {
        set.insert(spliced(expected, position, position, &[word("not")]));
    }
}

fn word(text: &'static str) -> SpokenToken {
    SpokenToken::from_static(text)
}

fn spliced(
    tokens: &[SpokenToken],
    start: usize,
    end: usize,
    insert: &[SpokenToken],
) -> Vec<SpokenToken> {
    let mut out = tokens[..start].to_vec();
    out.extend_from_slice(insert);
    out.extend_from_slice(&tokens[end..]);
    out
}
