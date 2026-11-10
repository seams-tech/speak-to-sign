//! The OutLayer attestation of one verifier call: a TDX quote that binds the
//! WASM that ran, the input and the output of the call. The same check as
//! `checkAttestationBinding` of `packages/voice-verdict`.
//!
//! Each HTTPS call of an OutLayer worker returns `attestation_url`. The
//! record at that URL has a TDX quote. The first 32 bytes of the quote's
//! report data are the task hash: a SHA-256 over the WASM hash, the input
//! hash, the output hash, the caller, the project and the time. So the quote
//! says: this worker ran this WASM on this input and gave this output.
//!
//! [`check_attestation_binding`] checks every link that needs no Intel
//! collateral. Two checks stay with the caller ([`NOT_CHECKED`]):
//! - the signature chain of the quote to Intel (a DCAP verifier, or
//!   `outlayer-verify`);
//! - the approval of the five measurements by the OutLayer worker contract
//!   (`is_measurements_approved`, with [`Measurements::view_args`]).

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The OutLayer contract on NEAR testnet that holds the approved measurements.
pub const WORKER_CONTRACT_TESTNET: &str = "worker.outlayer.testnet";
/// The same contract on NEAR mainnet.
pub const WORKER_CONTRACT_MAINNET: &str = "worker.outlayer.near";
/// The checks that [`check_attestation_binding`] does not do, with the names
/// of the TypeScript package.
pub const NOT_CHECKED: [&str; 2] = ["quote_signature", "measurements_approved"];
/// Records before this time (2026-01-30, UNIX seconds) have the shorter task
/// hash. This module refuses them.
pub const V1_CUTOFF: i64 = 1_769_784_939;

/// The TEE type of TDX in a quote header.
const TEE_TDX: u32 = 0x81;
/// The bytes of the quote header.
const HEADER: usize = 48;
/// The bytes of a TD report (TD 1.0) in the quote body.
const TD_REPORT: usize = 584;

/// The record of `GET <api>/attestations/by-call/<call_id>`. Other fields
/// are ignored.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct AttestationRecord {
    pub task_type: String,
    pub task_id: i64,
    /// Standard base64 of the TDX quote.
    pub tdx_quote: String,
    /// UNIX seconds.
    pub timestamp: i64,
    pub output_hash: String,
    pub input_hash: Option<String>,
    pub repo_url: Option<String>,
    pub commit_hash: Option<String>,
    pub build_target: Option<String>,
    pub wasm_hash: Option<String>,
    pub block_height: Option<i64>,
    pub caller_account_id: Option<String>,
    pub project_id: Option<String>,
    pub secrets_ref: Option<String>,
    pub attached_usd: Option<String>,
    pub call_id: Option<String>,
}

/// The five TDX measurements of a quote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Measurements {
    pub mrtd: [u8; 48],
    pub rtmr0: [u8; 48],
    pub rtmr1: [u8; 48],
    pub rtmr2: [u8; 48],
    pub rtmr3: [u8; 48],
}

impl Measurements {
    /// The JSON arguments of `is_measurements_approved` on the OutLayer
    /// worker contract: each measurement as lowercase hex.
    pub fn view_args(&self) -> String {
        let mut args = String::from("{\"measurements\":{");
        for (index, (name, value)) in [
            ("mrtd", &self.mrtd),
            ("rtmr0", &self.rtmr0),
            ("rtmr1", &self.rtmr1),
            ("rtmr2", &self.rtmr2),
            ("rtmr3", &self.rtmr3),
        ]
        .into_iter()
        .enumerate()
        {
            if index > 0 {
                args.push(',');
            }
            args.push('"');
            args.push_str(name);
            args.push_str("\":\"");
            args.push_str(&hex(value));
            args.push('"');
        }
        args.push_str("}}");
        args
    }
}

/// The parts of a TDX quote that the binding check reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdxQuote {
    /// 4 or 5.
    pub version: u16,
    pub measurements: Measurements,
    pub report_data: [u8; 64],
}

/// Why an attestation does not bind the output that you hold.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttestationRefusal {
    /// The record is not an attestation record of an execution, or the quote
    /// is not a TDX quote. The text names the part.
    Malformed(String),
    /// The report data of the quote is not the task hash of the record.
    TaskHashMismatch,
    /// The record is for another output than the one that you hold.
    OutputMismatch,
    /// The record is for another input than the one that you hold.
    InputMismatch,
    /// The WASM that ran is not one that you accept.
    WasmNotAccepted(Option<String>),
    /// The record is for another project.
    ProjectMismatch,
    /// The record is for another caller.
    CallerMismatch,
}

