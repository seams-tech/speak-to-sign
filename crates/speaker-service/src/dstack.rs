//! The dstack guest agent, v1 surface (`dstack.guest.v1`, dstack 0.6.0 or
//! later), as plain JSON over HTTP/1.1 on the Unix socket.
//!
//! The wire format is in `docs/guest-api-v1.md` of Dstack-TEE/dstack: a `POST`
//! to `/v1/<Method>` with `Content-Type: application/json`; every proto
//! `bytes` field is hex in JSON. This client uses two methods:
//! - `GetKey {domain, algorithm}` to `{key, public_key, signature_chain}`
//! - `Attest {report_data, include_boottime_gpu_evidence}` to `{attestation}`
//!
//! `attestation` is a `VersionedAttestation`: for v1 a MessagePack map whose
//! `platform.data.quote` holds the raw TDX quote when `platform.kind` is `tdx`
//! or `gcp-tdx`. [`quote_from_attestation`] takes it out.
use anyhow::{anyhow, bail, Context};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::Request;
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{json, Value};

/// The guest agent socket in a dstack CVM (mounted into the container).
pub const DEFAULT_SOCKET: &str = "/var/run/dstack.sock";

/// Responses from the agent stay small; refuse anything over 1 MiB.
const MAX_REPLY_BYTES: usize = 1 << 20;

pub struct Client {
    socket: String,
}

#[derive(Deserialize)]
pub struct GetKeyResponse {
    #[serde(with = "hex::serde")]
    pub key: Vec<u8>,
    #[serde(with = "hex::serde")]
    pub public_key: Vec<u8>,
    #[serde(default)]
    pub signature_chain: Vec<String>,
}

#[derive(Deserialize)]
struct AttestResponse {
    #[serde(with = "hex::serde")]
    attestation: Vec<u8>,
}

impl Client {
    pub fn new(socket: impl Into<String>) -> Self {
        Client { socket: socket.into() }
    }

    async fn call(&self, method: &str, body: Value) -> anyhow::Result<Vec<u8>> {
        let stream = tokio::net::UnixStream::connect(&self.socket)
            .await
            .with_context(|| format!("connect {}", self.socket))?;
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
        tokio::spawn(connection);
        let request = Request::post(format!("/v1/{method}"))
            .header("host", "localhost")
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from(body.to_string())))?;
        let response = sender.send_request(request).await?;
        let status = response.status();
        let body = http_body_util::Limited::new(response.into_body(), MAX_REPLY_BYTES)
            .collect()
            .await
            .map_err(|error| anyhow!("read {method} reply: {error}"))?
            .to_bytes();
        if !status.is_success() {
            // A 404 that is not JSON means the agent has no v1 surface.
            bail!("{method}: status {status}: {}", String::from_utf8_lossy(&body[..body.len().min(300)]));
        }
        Ok(body.to_vec())
    }

    /// v1 `GetKey` with `algorithm = "ed25519"`.
    pub async fn get_ed25519_key(&self, domain: &str) -> anyhow::Result<GetKeyResponse> {
        let body = self.call("GetKey", json!({ "domain": domain, "algorithm": "ed25519" })).await?;
        let reply: GetKeyResponse = serde_json::from_slice(&body).context("GetKey reply")?;
        if reply.key.len() != 32 || reply.public_key.len() != 32 {
            bail!("GetKey: ed25519 key is {} bytes, public key {} bytes", reply.key.len(), reply.public_key.len());
        }
        Ok(reply)
    }

    /// v1 `Attest` over 1 to 64 bytes of `report_data`: the attestation bytes.
    pub async fn attest(&self, report_data: &[u8]) -> anyhow::Result<Vec<u8>> {
        let body = self
            .call(
                "Attest",
                json!({ "report_data": hex::encode(report_data), "include_boottime_gpu_evidence": false }),
            )
            .await?;
        let reply: AttestResponse = serde_json::from_slice(&body).context("Attest reply")?;
        Ok(reply.attestation)
    }
}

/// Takes the raw TDX quote out of a v1 `VersionedAttestation`
/// (`platform.data.quote`). `None` for another platform or a legacy (SCALE)
/// attestation, whose first byte is `0x00`.
pub fn quote_from_attestation(attestation: &[u8]) -> Option<Vec<u8>> {
    let value = rmpv::decode::read_value(&mut &attestation[..]).ok()?;
    let field = |value: &rmpv::Value, name: &str| -> Option<rmpv::Value> {
        value.as_map()?.iter().find(|(key, _)| key.as_str() == Some(name)).map(|(_, value)| value.clone())
    };
    let platform = field(&value, "platform")?;
    let data = field(&platform, "data")?;
    let quote = field(&data, "quote")?;
    match quote {
        rmpv::Value::Binary(bytes) => Some(bytes),
        // A byte array that serde wrote as a sequence of integers.
        rmpv::Value::Array(items) => items.iter().map(|item| item.as_u64().and_then(|n| u8::try_from(n).ok())).collect(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    /// The v1 ed25519 test vectors from `docs/guest-api-v1.md`: the private
    /// key is the RFC 8032 seed, so `SigningKey::from_bytes` gives the agent's
    /// public key. The service checks this at start.
    #[test]
    fn agent_ed25519_key_is_an_rfc8032_seed() {
        for (private, public) in [
            (
                "b023493030669cf22e9cafa6a464d4cf3ae4edfe5474ec796710f21ea011946d",
                "a3dc149fd5b765eab2eb7d3174fa939e39386898f10b15b7b146f6f1358ecf2a",
            ),
            (
                "3c4c3ece12fa99ccb93fc0090877f80e70545fdd971e2ac93d3398c4684538d3",
                "2380c4a33a60b60613fa43866421e5b96eb8dcde211317200fd0d41e7e491288",
            ),
        ] {
            let seed: [u8; 32] = hex::decode(private).unwrap().try_into().unwrap();
            assert_eq!(hex::encode(SigningKey::from_bytes(&seed).verifying_key().as_bytes()), public);
        }
    }

    #[test]
    fn quote_comes_out_of_a_v1_attestation() {
        use rmpv::Value;
        let attestation = Value::Map(vec![
            (Value::from("version"), Value::from(1)),
            (
                Value::from("platform"),
                Value::Map(vec![
                    (Value::from("kind"), Value::from("tdx")),
                    (
                        Value::from("data"),
                        Value::Map(vec![
                            (Value::from("quote"), Value::Binary(vec![4, 0, 2, 0])),
                            (Value::from("event_log"), Value::from("[]")),
                        ]),
                    ),
                ]),
            ),
        ]);
        let mut bytes = Vec::new();
        rmpv::encode::write_value(&mut bytes, &attestation).unwrap();
        assert_eq!(quote_from_attestation(&bytes), Some(vec![4, 0, 2, 0]));
        assert_eq!(quote_from_attestation(&[0, 1, 2]), None);
    }
}
