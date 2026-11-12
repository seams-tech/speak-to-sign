//! The attestation of the NEAR AI gateway, the only party that opens the
//! audio that the worker sends to Whisper.
//!
//! The worker seals each transcription request with Oblivious HTTP
//! ([`crate::ohttp`]) to the OHTTP key of the NEAR AI gateway. Before it
//! seals to a key, it checks the gateway's attestation report
//! (`GET /v1/attestation/report`, with a fresh nonce):
//!
//! 1. The gateway's TDX quote chains to Intel, with Intel's current
//!    collateral ([`crate::tdx_quote`]), the TCB status is one of
//!    [`ACCEPTED_TCB_STATUSES`], and the TD is not a debug TD.
//! 2. The quote's report data is the gateway's ed25519 key and the nonce
//!    of this check: `report_data = key (32) || nonce (32)`. The key is the
//!    pinned [`NEAR_AI_GATEWAY_KEY_HEX`].
//! 3. The quote's MRCONFIGID is `0x01 || SHA-256(app_compose) || 0^15`
//!    (dstack), so the compose file of the report is the one that the TD
//!    runs. Its hash is recorded, not pinned: NEAR AI deploys often.
//! 4. The gateway key signs (ed25519) the OHTTP key configuration, and the
//!    configuration is one that [`KeyConfig::parse`] accepts.
//! 5. The report has an attestation of the Whisper model of this verifier.
//!    Its TDX quote chains to Intel too, and binds the model's ed25519 key
//!    and the same nonce.
//!
//! Not checked here: how the gateway reaches the model (its code checks
//! the model's TDX and GPU attestation and pins the model's TLS key), the
//! NVIDIA GPU attestation, and the code of the compose file.
use std::collections::BTreeMap;

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;

use crate::config::{
    INTEL_PCS_MAX_BYTES, INTEL_PCS_TIMEOUT_SECS, INTEL_PCS_URL, INTEL_ROOT_CA_CRL_URL, NEAR_AI_ATTESTATION_GRACE_MS,
    NEAR_AI_ATTESTATION_MAX_BYTES, NEAR_AI_ATTESTATION_TIMEOUT_SECS, NEAR_AI_ATTESTATION_TTL_MS,
    NEAR_AI_ATTESTATION_URL, NEAR_AI_GATEWAY_KEY_HEX, NEAR_AI_MODEL,
};
use crate::digest::{from_hex, from_hex_bytes, hex, sha256};
use crate::host::{GetRequest, Reply};
use crate::ohttp::KeyConfig;
use crate::tdx_quote::{self, Collateral};

/// The TCB statuses of Intel's TCB info that the verifier accepts:
/// `UpToDate`, and `SWHardeningNeeded` (the platform is up to date; the
/// software in the TD must apply the mitigations of the advisories). Any
/// other status (`OutOfDate`, `ConfigurationNeeded`, `Revoked`, ...) fails the
/// check.
pub const ACCEPTED_TCB_STATUSES: [&str; 2] = ["UpToDate", "SWHardeningNeeded"];

/// Why a check gives no checked gateway.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// NEAR AI or Intel PCS did not answer, or answered with an error
    /// status. Nothing is known against the gateway.
    Unavailable(String),
    /// An answer failed a check.
    NotAttested(String),
}

fn not_attested(detail: impl Into<String>) -> Failure {
    Failure::NotAttested(detail.into())
}

/// The report request of a check with `nonce`.
pub fn report_request(nonce: &[u8; 32]) -> GetRequest {
    GetRequest {
        url: format!("{NEAR_AI_ATTESTATION_URL}?model={NEAR_AI_MODEL}&signing_algo=ed25519&nonce={}", hex(nonce)),
        timeout_secs: NEAR_AI_ATTESTATION_TIMEOUT_SECS,
        max_response_bytes: NEAR_AI_ATTESTATION_MAX_BYTES,
    }
}

/// One attested TD of a report: its quote and the ed25519 key that its
/// report data must name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttestedTd {
    pub quote: Vec<u8>,
    pub key: [u8; 32],
}

/// The parts of a report that the check reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub gateway: AttestedTd,
    /// The compose file of the gateway (`info.tcb_info.app_compose`).
    pub app_compose: String,
    /// The OHTTP key configuration and the gateway key's signature of it.
    pub key_config: Vec<u8>,
    pub key_config_signer: [u8; 32],
    pub key_config_signature: [u8; 64],
    /// The attestation of [`NEAR_AI_MODEL`].
    pub model: AttestedTd,
}

