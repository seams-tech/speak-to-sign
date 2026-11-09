//! Speaker embeddings, the stored template and the enrollment rule. The math
//! follows the Wallet (`voiceid/src/browser/model.ts` and `enrollment.ts`).
//!
//! The embedding comes from the speaker service: ReDimNet B1 in a Phala
//! dstack CVM, which signs each embedding with its attested ed25519 key.
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::config::{
    EMBEDDING_DIM, REDIMNET_SHA256_HEX, SPEAKER_CUTOFF_MILLI, SPEAKER_EMBED_DOMAIN, SPEAKER_EMBED_URL,
    SPEAKER_MAX_RESPONSE_BYTES, SPEAKER_TIMEOUT_SECS,
};
use crate::digest::{b64, from_b64, from_hex, hex};
use crate::host::PostRequest;

/// The POST to the speaker service: `{"audio_wav_b64", "nonce"}`.
pub fn service_request(wav: &[u8], nonce: &[u8; 32]) -> PostRequest {
    let body = json!({ "audio_wav_b64": b64(wav), "nonce": hex(nonce) });
    PostRequest {
        url: SPEAKER_EMBED_URL.to_string(),
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: body.to_string().into_bytes(),
        timeout_secs: SPEAKER_TIMEOUT_SECS,
        max_response_bytes: SPEAKER_MAX_RESPONSE_BYTES,
    }
}

/// The 32-byte message that the speaker service signs:
/// `SHA-256(SPEAKER_EMBED_DOMAIN || audio_digest || nonce || model_sha256 ||
/// embedding bytes)`.
pub fn service_message(audio_digest: &[u8; 32], nonce: &[u8; 32], model_sha256: &[u8; 32], embedding_le: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SPEAKER_EMBED_DOMAIN);
    hasher.update(audio_digest);
    hasher.update(nonce);
    hasher.update(model_sha256);
    hasher.update(embedding_le);
    hasher.finalize().into()
}

/// A checked speaker service reply.
#[derive(Debug, PartialEq)]
pub struct ServiceReply {
    pub embedding: Embedding,
    /// The service's own model time (not signed).
    pub model_ms: Option<u64>,
}

/// Checks a reply: status 200; `audio_digest`, `nonce` and `model_sha256`
/// are the values that the worker sent and pins; the key is `pinned`; an
/// ed25519 signature (strict) over [`service_message`]; 192 finite values.
pub fn check_service_reply(
    status: u16,
    body: &[u8],
    audio_digest: &[u8; 32],
    nonce: &[u8; 32],
    pinned: &[u8; 32],
) -> Result<ServiceReply, String> {
    #[derive(Deserialize)]
    struct Reply {
        embedding_b64: String,
        audio_digest: String,
        model_sha256: String,
        nonce: String,
        public_key: String,
        signature: String,
        model_ms: Option<u64>,
    }
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Reply = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    let digest = from_hex::<32>(&reply.audio_digest).ok_or("bad_reply")?;
    let model = from_hex::<32>(&reply.model_sha256).ok_or("bad_reply")?;
    let echoed = from_hex::<32>(&reply.nonce).ok_or("bad_reply")?;
    let public_key = from_hex::<32>(&reply.public_key).ok_or("bad_reply")?;
    let signature = from_hex::<64>(&reply.signature).ok_or("bad_reply")?;
    if &digest != audio_digest {
        return Err("audio_digest_mismatch".into());
    }
    if &echoed != nonce {
        return Err("nonce_mismatch".into());
    }
    if hex(&model) != REDIMNET_SHA256_HEX {
        return Err("model_not_pinned".into());
    }
    if &public_key != pinned {
        return Err("key_not_pinned".into());
    }
    let embedding_le = from_b64(&reply.embedding_b64).ok_or("bad_reply")?;
    if embedding_le.len() != EMBEDDING_DIM * 4 {
        return Err("embedding_length".into());
    }
    let message = service_message(&digest, &echoed, &model, &embedding_le);
    VerifyingKey::from_bytes(&public_key)
        .and_then(|key| key.verify_strict(&message, &Signature::from_bytes(&signature)))
        .map_err(|_| "bad_signature".to_string())?;
    let raw: Vec<f32> =
        embedding_le.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect();
    let embedding = Embedding::from_raw(&raw).ok_or("bad_embedding")?;
    Ok(ServiceReply { embedding, model_ms: reply.model_ms })
}

/// The pinned model digest as bytes.
pub fn model_sha256() -> [u8; 32] {
    from_hex::<32>(REDIMNET_SHA256_HEX).expect("pinned hex")
}

/// A unit-length 192-value ReDimNet embedding.
#[derive(Clone, Debug, PartialEq)]
pub struct Embedding(Vec<f32>);

impl Embedding {
    /// Normalizes a raw model output. Refuses a wrong size, a value that is
    /// not finite, or a vector with no signal.
    pub fn from_raw(values: &[f32]) -> Option<Self> {
        if values.len() != EMBEDDING_DIM || !values.iter().all(|value| value.is_finite()) {
            return None;
        }
        let squared: f64 = values.iter().map(|value| f64::from(*value) * f64::from(*value)).sum();
        if squared < 1e-12 {
            return None;
        }
        let norm = squared.sqrt();
        Some(Self(values.iter().map(|value| (f64::from(*value) / norm) as f32).collect()))
    }

    /// The values.
    pub fn values(&self) -> &[f32] {
        &self.0
    }
}

