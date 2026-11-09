//! The stored template record of an owner:
//! `SVT1 || epoch (u32 LE) || model SHA-256 || 192 f32 LE`.
use crate::config::{EMBEDDING_DIM, REDIMNET_SHA256_HEX};
use crate::digest::from_hex;
use crate::embedding::{f32_values, Embedding};

const TEMPLATE_MAGIC: &[u8; 4] = b"SVT1";

/// The record length: the magic, the epoch, the model digest and the
/// values (808 bytes).
const RECORD_LEN: usize = 4 + 4 + 32 + 4 * EMBEDDING_DIM;

/// The pinned model digest as bytes.
pub fn model_sha256() -> [u8; 32] {
    from_hex::<32>(REDIMNET_SHA256_HEX).expect("pinned hex")
}

/// A stored template.
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateRecord {
    /// The template epoch: 1, then 1 more on each re-enrollment.
    pub epoch: u32,
    /// SHA-256 of the speaker model that made the template.
    pub model_sha256: [u8; 32],
    /// The template.
    pub template: Embedding,
}

impl TemplateRecord {
    /// The stored bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(RECORD_LEN);
        bytes.extend_from_slice(TEMPLATE_MAGIC);
        bytes.extend_from_slice(&self.epoch.to_le_bytes());
        bytes.extend_from_slice(&self.model_sha256);
        for value in self.template.values() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    /// Decodes stored bytes. Refuses any other layout, and values that are
    /// not unit length.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != RECORD_LEN || &bytes[..4] != TEMPLATE_MAGIC {
            return None;
        }
        let epoch = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
        let model_sha256: [u8; 32] = bytes[8..40].try_into().ok()?;
        let template = Embedding::from_unit(f32_values(&bytes[40..]))?;
        Some(Self { epoch, model_sha256, template })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digest::hex;
    use crate::embedding::tests::embedding;

    #[test]
    fn model_digest_parses_the_pin() {
        assert_eq!(hex(&model_sha256()), REDIMNET_SHA256_HEX);
    }

    #[test]
    fn template_record_round_trip_and_refusals() {
        let record = TemplateRecord { epoch: 7, model_sha256: [9; 32], template: embedding(3, 0.5) };
        let bytes = record.encode();
        assert_eq!(bytes.len(), 808);
        assert_eq!(TemplateRecord::decode(&bytes), Some(record));
        assert_eq!(TemplateRecord::decode(&bytes[..807]), None);
        let mut wrong_magic = bytes.clone();
        wrong_magic[0] = b'X';
        assert_eq!(TemplateRecord::decode(&wrong_magic), None);
    }
}
