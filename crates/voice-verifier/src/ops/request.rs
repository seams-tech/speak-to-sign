//! The typed request of a `verify` input, as the Wallet builds it. Each text
//! field must parse as its `spoken-intent` type. Any other value refuses as
//! `unsupported`.
use spoken_intent::{
    AppOwner, BetOutcomeV1, ConfirmationContext, NearAccount, NearAmount, Network, NoteRatingV1, ProposalV1, SpokenAccount, SpokenBranch,
    SpokenRequestV1, SpokenSummary, UsdcAmount,
};

use crate::config::MAX_NOTE_CHARS;
use crate::digest::{from_hex, sha256};
use crate::input::{parse_yocto, OutcomeInput, RatingInput, RequestInput};
use crate::output::Reason;

/// The network that this version serves.
pub(super) const SERVED_NETWORK: Network = Network::Testnet;

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

/// The owner of an input: a NEAR account, or an owner that an application
/// names (`app:<id>`).
pub(super) enum Owner {
    Near(NearAccount),
    App(AppOwner),
}

impl Owner {
    pub(super) fn parse(text: &str) -> Result<Self, Reason> {
        if text.starts_with(spoken_intent::APP_OWNER_PREFIX) {
            AppOwner::new(text).map(Self::App).map_err(unsupported)
        } else {
            NearAccount::new(text).map(Self::Near).map_err(unsupported)
        }
    }

    pub(super) fn as_str(&self) -> &str {
        match self {
            Self::Near(account) => account.as_str(),
            Self::App(owner) => owner.as_str(),
        }
    }
}

/// The typed request of a `verify` input. A `confirmation` needs an
/// application owner. Every other kind needs a NEAR owner.
pub(super) fn typed_request(owner: &str, request: &RequestInput) -> Result<SpokenRequestV1, Reason> {
    let owner = match (Owner::parse(owner)?, request) {
        (Owner::App(owner), RequestInput::Confirmation { context, payload_sha256_hex, summary }) => {
            return Ok(SpokenRequestV1::Confirmation {
                owner,
                context: ConfirmationContext::new(context).map_err(unsupported)?,
                payload_sha256: lowercase_hex::<32>(payload_sha256_hex)?,
                summary: SpokenSummary::new(summary).map_err(unsupported)?,
            });
        }
        (Owner::App(_), _) | (Owner::Near(_), RequestInput::Confirmation { .. }) => return Err(Reason::Unsupported),
        (Owner::Near(owner), _) => owner,
    };
    match request {
        RequestInput::Transfer { receiver, amount_yocto } => {
            transfer(owner, receiver, parse_yocto(amount_yocto).ok_or(Reason::Unsupported)?)
        }
        RequestInput::CommunityNote { contract, post_id, note_text, summary } => {
            if note_text.trim().is_empty() || note_text.chars().count() > MAX_NOTE_CHARS {
                return Err(Reason::Unsupported);
            }
            Ok(SpokenRequestV1::CommunityNote {
                network: SERVED_NETWORK,
                owner,
                contract: NearAccount::new(contract).map_err(unsupported)?,
                post_id: *post_id,
                note_sha256: sha256(note_text.as_bytes()),
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
        RequestInput::MarketBet { market, token, market_id, outcome, amount_units } => {
            if *market_id == 0 {
                return Err(Reason::Unsupported);
            }
            // The same decimal rule as a yoctoNEAR amount: digits only, no sign.
            let units = parse_yocto(amount_units).ok_or(Reason::Unsupported)?;
            Ok(SpokenRequestV1::MarketBet {
                network: SERVED_NETWORK,
                owner,
                market: NearAccount::new(market).map_err(unsupported)?,
                token: NearAccount::new(token).map_err(unsupported)?,
                market_id: *market_id,
                outcome: match outcome {
                    OutcomeInput::Yes => BetOutcomeV1::Yes,
                    OutcomeInput::No => BetOutcomeV1::No,
                },
                amount: UsdcAmount::from_units(units).map_err(unsupported)?,
            })
        }
        RequestInput::Transaction { receiver, actions_sha256_hex, summary } => {
            Ok(SpokenRequestV1::Transaction {
                network: SERVED_NETWORK,
                owner,
                receiver: NearAccount::new(receiver).map_err(unsupported)?,
                actions_sha256: lowercase_hex::<32>(actions_sha256_hex)?,
                summary: SpokenSummary::new(summary).map_err(unsupported)?,
            })
        }
        RequestInput::SignedMessage { payload_sha256_hex, summary } => {
            Ok(SpokenRequestV1::SignedMessage {
                network: SERVED_NETWORK,
                owner,
                payload_sha256: lowercase_hex::<32>(payload_sha256_hex)?,
                summary: SpokenSummary::new(summary).map_err(unsupported)?,
            })
        }
        // Handled before this match.
        RequestInput::Confirmation { .. } => Err(Reason::Unsupported),
        // `multisig::prepare` builds these: they need the worker's storage
        // and randomness.
        RequestInput::MultisigPropose { .. }
        | RequestInput::MultisigHideNote { .. }
        | RequestInput::MultisigConfirm { .. } => Err(Reason::Unsupported),
    }
}

/// The accounts of the word check: the contacts of the input, and the
/// receiver of a transfer or of a multisig transfer if it is not one of
/// them. A `recalled` proposal adds no receiver: the recipient step writes
/// a contact's words into the heard text, so a refusal would show the
/// receiver that the member must say from memory.
pub(super) fn known_accounts(
    contacts: &[String],
    request: &SpokenRequestV1,
    recalled: bool,
) -> Result<Vec<SpokenAccount>, Reason> {
    let mut accounts = contacts
        .iter()
        .map(|contact| SpokenAccount::new(contact))
        .collect::<Result<Vec<_>, _>>()
        .map_err(unsupported)?;
    let receiver = match request {
        SpokenRequestV1::AccountTransfer { receiver, .. } => Some(receiver),
        SpokenRequestV1::MultisigApproval { proposal: ProposalV1::Transfer { receiver, .. }, .. } if !recalled => {
            Some(receiver)
        }
        _ => None,
    };
    if let Some(receiver) = receiver {
        if !accounts.contains(receiver) {
            accounts.push(receiver.clone());
        }
    }
    Ok(accounts)
}

/// `2 * N` lowercase hex characters.
pub(super) fn lowercase_hex<const N: usize>(text: &str) -> Result<[u8; N], Reason> {
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
