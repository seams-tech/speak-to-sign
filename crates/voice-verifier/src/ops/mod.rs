//! The operations `enroll` and `verify`.
//!
//! `verify` sends the canonical WAV to the speaker service and to NEAR AI at
//! the same time, reads the template and the used-audio marker while those
//! requests are in flight, checks the speaker against the template and the
//! words against `render(request)`, marks the audio used (only after a
//! decision), runs the policy step and signs the verdict with the manifest
//! signing key.
//!
//! `enroll` needs the owner's authorization: a NEP-413 signature of the
//! enrollment digest by a full-access key of the owner (see
//! [`crate::authorization`]). A new authorization lets the owner enroll
//! again; the template is replaced and its epoch grows by 1.
//!
//! Each flow has its own file. `request.rs` types the request of a `verify`
//! input, `multisig.rs` builds and records the multisig kinds, and
//! `steps.rs` holds the steps that both flows use.
mod enroll;
mod multisig;
mod request;
mod steps;
mod verify;

use serde_json::Value;

use crate::config::{SPEAKER_PINNED_KEY_HEX, VERIFIER_VERSION};
use crate::digest::from_hex;
use crate::host::Host;
use crate::output::{json_bytes, Outcome, Reason, UnknownOp, ERROR_OUTPUT_KIND};

pub use request::transfer_request;

/// Values that the release build pins. Tests replace the speaker key,
/// because their fake service signs with its own key.
#[derive(Clone, Copy, Debug)]
pub struct Pins {
    /// The key of the speaker service. Not used with `local_speaker`.
    pub speaker_key: [u8; 32],
    /// `true`: the embeddings come from the model inside the worker
    /// ([`Host::embed_local`]), and no request goes to the speaker service.
    /// The release value is the feature `local-speaker`.
    pub local_speaker: bool,
}

impl Pins {
    fn production() -> Self {
        Self {
            speaker_key: from_hex::<32>(SPEAKER_PINNED_KEY_HEX).expect("pinned hex"),
            local_speaker: cfg!(feature = "local-speaker"),
        }
    }
}

/// Runs one input with the release pins and returns the output JSON bytes.
pub fn run(input: &[u8], host: &mut dyn Host) -> Vec<u8> {
    run_with(input, host, &Pins::production())
}

/// Runs one input. It never panics on input: every failure is a refusal
/// with a reason.
pub fn run_with(input: &[u8], host: &mut dyn Host, pins: &Pins) -> Vec<u8> {
    let value: Value = serde_json::from_slice(input).unwrap_or(Value::Null);
    match value.get("op").and_then(Value::as_str) {
        Some("enroll") => json_bytes(&enroll::enroll(value, host, pins)),
        Some("verify") => json_bytes(&verify::verify(value, host, pins)),
        _ => json_bytes(&UnknownOp {
            kind: ERROR_OUTPUT_KIND,
            verifier: VERIFIER_VERSION,
            outcome: Outcome::Refuse,
            reason: Reason::Unsupported,
        }),
    }
}

/// A refusal of a flow: the reason, and a short text for the unsigned
/// `detail` field of the output. `?` turns a bare [`Reason`] into a refusal
/// without a detail.
struct Refusal {
    reason: Reason,
    detail: Option<String>,
}

impl Refusal {
    fn new(reason: Reason, detail: impl Into<String>) -> Self {
        Self { reason, detail: Some(detail.into()) }
    }
}

impl From<Reason> for Refusal {
    fn from(reason: Reason) -> Self {
        Self { reason, detail: None }
    }
}
