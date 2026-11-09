//! The owner's authorization of an enrollment.
//!
//! The owner signs one NEP-413 message with a full-access key of the owner
//! account. The message names the enrollment digest of exactly the three
//! recordings. `enroll` computes the digest from the audio it received and
//! checks the signature over the NEP-413 hash before any network call. Then
//! it reads the key with a NEAR RPC `view_access_key` (finality `final`) in
//! the same batch as the speaker calls, and enrolls only if the key is a
//! full-access key of the owner.
//!
//! `enrollment_digest = base64url-no-pad SHA-256(ENROLLMENT_DOMAIN || owner
//! || 0x00 || d1 || d2 || d3)`, where each `d` is the raw 32-byte SHA-256 of
//! a canonical WAV, in input order. The NEP-413 message is
//! `ENROLLMENT_MESSAGE_PREFIX || enrollment_digest`, to
//! `ENROLLMENT_RECIPIENT`, with no callback URL. The Wallet's tests read the
//! shared vectors `testdata/enrollment_digest_v2.json` and
//! `testdata/enrollment_authorization_v1.json`.
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::config::{
    ENROLLMENT_DOMAIN, ENROLLMENT_MESSAGE_PREFIX, ENROLLMENT_RECIPIENT, NEAR_RPC_MAX_RESPONSE_BYTES,
    NEAR_RPC_TIMEOUT_SECS, NEAR_RPC_URL, NEP413_TAG,
};
use crate::digest::{from_b64, from_base58, near_ed25519_key};
use crate::host::PostRequest;
use crate::input::EnrollAuthorization;

/// The 32-byte enrollment digest.
pub fn enrollment_digest(owner: &str, audio_digests: &[[u8; 32]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ENROLLMENT_DOMAIN);
    hasher.update(owner.as_bytes());
    hasher.update([0u8]);
    for digest in audio_digests {
        hasher.update(digest);
    }
    hasher.finalize().into()
}

/// The NEP-413 message that authorizes the enrollment with this digest
/// (base64url text).
pub fn authorization_message(enrollment_digest_b64u: &str) -> String {
    format!("{ENROLLMENT_MESSAGE_PREFIX}{enrollment_digest_b64u}")
}

/// The NEP-413 hash: `SHA-256(u32 LE tag || borsh(message, nonce,
/// recipient, callback_url = None))`. The key signs these 32 bytes.
pub fn nep413_hash(message: &str, nonce: &[u8; 32], recipient: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(NEP413_TAG.to_le_bytes());
    borsh_string(&mut hasher, message);
    hasher.update(nonce);
    borsh_string(&mut hasher, recipient);
    // `callback_url: None`.
    hasher.update([0u8]);
    hasher.finalize().into()
}

fn borsh_string(hasher: &mut Sha256, text: &str) {
    hasher.update((text.len() as u32).to_le_bytes());
    hasher.update(text.as_bytes());
}

/// Checks the owner's NEP-413 signature of the enrollment message. Returns
/// the key as `ed25519:<base58>` for the access-key view, or the reason for
/// a refusal.
pub fn check_authorization(
    authorization: &EnrollAuthorization,
    enrollment_digest_b64u: &str,
) -> Result<String, &'static str> {
    let public_key: [u8; 32] = authorization
        .public_key
        .strip_prefix("ed25519:")
        .and_then(from_base58)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or("bad_public_key")?;
    let signature: [u8; 64] =
        from_b64(&authorization.signature_b64).and_then(|bytes| bytes.try_into().ok()).ok_or("bad_signature")?;
    let nonce: [u8; 32] =
        from_b64(&authorization.nonce_b64).and_then(|bytes| bytes.try_into().ok()).ok_or("bad_nonce")?;
    let message = authorization_message(enrollment_digest_b64u);
    let hash = nep413_hash(&message, &nonce, ENROLLMENT_RECIPIENT);
    VerifyingKey::from_bytes(&public_key)
        .and_then(|key| key.verify_strict(&hash, &Signature::from_bytes(&signature)))
        .map_err(|_| "bad_signature")?;
    Ok(near_ed25519_key(&public_key))
}

