//! The sealed audio of a confidential request: HPKE base mode (RFC 9180)
//! with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305. The Wallet
//! seals each WAV to the verifier's audio key, so the Seams server and
//! OutLayer's coordinator carry only ciphertext.
//!
//! The private key is the OutLayer secret [`AUDIO_KEY_ENV`]: 32 bytes that
//! the keystore generated inside its TEE (type `hex32`). Nobody saw them,
//! and the keystore refuses a manual secret with the `PROTECTED_` prefix.
//!
//! A sealed clip is `enc || ciphertext || tag`: the 32-byte encapsulated
//! key, then the WAV under ChaCha20-Poly1305 with its 16-byte tag. `info` is
//! [`AUDIO_INFO`]. The `aad` names the operation and the owner
//! ([`audio_aad`]), so a sealed clip opens only for that owner and that
//! operation.
use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem as KemTrait, OpModeR, Serializable};

use crate::config::{AUDIO_INFO, AUDIO_KEY_DOMAIN};
use crate::digest::{from_hex, sha256};

type Kem = X25519HkdfSha256;

/// The length of the encapsulated key, and of each X25519 key.
pub const KEY_BYTES: usize = 32;
/// The Poly1305 tag.
const TAG_BYTES: usize = 16;

/// The verifier's audio key.
pub struct AudioKey(<Kem as KemTrait>::PrivateKey);

impl AudioKey {
    /// The key from the secret's text: 64 hex characters. `None` for any
    /// other text.
    pub fn from_secret(text: &str) -> Option<Self> {
        let bytes = from_hex::<KEY_BYTES>(text.trim())?;
        <Kem as KemTrait>::PrivateKey::from_bytes(&bytes).ok().map(Self)
    }

    /// The 32-byte X25519 public key that a Wallet seals to.
    pub fn public_key(&self) -> [u8; KEY_BYTES] {
        Kem::sk_to_pk(&self.0).to_bytes().into()
    }

    /// Opens one sealed clip. `None` for a clip that is too short, sealed
    /// to another key, changed, or sealed with another `aad`.
    pub fn open(&self, sealed: &[u8], aad: &[u8]) -> Option<Vec<u8>> {
        if sealed.len() < KEY_BYTES + TAG_BYTES {
            return None;
        }
        let (encapped, ciphertext) = sealed.split_at(KEY_BYTES);
        let encapped = <Kem as KemTrait>::EncappedKey::from_bytes(encapped).ok()?;
        hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(
            &OpModeR::Base,
            &self.0,
            &encapped,
            AUDIO_INFO,
            ciphertext,
            aad,
        )
        .ok()
    }
}

/// The `aad` of a sealed clip: `op || 0x00 || owner`.
pub fn audio_aad(op: &str, owner: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(op.len() + 1 + owner.len());
    aad.extend_from_slice(op.as_bytes());
    aad.push(0);
    aad.extend_from_slice(owner.as_bytes());
    aad
}

/// The 32-byte message that the verdict key signs to name the audio key:
/// `SHA-256(AUDIO_KEY_DOMAIN || public key)`.
pub fn audio_key_message(public_key: &[u8; KEY_BYTES]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(AUDIO_KEY_DOMAIN.len() + KEY_BYTES);
    preimage.extend_from_slice(AUDIO_KEY_DOMAIN);
    preimage.extend_from_slice(public_key);
    sha256(&preimage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_is_64_hex_characters() {
        assert!(AudioKey::from_secret(&"ab".repeat(32)).is_some());
        assert!(AudioKey::from_secret(&format!(" {}\n", "AB".repeat(32))).is_some());
        assert!(AudioKey::from_secret(&"ab".repeat(31)).is_none());
        assert!(AudioKey::from_secret(&"zz".repeat(32)).is_none());
        assert!(AudioKey::from_secret("").is_none());
    }

    /// RFC 7748, section 6.1: Alice's private and public key.
    #[test]
    fn the_public_key_is_x25519_of_the_secret() {
        let key = AudioKey::from_secret("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a").unwrap();
        assert_eq!(
            crate::digest::hex(&key.public_key()),
            "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
        );
    }

    #[test]
    fn the_aad_names_the_op_and_the_owner() {
        assert_eq!(audio_aad("verify", "o.testnet"), b"verify\0o.testnet");
    }

    #[test]
    fn a_short_clip_does_not_open() {
        let key = AudioKey::from_secret(&"ab".repeat(32)).unwrap();
        assert!(key.open(&[0u8; KEY_BYTES + TAG_BYTES - 1], b"").is_none());
        assert!(key.open(&[0u8; KEY_BYTES + TAG_BYTES], b"").is_none());
    }
}
