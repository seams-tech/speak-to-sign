//! Output JSON and the signed verdict.
//!
//! The verdict is the only signed object. Its bytes are exactly what
//! [`verdict_json`] writes; the Seams route passes them to the Wallet as a
//! string, so nobody serializes them again. The signed message is
//! `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` (32 bytes), and the
//! manifest signing key signs it with ed25519 ([`sign_verdict`]). Before
//! that, [`fit_heard`] cuts `heard` so that the output fits its size limit.
use std::collections::BTreeMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::config::{
    INTENT_DOMAIN, MAX_HEARD_BYTES, MAX_OUTPUT_BYTES, TRANSCRIPT_DOMAIN, VERDICT_DOMAIN, VERIFIER_VERSION,
};
use crate::digest::{b64, near_ed25519_key, sha256};
use crate::host::Host;
use crate::words::cut_at;

/// The verdict kind. The Wallet accepts only this one.
const VERDICT_KIND: &str = "seams_voice_signed_verdict_v2";

/// `accept`, `step_up` or `refuse`. On `step_up` the voice and the words
/// passed, and a policy rule asks the Wallet for a fresh passkey as well.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Accept,
    StepUp,
    Refuse,
}

/// Refusal reasons.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// The energy gate refused the audio.
    Quality,
    /// The speaker score is below the cutoff, or enrollment samples disagree.
    Speaker,
    /// The heard words are not the rendered words.
    Words,
    /// The audio digest was used before.
    AudioReused,
    /// The audio is not a 16 kHz mono PCM16 WAV of 1 sample to 8 s.
    AudioInvalid,
    /// No template for this owner.
    TemplateMissing,
    /// The input is not a request this version handles.
    Unsupported,
    /// The speaker service did not answer, or its reply failed a check.
    SpeakerUnavailable,
    /// Worker storage failed.
    Storage,
    /// `enroll` only: another enrollment of this owner changed the template
    /// during this one.
    TemplateExists,
    /// NEAR AI did not answer, answered with an error, or gave no text.
    TranscriberUnavailable,
    /// `enroll` only: the authorization is not a valid NEP-413 signature of
    /// this enrollment by a full-access key of the owner.
    NotAuthorized,
    /// `enroll` only: the NEAR RPC access-key view failed.
    AuthorizationUnavailable,
    /// A multisig confirmation names a proposal that the worker does not
    /// hold, or holds under another id.
    ProposalMissing,
    /// The voice is the voice of another member who already said this
    /// multisig proposal.
    SameSpeaker,
    /// This member said the wrong words for this multisig proposal too many
    /// times.
    AttemptsExhausted,
    /// `detect` only: the chat model did not answer, or its reply was not
    /// one intent of the list.
    DetectorUnavailable,
}

#[cfg(test)]
impl Reason {
    /// Every reason, in declaration order.
    const ALL: [Reason; 17] = [
        Reason::Quality,
        Reason::Speaker,
        Reason::Words,
        Reason::AudioReused,
        Reason::AudioInvalid,
        Reason::TemplateMissing,
        Reason::Unsupported,
        Reason::SpeakerUnavailable,
        Reason::Storage,
        Reason::TemplateExists,
        Reason::TranscriberUnavailable,
        Reason::NotAuthorized,
        Reason::AuthorizationUnavailable,
        Reason::ProposalMissing,
        Reason::SameSpeaker,
        Reason::AttemptsExhausted,
        Reason::DetectorUnavailable,
    ];
}

/// The signed verdict: 13 fields, always all present, in this order. A
/// digest is `null` only on a refusal that came before it was known.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verdict {
    pub kind: String,
    pub renderer: String,
    pub verifier: String,
    /// base64url `request_digest(request)` of `spoken-intent`.
    pub request_digest: Option<String>,
    /// base64url `spoken_text_digest(render(request))`.
    pub spoken_text_digest: Option<String>,
    /// base64url SHA-256 of the canonical WAV.
    pub audio_digest: Option<String>,
    pub outcome: Outcome,
    /// Set only on `refuse`.
    pub reason: Option<Reason>,
    /// The id of the policy rule, set only on `step_up`.
    pub policy_rule: Option<String>,
    /// The worker clock before signing plus [`crate::config::VERDICT_TTL_MS`],
    /// in ms since the UNIX epoch. The Wallet refuses the verdict after it.
    pub expires_at_ms: u64,
    pub speaker_score_milli: Option<i32>,
    pub word_margin_milli: Option<i32>,
    pub heard: Option<String>,
}

