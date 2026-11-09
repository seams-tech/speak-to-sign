use core::num::NonZeroU8;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::{ChallengeWord, NearAccount, NearAmount, SpokenAccount, SpokenBranch, SpokenSummary};

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
    /// A spoken approval of a typed multisig proposal.
    MultisigApproval {
        /// The network of the multisig.
        network: Network,
        /// The multisig contract.
        multisig: NearAccount,
        /// The proposal id.
        proposal_id: u64,
        /// The proposal. No kind holds free text or a free function call.
        proposal: ProposalV1,
        /// The two fresh words that the contract issued.
        challenge: [ChallengeWord; 2],
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
}
