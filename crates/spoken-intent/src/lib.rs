//! The one canonical English sentence for a voice-confirmed NEAR request.
//!
//! The verifier links this crate. The Wallet has a TypeScript port of the
//! rules, and the golden vectors in `fixtures/` check that the port renders,
//! normalizes and digests the same text. The voice multisig contract
//! (`demo/contracts/voice-multisig`) links it for the multisig commitment and
//! digest. The crate uses no floats, no locale, no clock and no randomness:
//! the caller passes the salt of a multisig commitment in.
//!
//! Types carry the grammar rules. Each account that the text says is a
//! [`SpokenAccount`], which holds only an account that the grammar can speak.
//! The owner and the multisig are not said, so each is a [`NearAccount`],
//! which can be implicit. A [`NearAmount`] holds only an
//! exact multiple of 0.01 NEAR up to 1,000,000 NEAR. A [`SpokenSummary`]
//! holds only short plain words that a speech-to-text model writes back the
//! same way, and a [`SpokenBranch`] holds only one word of lowercase letters.
//! So [`render`] cannot fail, and Borsh decoding refuses bytes that hold an
//! unspeakable value.
//!
//! A change to any rendered text is a new renderer version.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod account;
mod amount;
mod branch;
mod confusion;
mod normalize;
mod numbers;
mod owner;
mod parse;
mod phonetic;
mod punctuated;
mod render;
mod request;
mod spelling;
mod summary;
mod token;

use sha2::{Digest, Sha256};

pub use account::{InvalidAccountId, NearAccount, SpokenAccount};
pub use amount::{NearAmount, UsdcAmount};
pub use branch::{InvalidBranch, SpokenBranch, MAX_BRANCH_LETTERS};
pub use confusion::confusion_set;
pub use normalize::normalize;
pub use owner::{
    AppOwner, ConfirmationContext, InvalidIdentifier, APP_OWNER_PREFIX, MAX_APP_OWNER_BYTES, MAX_CONTEXT_BYTES,
};
pub use parse::{parse_transfer, ParseRefusal, ParseResult, ParsedTransfer};
pub use phonetic::{phonetic_key, PhoneticKey};
pub use punctuated::{normalize_punctuated, PunctuatedRefusal, PUNCTUATED_ALIASES};
pub use render::{render, RenderedIntentV1};
pub use request::{BetOutcomeV1, Network, NoteRatingV1, ProposalV1, SpokenRequestV1};
pub use summary::{InvalidSummary, SpokenSummary, MAX_SUMMARY_BYTES, MAX_SUMMARY_WORDS};
pub use token::{spoken_text, SpokenToken};

/// The renderer version that statements and verdicts name.
pub const RENDERER_VERSION: &str = "spoken-intent/1";

/// Domain prefix of [`request_digest`].
pub const REQUEST_DIGEST_DOMAIN: &[u8] = b"seams:spoken-intent:request:v1";

/// Domain prefix of [`spoken_text_digest`].
pub const SPOKEN_TEXT_DIGEST_DOMAIN: &[u8] = b"seams:spoken-intent:spoken:v1";

/// Why a value has no spoken form.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum UnsupportedReason {
    /// The amount is zero, above 1,000,000 NEAR, or not a whole multiple of
    /// 0.01 NEAR.
    AmountNotSpeakable,
    /// The account is not a valid named NEAR account, or it is an implicit
    /// (64 hex characters) or `0x` account.
    AccountNotSpeakable,
}

/// Domain prefix of [`multisig_commitment`].
pub const MULTISIG_COMMITMENT_DOMAIN: &[u8] = b"seams:spoken-intent:multisig-commitment:v1";

/// The Borsh tag of [`SpokenRequestV1::MultisigApproval`].
const MULTISIG_APPROVAL_TAG: u8 = 1;

/// `sha256(REQUEST_DIGEST_DOMAIN || borsh(request))`, except for a multisig
/// approval, whose digest is [`multisig_approval_digest`].
pub fn request_digest(request: &SpokenRequestV1) -> [u8; 32] {
    if let SpokenRequestV1::MultisigApproval {
        network,
        owner,
        multisig,
        proposal_id,
        proposal,
        salt,
    } = request
    {
        let commitment = multisig_commitment(multisig, *proposal_id, proposal, salt);
        return multisig_approval_digest(*network, owner, multisig, *proposal_id, &commitment);
    }
    sha256_borsh(REQUEST_DIGEST_DOMAIN, request, &[])
}

/// The salted hash of one multisig proposal, which the contract stores in
/// place of the proposal:
/// `sha256(MULTISIG_COMMITMENT_DOMAIN || borsh(multisig, proposal_id, proposal) || salt)`.
///
/// The salt is 32 random bytes. Without it, a member could hash each likely
/// amount and receiver and compare the result with the commitment.
pub fn multisig_commitment(
    multisig: &NearAccount,
    proposal_id: u64,
    proposal: &ProposalV1,
    salt: &[u8; 32],
) -> [u8; 32] {
    sha256_borsh(
        MULTISIG_COMMITMENT_DOMAIN,
        &(multisig, proposal_id, proposal),
        salt,
    )
}

/// The request digest of a multisig approval:
/// `sha256(REQUEST_DIGEST_DOMAIN || 1 || borsh(network, owner, multisig, proposal_id, commitment))`.
/// It holds the commitment in place of the proposal and the salt, so the
/// contract computes it from its own state.
pub fn multisig_approval_digest(
    network: Network,
    owner: &NearAccount,
    multisig: &NearAccount,
    proposal_id: u64,
    commitment: &[u8; 32],
) -> [u8; 32] {
    sha256_borsh(
        REQUEST_DIGEST_DOMAIN,
        &(
            MULTISIG_APPROVAL_TAG,
            network,
            owner,
            multisig,
            proposal_id,
            commitment,
        ),
        &[],
    )
}

/// `sha256(domain || borsh(value) || suffix)`.
fn sha256_borsh(domain: &[u8], value: &impl borsh::BorshSerialize, suffix: &[u8]) -> [u8; 32] {
    // Every field serializes infallibly into a Vec.
    let bytes = borsh::to_vec(value).expect("borsh serialization into a Vec");
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(&bytes);
    hasher.update(suffix);
    hasher.finalize().into()
}

/// `sha256(SPOKEN_TEXT_DIGEST_DOMAIN || spoken_text)`.
pub fn spoken_text_digest(rendered: &RenderedIntentV1) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SPOKEN_TEXT_DIGEST_DOMAIN);
    hasher.update(rendered.spoken_text.as_bytes());
    hasher.finalize().into()
}