impl Verdict {
    /// An empty verdict that refuses as `unsupported` until filled.
    pub fn new() -> Self {
        Self {
            kind: VERDICT_KIND.to_string(),
            renderer: spoken_intent::RENDERER_VERSION.to_string(),
            verifier: VERIFIER_VERSION.to_string(),
            request_digest: None,
            spoken_text_digest: None,
            audio_digest: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            policy_rule: None,
            expires_at_ms: 0,
            speaker_score_milli: None,
            word_margin_milli: None,
            heard: None,
        }
    }
}

impl Default for Verdict {
    fn default() -> Self {
        Self::new()
    }
}

/// The verdict's bytes: compact JSON, fields in declaration order.
pub fn verdict_json(verdict: &Verdict) -> String {
    serde_json::to_string(verdict).expect("verdict serializes")
}

/// The 32-byte message that the signing key signs.
pub fn verdict_message(verdict_json: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(VERDICT_DOMAIN.len() + verdict_json.len());
    preimage.extend_from_slice(VERDICT_DOMAIN);
    preimage.extend_from_slice(verdict_json);
    sha256(&preimage)
}

/// Stage times inside the worker, in ms, by stage name (not signed). A
/// `BTreeMap`, so the JSON names the stages in alphabetical order.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Stages(BTreeMap<&'static str, u64>);

impl Stages {
    /// Records the time since `started` as the stage `name`.
    pub fn since(&mut self, name: &'static str, started: Instant) {
        self.record(name, started.elapsed().as_millis() as u64);
    }

    /// Runs `step` and records its time as the stage `name`.
    pub fn time<T>(&mut self, name: &'static str, step: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let value = step();
        self.since(name, started);
        value
    }

    /// The recorded time of the stage `name`, or 0.
    pub fn get(&self, name: &str) -> u64 {
        self.0.get(name).copied().unwrap_or(0)
    }

    /// Records a time that another party measured.
    pub fn record(&mut self, name: &'static str, ms: u64) {
        self.0.insert(name, ms);
    }
}

// The `kind` of each output.
const VERIFY_OUTPUT_KIND: &str = "seams_voice_verify_output_v2";
const ENROLL_OUTPUT_KIND: &str = "seams_voice_enrollment_v3";
pub const ERROR_OUTPUT_KIND: &str = "seams_voice_error_v1";

/// The `verify` output. `verdict_json` is a string, so its bytes reach the
/// Wallet as they were signed.
#[derive(Clone, Debug, Serialize)]
pub struct VerifyOutput {
    pub kind: &'static str,
    pub verdict_json: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: Option<String>,
    /// `ed25519:<base58>`: the key that the Wallet pins.
    pub public_key: Option<String>,
    /// The sentence of the policy rule on `step_up`, for the Wallet to show
    /// (not signed; the verdict names the rule id).
    pub policy_text: Option<&'static str>,
    pub ms: Stages,
    /// A short error text for a refusal or a failed signature (not signed).
    pub detail: Option<String>,
    /// The commitment and the salt of a new multisig proposal, only on the
    /// accept of a proposal (not signed). Other outputs leave the field out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multisig: Option<MultisigOpening>,
    /// `select` only: the index of the request that the owner said, in the
    /// input order (not signed; the verdict binds the request digest). Other
    /// outputs leave the field out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<usize>,
}

/// What the proposer needs from the worker: the commitment for `propose`,
/// and the salt for `execute`. The proposer's page has the receiver and the
/// amount. Both values are base64url, so the output stays below
/// [`MAX_OUTPUT_BYTES`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MultisigOpening {
    pub commitment: String,
    pub salt: String,
}

impl VerifyOutput {
    /// `signed` is the signature (standard base64) and the key
    /// (`ed25519:<base58>`) of [`sign_verdict`], if it passed.
    pub fn new(
        verdict_json: String,
        signed: Option<(String, String)>,
        policy_text: Option<&'static str>,
        ms: Stages,
        detail: Option<String>,
    ) -> Self {
        let (signature_b64, public_key) = signed.unzip();
        Self { kind: VERIFY_OUTPUT_KIND, verdict_json, signature_b64, public_key, policy_text, ms, detail, multisig: None, selected: None }
    }
}

/// The `heard` caps that [`fit_heard`] tries, longest first. The last one
/// leaves `heard` out.
const HEARD_CAPS: [usize; 4] = [MAX_HEARD_BYTES, 120, 60, 0];