/// A JSON field that is an object, or a string that holds one (NEAR AI
/// writes some objects as JSON text).
fn object(value: &Value) -> Option<Value> {
    match value {
        Value::Object(_) => Some(value.clone()),
        Value::String(text) => serde_json::from_str::<Value>(text).ok().filter(Value::is_object),
        _ => None,
    }
}

fn hex_field(value: &Value) -> Option<Vec<u8>> {
    let text = value.as_str()?;
    from_hex_bytes(text.strip_prefix("0x").unwrap_or(text))
}

fn key_field(value: &Value) -> Option<[u8; 32]> {
    hex_field(value)?.try_into().ok()
}

/// Reads the report: status 200 and the fields of [`Report`].
pub fn parse_report(status: u16, body: &[u8]) -> Result<Report, Failure> {
    if status != 200 {
        return Err(Failure::Unavailable(format!("report: status_{status}")));
    }
    let report: Value = serde_json::from_slice(body).map_err(|_| not_attested("report: not_json"))?;
    let gateway = &report["gateway_attestation"];
    if gateway["signing_algo"] != "ed25519" {
        return Err(not_attested("gateway: signing_algo"));
    }
    let gateway_key = key_field(&gateway["signing_address"]).ok_or_else(|| not_attested("gateway: key"))?;
    let gateway_quote = hex_field(&gateway["intel_quote"]).ok_or_else(|| not_attested("gateway: quote"))?;
    let app_compose = object(&gateway["info"])
        .and_then(|info| object(&info["tcb_info"]))
        .and_then(|tcb| tcb["app_compose"].as_str().map(str::to_string))
        .ok_or_else(|| not_attested("gateway: app_compose"))?;

    let ohttp = &report["ohttp_attestation"];
    if ohttp["signing_algo"] != "ed25519" {
        return Err(not_attested("ohttp: signing_algo"));
    }
    let key_config = hex_field(&ohttp["key_config"]).ok_or_else(|| not_attested("ohttp: key_config"))?;
    let key_config_signer = key_field(&ohttp["signing_key"]).ok_or_else(|| not_attested("ohttp: signing_key"))?;
    let key_config_signature: [u8; 64] = hex_field(&ohttp["signature"])
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| not_attested("ohttp: signature"))?;

    let models = report["model_attestations"].as_array().ok_or_else(|| not_attested("model: none"))?;
    let model =
        models.iter().find(|model| model["model_name"] == NEAR_AI_MODEL).ok_or_else(|| not_attested("model: name"))?;
    if model["signing_algo"] != "ed25519" {
        return Err(not_attested("model: signing_algo"));
    }
    let model_key = key_field(&model["signing_address"]).ok_or_else(|| not_attested("model: key"))?;
    let model_quote = hex_field(&model["intel_quote"]).ok_or_else(|| not_attested("model: quote"))?;
    Ok(Report {
        gateway: AttestedTd { quote: gateway_quote, key: gateway_key },
        app_compose,
        key_config,
        key_config_signer,
        key_config_signature,
        model: AttestedTd { quote: model_quote, key: model_key },
    })
}

/// The platform of a quote that its collateral depends on: the FMSPC
/// (upper-case hex, as Intel PCS takes it) and the CA of its PCK
/// certificate (`processor` or `platform`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Platform {
    pub fmspc: String,
    pub ca: &'static str,
}

/// The platform of a TDX quote, from the PCK certificate chain in the
/// quote.
pub fn platform(quote: &[u8]) -> Result<Platform, Failure> {
    let (fmspc, ca) = tdx_quote::platform(quote).map_err(|error| not_attested(format!("quote: {error}")))?;
    Ok(Platform { fmspc: hex(&fmspc).to_uppercase(), ca })
}

