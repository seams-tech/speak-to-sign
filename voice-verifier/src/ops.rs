//! The operations `enroll` and `verify` (HTTPS path, plan Section 7.5).
//!
//! `verify` sends the canonical WAV to the speaker service and to NEAR AI at
//! the same time, checks the speaker against the stored template and the
//! words against `render(request)`, marks the audio used and signs the
//! verdict with the manifest signing key.
use std::time::Instant;

use serde_json::{json, Map, Value};
use spoken_intent::{
    confusion_set, render, request_digest, spoken_text_digest, NearAmount, Network, SpokenAccount, SpokenRequestV1,
};

use crate::audio::{decode_wav, energy_gate, wav_bytes};
use crate::config::{
    audio_used_key, template_key, ENROLL_RECORDINGS, MAX_CONTACTS, MAX_HEARD_BYTES, MAX_OUTPUT_BYTES,
    NEAR_AI_API_KEY_ENV, SPEAKER_PINNED_KEY_HEX, TEMPLATE_EPOCH, VERIFIER_VERSION,
};
use crate::digest::{b64, b64u, from_b64, from_hex, near_ed25519_key, sha256};
use crate::host::{Host, Timed};
use crate::input::{parse_yocto, EnrollInput, VerifyInput};
use crate::output::{
    json_bytes, short, verdict_json, verdict_message, Enrollment, Outcome, Reason, UnknownOp, Verdict, VerifyOutput,
    VERIFY_OUTPUT_KIND,
};
use crate::speaker::{
    self, check_service_reply, model_sha256, service_request, similarity_milli, speaker_passes, TemplateRecord,
};
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::{check_words, cut_at};

/// The network that this version serves.
pub const SERVED_NETWORK: Network = Network::Testnet;

/// Values that the release build pins. Tests replace the speaker key,
/// because their fake service signs with its own key.
#[derive(Clone, Copy, Debug)]
pub struct Pins {
    pub speaker_key: [u8; 32],
}

impl Pins {
    pub fn production() -> Self {
        Self { speaker_key: from_hex::<32>(SPEAKER_PINNED_KEY_HEX).expect("pinned hex") }
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
        Some("enroll") => json_bytes(&enroll(value, host, pins)),
        Some("verify") => verify(value, host, pins),
        _ => json_bytes(&UnknownOp {
            kind: "seams_voice_error_v1",
            verifier: VERIFIER_VERSION,
            outcome: Outcome::Refuse,
            reason: Reason::Unsupported,
        }),
    }
}

/// The request that the vault rebuilds from its state and the call
/// arguments. Accounts must be speakable and distinct; the amount must be
/// speakable.
pub fn transfer_request(
    vault: &str,
    owner: &str,
    receiver: &str,
    amount_yocto: u128,
    nonce: u64,
) -> Result<SpokenRequestV1, Reason> {
    let account = |id: &str| SpokenAccount::new(id).map_err(|_| Reason::Unsupported);
    let (vault, owner, receiver) = (account(vault)?, account(owner)?, account(receiver)?);
    if vault == owner || receiver == owner || receiver == vault {
        return Err(Reason::Unsupported);
    }
    let amount = NearAmount::from_yocto(amount_yocto).map_err(|_| Reason::Unsupported)?;
    Ok(SpokenRequestV1::VaultTransfer { network: SERVED_NETWORK, vault, owner, receiver, amount, nonce })
}

fn elapsed(started: Instant) -> Value {
    json!(started.elapsed().as_millis() as u64)
}

/// A decoded inline WAV: its samples, the canonical WAV and its digest.
struct Clip {
    pcm: Vec<i16>,
    wav: Vec<u8>,
    digest: [u8; 32],
}

fn decode_clip(b64_text: &str, detail: &mut Option<String>) -> Result<Clip, Reason> {
    let bytes = from_b64(b64_text).ok_or_else(|| {
        *detail = Some("bad_base64".into());
        Reason::AudioInvalid
    })?;
    let pcm = decode_wav(&bytes).map_err(|error| {
        *detail = Some(error.into());
        Reason::AudioInvalid
    })?;
    let wav = wav_bytes(&pcm);
    let digest = sha256(&wav);
    Ok(Clip { pcm, wav, digest })
}

