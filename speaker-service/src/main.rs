//! The HTTP server. Environment:
//! - `SPEAKER_LISTEN`: listen address, default `0.0.0.0:8080`.
//! - `SPEAKER_MODEL_PATH`: default `/app/redimnet-b1.onnx`.
//! - `DSTACK_SOCKET`: default `/var/run/dstack.sock`.
//! - `SPEAKER_DEV_KEY_HEX`: a 32-byte ed25519 seed for a run outside a CVM. If
//!   it is set, the service does not call the guest agent, and
//!   `/v1/attestation` has no quote (`"dev": true`).
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{OnceCell, Semaphore};

use seams_speaker_service::dstack::{self, Client};
use seams_speaker_service::model::Model;
use seams_speaker_service::{
    decode_wav, embed_message, embedding_bytes, model_sha256, parse_nonce, report_data, sha256, KEY_DOMAIN,
    MODEL_SHA256,
};

/// An 8 s WAV is 256,044 bytes, so 342 KB in base64.
const MAX_BODY_BYTES: usize = 512 * 1024;

struct Service {
    model: Model,
    key: SigningKey,
    public_key: [u8; 32],
    /// The GetKey signature chain (hex links), empty in dev mode.
    signature_chain: Vec<String>,
    /// `None` in dev mode.
    agent: Option<Client>,
    attestation: OnceCell<Value>,
    /// One model run per CPU at a time; more requests wait.
    runs: Semaphore,
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

#[derive(Deserialize)]
struct EmbedRequest {
    audio_wav_b64: String,
    nonce: String,
}

async fn embed(State(service): State<Arc<Service>>, body: axum::body::Bytes) -> Response {
    let started = Instant::now();
    let Ok(request) = serde_json::from_slice::<EmbedRequest>(&body) else {
        return error(StatusCode::BAD_REQUEST, "bad_json");
    };
    let Ok(nonce) = parse_nonce(&request.nonce) else {
        return error(StatusCode::BAD_REQUEST, "bad_nonce");
    };
    let Ok(wav) = base64::engine::general_purpose::STANDARD.decode(request.audio_wav_b64.trim()) else {
        return error(StatusCode::BAD_REQUEST, "bad_base64");
    };
    let audio_digest = sha256(&wav);
    let samples = match decode_wav(&wav) {
        Ok(samples) => samples,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };

    let Ok(_permit) = service.runs.acquire().await else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "shutting_down");
    };
    let model_started = Instant::now();
    let worker = service.clone();
    let embedding = match tokio::task::spawn_blocking(move || worker.model.embed(&samples)).await {
        Ok(Ok(embedding)) => embedding,
        Ok(Err(cause)) => {
            eprintln!("embed: {cause:#}");
            return error(StatusCode::UNPROCESSABLE_ENTITY, "model_failed");
        }
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "model_panicked"),
    };
    let model_ms = model_started.elapsed().as_millis() as u64;

    let embedding_le = embedding_bytes(&embedding);
    let message = embed_message(&audio_digest, &nonce, &model_sha256(), &embedding_le);
    let signature = service.key.sign(&message);
    let b64 = base64::engine::general_purpose::STANDARD;
    Json(json!({
        "embedding_b64": b64.encode(&embedding_le),
        "audio_digest": hex::encode(audio_digest),
        "model_sha256": MODEL_SHA256,
        "nonce": hex::encode(nonce),
        "public_key": hex::encode(service.public_key),
        "signature": hex::encode(signature.to_bytes()),
        // Not signed: timing for the latency probe.
        "model_ms": model_ms,
        "total_ms": started.elapsed().as_millis() as u64,
    }))
    .into_response()
}

async fn attestation(State(service): State<Arc<Service>>) -> Response {
    let data = report_data(&service.public_key, &model_sha256());
    let base = json!({
        "public_key": hex::encode(service.public_key),
        "model_sha256": MODEL_SHA256,
        "report_data": hex::encode(data),
        "key_domain": KEY_DOMAIN,
        "key_algorithm": "ed25519",
        "signature_chain": service.signature_chain,
    });
    let Some(agent) = &service.agent else {
        let mut value = base;
        value["quote"] = Value::Null;
        value["dev"] = json!(true);
        return Json(value).into_response();
    };
    // One attestation for the life of the process: report_data is fixed.
    let result = service
        .attestation
        .get_or_try_init(|| async {
            let attestation = agent.attest(&data).await?;
            let quote = dstack::quote_from_attestation(&attestation);
            let mut value = base.clone();
            value["quote"] = quote.map_or(Value::Null, |quote| json!(hex::encode(quote)));
            value["attestation"] = json!(hex::encode(&attestation));
            value["dev"] = json!(false);
            anyhow::Ok(value)
        })
        .await;
    match result {
        Ok(value) => Json(value.clone()).into_response(),
        Err(cause) => {
            eprintln!("attest: {cause:#}");
            error(StatusCode::SERVICE_UNAVAILABLE, "attest_failed")
        }
    }
}

async fn key(agent: Option<&Client>) -> anyhow::Result<(SigningKey, Vec<String>)> {
    if let Ok(text) = std::env::var("SPEAKER_DEV_KEY_HEX") {
        let mut seed = [0; 32];
        hex::decode_to_slice(text.trim(), &mut seed)
            .map_err(|_| anyhow::anyhow!("SPEAKER_DEV_KEY_HEX is not 64 hex characters"))?;
        return Ok((SigningKey::from_bytes(&seed), Vec::new()));
    }
    let agent = agent.expect("an agent outside dev mode");
    let reply = agent.get_ed25519_key(KEY_DOMAIN).await?;
    let seed: [u8; 32] = reply.key.as_slice().try_into()?;
    let key = SigningKey::from_bytes(&seed);
    if key.verifying_key().as_bytes()[..] != reply.public_key[..] {
        anyhow::bail!("GetKey: the public key is not the key of the returned seed");
    }
    Ok((key, reply.signature_chain))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let listen = std::env::var("SPEAKER_LISTEN").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let model_path = std::env::var("SPEAKER_MODEL_PATH").unwrap_or_else(|_| "/app/redimnet-b1.onnx".into());
    let dev = std::env::var_os("SPEAKER_DEV_KEY_HEX").is_some();
    let agent = (!dev).then(|| Client::new(std::env::var("DSTACK_SOCKET").unwrap_or_else(|_| dstack::DEFAULT_SOCKET.into())));

    let started = Instant::now();
    let model = tokio::task::spawn_blocking(move || Model::load(&model_path)).await??;
    let load_ms = started.elapsed().as_millis();
    let (key, signature_chain) = key(agent.as_ref()).await?;
    let public_key = key.verifying_key().to_bytes();
    let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
    eprintln!(
        "speaker-service: model {MODEL_SHA256} plan_ms={load_ms} public_key={} dev={dev} runs={cpus} listen={listen}",
        hex::encode(public_key)
    );

    let service = Arc::new(Service {
        model,
        key,
        public_key,
        signature_chain,
        agent,
        attestation: OnceCell::new(),
        runs: Semaphore::new(cpus),
    });
    let app = Router::new()
        .route("/v1/embed", post(embed))
        .route("/v1/attestation", get(attestation))
        .route("/healthz", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(service);
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
