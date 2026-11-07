use core::num::NonZeroU8;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::{ChallengeWord, NearAmount, SpokenAccount};

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
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
pub enum SpokenRequestV1 {
    /// A native NEAR transfer from a voice vault to a saved contact.
    VaultTransfer {
        /// The network of the vault.
        network: Network,
        /// The vault contract.
        vault: SpokenAccount,
        /// The vault owner.
        owner: SpokenAccount,
        /// The contact that receives the amount.
        receiver: SpokenAccount,
        /// The amount. Borsh writes it as the `u128` yoctoNEAR value.
        amount: NearAmount,
        /// The vault request nonce.
        nonce: u64,
    },
    /// A spoken approval of a typed multisig proposal.
    MultisigApproval {
        /// The network of the multisig.
        network: Network,
        /// The multisig contract.
        multisig: SpokenAccount,
        /// The proposal id.
        proposal_id: u64,
        /// The proposal. No kind holds free text or a free function call.
        proposal: ProposalV1,
        /// The two fresh words that the contract issued.
        challenge: [ChallengeWord; 2],
    },
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
