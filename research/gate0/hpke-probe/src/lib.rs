//! The audio envelope of Section 7.2: HPKE base mode with the suite
//! X25519-HKDF-SHA256 / HKDF-SHA256 / ChaCha20-Poly1305 (RFC 9180).
use hpke::{
    aead::ChaCha20Poly1305, kdf::HkdfSha256, kem::X25519HkdfSha256, Deserializable, Kem as KemTrait,
    OpModeR, OpModeS, Serializable,
};

pub type Kem = X25519HkdfSha256;
pub const INFO: &[u8] = b"seams:voice-audio:v1";

/// Returns (private key, public key), 32 bytes each.
pub fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    let (private_key, public_key) = Kem::gen_keypair();
    (private_key.to_bytes().into(), public_key.to_bytes().into())
}

/// Returns (encapsulated key, ciphertext with its 16-byte tag).
pub fn seal(recipient_public_key: &[u8], aad: &[u8], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), hpke::HpkeError> {
    let public_key = <Kem as KemTrait>::PublicKey::from_bytes(recipient_public_key)?;
    let (encapped, ciphertext) =
        hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, Kem>(&OpModeS::Base, &public_key, INFO, plaintext, aad)?;
    Ok((encapped.to_bytes().to_vec(), ciphertext))
}

pub fn open(recipient_private_key: &[u8], encapped: &[u8], aad: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, hpke::HpkeError> {
    let private_key = <Kem as KemTrait>::PrivateKey::from_bytes(recipient_private_key)?;
    let encapped = <Kem as KemTrait>::EncappedKey::from_bytes(encapped)?;
    hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(&OpModeR::Base, &private_key, &encapped, INFO, ciphertext, aad)
}

/// Wallet-side link check for wasm32-unknown-unknown: generate, seal and open.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[no_mangle]
pub extern "C" fn gate0_hpke_roundtrip_len(length: u32) -> u32 {
    let (private_key, public_key) = generate_keypair();
    let plaintext = vec![7u8; length as usize];
    let Ok((encapped, ciphertext)) = seal(&public_key, b"aad", &plaintext) else { return 0 };
    match open(&private_key, &encapped, b"aad", &ciphertext) {
        Ok(opened) if opened == plaintext => ciphertext.len() as u32,
        _ => 0,
    }
}
