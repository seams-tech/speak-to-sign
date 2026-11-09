//! The typed request of a `verify` input, as the Wallet builds it. Each text
//! field must parse as its `spoken-intent` type. Any other value refuses as
//! `unsupported`.
use spoken_intent::{
    NearAccount, NearAmount, Network, NoteRatingV1, SpokenAccount, SpokenBranch, SpokenRequestV1, SpokenSummary,
};

use crate::digest::from_hex;
use crate::input::{parse_yocto, RatingInput, RequestInput};
use crate::output::Reason;

/// The network that this version serves.
const SERVED_NETWORK: Network = Network::Testnet;

/// The refusal of an input that this version does not handle, for
/// `map_err`.
pub(super) fn unsupported<E>(_: E) -> Reason {
    Reason::Unsupported
}

/// A transfer from the owner's account, as the Wallet builds it. The owner
/// can be any NEAR account; the receiver and the amount must be speakable,
/// and the receiver is not the owner.
pub fn transfer_request(owner: &str, receiver: &str, amount_yocto: u128) -> Result<SpokenRequestV1, Reason> {
    transfer(NearAccount::new(owner).map_err(unsupported)?, receiver, amount_yocto)
}

fn transfer(owner: NearAccount, receiver: &str, amount_yocto: u128) -> Result<SpokenRequestV1, Reason> {
    let receiver = SpokenAccount::new(receiver).map_err(unsupported)?;
    if receiver.as_str() == owner.as_str() {
        return Err(Reason::Unsupported);
    }
    let amount = NearAmount::from_yocto(amount_yocto).map_err(unsupported)?;
    Ok(SpokenRequestV1::AccountTransfer { network: SERVED_NETWORK, owner, receiver, amount })
}

/// The typed request of a `verify` input.
pub(super) fn typed_request(owner: &str, request: &RequestInput) -> Result<SpokenRequestV1, Reason> {
    let owner = NearAccount::new(owner).map_err(unsupported)?;
    match request {
        RequestInput::Transfer { receiver, amount_yocto } => {
            transfer(owner, receiver, parse_yocto(amount_yocto).ok_or(Reason::Unsupported)?)
        }
        RequestInput::CommunityNote { contract, post_id, note_sha256_hex, summary } => {
            Ok(SpokenRequestV1::CommunityNote {
                network: SERVED_NETWORK,
                owner,
                contract: NearAccount::new(contract).map_err(unsupported)?,
                post_id: *post_id,
                note_sha256: lowercase_hex::<32>(note_sha256_hex)?,
                summary: SpokenSummary::new(summary).map_err(unsupported)?,
            })
        }
        RequestInput::NoteRating { contract, note_id, rating } => Ok(SpokenRequestV1::NoteRating {
            network: SERVED_NETWORK,
            owner,
            contract: NearAccount::new(contract).map_err(unsupported)?,
            note_id: *note_id,
            rating: (*rating).into(),
        }),
        RequestInput::MergeApproval { contract, repo_sha256_hex, pull_request, base, head_commit_hex } => {
            if *pull_request == 0 {
                return Err(Reason::Unsupported);
            }
            Ok(SpokenRequestV1::MergeApproval {
                network: SERVED_NETWORK,
                owner,
                contract: NearAccount::new(contract).map_err(unsupported)?,
                repo_sha256: lowercase_hex::<32>(repo_sha256_hex)?,
                pull_request: *pull_request,
                base: SpokenBranch::new(base).map_err(unsupported)?,
                head_commit: lowercase_hex::<20>(head_commit_hex)?,
            })
        }
    }
}

/// The accounts of the word check: the contacts of the input, and the
/// receiver of a transfer if it is not one of them.
pub(super) fn known_accounts(contacts: &[String], request: &SpokenRequestV1) -> Result<Vec<SpokenAccount>, Reason> {
    let mut accounts = contacts
        .iter()
        .map(|contact| SpokenAccount::new(contact))
        .collect::<Result<Vec<_>, _>>()
        .map_err(unsupported)?;
    if let SpokenRequestV1::AccountTransfer { receiver, .. } = request {
        if !accounts.contains(receiver) {
            accounts.push(receiver.clone());
        }
    }
    Ok(accounts)
}

/// `2 * N` lowercase hex characters.
fn lowercase_hex<const N: usize>(text: &str) -> Result<[u8; N], Reason> {
    let lowercase = text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    from_hex::<N>(text).filter(|_| lowercase).ok_or(Reason::Unsupported)
}

impl From<RatingInput> for NoteRatingV1 {
    fn from(rating: RatingInput) -> Self {
        match rating {
            RatingInput::Helpful => NoteRatingV1::Helpful,
            RatingInput::SomewhatHelpful => NoteRatingV1::SomewhatHelpful,
            RatingInput::NotHelpful => NoteRatingV1::NotHelpful,
        }
    }
}
