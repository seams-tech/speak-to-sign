//! SHA-256, base64url, hex and base58 text.
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use sha2::{Digest, Sha256};

/// SHA-256 of `bytes`.
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// Unpadded base64url.
pub fn b64u(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Standard base64 with padding.
pub fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// Decodes standard base64 with padding. White space at the ends is removed.
pub fn from_b64(text: &str) -> Option<Vec<u8>> {
    STANDARD.decode(text.trim()).ok()
}

/// Lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Decodes `2 * N` hex characters into `N` bytes.
pub fn from_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != 2 * N || !text.is_ascii() {
        return None;
    }
    let mut out = [0u8; N];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(out)
}

const BASE58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// Bitcoin base58, as NEAR writes keys.
pub fn base58(bytes: &[u8]) -> String {
    let zeros = bytes.iter().take_while(|byte| **byte == 0).count();
    // Base-58 digits, least significant first.
    let mut digits: Vec<u8> = Vec::with_capacity(bytes.len() * 138 / 100 + 1);
    for byte in &bytes[zeros..] {
        let mut carry = u32::from(*byte);
        for digit in digits.iter_mut() {
            carry += u32::from(*digit) << 8;
            *digit = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut text = String::with_capacity(zeros + digits.len());
    text.extend(std::iter::repeat('1').take(zeros));
    text.extend(digits.iter().rev().map(|digit| BASE58[*digit as usize] as char));
    text
}

/// A NEAR public key text: `ed25519:<base58>`.
pub fn near_ed25519_key(public_key: &[u8]) -> String {
    format!("ed25519:{}", base58(public_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base58_known_values() {
        assert_eq!(base58(b""), "");
        assert_eq!(base58(&[0, 0, 1]), "112");
        assert_eq!(base58(b"hello world"), "StV1DL6CwTryKyV");
        // The NEAR key of 32 zero bytes.
        assert_eq!(base58(&[0; 32]), "11111111111111111111111111111111");
        assert_eq!(base58(&[255; 32]), "JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG");
    }

    #[test]
    fn hex_round_trip() {
        let bytes: [u8; 4] = [0, 15, 16, 255];
        assert_eq!(from_hex::<4>(&hex(&bytes)), Some(bytes));
        assert_eq!(from_hex::<4>("000f10f"), None);
        assert_eq!(from_hex::<4>("000f10fg"), None);
    }

    #[test]
    fn base64_forms() {
        assert_eq!(b64u(&[0xfb, 0xff]), "-_8");
        assert_eq!(b64(&[0xfb, 0xff]), "+/8=");
        assert_eq!(from_b64(" +/8= "), Some(vec![0xfb, 0xff]));
        assert_eq!(from_b64("-_8"), None);
    }
}
