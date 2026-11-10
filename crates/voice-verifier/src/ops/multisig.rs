//! The multisig kinds of `verify`. The proposer says a transfer, and the
//! worker keeps the proposal and its salt in storage; the contract holds
//! only the commitment. Each other member says the proposal from memory, and
//! the worker builds the request from the stored proposal.
//!
//! Three rules hold the proposal back from a member who does not know it:
//! the verdict of a confirmation carries the spoken-text digest and the word
//! margin only on an accept, a member has [`MAX_TRIES`] `words` refusals for
//! one proposal, and no output of a confirmation holds the salt. One more
//! rule makes each confirmation a different person: a voice that passes
//! against another member who already said the proposal is refused.
use serde::{Deserialize, Serialize};
use spoken_intent::{
    multisig_commitment, NearAccount, NearAmount, Network, ProposalV1, SpokenAccount, SpokenRequestV1,
};

use super::request::{lowercase_hex, unsupported};
use crate::config::template_key;
use crate::digest::{b64u, hex};
use crate::embedding::{similarity_milli, speaker_passes, Embedding};
use crate::host::Host;
use crate::input::{parse_yocto, RequestInput};
use crate::output::{MultisigOpening, Reason};
use crate::template::{model_sha256, TemplateRecord};

/// The `words` refusals that one member has for one proposal.
pub const MAX_TRIES: u32 = 3;

/// Tries of a compare-and-set before a storage refusal.
const MAX_WRITE_TRIES: usize = 5;

/// A multisig request and where its records live.
pub(super) struct Prepared {
    pub(super) request: SpokenRequestV1,
    /// `true` for a confirmation: the member did not see the proposal.
    pub(super) recalled: bool,
    commitment: [u8; 32],
    /// The storage key prefix of the proposal.
    prefix: String,
    owner: String,
}

/// The stored proposal and salt.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredOpening {
    proposal_id: u64,
    receiver: String,
    amount_yocto: String,
    salt_hex: String,
}

/// The request of a multisig kind: a new salt for a proposal, or the stored
/// proposal for a confirmation. A confirmation of a member without tries
/// left refuses here, before the checks.
pub(super) fn prepare(
    host: &mut dyn Host,
    owner_text: &str,
    request: &RequestInput,
    network: Network,
) -> Result<Prepared, Reason> {
    let owner = NearAccount::new(owner_text).map_err(unsupported)?;
    match request {
        RequestInput::MultisigPropose { multisig, proposal_id, receiver, amount_yocto } => {
            let multisig = NearAccount::new(multisig).map_err(unsupported)?;
            let amount = parse_yocto(amount_yocto).ok_or(Reason::Unsupported)?;
            let proposal = transfer(receiver, amount)?;
            if *proposal_id == 0 {
                return Err(Reason::Unsupported);
            }
            let salt = host.random32().map_err(|_| Reason::Storage)?;
            Ok(prepared(network, owner, multisig, *proposal_id, proposal, salt, false))
        }
        RequestInput::MultisigConfirm { multisig, proposal_id, commitment_hex } => {
            let multisig = NearAccount::new(multisig).map_err(unsupported)?;
            let commitment = lowercase_hex::<32>(commitment_hex)?;
            let prefix = key_prefix(&multisig, &commitment);
            let stored = read_json::<StoredOpening>(host, &format!("{prefix}:open"))?.ok_or(Reason::ProposalMissing)?;
            if stored.proposal_id != *proposal_id {
                return Err(Reason::ProposalMissing);
            }
            let amount = parse_yocto(&stored.amount_yocto).ok_or(Reason::Storage)?;
            let proposal = transfer(&stored.receiver, amount).map_err(|_| Reason::Storage)?;
            let salt = crate::digest::from_hex::<32>(&stored.salt_hex).ok_or(Reason::Storage)?;
            let ready = prepared(network, owner, multisig, *proposal_id, proposal, salt, true);
            if ready.commitment != commitment {
                return Err(Reason::Storage);
            }
            if tries(host, &ready)? >= MAX_TRIES {
                return Err(Reason::AttemptsExhausted);
            }
            Ok(ready)
        }
        _ => Err(Reason::Unsupported),
    }
}

/// Refuses a voice that passes against the template of another member who
/// already said this proposal.
pub(super) fn check_other_voices(host: &mut dyn Host, ready: &Prepared, embedding: &Embedding) -> Result<(), Reason> {
    for member in voices(host, ready)?.0 {
        if member == ready.owner {
            continue;
        }
        let record = match host.storage_get(&template_key(&member)) {
            Ok(Some(bytes)) => TemplateRecord::decode(&bytes),
            Ok(None) => None,
            Err(_) => return Err(Reason::Storage),
        };
        let same = record
            .filter(|record| record.model_sha256 == model_sha256())
            .is_some_and(|record| speaker_passes(similarity_milli(embedding, &record.template)));
        if same {
            return Err(Reason::SameSpeaker);
        }
    }
    Ok(())
}

