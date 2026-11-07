use alloc::collections::BTreeSet;
use alloc::vec;
use alloc::vec::Vec;

use crate::numbers::{digit_value, digit_word, push_integer_words};
use crate::render::SpokenToken;
use crate::{render, NearAmount, ProposalV1, SpokenAccount, SpokenRequestV1};

/// The verbs of the grammar: the two request verbs, "reject" (the opposite
/// of "approve") and the proposal verbs.
const VERBS: [&str; 6] = ["send", "approve", "reject", "add", "remove", "set"];

/// Negations, as `normalize` gives them ("don't" becomes "dont").
const NEGATIONS: [&[&str]; 4] = [&["do", "not"], &["dont"], &["never"], &["not"]];

/// The spoken forms of the near misses of a request, sorted and without the
/// request's own form. A decision rule must refuse each of them.
///
/// Field changes:
///
/// - An amount: ten times, one hundred times, one tenth and one hundredth
///   (if exact), and each digit of the amount in hundredths (padded to three
///   digits) changed to each other digit, where the result is speakable.
/// - A receiver or member: each other account in `contacts`.
/// - A proposal: the id one lower and one higher, the two challenge words
///   swapped, add and remove member exchanged, the threshold one lower and one
///   higher, and each of the five version digits changed to each other digit.
///
/// Sentence changes, at each verb (the first word, and for an approval also
/// the first word of the proposal):
///
/// - A changed verb: each other word of `VERBS`.
/// - A negation: each of `NEGATIONS` before the verb, and "not" after it.
/// - A dropped clause: a transfer without its amount, without its amount and
///   "near", without its receiver, or without its verb; an approval without
///   "proposal" and its id, without its proposal, without one or both
///   challenge words.
/// - An added clause: "and" and the transfer or proposal again, for the
///   request itself and for each of its field changes with the same id.
pub fn confusion_set(
    request: &SpokenRequestV1,
    contacts: &[SpokenAccount],
) -> Vec<Vec<SpokenToken>> {
    let expected = render(request).spoken;
    let mut set = field_changes(request, contacts, &expected);
    let (clause_start, clause_end, clauses) = clauses(request, contacts, &expected);
    sentence_changes(&expected, clause_start, clause_end, &clauses, &mut set);
    set.remove(&expected);
    set.into_iter().collect()
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

/// Number of words of `proposal <id>` after "approve".
fn proposal_prefix_len(proposal_id: u64) -> usize {
    let mut id_words = Vec::new();
    push_integer_words(proposal_id, &mut id_words);
    2 + id_words.len()
}

/// The range of the clause after the request verb (a transfer: the whole
/// sentence; an approval: the proposal), and that clause for the request and
/// for each field change that keeps the sentence shape.
fn clauses(
    request: &SpokenRequestV1,
    contacts: &[SpokenAccount],
    expected: &[SpokenToken],
) -> (usize, usize, Vec<Vec<SpokenToken>>) {
    match request {
        SpokenRequestV1::VaultTransfer {
            network,
            vault,
            owner,
            receiver,
            amount,
            nonce,
        } => {
            let mut clauses = vec![expected.to_vec()];
            for (receiver, amount) in transfer_variants(receiver, *amount, contacts) {
                clauses.push(
                    render(&SpokenRequestV1::VaultTransfer {
                        network: *network,
                        vault: vault.clone(),
                        owner: owner.clone(),
                        receiver,
                        amount,
                        nonce: *nonce,
                    })
                    .spoken,
                );
            }
            (0, expected.len(), clauses)
        }
        SpokenRequestV1::MultisigApproval {
            network,
            multisig,
            proposal_id,
            proposal,
            challenge,
        } => {
            let start = proposal_prefix_len(*proposal_id);
            let mut proposals = vec![proposal.clone()];
            proposals.extend(proposal_variants(proposal, contacts));
            let clauses = proposals
                .into_iter()
                .map(|proposal| {
                    let spoken = render(&SpokenRequestV1::MultisigApproval {
                        network: *network,
                        multisig: multisig.clone(),
                        proposal_id: *proposal_id,
                        proposal,
                        challenge: *challenge,
                    })
                    .spoken;
                    spoken[start..spoken.len() - 2].to_vec()
                })
                .collect();
            (start, expected.len() - 2, clauses)
        }
    }
}

/// Changed verbs, negations, dropped and added clauses.
fn sentence_changes(
    expected: &[SpokenToken],
    clause_start: usize,
    clause_end: usize,
    clauses: &[Vec<SpokenToken>],
    set: &mut BTreeSet<Vec<SpokenToken>>,
) {
    let mut verb_positions = vec![0];
    if clause_start != 0 {
        verb_positions.push(clause_start);
    }
    for &position in &verb_positions {
        for verb in VERBS.iter().filter(|verb| **verb != expected[position].as_str()) {
            set.insert(spliced(expected, position, position + 1, &[word(verb)]));
        }
        for negation in NEGATIONS {
            let words: Vec<SpokenToken> = negation.iter().map(|w| word(w)).collect();
            set.insert(spliced(expected, position, position, &words));
        }
        set.insert(spliced(expected, position + 1, position + 1, &[word("not")]));
    }

    // A dropped part of the clause, when the clause is a transfer.
    let clause = &expected[clause_start..clause_end];
    if clause.first().is_some_and(|w| w.as_str() == "send") {
        if let Some(near) = clause.iter().position(|w| w.as_str() == "near") {
            let near = clause_start + near;
            set.insert(spliced(expected, clause_start + 1, near, &[]));
            set.insert(spliced(expected, clause_start + 1, near + 1, &[]));
            set.insert(spliced(expected, near + 1, clause_end, &[]));
        }
        set.insert(spliced(expected, clause_start, clause_start + 1, &[]));
    }
    if clause_start != 0 {
        let len = expected.len();
        set.insert(spliced(expected, 1, clause_start, &[]));
        set.insert(spliced(expected, clause_start, clause_end, &[]));
        set.insert(expected[..len - 2].to_vec());
        set.insert(spliced(expected, len - 2, len - 1, &[]));
        set.insert(expected[..len - 1].to_vec());
    }

    // An added clause after the sentence.
    for clause in clauses {
        let mut added = expected.to_vec();
        added.push(word("and"));
        added.extend_from_slice(clause);
        set.insert(added);
    }
}

/// The field changes.
fn field_changes(
    request: &SpokenRequestV1,
    contacts: &[SpokenAccount],
    expected: &[SpokenToken],
) -> BTreeSet<Vec<SpokenToken>> {
    let mut set = BTreeSet::new();
    match request {
        SpokenRequestV1::VaultTransfer {
            network,
            vault,
            owner,
            receiver,
            amount,
            nonce,
        } => {
            for (receiver, amount) in transfer_variants(receiver, *amount, contacts) {
                let variant = SpokenRequestV1::VaultTransfer {
                    network: *network,
                    vault: vault.clone(),
                    owner: owner.clone(),
                    receiver,
                    amount,
                    nonce: *nonce,
                };
                set.insert(render(&variant).spoken);
            }
        }
        SpokenRequestV1::MultisigApproval {
            network,
            multisig,
            proposal_id,
            proposal,
            challenge,
        } => {
            let approval = |proposal_id: u64, proposal: ProposalV1, challenge| {
                render(&SpokenRequestV1::MultisigApproval {
                    network: *network,
                    multisig: multisig.clone(),
                    proposal_id,
                    proposal,
                    challenge,
                })
                .spoken
            };
            let neighbour_ids = [proposal_id.checked_sub(1), proposal_id.checked_add(1)];
            for id in neighbour_ids.into_iter().flatten() {
                set.insert(approval(id, proposal.clone(), *challenge));
            }
            set.insert(approval(
                *proposal_id,
                proposal.clone(),
                [challenge[1], challenge[0]],
            ));
            for variant in proposal_variants(proposal, contacts) {
                set.insert(approval(*proposal_id, variant, *challenge));
            }
            if let ProposalV1::SetVerifierVersion { .. } = proposal {
                // The digits sit just before the two challenge words.
                let first_digit = expected.len() - 7;
                for position in first_digit..first_digit + 5 {
                    let current = digit_value(expected[position].as_str());
                    for digit in (0..10u8).filter(|digit| Some(*digit) != current) {
                        let mut variant = expected.to_vec();
                        variant[position] = SpokenToken::from_static(digit_word(digit));
                        set.insert(variant);
                    }
                }
            }
        }
    }
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
    let mut candidates = vec![hundredths.saturating_mul(10), hundredths.saturating_mul(100)];
    if hundredths % 10 == 0 {
        candidates.push(hundredths / 10);
    }
    if hundredths % 100 == 0 {
        candidates.push(hundredths / 100);
    }
    let mut digits: Vec<u64> = Vec::new();
    let mut rest = hundredths;
    while rest > 0 || digits.len() < 3 {
        digits.push(rest % 10);
        rest /= 10;
    }
    for (position, current) in digits.iter().enumerate() {
        let place = 10u64.pow(position as u32);
        for digit in (0..10).filter(|digit| digit != current) {
            candidates.push(hundredths - current * place + digit * place);
        }
    }
    candidates
        .into_iter()
        .filter_map(|candidate| NearAmount::from_hundredths(candidate).ok())
        .collect()
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
    }
}
