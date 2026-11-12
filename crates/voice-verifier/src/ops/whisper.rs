//! The Whisper request of every operation with words (`verify`, `select`,
//! `transcribe`, `detect`): sealed to the NEAR AI gateway that the worker
//! checked, with the checked gateway kept in the worker storage.
//!
//! A normal call reads one record of the worker storage and seals to the
//! key configuration in it. The record is checked again when it is older
//! than [`NEAR_AI_ATTESTATION_TTL_MS`], or after a reply that did not open
//! (the gateway's key changed). Only that call pays for the check: the
//! report, Intel's collateral and the quote checks.
//!
//! Fail closed: no checked gateway, no request. If the check again cannot
//! reach NEAR AI or Intel PCS, the last checked gateway serves up to
//! [`NEAR_AI_ATTESTATION_GRACE_MS`]; after that the call refuses with
//! `transcriber_unavailable`. A check that fails refuses with
//! `transcriber_not_attested`, and so does a reply that does not open.
use std::time::Instant;

use super::steps::reply_of;
use super::Refusal;
use crate::config::{NEAR_AI_API_KEY_ENV, NEAR_AI_GATEWAY_RECORD_KEY};
#[cfg(doc)]
use crate::config::{NEAR_AI_ATTESTATION_GRACE_MS, NEAR_AI_ATTESTATION_TTL_MS};
use crate::host::{Host, PostRequest, Timed};
use crate::nearai_attestation::{
    check, collateral, collateral_requests, parse_report, platform, report_request, Age, Failure, Gateway,
};
use crate::ohttp::ResponseOpener;
use crate::output::{short, Reason, Stages};
use crate::transcriber::{open_reply, transcription_request, ReplyFault};

/// The NEAR AI API key, or a refusal.
pub(super) fn api_key(host: &dyn Host) -> Result<String, Refusal> {
    host.secret(NEAR_AI_API_KEY_ENV)
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .ok_or_else(|| Refusal::new(Reason::TranscriberUnavailable, "transcriber: no_api_key"))
}

/// What reads the reply of one Whisper request.
pub(super) struct Words {
    opener: ResponseOpener,
    /// The requests that went out before the Whisper request, for
    /// [`in_flight`](super::steps::in_flight).
    pub(super) early: Early,
}

/// The requests of an operation that are in flight before the rest.
#[derive(Clone, Copy)]
pub(super) struct Early {
    /// How many requests, from the start of the list.
    pub(super) count: usize,
    /// When they started.
    pub(super) started: Instant,
}

/// Starts the requests of `requests` (the speaker request), then adds the
/// Whisper request of `wav`, sealed to the checked gateway, to the list.
///
/// The read of the gateway record is a blocking storage call. The speaker
/// request needs no checked gateway, so it goes out first, and the read
/// runs while it is in flight. No audio goes to Whisper before the gateway
/// is checked. A refusal here drops the requests that are in flight.
///
/// It records the stages `tee` (the time to get the checked gateway) and
/// `tee_cached` (1: the stored record; 0: a new check; 2: the stored record,
/// because the new check could not reach a service).
pub(super) fn words_request(
    host: &mut dyn Host,
    ms: &mut Stages,
    api_key: &str,
    wav: &[u8],
    requests: &mut Vec<PostRequest>,
) -> Result<Words, Refusal> {
    let early = Early { count: requests.len(), started: Instant::now() };
    if !requests.is_empty() {
        host.post_start(requests.clone());
    }
    match sealed_request(host, ms, api_key, wav) {
        Ok((request, opener)) => {
            requests.push(request);
            Ok(Words { opener, early })
        }
        Err(refusal) => {
            host.post_cancel();
            Err(refusal)
        }
    }
}

