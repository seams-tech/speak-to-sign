//! The NEAR AI attestation check against the live services, and the
//! recorder of its test data.
//!
//! With `SEAMS_NEAR_AI_LIVE=1`, a check with a fresh nonce, with the times:
//!
//! ```sh
//! SEAMS_NEAR_AI_LIVE=1 cargo test --release --test nearai_attestation_live -- --nocapture
//! ```
//!
//! With `SEAMS_NEAR_AI_RECORD=1`, it writes `testdata/nearai_report_v1.json`
//! and `testdata/nearai_collateral_v1.json`: a report for the nonce of the
//! fake host (32 bytes of 0x5a) and Intel's replies, for the offline tests.
//! It needs `curl`. No API key.
use std::io::Read;
use std::process::Command;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use seams_voice_verifier::host::{GetRequest, Reply};
use seams_voice_verifier::nearai_attestation::{
    check, collateral, collateral_requests, parse_report, platform, report_request,
};

fn get(request: &GetRequest) -> Reply {
    let dir = std::env::temp_dir().join(format!("nearai-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (body, headers) = (dir.join("body"), dir.join("headers"));
    let output = Command::new("curl")
        .args(["-sS", "-m", "30", "-D"])
        .arg(&headers)
        .arg("-o")
        .arg(&body)
        .args(["-w", "%{http_code}", &request.url])
        .output()
        .expect("curl");
    let status = String::from_utf8_lossy(&output.stdout).trim().parse().unwrap();
    let header_text = std::fs::read_to_string(&headers).unwrap_or_default();
    let headers = header_text
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect();
    Reply { status, headers, body: std::fs::read(&body).unwrap() }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

#[test]
fn the_live_gateway_passes_the_check() {
    let record = std::env::var("SEAMS_NEAR_AI_RECORD").is_ok();
    if std::env::var("SEAMS_NEAR_AI_LIVE").is_err() && !record {
        eprintln!("skipped: set SEAMS_NEAR_AI_LIVE=1 or SEAMS_NEAR_AI_RECORD=1");
        return;
    }
    let nonce: [u8; 32] = if record {
        [0x5a; 32]
    } else {
        let mut nonce = [0u8; 32];
        std::fs::File::open("/dev/urandom").unwrap().read_exact(&mut nonce).unwrap();
        nonce
    };
    let started = Instant::now();
    let report_reply = get(&report_request(&nonce));
    let report_ms = started.elapsed().as_millis();
    let report = parse_report(report_reply.status, &report_reply.body).unwrap();
    let platforms = [platform(&report.gateway.quote).unwrap(), platform(&report.model.quote).unwrap()];
    eprintln!("platforms: {platforms:?}");
    let requests = collateral_requests(&platforms);
    let fetched = Instant::now();
    let replies: Vec<Reply> = requests.iter().map(get).collect();
    let collateral_ms = fetched.elapsed().as_millis();
    let checked_at_ms = now_ms();
    let checked = Instant::now();
    let collaterals = collateral(&platforms, &requests, replies.iter().cloned().map(Ok).collect()).unwrap();
    let gateway = check(&report, &nonce, &collaterals[0], &collaterals[1], checked_at_ms).unwrap();
    eprintln!(
        "report {report_ms} ms, collateral {collateral_ms} ms (sequential), check {} ms: {gateway:?}",
        checked.elapsed().as_millis()
    );
    if record {
        let testdata = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata");
        std::fs::write(testdata.join("nearai_report_v1.json"), &report_reply.body).unwrap();
        let replies: Vec<Value> = requests
            .iter()
            .zip(&replies)
            .map(|(request, reply)| {
                let headers: Vec<Value> = reply
                    .headers
                    .iter()
                    .filter(|(name, _)| name.to_ascii_lowercase().contains("issuer-chain"))
                    .map(|(name, value)| json!([name, value]))
                    .collect();
                json!({ "url": request.url, "status": reply.status, "headers": headers, "body_b64": STANDARD.encode(&reply.body) })
            })
            .collect();
        let recorded = json!({
            "about": "Intel PCS replies for the quotes of nearai_report_v1.json, from tests/nearai_attestation_live.rs",
            "nonce_hex": "5a".repeat(32),
            "checked_at_ms": checked_at_ms,
            "replies": replies,
        });
        std::fs::write(
            testdata.join("nearai_collateral_v1.json"),
            serde_json::to_string_pretty(&recorded).unwrap() + "\n",
        )
        .unwrap();
        eprintln!("recorded");
    }
}