impl AttestationRefusal {
    /// The refusal code of the TypeScript package.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "malformed",
            Self::TaskHashMismatch => "task_hash_mismatch",
            Self::OutputMismatch => "output_mismatch",
            Self::InputMismatch => "input_mismatch",
            Self::WasmNotAccepted(_) => "wasm_not_accepted",
            Self::ProjectMismatch => "project_mismatch",
            Self::CallerMismatch => "caller_mismatch",
        }
    }
}

/// What the checker holds and expects.
#[derive(Clone, Copy, Debug)]
pub struct Binding<'a> {
    /// The JSON text of the `output` of the call, as OutLayer returned it.
    /// The key order does not matter.
    pub output_json: &'a str,
    /// The WASM hashes that you accept, as 64 lowercase hex characters each.
    /// Build the verifier to get one.
    pub accepted_wasm_hashes: &'a [&'a str],
    /// The compact JSON text of the `input` that you sent, with its keys in
    /// the order that you sent them (`JSON.stringify` of it).
    pub input_json: Option<&'a str>,
    /// The expected project, `owner/project`.
    pub project_id: Option<&'a str>,
    /// The expected caller: over HTTPS, the owner of the payment key.
    pub caller_account_id: Option<&'a str>,
}

impl<'a> Binding<'a> {
    /// Expects this output and one of these WASM hashes, and nothing more.
    pub fn new(output_json: &'a str, accepted_wasm_hashes: &'a [&'a str]) -> Self {
        Self {
            output_json,
            accepted_wasm_hashes,
            input_json: None,
            project_id: None,
            caller_account_id: None,
        }
    }

    /// Expects this input.
    pub fn input(mut self, input_json: &'a str) -> Self {
        self.input_json = Some(input_json);
        self
    }

    /// Expects this project.
    pub fn project(mut self, project_id: &'a str) -> Self {
        self.project_id = Some(project_id);
        self
    }

    /// Expects this caller.
    pub fn caller(mut self, caller_account_id: &'a str) -> Self {
        self.caller_account_id = Some(caller_account_id);
        self
    }
}

/// The result of a binding check that passed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bound {
    /// SHA-256 of the WASM that ran, as lowercase hex: the OutLayer version
    /// key.
    pub wasm_hash: String,
    /// The measurements of the quote. They mean nothing until the worker
    /// contract approves them.
    pub measurements: Measurements,
    /// The raw quote, for a DCAP verifier.
    pub quote: Vec<u8>,
}

/// Reads an attestation record from its JSON text.
pub fn parse_attestation_record(
    record_json: &str,
) -> Result<AttestationRecord, AttestationRefusal> {
    serde_json::from_str(record_json)
        .map_err(|error| AttestationRefusal::Malformed(error.to_string()))
}

/// Checks that the record binds this output (and this input, if you give
/// it) to an accepted WASM, and that the TDX quote commits to the record. It
/// does not check the signature of the quote or the approval of the
/// measurements: see [`NOT_CHECKED`].
pub fn check_attestation_binding(
    record: &AttestationRecord,
    binding: &Binding,
) -> Result<Bound, AttestationRefusal> {
    let malformed = |part: &str| AttestationRefusal::Malformed(part.to_string());
    if record.task_type != "execute" {
        return Err(malformed("task_type"));
    }
    if record.timestamp < V1_CUTOFF {
        return Err(malformed("record before the current task hash format"));
    }
    if !is_hash(&record.output_hash) {
        return Err(malformed("output_hash"));
    }
    let quote = STANDARD
        .decode(&record.tdx_quote)
        .map_err(|_| malformed("tdx_quote"))?;
    let parsed = parse_tdx_quote(&quote).ok_or_else(|| malformed("tdx_quote"))?;

    // 1. The quote commits to the record.
    let (head, tail) = parsed.report_data.split_at(32);
    if head != task_hash(record) || tail.iter().any(|byte| *byte != 0) {
        return Err(AttestationRefusal::TaskHashMismatch);
    }

    // 2. The record is for this output: SHA-256 of the compact JSON with
    //    sorted keys.
    let output: Value =
        serde_json::from_str(binding.output_json).map_err(|_| malformed("output_json"))?;
    let mut sorted = String::new();
    sorted_json(&output, &mut sorted);
    if hex(&sha256(sorted.as_bytes())) != record.output_hash {
        return Err(AttestationRefusal::OutputMismatch);
    }

    // 3. The record is for this input: SHA-256 of the JSON that was sent.
    if let Some(input_json) = binding.input_json {
        if record.input_hash.as_deref() != Some(hex(&sha256(input_json.as_bytes())).as_str()) {
            return Err(AttestationRefusal::InputMismatch);
        }
    }

    // 4. The WASM, the project and the caller.
    let wasm_hash = match &record.wasm_hash {
        Some(hash) if binding.accepted_wasm_hashes.contains(&hash.as_str()) => hash.clone(),
        other => return Err(AttestationRefusal::WasmNotAccepted(other.clone())),
    };
    if binding
        .project_id
        .is_some_and(|project| record.project_id.as_deref() != Some(project))
    {
        return Err(AttestationRefusal::ProjectMismatch);
    }
    if binding
        .caller_account_id
        .is_some_and(|caller| record.caller_account_id.as_deref() != Some(caller))
    {
        return Err(AttestationRefusal::CallerMismatch);
    }
    Ok(Bound {
        wasm_hash,
        measurements: parsed.measurements,
        quote,
    })
}