fn sealed_request(
    host: &mut dyn Host,
    ms: &mut Stages,
    api_key: &str,
    wav: &[u8],
) -> Result<(PostRequest, ResponseOpener), Refusal> {
    let started = Instant::now();
    let gateway = checked_gateway(host, ms);
    ms.since("tee", started);
    let config = gateway?.key_config().ok_or_else(|| not_attested("record: key_config"))?;
    let seed = host.random32().map_err(|_| Refusal::new(Reason::TranscriberUnavailable, "transcriber: random"))?;
    transcription_request(&config, api_key, wav, &seed).map_err(|error| not_attested(format!("ohttp: {error}")))
}

/// The transcript of the reply. A reply that does not open drops the
/// stored gateway, so the next call checks the gateway again.
pub(super) fn words_reply(host: &mut dyn Host, timed: Option<&Timed>, words: &Words) -> Result<String, Refusal> {
    let opened = match reply_of(timed) {
        Ok((status, body)) => open_reply(status, body, &words.opener),
        Err(error) => Err(ReplyFault::Unavailable(error)),
    };
    match opened {
        Ok(text) => Ok(text),
        Err(ReplyFault::Unavailable(detail)) => {
            Err(Refusal::new(Reason::TranscriberUnavailable, short(&format!("transcriber: {detail}"))))
        }
        Err(ReplyFault::NotAttested(detail)) => {
            let _ = host.worker_set(NEAR_AI_GATEWAY_RECORD_KEY, b"{}");
            Err(Refusal::new(Reason::TranscriberNotAttested, short(&format!("transcriber: {detail}"))))
        }
    }
}

fn not_attested(detail: impl AsRef<str>) -> Refusal {
    Refusal::new(Reason::TranscriberNotAttested, short(&format!("attestation: {}", detail.as_ref())))
}

/// The checked gateway: the stored record while it is fresh, else a new
/// check (see the module text).
fn checked_gateway(host: &mut dyn Host, ms: &mut Stages) -> Result<Gateway, Refusal> {
    let now_ms = host.now_ms();
    let stored = host
        .worker_get(NEAR_AI_GATEWAY_RECORD_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| Gateway::from_record(&bytes))
        .map(|gateway| (gateway.age(now_ms), gateway));
    if let Some((Age::Fresh, gateway)) = stored {
        ms.record("tee_cached", 1);
        return Ok(gateway);
    }
    match check_again(host) {
        Ok(gateway) => {
            // A failed write costs the next call a check, nothing more.
            let _ = host.worker_set(NEAR_AI_GATEWAY_RECORD_KEY, &gateway.to_record());
            ms.record("tee_cached", 0);
            Ok(gateway)
        }
        Err(Failure::Unavailable(detail)) => match stored {
            Some((Age::Grace, gateway)) => {
                ms.record("tee_cached", 2);
                Ok(gateway)
            }
            _ => Err(Refusal::new(Reason::TranscriberUnavailable, short(&format!("attestation: {detail}")))),
        },
        Err(Failure::NotAttested(detail)) => Err(not_attested(detail)),
    }
}

/// One check of the gateway with a fresh nonce: the report, then Intel's
/// collateral for its two quotes, then [`check`].
fn check_again(host: &mut dyn Host) -> Result<Gateway, Failure> {
    let unavailable = |detail: String| Failure::Unavailable(detail);
    let nonce = host.random32().map_err(|_| unavailable("random".into()))?;
    let reply = host
        .get_all(vec![report_request(&nonce)])
        .pop()
        .ok_or_else(|| unavailable("report: no_result".into()))?
        .map_err(|error| unavailable(format!("report: {error}")))?;
    let report = parse_report(reply.status, &reply.body)?;
    let platforms = [platform(&report.gateway.quote)?, platform(&report.model.quote)?];
    let requests = collateral_requests(&platforms);
    let replies = host.get_all(requests.clone());
    let collaterals = collateral(&platforms, &requests, replies)?;
    check(&report, &nonce, &collaterals[0], &collaterals[1], host.now_ms())
}
