//! The NEAR AI attestation check with a recorded real report and Intel's
//! recorded collateral (`testdata/nearai_report_v1.json`,
//! `testdata/nearai_collateral_v1.json`, from
//! `tests/nearai_attestation_live.rs`). No network.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;

use seams_voice_verifier::digest::hex;
use seams_voice_verifier::host::{GetRequest, Reply};
use seams_voice_verifier::nearai_attestation::{
    check, collateral, collateral_requests, parse_report, platform, Failure, Gateway, Platform, Report,
};

const REPORT: &[u8] = include_bytes!("../testdata/nearai_report_v1.json");
const COLLATERAL: &str = include_str!("../testdata/nearai_collateral_v1.json");
const NONCE: [u8; 32] = [0x5a; 32];

struct Recorded {
    checked_at_ms: u64,
    replies: Vec<(String, Reply)>,
}

fn recorded() -> Recorded {
    let value: Value = serde_json::from_str(COLLATERAL).unwrap();
    let replies = value["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|reply| {
            let headers = reply["headers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|pair| (pair[0].as_str().unwrap().to_string(), pair[1].as_str().unwrap().to_string()))
                .collect();
            let body = STANDARD.decode(reply["body_b64"].as_str().unwrap()).unwrap();
            (
                reply["url"].as_str().unwrap().to_string(),
                Reply { status: reply["status"].as_u64().unwrap() as u16, headers, body },
            )
        })
        .collect();
    Recorded { checked_at_ms: value["checked_at_ms"].as_u64().unwrap(), replies }
}

/// The replies to `requests`, from the recording.
fn replies_for(requests: &[GetRequest], recorded: &Recorded) -> Vec<Result<Reply, String>> {
    requests
        .iter()
        .map(|request| {
            recorded
                .replies
                .iter()
                .find(|(url, _)| *url == request.url)
                .map(|(_, reply)| reply.clone())
                .ok_or_else(|| "not recorded".to_string())
        })
        .collect()
}

fn platforms(report: &Report) -> [Platform; 2] {
    [platform(&report.gateway.quote).unwrap(), platform(&report.model.quote).unwrap()]
}

/// The check of `report` with the recorded collateral, at `now_ms`.
fn check_at(report: &Report, nonce: &[u8; 32], now_ms: u64) -> Result<Gateway, Failure> {
    let recorded = recorded();
    let platforms = platforms(report);
    let requests = collateral_requests(&platforms);
    let collaterals = collateral(&platforms, &requests, replies_for(&requests, &recorded))?;
    check(report, nonce, &collaterals[0], &collaterals[1], now_ms)
}

fn report() -> Report {
    parse_report(200, REPORT).unwrap()
}

/// The report with one change of its JSON.
fn changed(change: impl FnOnce(&mut Value)) -> Result<Report, Failure> {
    let mut value: Value = serde_json::from_slice(REPORT).unwrap();
    change(&mut value);
    parse_report(200, &serde_json::to_vec(&value).unwrap())
}

fn not_attested(result: Result<Gateway, Failure>) -> String {
    match result {
        Err(Failure::NotAttested(detail)) => detail,
        other => panic!("expected a failed check, got {other:?}"),
    }
}

#[test]
fn the_recorded_report_passes() {
    let at = recorded().checked_at_ms;
    let gateway = check_at(&report(), &NONCE, at).unwrap();
    assert_eq!(gateway.gateway_key, "40599fb284f43953bb356b09080fd803c960fc10285ad90eca462ca711ad4acb");
    assert_eq!(
        gateway.key_config,
        "010020e4e354364111f2295e2d2ed97ce1103c9fdcb261459ec626d9bd8a6e15f0d11600080001000100010003"
    );
    assert_eq!(gateway.compose_hash, "877959253d2406f05fa718840fd157b8e647547827e9524cb33081a2a8fcb78b");
    assert_eq!(gateway.tcb_status, "UpToDate");
    assert_eq!(gateway.checked_at_ms, at);
    assert!(gateway.key_config().is_some());
    assert_eq!(Gateway::from_record(&gateway.to_record()), Some(gateway));
}

#[test]
fn the_platforms_of_the_two_quotes() {
    let report = report();
    let found = platforms(&report);
    assert_eq!(found[0], Platform { fmspc: "70A06D070000".into(), ca: "platform" });
    assert_eq!(found[1], Platform { fmspc: "90C06F000000".into(), ca: "platform" });
    assert_eq!(collateral_requests(&found).len(), 5);
}

#[test]
fn a_wrong_or_stale_nonce_fails() {
    let at = recorded().checked_at_ms;
    let mut other = NONCE;
    other[31] ^= 1;
    assert_eq!(not_attested(check_at(&report(), &other, at)), "gateway: report_data_nonce");
}

#[test]
fn stale_collateral_fails() {
    let at = recorded().checked_at_ms + 120 * 24 * 3_600_000;
    let detail = not_attested(check_at(&report(), &NONCE, at));
    assert!(detail.starts_with("gateway: quote: "), "{detail}");
}