/// The length of a standard base64 ed25519 signature (64 bytes).
const SIGNATURE_B64_LEN: usize = 88;

/// The longest base58 text of a 32-byte key.
const KEY_BASE58_MAX_LEN: usize = 44;

/// Room for the `sign` and `total` stage times, which come after the fit.
const STAGE_TIME_ROOM: usize = 48;

/// The verdict JSON with the longest `heard` of `HEARD_CAPS` for which the
/// output stays below [`MAX_OUTPUT_BYTES`]. `heard` is part of the signed
/// bytes, so the fit comes before the signature. It sizes the output with a
/// signature and a key of full length.
pub fn fit_heard(
    mut verdict: Verdict,
    policy_text: Option<&'static str>,
    ms: &Stages,
    detail: Option<&str>,
    multisig: Option<&MultisigOpening>,
    selected: Option<usize>,
) -> String {
    let heard = verdict.heard.take();
    let longest_signature = ("A".repeat(SIGNATURE_B64_LEN), format!("ed25519:{}", "1".repeat(KEY_BASE58_MAX_LEN)));
    let detail = detail.map(str::to_owned);
    let mut sized = VerifyOutput::new(String::new(), Some(longest_signature), policy_text, ms.clone(), detail);
    sized.multisig = multisig.cloned();
    sized.selected = selected;
    for cap in HEARD_CAPS {
        verdict.heard = heard.as_ref().filter(|_| cap > 0).map(|text| cut_at(text, cap));
        sized.verdict_json = verdict_json(&verdict);
        if serde_json::to_vec(&sized).expect("serializes").len() + STAGE_TIME_ROOM < MAX_OUTPUT_BYTES {
            break;
        }
    }
    sized.verdict_json
}

/// Signs the verdict JSON with the manifest signing key. Returns the
/// signature (standard base64) and the key (`ed25519:<base58>`).
pub fn sign_verdict(host: &mut dyn Host, verdict_json: &str) -> Result<(String, String), String> {
    let message = verdict_message(verdict_json.as_bytes());
    let signature = host.sign(&message)?;
    let public_key = host.public_key()?;
    if signature.len() != 64 || public_key.len() != 32 {
        return Err("length".to_string());
    }
    Ok((b64(&signature), near_ed25519_key(&public_key)))
}

/// The transcript kind. It is not a verdict: it approves no request.
const TRANSCRIPT_KIND: &str = "seams_voice_signed_transcript_v1";
const TRANSCRIPT_OUTPUT_KIND: &str = "seams_voice_transcript_output_v1";

/// The signed transcript: 9 fields, always all present, in this order. It
/// says that the voice of `owner` passed the speaker check on this audio,
/// and what the speech-to-text model heard. It binds no request, so a
/// checker of verdicts must not accept it; its `kind` and its signing
/// prefix ([`crate::config::TRANSCRIPT_DOMAIN`]) are not those of a verdict.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transcript {
    pub kind: String,
    pub verifier: String,
    /// The owner whose template the voice was compared with.
    pub owner: Option<String>,
    /// base64url SHA-256 of the canonical WAV.
    pub audio_digest: Option<String>,
    /// `accept` or `refuse`.
    pub outcome: Outcome,
    /// Set only on `refuse`.
    pub reason: Option<Reason>,
    pub expires_at_ms: u64,
    pub speaker_score_milli: Option<i32>,
    /// The heard words: lowercase ASCII letters, digits and apostrophes,
    /// with single spaces. Set only on `accept`. The speech-to-text model
    /// gives it with no signature of its own.
    pub text: Option<String>,
}

impl Transcript {
    /// An empty transcript that refuses as `unsupported` until filled.
    pub fn new() -> Self {
        Self {
            kind: TRANSCRIPT_KIND.to_string(),
            verifier: VERIFIER_VERSION.to_string(),
            owner: None,
            audio_digest: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            expires_at_ms: 0,
            speaker_score_milli: None,
            text: None,
        }
    }
}

impl Default for Transcript {
    fn default() -> Self {
        Self::new()
    }
}

/// The 32-byte message that the signing key signs for a transcript.
pub fn transcript_message(transcript_json: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(TRANSCRIPT_DOMAIN.len() + transcript_json.len());
    preimage.extend_from_slice(TRANSCRIPT_DOMAIN);
    preimage.extend_from_slice(transcript_json);
    sha256(&preimage)
}

