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
//! [`crate::enrollment`]). A new authorization lets the owner enroll again;
//! the template is replaced and its epoch grows by 1.
use std::time::Instant;

use serde_json::{json, Map, Value};
use spoken_intent::{
    confusion_set, render, request_digest, spoken_text_digest, NearAccount, NearAmount, Network, NoteRatingV1,
    SpokenAccount, SpokenRequestV1, SpokenSummary,
};

use crate::audio::{decode_wav, energy_gate, wav_bytes};
use crate::config::{
    audio_used_key, template_key, ENROLL_RECORDINGS, MAX_CONTACTS, MAX_HEARD_BYTES, MAX_OUTPUT_BYTES,
    NEAR_AI_API_KEY_ENV, SPEAKER_PINNED_KEY_HEX, TEMPLATE_EPOCH, VERDICT_TTL_MS, VERIFIER_VERSION,
};
use crate::digest::{b64, b64u, from_b64, from_hex, near_ed25519_key, sha256};
use crate::enrollment::{access_key_request, check_authorization, enrollment_digest, parse_access_key, AccessKey};
use crate::host::{Host, Timed};
use crate::input::{parse_yocto, EnrollInput, RatingInput, RequestInput, VerifyInput};
use crate::policy::{self, Decision};
use crate::output::{
    json_bytes, short, verdict_json, verdict_message, Enrollment, Outcome, Reason, UnknownOp, Verdict, VerifyOutput,
    VERIFY_OUTPUT_KIND,
};
use crate::speaker::{
    self, check_service_reply, model_sha256, service_request, similarity_milli, speaker_passes, TemplateRecord,
};
use crate::transcriber::{parse_reply, transcription_request};
use crate::words::{check_words, cut_at, WordCheck};

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

/// A transfer from the owner's account, as the Wallet builds it. The owner
/// can be any NEAR account; the receiver and the amount must be speakable,
/// and the receiver is not the owner.
pub fn transfer_request(owner: &str, receiver: &str, amount_yocto: u128) -> Result<SpokenRequestV1, Reason> {
    let owner = NearAccount::new(owner).map_err(|_| Reason::Unsupported)?;
    let receiver = SpokenAccount::new(receiver).map_err(|_| Reason::Unsupported)?;
    if receiver.as_str() == owner.as_str() {
        return Err(Reason::Unsupported);
    }
    let amount = NearAmount::from_yocto(amount_yocto).map_err(|_| Reason::Unsupported)?;
    Ok(SpokenRequestV1::AccountTransfer { network: SERVED_NETWORK, owner, receiver, amount })
}

/// The typed request of a `verify` input.
fn typed_request(owner: &str, request: &RequestInput) -> Result<SpokenRequestV1, Reason> {
    match request {
        RequestInput::Transfer { receiver, amount_yocto } => {
            let amount = parse_yocto(amount_yocto).ok_or(Reason::Unsupported)?;
            transfer_request(owner, receiver, amount)
        }
        RequestInput::CommunityNote { contract, post_id, note_sha256_hex, summary } => {
            let lowercase_hex = note_sha256_hex.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
            let note_sha256 = from_hex::<32>(note_sha256_hex).filter(|_| lowercase_hex).ok_or(Reason::Unsupported)?;
            Ok(SpokenRequestV1::CommunityNote {
                network: SERVED_NETWORK,
                owner: NearAccount::new(owner).map_err(|_| Reason::Unsupported)?,
                contract: NearAccount::new(contract).map_err(|_| Reason::Unsupported)?,
                post_id: *post_id,
                note_sha256,
                summary: SpokenSummary::new(summary).map_err(|_| Reason::Unsupported)?,
            })
        }
        RequestInput::NoteRating { contract, note_id, rating } => Ok(SpokenRequestV1::NoteRating {
            network: SERVED_NETWORK,
            owner: NearAccount::new(owner).map_err(|_| Reason::Unsupported)?,
            contract: NearAccount::new(contract).map_err(|_| Reason::Unsupported)?,
            note_id: *note_id,
            rating: match rating {
                RatingInput::Helpful => NoteRatingV1::Helpful,
                RatingInput::SomewhatHelpful => NoteRatingV1::SomewhatHelpful,
                RatingInput::NotHelpful => NoteRatingV1::NotHelpful,
            },
        }),
    }
}

