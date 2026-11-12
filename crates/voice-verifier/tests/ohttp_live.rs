//! A live transcription through the OHTTP endpoint of the NEAR AI gateway,
//! with the exact request of the worker, and the same request in plain
//! HTTPS for the time. It runs only with `SEAMS_NEAR_AI_LIVE=1`,
//! `NEAR_AI_API_KEY` and `SEAMS_WAV` (a WAV file):
//!
//! ```sh
//! SEAMS_NEAR_AI_LIVE=1 NEAR_AI_API_KEY=... SEAMS_WAV=clip.wav cargo test --test ohttp_live -- --nocapture
//! ```
//!
//! It needs `curl`. The key goes to `curl` only inside the sealed body or in
//! a header file, not in the arguments.
use std::io::Write;
use std::process::Command;
use std::time::Instant;

use seams_voice_verifier::ohttp::{bhttp_request, bhttp_response, seal_request, KeyConfig};

fn curl(args: &[&str]) -> (u16, Vec<u8>) {
    let dir = std::env::temp_dir().join(format!("ohttp-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("out");
    let output = Command::new("curl")
        .args(["-sS", "-m", "60", "-o"])
        .arg(&out)
        .args(["-w", "%{http_code}"])
        .args(args)
        .output()
        .expect("curl");
    let status = String::from_utf8_lossy(&output.stdout).trim().parse().unwrap_or(0);
    (status, std::fs::read(&out).unwrap_or_default())
}

#[test]
fn a_sealed_transcription_opens() {
    if std::env::var("SEAMS_NEAR_AI_LIVE").is_err() {
        eprintln!("skipped: set SEAMS_NEAR_AI_LIVE=1, NEAR_AI_API_KEY and SEAMS_WAV");
        return;
    }
    let key = std::env::var("NEAR_AI_API_KEY").expect("NEAR_AI_API_KEY");
    let wav = std::fs::read(std::env::var("SEAMS_WAV").expect("SEAMS_WAV")).expect("wav");
    let dir = std::env::temp_dir().join(format!("ohttp-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    let started = Instant::now();
    let (status, report) =
        curl(&["https://cloud-api.near.ai/v1/attestation/report?model=openai/whisper-large-v3&signing_algo=ed25519"]);
    eprintln!("report: status {status}, {} bytes, {} ms", report.len(), started.elapsed().as_millis());
    let report: serde_json::Value = serde_json::from_slice(&report).unwrap();
    let config_hex = report["ohttp_attestation"]["key_config"].as_str().unwrap();
    let config_bytes: Vec<u8> =
        (0..config_hex.len()).step_by(2).map(|at| u8::from_str_radix(&config_hex[at..at + 2], 16).unwrap()).collect();
    let config = KeyConfig::parse(&config_bytes).unwrap();

    let boundary = "seamslivetest";
    let mut body = Vec::new();
    for (name, value) in [("model", "openai/whisper-large-v3"), ("language", "en")] {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(&wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let headers = vec![
        ("authorization".to_string(), format!("Bearer {}", key.trim())),
        ("content-type".to_string(), format!("multipart/form-data; boundary={boundary}")),
        ("x-no-aliasing".to_string(), "true".to_string()),
    ];

    for round in 0..2 {
        let sealed_at = Instant::now();
        let message = bhttp_request("POST", "cloud-api.near.ai", "/v1/audio/transcriptions", &headers, &body);
        let seed: [u8; 32] = std::array::from_fn(|index| (index as u8) ^ (round as u8) ^ 0x5a);
        let sealed = seal_request(&config, &message, &seed).unwrap();
        let seal_ms = sealed_at.elapsed().as_micros();
        let file = dir.join("sealed");
        std::fs::write(&file, &sealed.body).unwrap();
        let posted = Instant::now();
        let (status, reply) = curl(&[
            "-X",
            "POST",
            "-H",
            "Content-Type: message/ohttp-req",
            "--data-binary",
            &format!("@{}", file.display()),
            "https://cloud-api.near.ai/ohttp",
        ]);
        let post_ms = posted.elapsed().as_millis();
        assert_eq!(status, 200, "{}", String::from_utf8_lossy(&reply));
        let opened = sealed.opener.open(&reply).expect("the response opens");
        let (inner, content) = bhttp_response(&opened).unwrap();
        eprintln!(
            "ohttp {round}: seal {seal_ms} us, post {post_ms} ms, inner {inner}: {}",
            String::from_utf8_lossy(&content)
        );
        assert_eq!(inner, 200);

        // The same request in plain HTTPS.
        let header_file = dir.join("headers");
        let mut writer = std::fs::File::create(&header_file).unwrap();
        for (name, value) in &headers {
            writeln!(writer, "{name}: {value}").unwrap();
        }
        let plain_file = dir.join("plain");
        std::fs::write(&plain_file, &body).unwrap();
        let posted = Instant::now();
        let (status, reply) = curl(&[
            "-X",
            "POST",
            "-H",
            &format!("@{}", header_file.display()),
            "--data-binary",
            &format!("@{}", plain_file.display()),
            "https://cloud-api.near.ai/v1/audio/transcriptions",
        ]);
        eprintln!(
            "plain {round}: post {} ms, status {status}: {}",
            posted.elapsed().as_millis(),
            String::from_utf8_lossy(&reply)
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}