/// The JSON-RPC `query` (`view_access_key`, finality `final`) of the
/// owner's key.
pub fn access_key_request(owner: &str, public_key: &str) -> PostRequest {
    let body = json!({
        "jsonrpc": "2.0",
        "id": "seams-voice-verifier",
        "method": "query",
        "params": {
            "request_type": "view_access_key",
            "finality": "final",
            "account_id": owner,
            "public_key": public_key,
        },
    });
    PostRequest {
        url: NEAR_RPC_URL.to_string(),
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: body.to_string().into_bytes(),
        timeout_secs: NEAR_RPC_TIMEOUT_SECS,
        max_response_bytes: NEAR_RPC_MAX_RESPONSE_BYTES,
    }
}

/// What the owner's account says about the key.
#[derive(Debug, PartialEq, Eq)]
pub enum AccessKey {
    FullAccess,
    FunctionCall,
    /// The account has no such key, or the account does not exist.
    Missing,
}

/// Reads a `view_access_key` reply. A transport, RPC or shape failure is an
/// `Err`; the enrollment then refuses as `authorization_unavailable`.
pub fn parse_access_key(status: u16, body: &[u8]) -> Result<AccessKey, String> {
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Value = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    if let Some(error) = reply.get("error") {
        return match error.pointer("/cause/name").and_then(Value::as_str) {
            Some("UNKNOWN_ACCESS_KEY" | "UNKNOWN_ACCOUNT") => Ok(AccessKey::Missing),
            _ => Err("rpc_error".into()),
        };
    }
    let result = reply.get("result").ok_or("bad_reply")?;
    // Older nodes answer an unknown key with an error text in the result.
    if let Some(error) = result.get("error").and_then(Value::as_str) {
        return if error.contains("does not exist") { Ok(AccessKey::Missing) } else { Err("view_error".into()) };
    }
    match result.get("permission") {
        Some(Value::String(permission)) if permission == "FullAccess" => Ok(AccessKey::FullAccess),
        Some(Value::Object(permission)) if permission.contains_key("FunctionCall") => Ok(AccessKey::FunctionCall),
        _ => Err("bad_reply".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digest::b64;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed(seed: [u8; 32], digest: &str, nonce: [u8; 32]) -> EnrollAuthorization {
        let key = SigningKey::from_bytes(&seed);
        let hash = nep413_hash(&authorization_message(digest), &nonce, ENROLLMENT_RECIPIENT);
        EnrollAuthorization {
            public_key: near_ed25519_key(&key.verifying_key().to_bytes()),
            signature_b64: b64(&key.sign(&hash).to_bytes()),
            nonce_b64: b64(&nonce),
        }
    }

    #[test]
    fn digest_preimage() {
        let digests = [[1u8; 32], [2u8; 32], [3u8; 32]];
        let mut preimage = ENROLLMENT_DOMAIN.to_vec();
        preimage.extend_from_slice(b"owner.testnet\0");
        digests.iter().for_each(|d| preimage.extend_from_slice(d));
        assert_eq!(enrollment_digest("owner.testnet", &digests), crate::digest::sha256(&preimage));
        // Another order or another owner is another digest.
        let swapped = [digests[1], digests[0], digests[2]];
        assert_ne!(enrollment_digest("owner.testnet", &swapped), enrollment_digest("owner.testnet", &digests));
        assert_ne!(enrollment_digest("other.testnet", &digests), enrollment_digest("owner.testnet", &digests));
    }

    #[test]
    fn nep413_payload_bytes() {
        let nonce = [9u8; 32];
        let mut payload = NEP413_TAG.to_le_bytes().to_vec();
        payload.extend_from_slice(&3u32.to_le_bytes());
        payload.extend_from_slice(b"msg");
        payload.extend_from_slice(&nonce);
        payload.extend_from_slice(&2u32.to_le_bytes());
        payload.extend_from_slice(b"to");
        payload.push(0);
        assert_eq!(nep413_hash("msg", &nonce, "to"), crate::digest::sha256(&payload));
    }

    #[test]
    fn only_the_signature_of_this_digest_passes() {
        let authorization = signed([7u8; 32], "digest-a", [1u8; 32]);
        let key = check_authorization(&authorization, "digest-a").unwrap();
        assert_eq!(key, authorization.public_key);
        assert_eq!(check_authorization(&authorization, "digest-b"), Err("bad_signature"));
        let mut wrong_nonce = signed([7u8; 32], "digest-a", [1u8; 32]);
        wrong_nonce.nonce_b64 = b64(&[2u8; 32]);
        assert_eq!(check_authorization(&wrong_nonce, "digest-a"), Err("bad_signature"));
        let mut short_nonce = signed([7u8; 32], "digest-a", [1u8; 32]);
        short_nonce.nonce_b64 = b64(&[2u8; 31]);
        assert_eq!(check_authorization(&short_nonce, "digest-a"), Err("bad_nonce"));
        let mut bad_key = signed([7u8; 32], "digest-a", [1u8; 32]);
        bad_key.public_key = "secp256k1:abc".into();
        assert_eq!(check_authorization(&bad_key, "digest-a"), Err("bad_public_key"));
        let mut bad_signature = signed([7u8; 32], "digest-a", [1u8; 32]);
        bad_signature.signature_b64 = b64(&[0u8; 63]);
        assert_eq!(check_authorization(&bad_signature, "digest-a"), Err("bad_signature"));
    }

    #[test]
    fn view_request() {
        let request = access_key_request("o.testnet", "ed25519:abc");
        assert_eq!(request.url, NEAR_RPC_URL);
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        assert_eq!(body["params"]["request_type"], "view_access_key");
        assert_eq!(body["params"]["finality"], "final");
        assert_eq!(body["params"]["account_id"], "o.testnet");
        assert_eq!(body["params"]["public_key"], "ed25519:abc");
    }

    fn reply(result: Value) -> Vec<u8> {
        json!({ "jsonrpc": "2.0", "id": "x", "result": result }).to_string().into_bytes()
    }

    #[test]
    fn view_replies() {
        let full = reply(json!({ "nonce": 5, "permission": "FullAccess", "block_height": 1, "block_hash": "h" }));
        assert_eq!(parse_access_key(200, &full), Ok(AccessKey::FullAccess));
        let call = reply(json!({ "nonce": 5, "permission": { "FunctionCall": {
            "allowance": null, "receiver_id": "x.testnet", "method_names": [] } } }));
        assert_eq!(parse_access_key(200, &call), Ok(AccessKey::FunctionCall));
        let unknown = json!({ "jsonrpc": "2.0", "id": "x", "error": {
            "name": "HANDLER_ERROR", "cause": { "name": "UNKNOWN_ACCESS_KEY", "info": {} } } });
        assert_eq!(parse_access_key(200, unknown.to_string().as_bytes()), Ok(AccessKey::Missing));
        let old = reply(json!({ "error": "access key ed25519:abc does not exist while viewing", "logs": [] }));
        assert_eq!(parse_access_key(200, &old), Ok(AccessKey::Missing));
        let internal = json!({ "error": { "name": "INTERNAL_ERROR", "cause": { "name": "INTERNAL_ERROR" } } });
        assert_eq!(parse_access_key(200, internal.to_string().as_bytes()), Err("rpc_error".into()));
        assert_eq!(parse_access_key(503, b""), Err("status_503".into()));
        assert_eq!(parse_access_key(200, &reply(json!({ "nonce": 1 }))), Err("bad_reply".into()));
    }
}
