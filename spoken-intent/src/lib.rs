//! The one canonical English sentence for a voice-confirmed NEAR request.
//!
//! Every consumer (the Wallet, the Seams server, the verifier and the
//! contracts) links this crate, so each one renders, normalizes and digests
//! the same text. The crate uses no floats, no locale, no clock and no
//! randomness: the caller passes the challenge words in.
//!
//! Types carry the grammar rules. Each account that the text says is a
//! [`SpokenAccount`], which holds only an account that the grammar can speak.
//! The vault, the owner and the multisig are not said, so each is a
//! [`NearAccount`], which can be implicit. A [`NearAmount`] holds only an
//! exact multiple of 0.01 NEAR up to 1,000,000 NEAR. So [`render`] cannot
//! fail, and Borsh decoding refuses bytes that hold an unspeakable value.
//!
//! A change to any rendered text is a new renderer version.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod account;
mod amount;
mod challenge;
mod confusion;
mod normalize;
mod numbers;
mod parse;
mod phonetic;
mod punctuated;
mod render;
mod request;

use sha2::{Digest, Sha256};

pub use account::{InvalidAccountId, NearAccount, SpokenAccount};
pub use amount::NearAmount;
pub use challenge::{ChallengeWord, CHALLENGE_WORDS};
pub use confusion::confusion_set;
pub use normalize::normalize;
pub use parse::{parse_transfer, ParseRefusal, ParseResult, ParsedTransfer};
pub use phonetic::{phonetic_key, PhoneticKey};
pub use punctuated::{normalize_punctuated, PunctuatedRefusal, PUNCTUATED_ALIASES};
pub use render::{render, RenderedIntentV1, SpokenToken};
pub use request::{Network, ProposalV1, SpokenRequestV1};

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

/// `sha256(REQUEST_DIGEST_DOMAIN || borsh(request))`.
pub fn request_digest(request: &SpokenRequestV1) -> [u8; 32] {
    // Every field serializes infallibly into a Vec.
    let bytes = borsh::to_vec(request).expect("borsh serialization into a Vec");
    let mut hasher = Sha256::new();
    hasher.update(REQUEST_DIGEST_DOMAIN);
    hasher.update(&bytes);
    hasher.finalize().into()
}

/// `sha256(SPOKEN_TEXT_DIGEST_DOMAIN || spoken_text)`.
pub fn spoken_text_digest(rendered: &RenderedIntentV1) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SPOKEN_TEXT_DIGEST_DOMAIN);
    hasher.update(rendered.spoken_text.as_bytes());
    hasher.finalize().into()
}