/// The cosine of two unit embeddings in thousandths, rounded down.
pub fn similarity_milli(left: &Embedding, right: &Embedding) -> i32 {
    let score: f64 = left.0.iter().zip(&right.0).map(|(a, b)| f64::from(*a) * f64::from(*b)).sum();
    (score * 1_000.0).floor() as i32
}

/// The speaker check passes at or above the cutoff.
pub fn speaker_passes(score_milli: i32) -> bool {
    score_milli >= SPEAKER_CUTOFF_MILLI
}

/// The result of the enrollment rule.
#[derive(Debug, PartialEq)]
pub enum Enrollment {
    /// Every pair agrees. The template is the unit mean.
    Agreed { template: Embedding, agreement_milli: i32 },
    /// Some pair is below the cutoff.
    Disagreed { agreement_milli: i32 },
}

/// Every pair of samples must reach the speaker cutoff, as in the Wallet.
/// `agreement_milli` is the lowest pairwise score.
pub fn enroll(samples: &[Embedding]) -> Enrollment {
    let mut agreement_milli = i32::MAX;
    for (index, left) in samples.iter().enumerate() {
        for right in &samples[index + 1..] {
            agreement_milli = agreement_milli.min(similarity_milli(left, right));
        }
    }
    if samples.len() < 2 || !speaker_passes(agreement_milli) {
        return Enrollment::Disagreed { agreement_milli: agreement_milli.min(1_000) };
    }
    let mut mean = vec![0f32; EMBEDDING_DIM];
    for sample in samples {
        for (slot, value) in mean.iter_mut().zip(&sample.0) {
            *slot += value / samples.len() as f32;
        }
    }
    match Embedding::from_raw(&mean) {
        Some(template) => Enrollment::Agreed { template, agreement_milli },
        None => Enrollment::Disagreed { agreement_milli },
    }
}

const TEMPLATE_MAGIC: &[u8; 4] = b"SVT1";

/// A stored template: `SVT1 || epoch (u32 LE) || model SHA-256 || 192 f32 LE`.
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
    /// The stored bytes (808).
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(4 + 4 + 32 + 4 * EMBEDDING_DIM);
        bytes.extend_from_slice(TEMPLATE_MAGIC);
        bytes.extend_from_slice(&self.epoch.to_le_bytes());
        bytes.extend_from_slice(&self.model_sha256);
        for value in self.template.values() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    /// Decodes stored bytes. Refuses any other layout.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != 4 + 4 + 32 + 4 * EMBEDDING_DIM || &bytes[..4] != TEMPLATE_MAGIC {
            return None;
        }
        let epoch = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
        let model_sha256: [u8; 32] = bytes[8..40].try_into().ok()?;
        let values: Vec<f32> = bytes[40..]
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        // Keep the stored values as they are; refuse any that are not unit.
        let squared: f64 = values.iter().map(|value| f64::from(*value) * f64::from(*value)).sum();
        if !values.iter().all(|value| value.is_finite()) || (squared - 1.0).abs() > 1e-3 {
            return None;
        }
        Some(Self { epoch, model_sha256, template: Embedding(values) })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A unit vector along `axis`, turned toward `axis + 1` by `angle`.
    pub(crate) fn embedding(axis: usize, angle: f32) -> Embedding {
        let mut values = vec![0f32; EMBEDDING_DIM];
        values[axis] = angle.cos();
        values[(axis + 1) % EMBEDDING_DIM] = angle.sin();
        Embedding::from_raw(&values).unwrap()
    }

    #[test]
    fn normalization_and_refusals() {
        let embedding = Embedding::from_raw(&[2.0; EMBEDDING_DIM]).unwrap();
        let norm: f32 = embedding.values().iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert!(Embedding::from_raw(&[1.0; 191]).is_none());
        assert!(Embedding::from_raw(&[0.0; EMBEDDING_DIM]).is_none());
        let mut bad = [1.0; EMBEDDING_DIM];
        bad[3] = f32::NAN;
        assert!(Embedding::from_raw(&bad).is_none());
    }

    #[test]
    fn similarity_rounds_down_and_cutoff_is_inclusive() {
        let a = embedding(0, 0.0);
        assert!(similarity_milli(&a, &a) >= 999);
        // cos(1.1) = 0.4536
        assert_eq!(similarity_milli(&a, &embedding(0, 1.1)), 453);
        assert!(speaker_passes(450));
        assert!(!speaker_passes(449));
        let opposite = Embedding::from_raw(&a.values().iter().map(|v| -v).collect::<Vec<_>>()).unwrap();
        assert!(similarity_milli(&a, &opposite) <= -999);
    }

    #[test]
    fn enrollment_agrees_and_makes_a_unit_mean() {
        let samples = [embedding(0, 0.0), embedding(0, 0.2), embedding(0, 0.4)];
        let Enrollment::Agreed { template, agreement_milli } = enroll(&samples) else { panic!() };
        // Lowest pair is 0.0 and 0.4: cos(0.4) = 0.921.
        assert_eq!(agreement_milli, 921);
        assert!(similarity_milli(&template, &embedding(0, 0.2)) >= 999);
    }

    #[test]
    fn enrollment_refuses_a_different_sample() {
        let samples = [embedding(0, 0.0), embedding(0, 0.1), embedding(5, 0.0)];
        assert_eq!(enroll(&samples), Enrollment::Disagreed { agreement_milli: 0 });
        assert!(matches!(enroll(&samples[..1]), Enrollment::Disagreed { .. }));
    }

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