/// Counts one `words` refusal of a confirmation.
pub(super) fn count_try(host: &mut dyn Host, ready: &Prepared) -> Result<(), Reason> {
    let key = tries_key(ready);
    for _ in 0..MAX_WRITE_TRIES {
        let written = match host.storage_get(&key).map_err(|_| Reason::Storage)? {
            None => host.storage_set_if_absent(&key, b"1"),
            Some(old) => {
                let next = (count(&old) + 1).to_string();
                host.storage_set_if_equals(&key, &old, next.as_bytes())
            }
        };
        if written.map_err(|_| Reason::Storage)? {
            return Ok(());
        }
    }
    Err(Reason::Storage)
}

/// Records an accept: a new proposal and its salt, and the owner among the
/// voices of the proposal. Returns the commitment and the salt for the
/// proposer, and nothing for a confirmation.
pub(super) fn record_accept(host: &mut dyn Host, ready: &Prepared) -> Result<Option<MultisigOpening>, Reason> {
    let opening = if ready.recalled {
        None
    } else {
        let SpokenRequestV1::MultisigApproval {
            proposal_id,
            proposal: ProposalV1::Transfer { receiver, amount },
            salt,
            ..
        } = &ready.request
        else {
            return Err(Reason::Unsupported);
        };
        let stored = StoredOpening {
            proposal_id: *proposal_id,
            receiver: receiver.as_str().to_string(),
            amount_yocto: amount.yocto().to_string(),
            salt_hex: hex(salt),
        };
        let bytes = serde_json::to_vec(&stored).map_err(|_| Reason::Storage)?;
        // A fresh salt gives a fresh key, so the key is absent.
        if !host.storage_set_if_absent(&format!("{}:open", ready.prefix), &bytes).map_err(|_| Reason::Storage)? {
            return Err(Reason::Storage);
        }
        Some(MultisigOpening { commitment: b64u(&ready.commitment), salt: b64u(salt) })
    };
    add_voice(host, ready)?;
    Ok(opening)
}

fn prepared(
    network: Network,
    owner: NearAccount,
    multisig: NearAccount,
    proposal_id: u64,
    proposal: ProposalV1,
    salt: [u8; 32],
    recalled: bool,
) -> Prepared {
    let commitment = multisig_commitment(&multisig, proposal_id, &proposal, &salt);
    let prefix = key_prefix(&multisig, &commitment);
    let owner_text = owner.as_str().to_string();
    let request = SpokenRequestV1::MultisigApproval { network, owner, multisig, proposal_id, proposal, salt };
    Prepared { request, recalled, commitment, prefix, owner: owner_text }
}

/// Only transfers: the other proposal kinds change who the members are.
fn transfer(receiver: &str, amount_yocto: u128) -> Result<ProposalV1, Reason> {
    Ok(ProposalV1::Transfer {
        receiver: SpokenAccount::new(receiver).map_err(unsupported)?,
        amount: NearAmount::from_yocto(amount_yocto).map_err(unsupported)?,
    })
}

fn key_prefix(multisig: &NearAccount, commitment: &[u8; 32]) -> String {
    format!("msig1:{}:{}", multisig.as_str(), b64u(commitment))
}

fn tries_key(ready: &Prepared) -> String {
    format!("{}:tries:{}", ready.prefix, ready.owner)
}

fn tries(host: &mut dyn Host, ready: &Prepared) -> Result<u32, Reason> {
    Ok(host.storage_get(&tries_key(ready)).map_err(|_| Reason::Storage)?.map_or(0, |bytes| count(&bytes)))
}

/// A stored decimal count. A record that does not parse counts as no tries
/// left.
fn count(bytes: &[u8]) -> u32 {
    std::str::from_utf8(bytes).ok().and_then(|text| text.parse().ok()).unwrap_or(MAX_TRIES)
}

/// The members who said the proposal, and the stored bytes of the list.
fn voices(host: &mut dyn Host, ready: &Prepared) -> Result<(Vec<String>, Option<Vec<u8>>), Reason> {
    let key = format!("{}:voices", ready.prefix);
    match host.storage_get(&key).map_err(|_| Reason::Storage)? {
        None => Ok((Vec::new(), None)),
        Some(bytes) => Ok((serde_json::from_slice(&bytes).map_err(|_| Reason::Storage)?, Some(bytes))),
    }
}

fn add_voice(host: &mut dyn Host, ready: &Prepared) -> Result<(), Reason> {
    let key = format!("{}:voices", ready.prefix);
    for _ in 0..MAX_WRITE_TRIES {
        let (mut members, old) = voices(host, ready)?;
        if members.contains(&ready.owner) {
            return Ok(());
        }
        members.push(ready.owner.clone());
        let bytes = serde_json::to_vec(&members).map_err(|_| Reason::Storage)?;
        let written = match old {
            None => host.storage_set_if_absent(&key, &bytes),
            Some(old) => host.storage_set_if_equals(&key, &old, &bytes),
        };
        if written.map_err(|_| Reason::Storage)? {
            return Ok(());
        }
    }
    Err(Reason::Storage)
}

fn read_json<T: for<'de> Deserialize<'de>>(host: &mut dyn Host, key: &str) -> Result<Option<T>, Reason> {
    match host.storage_get(key).map_err(|_| Reason::Storage)? {
        None => Ok(None),
        Some(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| Reason::Storage),
    }
}