/// A read of the used-audio marker: absent, or a refusal.
fn check_unused(host: &mut dyn Host, digest_b64u: &str) -> Result<(), Reason> {
    match host.marker_get(&audio_used_key(digest_b64u)) {
        Ok(None) => Ok(()),
        Ok(Some(_)) => Err(Reason::AudioReused),
        Err(_) => Err(Reason::Storage),
    }
}

/// Marks an audio digest used, atomically. A second use is refused.
fn consume(host: &mut dyn Host, digest_b64u: &str) -> Result<(), Reason> {
    match host.marker_set_if_absent(&audio_used_key(digest_b64u), b"1") {
        Ok(true) => Ok(()),
        Ok(false) => Err(Reason::AudioReused),
        Err(_) => Err(Reason::Storage),
    }
}

fn speaker_reply(
    timed: Option<&Timed>,
    clip: &Clip,
    nonce: &[u8; 32],
    pins: &Pins,
    detail: &mut Option<String>,
) -> Result<speaker::ServiceReply, Reason> {
    let checked = match timed.map(|timed| &timed.result) {
        Some(Ok((status, body))) => check_service_reply(*status, body, &clip.digest, nonce, &pins.speaker_key),
        Some(Err(error)) => Err(format!("network: {error}")),
        None => Err("no_result".into()),
    };
    checked.map_err(|error| {
        *detail = Some(short(&format!("speaker: {error}")));
        Reason::SpeakerUnavailable
    })
}

// ------------------------------------------------------------------ enroll

/// Three recordings of the owner become the template of (vault, owner).
pub fn enroll(value: Value, host: &mut dyn Host, pins: &Pins) -> Enrollment {
    let started = Instant::now();
    let mut output = Enrollment::new();
    match enroll_steps(value, host, pins, &mut output) {
        Ok(()) => {
            output.outcome = Outcome::Accept;
            output.reason = None;
        }
        Err(reason) => {
            output.outcome = Outcome::Refuse;
            output.reason = Some(reason);
        }
    }
    match host.public_key() {
        Ok(key) if key.len() == 32 => output.verifier_public_key = Some(near_ed25519_key(&key)),
        Ok(_) => output.detail = output.detail.take().or(Some("public_key: length".into())),
        Err(error) => output.detail = output.detail.take().or(Some(short(&format!("public_key: {error}")))),
    }
    output.ms.insert("total".into(), elapsed(started));
    output
}

fn enroll_steps(value: Value, host: &mut dyn Host, pins: &Pins, output: &mut Enrollment) -> Result<(), Reason> {
    let input: EnrollInput = serde_json::from_value(value).map_err(|_| Reason::Unsupported)?;
    let vault = SpokenAccount::new(&input.vault).map_err(|_| Reason::Unsupported)?;
    let owner = SpokenAccount::new(&input.owner).map_err(|_| Reason::Unsupported)?;
    if input.op != "enroll" || vault == owner {
        return Err(Reason::Unsupported);
    }
    output.vault = Some(vault.as_str().to_string());
    output.owner = Some(owner.as_str().to_string());
    if input.audio_wav_b64.len() != ENROLL_RECORDINGS {
        return Err(Reason::Unsupported);
    }
    let mut clips = Vec::with_capacity(ENROLL_RECORDINGS);
    for text in &input.audio_wav_b64 {
        clips.push(decode_clip(text, &mut output.detail)?);
    }
    output.audio_digests = clips.iter().map(|clip| b64u(&clip.digest)).collect();
    for (index, clip) in clips.iter().enumerate() {
        if clips[..index].iter().any(|other| other.digest == clip.digest) {
            return Err(Reason::AudioReused);
        }
        if !energy_gate(&clip.pcm).passes() {
            return Err(Reason::Quality);
        }
    }

    let key = template_key(vault.as_str(), owner.as_str());
    match host.storage_get(&key) {
        Ok(None) => {}
        Ok(Some(_)) => return Err(Reason::TemplateExists),
        Err(_) => return Err(Reason::Storage),
    }
    for digest in &output.audio_digests {
        check_unused(host, digest)?;
    }

    let mut nonces = Vec::with_capacity(ENROLL_RECORDINGS);
    for _ in 0..ENROLL_RECORDINGS {
        nonces.push(host.random32().map_err(|_| Reason::SpeakerUnavailable)?);
    }
    let requests: Vec<_> = clips.iter().zip(&nonces).map(|(clip, nonce)| service_request(&clip.wav, nonce)).collect();
    let started = Instant::now();
    let results = host.post_concurrent(&requests);
    output.ms.insert("speaker".into(), elapsed(started));
    let mut embeddings = Vec::with_capacity(ENROLL_RECORDINGS);
    for (index, (clip, nonce)) in clips.iter().zip(&nonces).enumerate() {
        embeddings.push(speaker_reply(results.get(index), clip, nonce, pins, &mut output.detail)?.embedding);
    }
    let template = match speaker::enroll(&embeddings) {
        speaker::Enrollment::Agreed { template, agreement_milli } => {
            output.agreement_milli = Some(agreement_milli);
            template
        }
        speaker::Enrollment::Disagreed { agreement_milli } => {
            output.agreement_milli = Some(agreement_milli);
            return Err(Reason::Speaker);
        }
    };
    for digest in &output.audio_digests {
        consume(host, digest)?;
    }
    let record = TemplateRecord { epoch: TEMPLATE_EPOCH, model_sha256: model_sha256(), template };
    match host.storage_set_if_absent(&key, &record.encode()) {
        Ok(true) => Ok(()),
        Ok(false) => Err(Reason::TemplateExists),
        Err(_) => Err(Reason::Storage),
    }
}

