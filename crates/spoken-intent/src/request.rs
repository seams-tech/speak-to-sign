use core::num::NonZeroU8;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::{NearAccount, NearAmount, SpokenAccount, SpokenBranch, SpokenSummary, UsdcAmount};

/// The NEAR network of a request. It is part of the request digest, not of
/// the spoken text.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize,
)]
pub enum Network {
    /// NEAR testnet.
    Testnet,
    /// NEAR mainnet.
    Mainnet,
}

/// A request that a person confirms by voice. It has only speakable kinds.
/// Only the fields that the text says are [`SpokenAccount`]s.
///
/// Borsh writes the explicit tag of each kind. Tag 0 was the retired vault
/// transfer, and decoding refuses it. Tag 3 is kept for a typed contract
/// call.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum SpokenRequestV1 {
    /// A spoken approval of a typed multisig proposal, from one member's
    /// own account. The text says the proposal id and the proposal.
    ///
    /// The multisig contract holds only the [`multisig_commitment`] of the
    /// proposal, so a member's page and the chain do not show it before the
    /// members confirm it. [`request_digest`] of this kind binds that
    /// commitment and not the proposal (see [`multisig_approval_digest`]), so
    /// the contract checks a verdict without the proposal.
    ///
    /// [`multisig_commitment`]: crate::multisig_commitment
    /// [`request_digest`]: crate::request_digest
    /// [`multisig_approval_digest`]: crate::multisig_approval_digest
    MultisigApproval {
        /// The network of the multisig.
        network: Network,
        /// The member who approves, named or implicit. The text does not say
        /// it.
        owner: NearAccount,
        /// The multisig contract. The text does not say it.
        multisig: NearAccount,
        /// The proposal id.
        proposal_id: u64,
        /// The proposal. No kind holds free text or a free function call.
        proposal: ProposalV1,
        /// The random salt of the commitment. The text does not say it.
        salt: [u8; 32],
    } = 1,
    /// A native NEAR transfer from the owner's own account to a named account.
    AccountTransfer {
        /// The network of the transfer.
        network: Network,
        /// The account that pays, named or implicit. The text does not say it.
        owner: NearAccount,
        /// The account that receives the amount.
        receiver: SpokenAccount,
        /// The amount. Borsh writes it as the `u128` yoctoNEAR value.
        amount: NearAmount,
    } = 2,
    /// A community note on a post, added from the owner's own account. Only
    /// the summary is said. The note itself is bound by its SHA-256.
    ///
    /// This kind and [`SpokenRequestV1::NoteRating`] move no value: the
    /// Wallet calls one fixed method of `contract` with no deposit. So the
    /// summary is the one free text that a request may hold.
    CommunityNote {
        /// The network of the notes contract.
        network: Network,
        /// The author, named or implicit. The text does not say it.
        owner: NearAccount,
        /// The notes contract. The text does not say it.
        contract: NearAccount,
        /// The post that the note is about.
        post_id: u64,
        /// SHA-256 of the UTF-8 note text.
        note_sha256: [u8; 32],
        /// The summary that the author says.
        summary: SpokenSummary,
    } = 4,
    /// A rating of a community note, from the owner's own account.
    NoteRating {
        /// The network of the notes contract.
        network: Network,
        /// The account that rates, named or implicit. The text does not say
        /// it.
        owner: NearAccount,
        /// The notes contract. The text does not say it.
        contract: NearAccount,
        /// The note. The text does not say it.
        note_id: u64,
        /// The rating that the text says.
        rating: NoteRatingV1,
    } = 5,
    /// An approval to merge one commit of a pull request into its base
    /// branch, from the owner's own account. The text says the pull request
    /// number and the base. The repository and the commit are bound by
    /// their hashes.
    ///
    /// This kind moves no value: the Wallet calls only `approve_merge` on
    /// `contract`, with no deposit.
    MergeApproval {
        /// The network of the merge approvals contract.
        network: Network,
        /// The approver, named or implicit. The text does not say it.
        owner: NearAccount,
        /// The merge approvals contract. The text does not say it.
        contract: NearAccount,
        /// SHA-256 of the UTF-8 repository name, such as
        /// `seams-tech/seams-wallet`. The text does not say it.
        repo_sha256: [u8; 32],
        /// The pull request number that the text says.
        pull_request: u64,
        /// The base branch that the text says.
        base: SpokenBranch,
        /// The 20-byte Git commit id of the head of the pull request. The
        /// text does not say it.
        head_commit: [u8; 20],
    } = 6,
    /// A bet on one outcome of a prediction market, paid in USDC from the
    /// owner's own account. The text says the amount, the outcome and the
    /// market id: "bet zero point five usdc yes on market nine".
    ///
    /// This kind moves value, as a transfer does: the owner sends `amount`
    /// of `token` to the `market` contract. The market contract checks the
    /// verdict of this request before it takes the bet, so the sentence that
    /// the owner said is the bet that the contract books.
    MarketBet {
        /// The network of the market.
        network: Network,
        /// The account that bets, named or implicit. The text does not say
        /// it.
        owner: NearAccount,
        /// The market contract. The text does not say it.
        market: NearAccount,
        /// The token contract of the stake. The text says only "usdc"; the
        /// digest binds the contract.
        token: NearAccount,
        /// The market id that the text says.
        market_id: u64,
        /// The outcome that the text says.
        outcome: BetOutcomeV1,
        /// The stake that the text says.
        amount: UsdcAmount,
    } = 7,
}

/// The outcome of a market that a bet backs.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum BetOutcomeV1 {
    /// "yes"
    Yes = 0,
    /// "no"
    No = 1,
}

impl BetOutcomeV1 {
    /// The other outcome.
    pub fn other(self) -> Self {
        match self {
            Self::Yes => Self::No,
            Self::No => Self::Yes,
        }
    }

    /// The word that the text says.
    pub fn word(self) -> &'static str {
        match self {
            Self::Yes => "yes",
            Self::No => "no",
        }
    }
}

/// The rating of a community note.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum NoteRatingV1 {
    /// "this note is helpful"
    Helpful = 0,
    /// "this note is somewhat helpful"
    SomewhatHelpful = 1,
    /// "this note is not helpful"
    NotHelpful = 2,
}

impl NoteRatingV1 {
    /// Every rating.
    pub const ALL: [Self; 3] = [Self::Helpful, Self::SomewhatHelpful, Self::NotHelpful];
}

/// A typed multisig proposal.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
pub enum ProposalV1 {
    /// Send NEAR from the multisig.
    Transfer {
        /// The receiver.
        receiver: SpokenAccount,
        /// The amount.
        amount: NearAmount,
    },
    /// Add a member.
    AddMember {
        /// The new member.
        member: SpokenAccount,
    },
    /// Remove a member.
    RemoveMember {
        /// The member to remove.
        member: SpokenAccount,
    },
    /// Set the number of approvals that a proposal needs.
    SetThreshold {
        /// The new threshold, at least one.
        threshold: NonZeroU8,
    },
    /// Pin a new verifier version.
    SetVerifierVersion {
        /// The 32-byte version hash. The text speaks its first eight decimal
        /// digits.
        version_hash: [u8; 32],
    },
    /// Hide a community note: the multisig is the moderator of a notes
    /// contract, and the contract removes the note's text. The multisig
    /// names the notes contract; the text does not say it.
    HideNote {
        /// The id of the note.
        note_id: u64,
    },
}
