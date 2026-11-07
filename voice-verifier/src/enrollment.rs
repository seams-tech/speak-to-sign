//! Owner-authorized enrollment.
//!
//! The owner signs `authorize_enrollment(enrollment_digest)` on the vault.
//! The vault keeps that digest for 10 minutes. `enroll` computes the same
//! digest from the audio it received and reads the vault's pending digest
//! for the owner with a NEAR RPC view call (finality `final`). It enrolls
//! only if the two are equal. The vault does not learn the result.
//!
//! `enrollment_digest = base64url-no-pad SHA-256(ENROLLMENT_DOMAIN || vault
//! || 0x00 || owner || 0x00 || d1 || d2 || d3)`, where each `d` is the raw
//! 32-byte SHA-256 of a canonical WAV, in input order.
//! `testdata/enrollment_digest_v1.json` is the shared vector; the vault's
//! tests and `demo/test_demo.py` read it.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::config::{
    ENROLLMENT_DOMAIN, NEAR_RPC_MAX_RESPONSE_BYTES, NEAR_RPC_TIMEOUT_SECS, NEAR_RPC_URL, PENDING_ENROLLMENT_VIEW,
};
use crate::digest::b64;
use crate::host::PostRequest;

/// The 32-byte enrollment digest.
pub fn enrollment_digest(vault: &str, owner: &str, audio_digests: &[[u8; 32]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ENROLLMENT_DOMAIN);
    hasher.update(vault.as_bytes());
    hasher.update([0u8]);
    hasher.update(owner.as_bytes());
    hasher.update([0u8]);
    for digest in audio_digests {
        hasher.update(digest);
    }
    hasher.finalize().into()
}

/// The JSON-RPC `query` (`call_function`, finality `final`) of the vault's
/// `get_pending_enrollment({"owner_id": owner})`.
pub fn pending_request(vault: &str, owner: &str) -> PostRequest {
    let args = json!({ "owner_id": owner }).to_string();
    let body = json!({
        "jsonrpc": "2.0",
        "id": "seams-voice-verifier",
        "method": "query",
        "params": {
            "request_type": "call_function",
            "finality": "final",
            "account_id": vault,
            "method_name": PENDING_ENROLLMENT_VIEW,
            "args_base64": b64(args.as_bytes()),
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

/// The vault's view: `null`, or the pending digest and its expiry. The
/// vault returns `null` for an expired authorization.
#[derive(Debug, Deserialize)]
struct PendingView {
    enrollment_digest: String,
    #[allow(dead_code)]
    expires_at_ns: Value,
}

/// The pending enrollment digest (base64url text) from an RPC reply, or
/// `None` if the owner has none. An RPC or contract error is an `Err`.
pub fn parse_pending(status: u16, body: &[u8]) -> Result<Option<String>, String> {
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Value = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    if reply.get("error").is_some() {
        return Err("rpc_error".into());
    }
    let result = reply.get("result").ok_or("bad_reply")?;
    if result.get("error").is_some() {
        return Err("view_error".into());
    }
    let bytes: Vec<u8> = result
        .get("result")
        .and_then(Value::as_array)
        .ok_or("bad_reply")?
        .iter()
        .map(|byte| byte.as_u64().and_then(|byte| u8::try_from(byte).ok()))
        .collect::<Option<_>>()
        .ok_or("bad_reply")?;
    let view: Option<PendingView> = serde_json::from_slice(&bytes).map_err(|_| "bad_view".to_string())?;
    Ok(view.map(|view| view.enrollment_digest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digest::{b64u, from_b64};

    const VECTOR: &str = include_str!("../testdata/enrollment_digest_v1.json");

    fn digest32(text: &str) -> [u8; 32] {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;
        URL_SAFE_NO_PAD.decode(text).unwrap().try_into().unwrap()
    }

    #[test]
    fn shared_vector() {
        let vector: Value = serde_json::from_str(VECTOR).unwrap();
        assert_eq!(vector["domain"].as_str().unwrap().as_bytes(), ENROLLMENT_DOMAIN);
        let digests: Vec<[u8; 32]> =
            vector["audio_digests"].as_array().unwrap().iter().map(|d| digest32(d.as_str().unwrap())).collect();
        let digest = enrollment_digest(vector["vault"].as_str().unwrap(), vector["owner"].as_str().unwrap(), &digests);
        assert_eq!(b64u(&digest), vector["enrollment_digest"].as_str().unwrap());
        // The preimage, written out.
        let mut preimage = ENROLLMENT_DOMAIN.to_vec();
        preimage.extend_from_slice(b"voicevault.testnet\0owner.testnet\0");
        digests.iter().for_each(|d| preimage.extend_from_slice(d));
        assert_eq!(digest, crate::digest::sha256(&preimage));
        // Another order, vault or owner is another digest.
        let swapped = [digests[1], digests[0], digests[2]];
        assert_ne!(enrollment_digest("voicevault.testnet", "owner.testnet", &swapped), digest);
        assert_ne!(enrollment_digest("owner.testnet", "voicevault.testnet", &digests), digest);
    }

    #[test]
    fn view_request() {
        let request = pending_request("v.testnet", "o.testnet");
        assert_eq!(request.url, NEAR_RPC_URL);
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        assert_eq!(body["params"]["finality"], "final");
        assert_eq!(body["params"]["account_id"], "v.testnet");
        assert_eq!(body["params"]["method_name"], "get_pending_enrollment");
        let args = from_b64(body["params"]["args_base64"].as_str().unwrap()).unwrap();
        assert_eq!(args, br#"{"owner_id":"o.testnet"}"#);
    }

    fn reply(view: &str) -> Vec<u8> {
        json!({ "jsonrpc": "2.0", "id": "x", "result": {
            "block_hash": "h", "block_height": 1, "logs": [], "result": view.as_bytes() } })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn view_replies() {
        let pending = reply(r#"{"enrollment_digest":"abc","expires_at_ns":"5"}"#);
        assert_eq!(parse_pending(200, &pending), Ok(Some("abc".into())));
        assert_eq!(parse_pending(200, &reply("null")), Ok(None));
        assert_eq!(parse_pending(503, b""), Err("status_503".into()));
        assert_eq!(parse_pending(200, br#"{"error":{"name":"HANDLER_ERROR"}}"#), Err("rpc_error".into()));
        let failed = json!({ "result": { "error": "wasm execution failed", "logs": [] } }).to_string();
        assert_eq!(parse_pending(200, failed.as_bytes()), Err("view_error".into()));
        assert_eq!(parse_pending(200, &reply("[1]")), Err("bad_view".into()));
    }
}