// ------------------------------------------------------------------ verify

struct VerifyRun {
    verdict: Verdict,
    ms: Map<String, Value>,
    detail: Option<String>,
}

/// One verify run: the output JSON bytes, always below 1024.
pub fn verify(value: Value, host: &mut dyn Host, pins: &Pins) -> Vec<u8> {
    let started = Instant::now();
    let mut run = VerifyRun { verdict: Verdict::new(), ms: Map::new(), detail: None };
    match verify_steps(value, host, pins, &mut run) {
        Ok(()) => {
            run.verdict.outcome = Outcome::Accept;
            run.verdict.reason = None;
        }
        Err(reason) => {
            run.verdict.outcome = Outcome::Refuse;
            run.verdict.reason = Some(reason);
        }
    }
    finish(run, host, started)
}

fn verify_steps(value: Value, host: &mut dyn Host, pins: &Pins, run: &mut VerifyRun) -> Result<(), Reason> {
    let started = Instant::now();
    let input: VerifyInput = serde_json::from_value(value).map_err(|_| Reason::Unsupported)?;
    if input.op != "verify" || input.contacts.len() > MAX_CONTACTS {
        return Err(Reason::Unsupported);
    }
    // 1. The request, as the vault will rebuild it.
    let amount = parse_yocto(&input.amount_yocto).ok_or(Reason::Unsupported)?;
    let request = transfer_request(&input.vault, &input.owner, &input.receiver, amount, input.nonce)?;
    let rendered = render(&request);
    run.verdict.request_digest = Some(b64u(&request_digest(&request)));
    run.verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(&rendered)));
    let mut contacts = input
        .contacts
        .iter()
        .map(|contact| SpokenAccount::new(contact))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Reason::Unsupported)?;
    if let SpokenRequestV1::VaultTransfer { receiver, .. } = &request {
        if !contacts.contains(receiver) {
            contacts.push(receiver.clone());
        }
    }

    // 2. The audio.
    let clip = decode_clip(&input.audio_wav_b64, &mut run.detail)?;
    let digest_b64u = b64u(&clip.digest);
    run.verdict.audio_digest = Some(digest_b64u.clone());
    if !energy_gate(&clip.pcm).passes() {
        return Err(Reason::Quality);
    }
    run.ms.insert("decode".into(), elapsed(started));

    // 3. The template and the used-audio marker.
    let stored = Instant::now();
    let record = match host.storage_get(&template_key(&input.vault, &input.owner)) {
        Ok(Some(bytes)) => TemplateRecord::decode(&bytes).ok_or(Reason::TemplateMissing)?,
        Ok(None) => return Err(Reason::TemplateMissing),
        Err(_) => return Err(Reason::Storage),
    };
    if record.model_sha256 != model_sha256() {
        return Err(Reason::TemplateMissing);
    }
    check_unused(host, &digest_b64u)?;
    run.ms.insert("storage".into(), elapsed(stored));

    // 4. The speaker service and NEAR AI, at the same time.
    let Some(api_key) = host.secret(NEAR_AI_API_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty())
    else {
        run.detail = Some("transcriber: no_api_key".into());
        return Err(Reason::TranscriberUnavailable);
    };
    let nonce = host.random32().map_err(|_| Reason::SpeakerUnavailable)?;
    let requests = [service_request(&clip.wav, &nonce), transcription_request(&api_key, &clip.wav)];
    let parallel = Instant::now();
    let results = host.post_concurrent(&requests);
    run.ms.insert("parallel".into(), elapsed(parallel));
    if let Some(timed) = results.first() {
        run.ms.insert("speaker".into(), json!(timed.ms));
    }
    if let Some(timed) = results.get(1) {
        run.ms.insert("transcribe".into(), json!(timed.ms));
    }

    // 5. Speaker.
    let reply = speaker_reply(results.first(), &clip, &nonce, pins, &mut run.detail)?;
    if let Some(model_ms) = reply.model_ms {
        run.ms.insert("redimnet".into(), json!(model_ms));
    }
    let score = similarity_milli(&reply.embedding, &record.template);
    run.verdict.speaker_score_milli = Some(score);
    if !speaker_passes(score) {
        return Err(Reason::Speaker);
    }

    // 6. The transcript, then the used-audio mark. An outage of either
    //    service does not burn the recording.
    let transcript = match results.get(1).map(|timed| &timed.result) {
        Some(Ok((status, body))) => parse_reply(*status, body),
        Some(Err(error)) => Err(format!("network: {error}")),
        None => Err("no_result".into()),
    }
    .map_err(|error| {
        run.detail = Some(short(&format!("transcriber: {error}")));
        Reason::TranscriberUnavailable
    })?;
    consume(host, &digest_b64u)?;

    // 7. Words: the heard tokens must equal the rendered tokens.
    let confusions = confusion_set(&request, &contacts);
    let check = check_words(&transcript, &contacts, &rendered.spoken, &confusions);
    run.verdict.heard = Some(check.heard);
    run.verdict.word_margin_milli = check.margin_milli;
    if !check.matched {
        return Err(Reason::Words);
    }
    Ok(())
}

