//! Owner-authorized enrollment (plan Section 4.4).
//!
//! The owner calls `authorize_enrollment(enrollment_digest)`. The vault keeps
//! one pending digest for each owner, for `ENROLLMENT_TTL_NS`; a new call
//! replaces it. The verifier's `enroll` reads it with the view
//! `get_pending_enrollment` (NEAR RPC, finality `final`) and enrolls only
//! audio whose digest equals it. The vault does not learn the result.
//!
//! `enrollment_digest = base64url-no-pad SHA-256("seams:voice-enrollment:v1"
//! || vault || 0x00 || owner || 0x00 || d1 || d2 || d3)`, with the three raw
//! 32-byte canonical WAV digests. The shared vector is
//! `voice-verifier/testdata/enrollment_digest_v1.json`.
//!
//! The records live under their own key prefix, outside the contract state
//! struct, so the state layout of a deployed vault stays the same.

use near_sdk::{borsh, env, near, AccountId};

use crate::state::NS_PER_SECOND;

/// An authorization holds for 10 minutes.
pub const ENROLLMENT_TTL_NS: u64 = 600 * NS_PER_SECOND;

/// The prefix of the enrollment digest preimage.
pub const ENROLLMENT_DOMAIN: &[u8] = b"seams:voice-enrollment:v1";

/// Storage key prefix of a pending enrollment (other prefixes: `v`, `a`).
const PREFIX: &[u8] = b"e";

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingEnrollment {
    pub digest: [u8; 32],
    pub expires_at_ns: u64,
}

impl PendingEnrollment {
    pub fn is_live(&self, now_ns: u64) -> bool {
        now_ns < self.expires_at_ns
    }
}

fn key(owner_id: &AccountId) -> Vec<u8> {
    [PREFIX, owner_id.as_bytes()].concat()
}

pub fn read(owner_id: &AccountId) -> Option<PendingEnrollment> {
    env::storage_read(&key(owner_id)).and_then(|bytes| borsh::from_slice(&bytes).ok())
}

/// Writes (or replaces) the pending enrollment of `owner_id`.
pub fn write(owner_id: &AccountId, pending: &PendingEnrollment) {
    let bytes = borsh::to_vec(pending).unwrap_or_else(|_| env::abort());
    env::storage_write(&key(owner_id), &bytes);
}

/// The 32-byte enrollment digest, as the verifier and the client compute it.
/// The vault stores the digest it is given; tests use this to check the
/// shared vector.
pub fn enrollment_digest(vault: &AccountId, owner: &AccountId, audio_digests: &[[u8; 32]]) -> [u8; 32] {
    let mut preimage = ENROLLMENT_DOMAIN.to_vec();
    preimage.extend_from_slice(vault.as_bytes());
    preimage.push(0);
    preimage.extend_from_slice(owner.as_bytes());
    preimage.push(0);
    audio_digests.iter().for_each(|digest| preimage.extend_from_slice(digest));
    env::sha256_array(&preimage)
}
