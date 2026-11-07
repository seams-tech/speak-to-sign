//! Gate 0 testnet probe. Input on stdin: {"op": "...", ...}. Output: one JSON
//! value on stdout.
//!
//! - echo: the caller identity the worker gives the guest.
//! - storage: set_if_absent(key) twice in the manifest's namespace.
//! - https: GET a URL (the manifest allows rpc.testnet.near.org only).
//! - big: an output of `bytes` bytes, to find the callback limit.
//! - fail: exit with status 1, so that the callback gets null.
//! - infer (models feature): ReDimNet and Aurora on `seconds` of audio.
use serde_json::{json, Value};
use std::time::Instant;

#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifests/probe.json").len()] =
    *include_bytes!("../manifests/probe.json");

fn main() {
    let input: Value = outlayer::env::input_json().ok().flatten().unwrap_or(Value::Null);
    let op = input.get("op").and_then(Value::as_str).unwrap_or("echo").to_string();
    let started = Instant::now();
    let result = match op.as_str() {
        "echo" => Ok(identity()),
        "storage" => storage(&input),
        "https" => https(&input),
        "big" => Ok(big(&input)),
        "fail" => std::process::exit(1),
        #[cfg(feature = "models")]
        "infer" => models::infer(&input),
        other => Err(format!("unknown op {other}")),
    };
    let mut output = match result {
        Ok(value) => json!({ "ok": true, "op": op, "result": value }),
        Err(error) => json!({ "ok": false, "op": op, "error": error }),
    };
    output["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
    outlayer::env::output_json(&output).expect("write output");
}

fn identity() -> Value {
    json!({
        "signer": outlayer::env::signer_account_id(),
        "predecessor": outlayer::env::predecessor_account_id(),
        "request_id": outlayer::env::request_id(),
        "block_height": outlayer::env::var("NEAR_BLOCK_HEIGHT"),
    })
}

fn storage(input: &Value) -> Result<Value, String> {
    let key = input.get("key").and_then(Value::as_str).ok_or("key missing")?;
    let first = outlayer::storage::set_if_absent(key, b"used").map_err(|error| error.to_string())?;
    let second = outlayer::storage::set_if_absent(key, b"used").map_err(|error| error.to_string())?;
    Ok(json!({ "key": key, "first_set": first, "second_set": second, "identity": identity() }))
}

fn https(input: &Value) -> Result<Value, String> {
    let url = input.get("url").and_then(Value::as_str).ok_or("url missing")?;
    let started = Instant::now();
    let response = wasi_http_client::Client::new().get(url).send().map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.body().map_err(|error| error.to_string())?;
    Ok(json!({ "url": url, "status": status, "body_bytes": body.len(), "ms": started.elapsed().as_millis() as u64 }))
}

fn big(input: &Value) -> Value {
    let bytes = input.get("bytes").and_then(Value::as_u64).unwrap_or(800) as usize;
    json!({ "padding": "x".repeat(bytes) })
}

#[cfg(feature = "models")]
mod models {
    use serde_json::{json, Value};
    use std::time::Instant;
    use tract_onnx::prelude::*;

    // The Wallet host already serves these files; the worker checks each
    // against its pinned SHA-256 before use.
    const HOST: &str = "https://test.sign.seams.sh/sdk/voiceid";
    const REDIMNET: (&str, &str) = ("redimnet-b1.onnx", "e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269");
    const AURORA: (&str, &str) = ("aurora-int8.onnx", "83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6");

    fn fetch((file, digest): (&str, &str)) -> Result<(Vec<u8>, u64), String> {
        use sha2::{Digest, Sha256};
        let started = Instant::now();
        let url = format!("{HOST}/{file}");
        let response = wasi_http_client::Client::new().get(&url).send().map_err(|error| format!("{file}: {error}"))?;
        if response.status() != 200 {
            return Err(format!("{file}: status {}", response.status()));
        }
        let body = response.body().map_err(|error| format!("{file}: {error}"))?;
        let actual: String = Sha256::digest(&body).iter().map(|byte| format!("{byte:02x}")).collect();
        if actual != digest {
            return Err(format!("{file}: digest {actual} is not the pinned digest"));
        }
        Ok((body, started.elapsed().as_millis() as u64))
    }

    pub fn infer(input: &Value) -> Result<Value, String> {
        let seconds = input.get("seconds").and_then(Value::as_f64).unwrap_or(8.0);
        let samples = (seconds * 16_000.0) as usize;
        let audio = synthetic_audio(samples);
        let (redimnet, redimnet_fetch_ms) = fetch(REDIMNET)?;
        let (aurora, aurora_fetch_ms) = fetch(AURORA)?;
        let speaker = run(&redimnet, samples, &audio, false).map_err(|error| format!("redimnet: {error:#}"))?;
        let words = run(&aurora, samples, &audio, true).map_err(|error| format!("aurora: {error:#}"))?;
        Ok(json!({
            "samples": samples,
            "fetch_ms": { "redimnet": redimnet_fetch_ms, "aurora": aurora_fetch_ms },
            "redimnet": speaker,
            "aurora": words,
        }))
    }

    fn run(bytes: &[u8], samples: usize, audio: &[f32], optimize: bool) -> TractResult<Value> {
        let started = Instant::now();
        let model = tract_onnx::onnx()
            .model_for_read(&mut &bytes[..])?
            .with_input_fact(0, f32::fact([1, samples]).into())?;
        // ReDimNet fails tract's declutter pass, so it runs the typed plan.
        let typed = if optimize { model.into_optimized()? } else { model.into_typed()? };
        let plan = typed.into_runnable()?;
        let load_ms = started.elapsed().as_millis() as u64;
        let input = tract_ndarray::Array2::from_shape_vec((1, samples), audio.to_vec())?;
        let run_started = Instant::now();
        let outputs = plan.run(tvec!(Tensor::from(input).into()))?;
        let values = outputs[0].to_plain_array_view::<f32>()?;
        let sum: f32 = values.iter().sum();
        Ok(json!({
            "load_ms": load_ms,
            "run_ms": run_started.elapsed().as_millis() as u64,
            "shape": outputs[0].shape(),
            "sum": sum,
        }))
    }

    fn synthetic_audio(samples: usize) -> Vec<f32> {
        let mut seed: u32 = 0x1234_5678;
        (0..samples)
            .map(|index| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let noise = (seed as f32 / u32::MAX as f32 - 0.5) * 0.05;
                let tone = (index as f32 * 220.0 * std::f32::consts::TAU / 16_000.0).sin() * 0.1;
                noise + tone
            })
            .collect()
    }
}