#[test]
fn a_wrong_measurement_fails() {
    let at = recorded().checked_at_ms;
    // Another compose file than the one that the quote measures.
    let report = changed(|value| {
        let info = &mut value["gateway_attestation"]["info"];
        let compose = info["tcb_info"]["app_compose"].as_str().unwrap().replacen("services:", "services: ", 1);
        info["tcb_info"]["app_compose"] = Value::from(compose);
    })
    .unwrap();
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "gateway: compose_hash");

    // A changed MRCONFIGID in the quote: Intel's signature no longer holds.
    let mut report = self::report();
    let mr_config_id = 48 + 16 + 48 + 48 + 8 + 8 + 8 + 48;
    report.gateway.quote[mr_config_id + 1] ^= 1;
    let detail = not_attested(check_at(&report, &NONCE, at));
    assert!(detail.starts_with("gateway: quote: "), "{detail}");
}

#[test]
fn a_wrong_model_fails() {
    let result = changed(|value| value["model_attestations"][0]["model_name"] = Value::from("openai/whisper-tiny"));
    assert_eq!(result, Err(Failure::NotAttested("model: name".into())));
    let result = changed(|value| value["model_attestations"] = Value::Array(Vec::new()));
    assert_eq!(result, Err(Failure::NotAttested("model: name".into())));
}

#[test]
fn a_wrong_key_fails() {
    let at = recorded().checked_at_ms;
    let other_key = "11".repeat(32);

    // The gateway names another key than the pinned one.
    let report =
        changed(|value| value["gateway_attestation"]["signing_address"] = Value::from(other_key.clone())).unwrap();
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "gateway: key_not_pinned");

    // Another key signs the OHTTP key configuration.
    let report = changed(|value| value["ohttp_attestation"]["signing_key"] = Value::from(other_key.clone())).unwrap();
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "ohttp: signer_not_gateway");

    // Another OHTTP key than the one that the gateway key signed.
    let mut report = self::report();
    report.key_config[10] ^= 1;
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "ohttp: bad_signature");
    let mut report = self::report();
    report.key_config_signature[0] ^= 1;
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "ohttp: bad_signature");

    // The model names another key than the one that its quote binds.
    let report = changed(|value| value["model_attestations"][0]["signing_address"] = Value::from(other_key)).unwrap();
    assert_eq!(not_attested(check_at(&report, &NONCE, at)), "model: report_data_key");

    // An ecdsa report is not read.
    let result = changed(|value| value["gateway_attestation"]["signing_algo"] = Value::from("ecdsa"));
    assert_eq!(result, Err(Failure::NotAttested("gateway: signing_algo".into())));
}

#[test]
fn changed_collateral_fails() {
    let report = report();
    let mut recorded = recorded();
    let platforms = platforms(&report);
    let requests = collateral_requests(&platforms);
    // One changed byte of the gateway's TCB info: Intel's signature fails.
    let (_, tcb) = recorded.replies.iter_mut().find(|(url, _)| url.contains("fmspc=70A06D070000")).unwrap();
    let text = String::from_utf8(tcb.body.clone()).unwrap();
    tcb.body = text.replacen("\"tdxtcbcomponents\"", "\"tdxtcbcomponentz\"", 1).into_bytes();
    assert_ne!(tcb.body, text.as_bytes());
    let collaterals = collateral(&platforms, &requests, replies_for(&requests, &recorded)).unwrap();
    let detail = not_attested(check(&report, &NONCE, &collaterals[0], &collaterals[1], recorded.checked_at_ms));
    assert!(detail.starts_with("gateway: quote: "), "{detail}");
}

#[test]
fn no_answer_is_unavailable_not_a_failed_check() {
    assert_eq!(parse_report(503, b"{}"), Err(Failure::Unavailable("report: status_503".into())));
    let report = report();
    let recorded = recorded();
    let platforms = platforms(&report);
    let requests = collateral_requests(&platforms);
    let mut replies = replies_for(&requests, &recorded);
    replies[1] = Err("timeout".into());
    assert!(matches!(collateral(&platforms, &requests, replies), Err(Failure::Unavailable(_))));
    let mut replies = replies_for(&requests, &recorded);
    replies[0].as_mut().unwrap().status = 500;
    assert_eq!(
        collateral(&platforms, &requests, replies).err(),
        Some(Failure::Unavailable("intel: status_500".into()))
    );
}

#[test]
fn the_report_binds_the_pinned_key_and_the_nonce() {
    let report = report();
    assert_eq!(hex(&report.gateway.key), "40599fb284f43953bb356b09080fd803c960fc10285ad90eca462ca711ad4acb");
    assert_eq!(report.key_config_signer, report.gateway.key);
    // TD report body starts after the 48-byte header; report_data is its
    // last 64 bytes of the 584-byte TD 1.0 report.
    assert_eq!(report.gateway.quote[48 + 520..48 + 552], report.gateway.key);
    assert_eq!(report.gateway.quote[48 + 552..48 + 584], NONCE);
}