/// The `transcribe` output. `transcript_json` is the only signed object.
#[derive(Clone, Debug, Serialize)]
pub struct TranscribeOutput {
    pub kind: &'static str,
    pub transcript_json: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: Option<String>,
    /// `ed25519:<base58>`.
    pub public_key: Option<String>,
    pub ms: Stages,
    pub detail: Option<String>,
}

impl TranscribeOutput {
    /// Signs the transcript with the manifest signing key.
    pub fn signed(host: &mut dyn Host, transcript: &Transcript, mut ms: Stages, detail: Option<String>) -> Self {
        let transcript_json = serde_json::to_string(transcript).expect("transcript serializes");
        let message = transcript_message(transcript_json.as_bytes());
        let signed = ms.time("sign", || match (host.sign(&message), host.public_key()) {
            (Ok(signature), Ok(key)) if signature.len() == 64 && key.len() == 32 => {
                Ok((b64(&signature), near_ed25519_key(&key)))
            }
            (Err(error), _) | (_, Err(error)) => Err(error),
            _ => Err("length".to_string()),
        });
        let (signature_b64, public_key, detail) = match signed {
            Ok((signature, key)) => (Some(signature), Some(key), detail),
            Err(error) => (None, None, Some(short(&format!("sign: {error}")))),
        };
        Self { kind: TRANSCRIPT_OUTPUT_KIND, transcript_json, signature_b64, public_key, ms, detail }
    }
}

/// The intent kind. It is not a verdict: it approves no request.
const INTENT_KIND: &str = "seams_voice_signed_intent_v1";
const DETECT_OUTPUT_KIND: &str = "seams_voice_intent_output_v1";

/// The signed result of `detect`: 13 fields, always all present, in this
/// order. It says that the voice of `owner` passed the speaker check, what
/// the speech-to-text model heard, and which intent of the application's
/// list a chat model named for those words. It is a proposal: two models
/// made it, and neither signs its part. Its `kind` and its signing prefix
/// ([`crate::config::INTENT_DOMAIN`]) are not those of a verdict.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentResult {
    pub kind: String,
    pub verifier: String,
    pub owner: Option<String>,
    /// base64url SHA-256 of the canonical WAV.
    pub audio_digest: Option<String>,
    /// base64url [`crate::intent::intents_digest`] of the list of the input.
    pub intents_digest: Option<String>,
    /// `accept` or `refuse`. An accept can have no intent.
    pub outcome: Outcome,
    pub reason: Option<Reason>,
    pub expires_at_ms: u64,
    pub speaker_score_milli: Option<i32>,
    /// The heard words, as in a transcript, cut to
    /// [`crate::config::MAX_INTENT_TEXT_BYTES`].
    pub text: Option<String>,
    /// The chat model that named the intent.
    pub model: Option<String>,
    /// The name of one intent of the list, or `null` if the model named
    /// none.
    pub intent: Option<String>,
    /// A value or `null` for each slot of the intent, in name order.
    pub slots: Option<BTreeMap<String, serde_json::Value>>,
}

impl IntentResult {
    /// An empty result that refuses as `unsupported` until filled.
    pub fn new() -> Self {
        Self {
            kind: INTENT_KIND.to_string(),
            verifier: VERIFIER_VERSION.to_string(),
            owner: None,
            audio_digest: None,
            intents_digest: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            expires_at_ms: 0,
            speaker_score_milli: None,
            text: None,
            model: None,
            intent: None,
            slots: None,
        }
    }
}

impl Default for IntentResult {
    fn default() -> Self {
        Self::new()
    }
}

/// The 32-byte message that the signing key signs for an intent result.
pub fn intent_message(intent_json: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(INTENT_DOMAIN.len() + intent_json.len());
    preimage.extend_from_slice(INTENT_DOMAIN);
    preimage.extend_from_slice(intent_json);
    sha256(&preimage)
}

/// The `detect` output. `intent_json` is the only signed object.
#[derive(Clone, Debug, Serialize)]
pub struct DetectOutput {
    pub kind: &'static str,
    pub intent_json: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: Option<String>,
    /// `ed25519:<base58>`.
    pub public_key: Option<String>,
    pub ms: Stages,
    pub detail: Option<String>,
}

