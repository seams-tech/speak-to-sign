//! The speaker service client. The service runs ReDimNet B1 in a Phala
//! dstack CVM and signs each embedding with its attested ed25519 key.
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::config::{
    EMBEDDING_DIM, REDIMNET_SHA256_HEX, SPEAKER_EMBED_DOMAIN, SPEAKER_EMBED_URL, SPEAKER_MAX_RESPONSE_BYTES,
    SPEAKER_TIMEOUT_SECS,
};
use crate::digest::{b64, from_b64, from_hex, hex};
use crate::embedding::{f32_values, Embedding};
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
pub fn service_message(
    audio_digest: &[u8; 32],
    nonce: &[u8; 32],
    model_sha256: &[u8; 32],
    embedding_le: &[u8],
) -> [u8; 32] {
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
    let embedding = Embedding::from_raw(&f32_values(&embedding_le)).ok_or("bad_embedding")?;
    Ok(ServiceReply { embedding, model_ms: reply.model_ms })
}