/// A note summary is free text, so one word heard in another way is
/// forgiven when the summary has at least this many words.
pub const SUMMARY_FORGIVE_MIN_WORDS: usize = 4;

/// The word decision. A transfer, an approval and a rating need the exact
/// words. A note summary also passes with one word changed or dropped, when
/// the heard words are still closer to the summary than to every near miss.
/// An added word is as close to the near miss with "not" in its place, so
/// it does not pass, and an added or dropped "not" never passes.
fn words_pass(request: &SpokenRequestV1, check: &WordCheck, expected_words: usize) -> bool {
    if check.matched {
        return true;
    }
    matches!(request, SpokenRequestV1::CommunityNote { .. })
        && expected_words >= SUMMARY_FORGIVE_MIN_WORDS
        && check.distance == Some(1)
        && check.margin_milli.is_some_and(|margin| margin > 0)
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

/// Three recordings of the owner become the template of the owner.
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
    let owner = NearAccount::new(&input.owner).map_err(|_| Reason::Unsupported)?;
    if input.op != "enroll" {
        return Err(Reason::Unsupported);
    }
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

    let digests: Vec<[u8; 32]> = clips.iter().map(|clip| clip.digest).collect();
    let digest_text = b64u(&enrollment_digest(owner.as_str(), &digests));
    output.enrollment_digest = Some(digest_text.clone());

    // The owner's signature of this digest, before any network call.
    let public_key = check_authorization(&input.authorization, &digest_text).map_err(|error| {
        output.detail = Some(format!("authorization: {error}"));
        Reason::NotAuthorized
    })?;

    // The owner's access key (NEAR RPC) and the three embeddings (speaker
    // service), in one batch.
    let mut nonces = Vec::with_capacity(ENROLL_RECORDINGS);
    for _ in 0..ENROLL_RECORDINGS {
        nonces.push(host.random32().map_err(|_| Reason::SpeakerUnavailable)?);
    }
    let mut requests = vec![access_key_request(owner.as_str(), &public_key)];
    requests.extend(clips.iter().zip(&nonces).map(|(clip, nonce)| service_request(&clip.wav, nonce)));
    let flight = Instant::now();
    host.post_start(requests);
    output.ms.insert("send".into(), elapsed(flight));

    // Storage while the requests are in flight: the current template (for
    // its epoch and the compare-and-swap) and the used-audio markers.
    let key = template_key(owner.as_str());
    let stored = Instant::now();
    let previous = match enroll_storage(host, &key, &output.audio_digests) {
        Ok(previous) => previous,
        Err(reason) => {
            host.post_cancel();
            return Err(reason);
        }
    };
    output.ms.insert("storage".into(), elapsed(stored));
    let waited = Instant::now();
    let results = host.post_wait();
    output.ms.insert("wait".into(), elapsed(waited));
    output.ms.insert("parallel".into(), elapsed(flight));
    if let Some(timed) = results.first() {
        output.ms.insert("rpc".into(), json!(timed.ms));
    }
    if let Some(slowest) = results.iter().skip(1).map(|timed| timed.ms).max() {
        output.ms.insert("speaker".into(), json!(slowest));
    }

    // The key must be a full-access key of the owner, before the embeddings
    // are used.
    let access = match results.first().map(|timed| &timed.result) {
        Some(Ok((status, body))) => parse_access_key(*status, body),
        Some(Err(error)) => Err(format!("network: {error}")),
        None => Err("no_result".into()),
    }
    .map_err(|error| {
        output.detail = Some(short(&format!("rpc: {error}")));
        Reason::AuthorizationUnavailable
    })?;
    let refused = match access {
        AccessKey::FullAccess => None,
        AccessKey::FunctionCall => Some("authorization: function_call_key"),
        AccessKey::Missing => Some("authorization: unknown_key"),
    };
    if let Some(detail) = refused {
        output.detail = Some(detail.into());
        return Err(Reason::NotAuthorized);
    }

    let mut embeddings = Vec::with_capacity(ENROLL_RECORDINGS);
    for (index, (clip, nonce)) in clips.iter().zip(&nonces).enumerate() {
        embeddings.push(speaker_reply(results.get(index + 1), clip, nonce, pins, &mut output.detail)?.embedding);
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
    let marked = Instant::now();
    for digest in &output.audio_digests {
        consume(host, digest)?;
    }
    // A re-enrollment replaces the template and adds 1 to its epoch.
    let epoch = previous
        .as_deref()
        .and_then(TemplateRecord::decode)
        .map_or(TEMPLATE_EPOCH, |record| record.epoch.saturating_add(1));
    let record = TemplateRecord { epoch, model_sha256: model_sha256(), template };
    let written = match &previous {
        None => host.storage_set_if_absent(&key, &record.encode()),
        Some(bytes) => host.storage_set_if_equals(&key, bytes, &record.encode()),
    };
    output.ms.insert("write".into(), elapsed(marked));
    match written {
        Ok(true) => {
            output.template_epoch = Some(epoch);
            Ok(())
        }
        Ok(false) => Err(Reason::TemplateExists),
        Err(_) => Err(Reason::Storage),
    }
}

/// The stored template bytes (if any), after a check that no clip was used.
fn enroll_storage(host: &mut dyn Host, key: &str, digests: &[String]) -> Result<Option<Vec<u8>>, Reason> {
    let previous = host.storage_get(key).map_err(|_| Reason::Storage)?;
    for digest in digests {
        check_unused(host, digest)?;
    }
    Ok(previous)
}

// ------------------------------------------------------------------ verify

struct VerifyRun {
    verdict: Verdict,
    ms: Map<String, Value>,
    detail: Option<String>,
    policy_text: Option<&'static str>,
}

/// One verify run: the output JSON bytes, always below 1024.
pub fn verify(value: Value, host: &mut dyn Host, pins: &Pins) -> Vec<u8> {
    let started = Instant::now();
    let mut run = VerifyRun { verdict: Verdict::new(), ms: Map::new(), detail: None, policy_text: None };
    match verify_steps(value, host, pins, &mut run) {
        Ok(Decision::Allow) => {
            run.verdict.outcome = Outcome::Accept;
            run.verdict.reason = None;
        }
        Ok(Decision::StepUp(rule)) => {
            run.verdict.outcome = Outcome::StepUp;
            run.verdict.reason = None;
            run.verdict.policy_rule = Some(rule.id.to_string());
            run.policy_text = Some(rule.text);
        }
        Err(reason) => {
            run.verdict.outcome = Outcome::Refuse;
            run.verdict.reason = Some(reason);
        }
    }
    finish(run, host, started)
}

fn verify_steps(value: Value, host: &mut dyn Host, pins: &Pins, run: &mut VerifyRun) -> Result<Decision, Reason> {
    let started = Instant::now();
    let input: VerifyInput = serde_json::from_value(value).map_err(|_| Reason::Unsupported)?;
    if input.op != "verify" || input.contacts.len() > MAX_CONTACTS {
        return Err(Reason::Unsupported);
    }
    // 1. The request, as the Wallet builds it.
    let request = typed_request(&input.owner, &input.request)?;
    let rendered = render(&request);
    run.verdict.request_digest = Some(b64u(&request_digest(&request)));
    run.verdict.spoken_text_digest = Some(b64u(&spoken_text_digest(&rendered)));
    let mut contacts = input
        .contacts
        .iter()
        .map(|contact| SpokenAccount::new(contact))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Reason::Unsupported)?;
    if let SpokenRequestV1::AccountTransfer { receiver, .. } = &request {
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

    // 3. The speaker service and NEAR AI, at the same time. The bodies go
    //    out now; the responses are read after the storage calls.
    let Some(api_key) = host.secret(NEAR_AI_API_KEY_ENV).map(|key| key.trim().to_string()).filter(|key| !key.is_empty())
    else {
        run.detail = Some("transcriber: no_api_key".into());
        return Err(Reason::TranscriberUnavailable);
    };
    let nonce = host.random32().map_err(|_| Reason::SpeakerUnavailable)?;
    let flight = Instant::now();
    host.post_start(vec![service_request(&clip.wav, &nonce), transcription_request(&api_key, &clip.wav)]);
    run.ms.insert("send".into(), elapsed(flight));

    // 4. The template and the used-audio check, while the requests are in
    //    flight. A refusal here drops them.
    let stored = Instant::now();
    let record = match verify_storage(host, &input.owner, &digest_b64u) {
        Ok(record) => record,
        Err(reason) => {
            host.post_cancel();
            return Err(reason);
        }
    };
    run.ms.insert("storage".into(), elapsed(stored));
    let waited = Instant::now();
    let results = host.post_wait();
    run.ms.insert("wait".into(), elapsed(waited));
    run.ms.insert("parallel".into(), elapsed(flight));
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
    let marked = Instant::now();
    let consumed = consume(host, &digest_b64u);
    run.ms.insert("mark".into(), elapsed(marked));
    consumed?;

    // 7. Words: the heard tokens must equal the rendered tokens (a note
    //    summary may differ by one word, see `words_pass`).
    let confusions = confusion_set(&request, &contacts);
    let check = check_words(&transcript, &contacts, &rendered.spoken, &confusions);
    let passed = words_pass(&request, &check, rendered.spoken.len());
    run.verdict.heard = Some(check.heard);
    run.verdict.word_margin_milli = check.margin_milli;
    if !passed {
        return Err(Reason::Words);
    }

    // 8. The policy step, after the deterministic checks. It can only
    //    tighten an accept into a step-up.
    let decided = Instant::now();
    let decision = policy::decide(&request);
    run.ms.insert("policy".into(), elapsed(decided));
    Ok(decision)
}

/// The owner's template for the pinned model, after a check that the audio
/// was not used.
fn verify_storage(host: &mut dyn Host, owner: &str, digest_b64u: &str) -> Result<TemplateRecord, Reason> {
    let record = match host.storage_get(&template_key(owner)) {
        Ok(Some(bytes)) => TemplateRecord::decode(&bytes).ok_or(Reason::TemplateMissing)?,
        Ok(None) => return Err(Reason::TemplateMissing),
        Err(_) => return Err(Reason::Storage),
    };
    if record.model_sha256 != model_sha256() {
        return Err(Reason::TemplateMissing);
    }
    check_unused(host, digest_b64u)?;
    Ok(record)
}

/// Sets the expiry, fits the output below [`MAX_OUTPUT_BYTES`] (by a
/// shorter `heard`, which is part of the signed bytes), then signs the
/// verdict.
fn finish(mut run: VerifyRun, host: &mut dyn Host, started: Instant) -> Vec<u8> {
    run.verdict.expires_at_ms = host.now_ms().saturating_add(VERDICT_TTL_MS);
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
            policy_text: run.policy_text,
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
        policy_text: run.policy_text,
        ms: run.ms,
        detail: run.detail,
    };
    let bytes = serde_json::to_vec(&output).expect("output serializes");
    debug_assert!(bytes.len() < MAX_OUTPUT_BYTES, "{}", bytes.len());
    bytes
}