/// Fits the output below [`MAX_OUTPUT_BYTES`] (by a shorter `heard`, which
/// is part of the signed bytes), then signs the verdict.
fn finish(mut run: VerifyRun, host: &mut dyn Host, started: Instant) -> Vec<u8> {
    let heard = run.verdict.heard.take();
    let mut verdict_text = String::new();
    for cap in [MAX_HEARD_BYTES, 120, 60, 0] {
        run.verdict.heard = heard.as_ref().filter(|_| cap > 0).map(|text| cut_at(text, cap));
        verdict_text = verdict_json(&run.verdict);
        let sized = VerifyOutput {
            kind: VERIFY_OUTPUT_KIND,
            verdict_json: verdict_text.clone(),
            signature_b64: Some("A".repeat(88)),
            public_key: Some(format!("ed25519:{}", "1".repeat(44))),
            ms: run.ms.clone(),
            detail: run.detail.clone(),
        };
        // Room for the `sign` and `total` stage times.
        if serde_json::to_vec(&sized).expect("serializes").len() + 48 < MAX_OUTPUT_BYTES {
            break;
        }
    }

    let signing = Instant::now();
    let message = verdict_message(verdict_text.as_bytes());
    let signed = host.sign(&message).and_then(|signature| {
        let public_key = host.public_key()?;
        if signature.len() != 64 || public_key.len() != 32 {
            return Err("length".to_string());
        }
        Ok((b64(&signature), near_ed25519_key(&public_key)))
    });
    run.ms.insert("sign".into(), elapsed(signing));
    run.ms.insert("total".into(), elapsed(started));
    let (signature_b64, public_key) = match signed {
        Ok((signature, key)) => (Some(signature), Some(key)),
        Err(error) => {
            run.detail = Some(short(&format!("sign: {error}")));
            (None, None)
        }
    };
    let output = VerifyOutput {
        kind: VERIFY_OUTPUT_KIND,
        verdict_json: verdict_text,
        signature_b64,
        public_key,
        ms: run.ms,
        detail: run.detail,
    };
    let bytes = serde_json::to_vec(&output).expect("output serializes");
    debug_assert!(bytes.len() < MAX_OUTPUT_BYTES, "{}", bytes.len());
    bytes
}