/// The task hash of a record, as `outlayer-verify` computes it (format V1).
/// Text fields go in as UTF-8, the hashes as their hex text, `task_id`,
/// `block_height` and `timestamp` as 64-bit little-endian. An absent field
/// adds no bytes.
pub fn task_hash(record: &AttestationRecord) -> [u8; 32] {
    let mut hasher = Sha256::new();
    let text = |hasher: &mut Sha256, fields: &[&Option<String>]| {
        for value in fields.iter().copied().flatten() {
            hasher.update(value.as_bytes());
        }
    };
    hasher.update(record.task_type.as_bytes());
    hasher.update(record.task_id.to_le_bytes());
    text(
        &mut hasher,
        &[
            &record.repo_url,
            &record.commit_hash,
            &record.build_target,
            &record.wasm_hash,
            &record.input_hash,
        ],
    );
    hasher.update(record.output_hash.as_bytes());
    if let Some(height) = record.block_height {
        hasher.update(height.to_le_bytes());
    }
    text(
        &mut hasher,
        &[
            &record.caller_account_id,
            &record.project_id,
            &record.secrets_ref,
        ],
    );
    hasher.update(record.timestamp.to_le_bytes());
    text(&mut hasher, &[&record.attached_usd]);
    hasher.finalize().into()
}

/// Reads the measurements and the report data of a TDX quote (version 4 or
/// 5). `None` for other bytes.
pub fn parse_tdx_quote(quote: &[u8]) -> Option<TdxQuote> {
    // Header: version (u16), attestation key type (u16), TEE type (u32), ...
    if quote.len() < HEADER + TD_REPORT {
        return None;
    }
    let version = u16::from_le_bytes([quote[0], quote[1]]);
    if u32::from_le_bytes([quote[4], quote[5], quote[6], quote[7]]) != TEE_TDX {
        return None;
    }
    // Version 5 has a body type (u16, 2 for a TD 1.0 report) and a body size
    // (u32) before the TD report.
    let body = match version {
        4 => HEADER,
        5 if u16::from_le_bytes([quote[48], quote[49]]) == 2 => HEADER + 6,
        _ => return None,
    };
    let report = quote.get(body..body + TD_REPORT)?;
    let measurement = |offset: usize| -> [u8; 48] {
        report[offset..offset + 48]
            .try_into()
            .expect("the report has 584 bytes")
    };
    Some(TdxQuote {
        version,
        measurements: Measurements {
            mrtd: measurement(136),
            rtmr0: measurement(328),
            rtmr1: measurement(376),
            rtmr2: measurement(424),
            rtmr3: measurement(472),
        },
        report_data: report[520..584].try_into().expect("64 bytes"),
    })
}

/// Compact JSON with the keys of each object sorted by their bytes, as the
/// OutLayer worker hashes an output. It sorts the keys itself, so a
/// `preserve_order` feature of `serde_json` elsewhere in the build does not
/// change it.
fn sorted_json(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                sorted_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                sorted_json(&map[key], out);
            }
            out.push('}');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn is_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(DIGITS[usize::from(byte >> 4)] as char);
        text.push(DIGITS[usize::from(byte & 15)] as char);
    }
    text
}