impl DetectOutput {
    /// Signs the result with the manifest signing key.
    pub fn signed(host: &mut dyn Host, result: &IntentResult, mut ms: Stages, detail: Option<String>) -> Self {
        let intent_json = serde_json::to_string(result).expect("intent result serializes");
        let message = intent_message(intent_json.as_bytes());
        let signed = ms.time("sign", || match (host.sign(&message), host.public_key()) {
            (Ok(signature), Ok(key)) if signature.len() == 64 && key.len() == 32 => {
                Ok((b64(&signature), near_ed25519_key(&key)))
            }
            (Err(error), _) | (_, Err(error)) => Err(error),
            _ => Err("length".to_string()),
        });
        let (signature_b64, public_key, detail) = match signed {
            Ok((signature, key)) => (Some(signature), Some(key), detail),
            Err(error) => (None, None, Some(short(&format!("sign: {error}")))),
        };
        Self { kind: DETECT_OUTPUT_KIND, intent_json, signature_b64, public_key, ms, detail }
    }
}

/// The `enroll` output.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EnrollOutput {
    pub kind: &'static str,
    pub verifier: &'static str,
    pub owner: Option<String>,
    pub outcome: Outcome,
    pub reason: Option<Reason>,
    /// The lowest pairwise speaker score of the three samples.
    pub agreement_milli: Option<i32>,
    /// The three canonical WAV digests, in input order.
    pub audio_digests: Vec<String>,
    /// base64url enrollment digest, which the owner's NEP-413 message
    /// names.
    pub enrollment_digest: Option<String>,
    /// The epoch of the written template: 1, then 1 more on each
    /// re-enrollment.
    pub template_epoch: Option<u32>,
    /// `ed25519:<base58>` of the verdict signing key, which the Wallet pins.
    pub verifier_public_key: Option<String>,
    pub ms: Stages,
    pub detail: Option<String>,
}

impl EnrollOutput {
    pub fn new() -> Self {
        Self {
            kind: ENROLL_OUTPUT_KIND,
            verifier: VERIFIER_VERSION,
            owner: None,
            outcome: Outcome::Refuse,
            reason: Some(Reason::Unsupported),
            agreement_milli: None,
            audio_digests: Vec::new(),
            enrollment_digest: None,
            template_epoch: None,
            verifier_public_key: None,
            ms: Stages::default(),
            detail: None,
        }
    }
}

impl Default for EnrollOutput {
    fn default() -> Self {
        Self::new()
    }
}

/// The output for an input without a known `op`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnknownOp {
    pub kind: &'static str,
    pub verifier: &'static str,
    pub outcome: Outcome,
    pub reason: Reason,
}

/// Cuts a detail text to at most 48 bytes at a char boundary.
pub fn short(text: &str) -> String {
    let mut end = text.len().min(48);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Serializes any output.
pub fn json_bytes<T: Serialize>(value: &T) -> Vec<u8> {
    let bytes = serde_json::to_vec(value).expect("output serializes");
    debug_assert!(bytes.len() < MAX_OUTPUT_BYTES, "{}", bytes.len());
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn verdict_has_thirteen_fields_in_order() {
        let text = verdict_json(&Verdict::new());
        assert_eq!(
            text,
            r#"{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.11.0","request_digest":null,"spoken_text_digest":null,"audio_digest":null,"outcome":"refuse","reason":"unsupported","policy_rule":null,"expires_at_ms":0,"speaker_score_milli":null,"word_margin_milli":null,"heard":null}"#
        );
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 13);
        assert_eq!(serde_json::to_value(Outcome::StepUp).unwrap(), "step_up");
    }

    #[test]
    fn reasons_serialize_in_snake_case() {
        let names: Vec<Value> = Reason::ALL.iter().map(|reason| serde_json::to_value(reason).unwrap()).collect();
        assert_eq!(
            Value::Array(names),
            json!([
                "quality",
                "speaker",
                "words",
                "audio_reused",
                "audio_invalid",
                "template_missing",
                "unsupported",
                "speaker_unavailable",
                "storage",
                "template_exists",
                "transcriber_unavailable",
                "not_authorized",
                "authorization_unavailable",
                "proposal_missing",
                "same_speaker",
                "attempts_exhausted",
                "detector_unavailable"
            ])
        );
    }

    #[test]
    fn message_is_the_domain_then_the_bytes() {
        let mut preimage = b"seams:outlayer:voice-verdict:v2".to_vec();
        preimage.extend_from_slice(b"{}");
        assert_eq!(verdict_message(b"{}"), sha256(&preimage));
    }
}