/// The Intel PCS requests that give the collateral of these platforms:
/// one PCK CRL for each CA, one TCB info for each FMSPC, the QE identity
/// and the root CA CRL. Each URL once, in a fixed order.
pub fn collateral_requests(platforms: &[Platform]) -> Vec<GetRequest> {
    let mut urls: Vec<String> = Vec::new();
    let mut push = |url: String| {
        if !urls.contains(&url) {
            urls.push(url);
        }
    };
    for platform in platforms {
        push(format!("{INTEL_PCS_URL}/sgx/certification/v4/pckcrl?ca={}&encoding=der", platform.ca));
        push(format!("{INTEL_PCS_URL}/tdx/certification/v4/tcb?fmspc={}", platform.fmspc));
    }
    push(format!("{INTEL_PCS_URL}/tdx/certification/v4/qe/identity"));
    push(INTEL_ROOT_CA_CRL_URL.to_string());
    urls.into_iter()
        .map(|url| GetRequest { url, timeout_secs: INTEL_PCS_TIMEOUT_SECS, max_response_bytes: INTEL_PCS_MAX_BYTES })
        .collect()
}

/// An issuer chain header: URL-encoded PEM.
fn issuer_chain(reply: &Reply, names: &[&str]) -> Result<String, Failure> {
    let value =
        names.iter().find_map(|name| reply.header(name)).ok_or_else(|| not_attested("collateral: issuer_chain"))?;
    percent_decode(value).ok_or_else(|| not_attested("collateral: issuer_chain"))
}

pub(crate) fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = text.get(at + 1..at + 3)?;
            out.push(u8::from_str_radix(pair, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A signed Intel JSON (`{"tcbInfo": ..., "signature": ...}` or
/// `{"enclaveIdentity": ..., "signature": ...}`): the exact text of the
/// signed object, and the signature. Intel signs the bytes of the object as
/// it sent them, so the text is not serialized again.
fn signed_json(body: &[u8], field: &str) -> Result<(String, Vec<u8>), Failure> {
    let parts: BTreeMap<String, &RawValue> =
        serde_json::from_slice(body).map_err(|_| not_attested(format!("collateral: {field}")))?;
    let signed = parts.get(field).ok_or_else(|| not_attested(format!("collateral: {field}")))?;
    let signature: String = parts
        .get("signature")
        .and_then(|raw| serde_json::from_str(raw.get()).ok())
        .ok_or_else(|| not_attested(format!("collateral: {field} signature")))?;
    let signature = from_hex_bytes(&signature).ok_or_else(|| not_attested(format!("collateral: {field} signature")))?;
    Ok((signed.get().to_string(), signature))
}

/// The collateral of each platform, from the replies to
/// [`collateral_requests`] (the same order). A transport error or an error
/// status is [`Failure::Unavailable`].
pub fn collateral(
    platforms: &[Platform],
    requests: &[GetRequest],
    replies: Vec<Result<Reply, String>>,
) -> Result<Vec<Collateral>, Failure> {
    let mut by_url: BTreeMap<&str, Reply> = BTreeMap::new();
    for (request, reply) in requests.iter().zip(replies) {
        let reply = reply.map_err(|error| Failure::Unavailable(format!("intel: {error}")))?;
        if reply.status != 200 {
            return Err(Failure::Unavailable(format!("intel: status_{}", reply.status)));
        }
        by_url.insert(request.url.as_str(), reply);
    }
    let get = |url: &str| by_url.get(url).ok_or_else(|| Failure::Unavailable("intel: no_result".into()));
    let qe = get(&format!("{INTEL_PCS_URL}/tdx/certification/v4/qe/identity"))?;
    let (qe_identity, qe_identity_signature) = signed_json(&qe.body, "enclaveIdentity")?;
    let qe_identity_issuer_chain = issuer_chain(qe, &["SGX-Enclave-Identity-Issuer-Chain"])?;
    let root_ca_crl = get(INTEL_ROOT_CA_CRL_URL)?.body.clone();
    platforms
        .iter()
        .map(|platform| {
            let crl = get(&format!("{INTEL_PCS_URL}/sgx/certification/v4/pckcrl?ca={}&encoding=der", platform.ca))?;
            let tcb = get(&format!("{INTEL_PCS_URL}/tdx/certification/v4/tcb?fmspc={}", platform.fmspc))?;
            let (tcb_info, tcb_info_signature) = signed_json(&tcb.body, "tcbInfo")?;
            Ok(Collateral {
                root_ca_crl: root_ca_crl.clone(),
                pck_crl: crl.body.clone(),
                tcb_info_issuer_chain: issuer_chain(tcb, &["TCB-Info-Issuer-Chain", "SGX-TCB-Info-Issuer-Chain"])?,
                tcb_info,
                tcb_info_signature,
                qe_identity_issuer_chain: qe_identity_issuer_chain.clone(),
                qe_identity: qe_identity.clone(),
                qe_identity_signature: qe_identity_signature.clone(),
            })
        })
        .collect()
}

/// The checked parts of one quote.
struct CheckedQuote {
    tcb_status: String,
    mr_config_id: [u8; 48],
}

/// Checks one quote: the chain to Intel with `collateral` at `now_ms`, an
/// accepted TCB status, no debug TD, and `report_data = key || nonce`.
fn check_quote(
    name: &str,
    td: &AttestedTd,
    collateral: &Collateral,
    nonce: &[u8; 32],
    now_ms: u64,
) -> Result<CheckedQuote, Failure> {
    let verified = tdx_quote::verify(&td.quote, collateral, now_ms / 1000)
        .map_err(|error| not_attested(format!("{name}: quote: {error}")))?;
    if !ACCEPTED_TCB_STATUSES.contains(&verified.tcb_status.as_str()) {
        return Err(not_attested(format!("{name}: tcb_{}", verified.tcb_status)));
    }
    let report = verified.report;
    if report.report_data[..32] != td.key {
        return Err(not_attested(format!("{name}: report_data_key")));
    }
    if &report.report_data[32..] != nonce {
        return Err(not_attested(format!("{name}: report_data_nonce")));
    }
    Ok(CheckedQuote { tcb_status: verified.tcb_status, mr_config_id: report.mr_config_id })
}

/// A checked gateway: the record that the worker keeps in its storage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gateway {
    /// The pinned gateway key, as lowercase hex.
    pub gateway_key: String,
    /// The OHTTP key configuration that the gateway key signed, as hex.
    pub key_config: String,
    /// SHA-256 of the gateway's compose file, as hex.
    pub compose_hash: String,
    /// The TCB status of the gateway's quote.
    pub tcb_status: String,
    /// SHA-256 of the gateway's quote, as hex.
    pub quote_sha256: String,
    /// The worker clock at the check, in ms since the UNIX epoch.
    pub checked_at_ms: u64,
}

/// The age of a checked gateway, for its use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Age {
    /// Younger than [`NEAR_AI_ATTESTATION_TTL_MS`]: use it.
    Fresh,
    /// Older, but younger than [`NEAR_AI_ATTESTATION_GRACE_MS`]: check
    /// again, and use it only if the check cannot reach NEAR AI or Intel.
    Grace,
    /// Too old, or from the future: do not use it.
    Expired,
}

impl Gateway {
    /// The key configuration to seal to. `None` if the record does not name
    /// the pinned gateway key or holds a configuration that the worker
    /// cannot seal to.
    pub fn key_config(&self) -> Option<KeyConfig> {
        if self.gateway_key != NEAR_AI_GATEWAY_KEY_HEX {
            return None;
        }
        KeyConfig::parse(&from_hex_bytes(&self.key_config)?).ok()
    }

    pub fn age(&self, now_ms: u64) -> Age {
        match now_ms.checked_sub(self.checked_at_ms) {
            Some(age) if age < NEAR_AI_ATTESTATION_TTL_MS => Age::Fresh,
            Some(age) if age < NEAR_AI_ATTESTATION_GRACE_MS => Age::Grace,
            _ => Age::Expired,
        }
    }

    /// The stored record. `None` if it does not parse or names no key
    /// configuration that the worker can seal to.
    pub fn from_record(bytes: &[u8]) -> Option<Self> {
        let gateway: Self = serde_json::from_slice(bytes).ok()?;
        gateway.key_config()?;
        Some(gateway)
    }

    pub fn to_record(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("a record serializes")
    }
}

/// The whole check of a report (see the module text), with the
/// collateral of the gateway's and of the model's platform, at `now_ms`.
pub fn check(
    report: &Report,
    nonce: &[u8; 32],
    gateway_collateral: &Collateral,
    model_collateral: &Collateral,
    now_ms: u64,
) -> Result<Gateway, Failure> {
    let pinned = from_hex::<32>(NEAR_AI_GATEWAY_KEY_HEX).expect("the pinned key is hex");
    if report.gateway.key != pinned {
        return Err(not_attested("gateway: key_not_pinned"));
    }
    let quote = check_quote("gateway", &report.gateway, gateway_collateral, nonce, now_ms)?;

    let compose_hash = sha256(report.app_compose.as_bytes());
    let mut expected = [0u8; 48];
    expected[0] = 1;
    expected[1..33].copy_from_slice(&compose_hash);
    if quote.mr_config_id != expected {
        return Err(not_attested("gateway: compose_hash"));
    }

    if report.key_config_signer != pinned {
        return Err(not_attested("ohttp: signer_not_gateway"));
    }
    VerifyingKey::from_bytes(&pinned)
        .and_then(|key| key.verify_strict(&report.key_config, &Signature::from_bytes(&report.key_config_signature)))
        .map_err(|_| not_attested("ohttp: bad_signature"))?;
    KeyConfig::parse(&report.key_config).map_err(|error| not_attested(format!("ohttp: {error}")))?;

    check_quote("model", &report.model, model_collateral, nonce, now_ms)?;

    Ok(Gateway {
        gateway_key: hex(&pinned),
        key_config: hex(&report.key_config),
        compose_hash: hex(&compose_hash),
        tcb_status: quote.tcb_status,
        quote_sha256: hex(&sha256(&report.gateway.quote)),
        checked_at_ms: now_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_request_names_the_model_the_algorithm_and_the_nonce() {
        let request = report_request(&[0xab; 32]);
        assert_eq!(
            request.url,
            format!(
                "https://cloud-api.near.ai/v1/attestation/report?model=openai/whisper-large-v3&signing_algo=ed25519&nonce={}",
                "ab".repeat(32)
            )
        );
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("-----BEGIN%20CERT%0A").unwrap(), "-----BEGIN CERT\n");
        assert_eq!(percent_decode("%2"), None);
        assert_eq!(percent_decode("%zz"), None);
    }

    #[test]
    fn signed_json_keeps_the_exact_bytes() {
        let body = br#"{"tcbInfo":{"z":1,"a":[2, 3]},"signature":"0a0b"}"#;
        assert_eq!(signed_json(body, "tcbInfo").unwrap(), (r#"{"z":1,"a":[2, 3]}"#.to_string(), vec![10, 11]));
        assert!(signed_json(body, "enclaveIdentity").is_err());
    }

    #[test]
    fn requests_ask_for_each_url_once() {
        let platforms = [
            Platform { fmspc: "00806F050000".into(), ca: "platform" },
            Platform { fmspc: "00806F050000".into(), ca: "platform" },
        ];
        let urls: Vec<String> = collateral_requests(&platforms).into_iter().map(|request| request.url).collect();
        assert_eq!(
            urls,
            [
                "https://api.trustedservices.intel.com/sgx/certification/v4/pckcrl?ca=platform&encoding=der",
                "https://api.trustedservices.intel.com/tdx/certification/v4/tcb?fmspc=00806F050000",
                "https://api.trustedservices.intel.com/tdx/certification/v4/qe/identity",
                "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der",
            ]
        );
    }

    #[test]
    fn a_record_ages() {
        let (_, public) = <hpke::kem::X25519HkdfSha256 as hpke::Kem>::derive_keypair(b"k");
        let mut config = vec![1, 0, 0x20];
        config.extend_from_slice(&hpke::Serializable::to_bytes(&public));
        config.extend_from_slice(&[0, 4, 0, 1, 0, 3]);
        let gateway = Gateway {
            gateway_key: NEAR_AI_GATEWAY_KEY_HEX.into(),
            key_config: hex(&config),
            compose_hash: "00".repeat(32),
            tcb_status: "UpToDate".into(),
            quote_sha256: "00".repeat(32),
            checked_at_ms: 1_000,
        };
        assert_eq!(Gateway::from_record(&gateway.to_record()), Some(gateway.clone()));
        assert_eq!(gateway.age(1_000), Age::Fresh);
        assert_eq!(gateway.age(1_000 + NEAR_AI_ATTESTATION_TTL_MS - 1), Age::Fresh);
        assert_eq!(gateway.age(1_000 + NEAR_AI_ATTESTATION_TTL_MS), Age::Grace);
        assert_eq!(gateway.age(1_000 + NEAR_AI_ATTESTATION_GRACE_MS), Age::Expired);
        assert_eq!(gateway.age(999), Age::Expired);
        // A record of another key, or with a key configuration that does
        // not parse, is no record.
        let other = Gateway { gateway_key: "11".repeat(32), ..gateway.clone() };
        assert_eq!(Gateway::from_record(&other.to_record()), None);
        let broken = Gateway { key_config: "0100".into(), ..gateway };
        assert_eq!(Gateway::from_record(&broken.to_record()), None);
        assert_eq!(Gateway::from_record(b"not json"), None);
    }
}
