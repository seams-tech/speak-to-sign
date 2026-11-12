//! The word model: a Whisper large-v3 model behind an OpenAI-style
//! `/audio/transcriptions` route. The build picks the service
//! ([`PROVIDER`]):
//!
//! - default, [`NEAR_AI`]: `openai/whisper-large-v3` on NEAR AI Cloud, over
//!   Oblivious HTTP. The whole HTTP request, with the API key, is sealed to
//!   the OHTTP key of the NEAR AI gateway that `nearai_attestation` checked,
//!   and goes to [`NEAR_AI_OHTTP_URL`]. So only that TDX VM opens the audio,
//!   and a reply that opens came from it, for this request.
//! - feature `venice`, [`VENICE`]: `fal-ai/wizper` on Venice AI, over plain
//!   HTTPS. It is the fallback for a NEAR AI Whisper outage. Venice gives no
//!   TEE quote, so nothing is checked: Venice can read the audio. The build
//!   writes `<version>+venice` in every signed output.
//!
//! The request holds only the audio and the fields `model` and `language`.
//! It never holds the expected text or a prompt. Neither service signs a
//! transcription.
use serde::Deserialize;

use crate::config::{
    NEAR_AI_API_KEY_ENV, NEAR_AI_LANGUAGE, NEAR_AI_MAX_RESPONSE_BYTES, NEAR_AI_MODEL, NEAR_AI_OHTTP_URL,
    NEAR_AI_TIMEOUT_SECS, NEAR_AI_TRANSCRIPTIONS_URL, VENICE_API_KEY_ENV, VENICE_MODEL, VENICE_TIMEOUT_SECS,
    VENICE_TRANSCRIPTIONS_URL,
};
use crate::digest::{hex, sha256};
use crate::host::PostRequest;
use crate::ohttp::{bhttp_request, bhttp_response, seal_request, KeyConfig, ResponseOpener};

/// One speech-to-text service.
#[derive(Debug, PartialEq, Eq)]
pub struct Provider {
    /// The transcription route (for NEAR AI: the route inside the sealed
    /// request).
    pub url: &'static str,
    pub model: &'static str,
    /// The OutLayer secret (an environment variable) with its API key.
    pub api_key_env: &'static str,
    pub timeout_secs: u64,
    /// True: the request goes sealed to a gateway whose TDX quote the worker
    /// checked. False: plain HTTPS, and no check.
    pub attested: bool,
}

pub const NEAR_AI: Provider = Provider {
    url: NEAR_AI_TRANSCRIPTIONS_URL,
    model: NEAR_AI_MODEL,
    api_key_env: NEAR_AI_API_KEY_ENV,
    timeout_secs: NEAR_AI_TIMEOUT_SECS,
    attested: true,
};

pub const VENICE: Provider = Provider {
    url: VENICE_TRANSCRIPTIONS_URL,
    model: VENICE_MODEL,
    api_key_env: VENICE_API_KEY_ENV,
    timeout_secs: VENICE_TIMEOUT_SECS,
    attested: false,
};

// Only the NEAR AI path has a checked gateway.
const _: () = assert!(NEAR_AI.attested && !VENICE.attested);

/// The service of this build.
pub const PROVIDER: &Provider = if cfg!(feature = "venice") { &VENICE } else { &NEAR_AI };

/// `multipart/form-data` with exactly the fields `model`, `language` and
/// `file`. The boundary comes from the WAV digest, so it is deterministic
/// and is not in the body. Returns (content type, body).
fn multipart_body(model: &str, wav: &[u8]) -> (String, Vec<u8>) {
    let boundary = format!("seams{}", hex(&sha256(wav)));
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in [("model", model), ("language", NEAR_AI_LANGUAGE)] {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// The transcription request as a Binary HTTP message: the POST to
/// [`NEAR_AI_TRANSCRIPTIONS_URL`] with the API key, the multipart body and
/// no model alias (so the gateway runs the named model).
pub fn transcription_message(api_key: &str, wav: &[u8]) -> Vec<u8> {
    let (content_type, body) = multipart_body(NEAR_AI.model, wav);
    let rest = NEAR_AI_TRANSCRIPTIONS_URL.strip_prefix("https://").expect("an https URL");
    let (authority, path) = rest.split_at(rest.find('/').expect("a path"));
    let headers = [
        ("authorization".to_string(), format!("Bearer {api_key}")),
        ("content-type".to_string(), content_type),
        ("x-no-aliasing".to_string(), "true".to_string()),
    ];
    bhttp_request("POST", authority, path, &headers, &body)
}

/// The POST to the OHTTP endpoint of NEAR AI, without the network: the
/// transcription request sealed to `config` with the host's `seed`, and
/// what opens its reply.
pub fn transcription_request(
    config: &KeyConfig,
    api_key: &str,
    wav: &[u8],
    seed: &[u8; 32],
) -> Result<(PostRequest, ResponseOpener), &'static str> {
    let sealed = seal_request(config, &transcription_message(api_key, wav), seed)?;
    let request = PostRequest {
        url: NEAR_AI_OHTTP_URL.to_string(),
        headers: vec![("Content-Type".to_string(), "message/ohttp-req".to_string())],
        body: sealed.body,
        timeout_secs: NEAR_AI_TIMEOUT_SECS,
        max_response_bytes: NEAR_AI_MAX_RESPONSE_BYTES,
    };
    Ok((request, sealed.opener))
}

/// The POST to a service with no checked gateway (Venice AI), over plain
/// HTTPS: the same form, with the API key in a header.
pub fn plain_request(provider: &Provider, api_key: &str, wav: &[u8]) -> PostRequest {
    let (content_type, body) = multipart_body(provider.model, wav);
    PostRequest {
        url: provider.url.to_string(),
        headers: vec![
            ("Authorization".to_string(), format!("Bearer {api_key}")),
            ("Content-Type".to_string(), content_type),
        ],
        body,
        timeout_secs: provider.timeout_secs,
        max_response_bytes: NEAR_AI_MAX_RESPONSE_BYTES,
    }
}

/// Why a reply gives no transcript.
#[derive(Debug, PartialEq, Eq)]
pub enum ReplyFault {
    /// NEAR AI did not answer, answered with an error, or gave no text.
    Unavailable(String),
    /// The gateway could not open the request (status 400), or the reply
    /// was not sealed for this request: the binding to the checked gateway
    /// failed.
    NotAttested(String),
}

/// Reads the reply of the OHTTP endpoint: status 200, a body that `opener`
/// opens, a Binary HTTP response, and in it a reply that [`parse_reply`]
/// accepts.
pub fn open_reply(status: u16, body: &[u8], opener: &ResponseOpener) -> Result<String, ReplyFault> {
    match status {
        200 => {}
        400 => return Err(ReplyFault::NotAttested("ohttp: status_400".into())),
        _ => return Err(ReplyFault::Unavailable(format!("ohttp: status_{status}"))),
    }
    let opened =
        opener.open(body).ok_or_else(|| ReplyFault::NotAttested("ohttp: not_sealed_for_this_request".into()))?;
    let (inner, content) =
        bhttp_response(&opened).map_err(|error| ReplyFault::Unavailable(format!("bhttp: {error}")))?;
    parse_reply(inner, &content).map_err(ReplyFault::Unavailable)
}

/// Reads a reply: status 200 and a JSON object whose `text` is a string with
/// a character that is not white space. Other fields (Venice adds
/// `duration`) are ignored.
pub fn parse_reply(status: u16, body: &[u8]) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Reply {
        text: Option<String>,
    }
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let reply: Reply = serde_json::from_slice(body).map_err(|_| "bad_reply".to_string())?;
    let text = reply.text.ok_or("bad_reply")?;
    if text.trim().is_empty() {
        return Err("no_text".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_has_only_the_three_fields_and_the_key() {
        let wav = b"RIFF0000WAVEfake".to_vec();
        let message = transcription_message("sk-test", &wav);
        let text = String::from_utf8_lossy(&message);
        assert!(text.starts_with("\0\u{4}POST\u{5}https\u{11}cloud-api.near.ai\u{18}/v1/audio/transcriptions"));
        assert!(text.contains("authorization\u{e}Bearer sk-test"));
        assert!(text.contains("x-no-aliasing\u{4}true"));
        assert_eq!(text.matches("Content-Disposition").count(), 3);
        assert!(text.contains("openai/whisper-large-v3"));
        assert!(!text.contains("prompt"));
        assert!(message.windows(wav.len()).any(|window| window == wav));
    }

    #[test]
    fn the_post_holds_only_ciphertext() {
        use hpke::{Kem, Serializable};
        let (_, public) = hpke::kem::X25519HkdfSha256::derive_keypair(b"gateway");
        let config = KeyConfig { key_id: 1, public_key: public.to_bytes().into() };
        let wav = b"RIFF0000WAVEfake".to_vec();
        let (request, _) = transcription_request(&config, "sk-test", &wav, &[3; 32]).unwrap();
        assert_eq!(request.url, "https://cloud-api.near.ai/ohttp");
        assert_eq!(request.headers, [("Content-Type".to_string(), "message/ohttp-req".to_string())]);
        assert!(!request.body.windows(wav.len()).any(|window| window == wav));
        assert!(!request.body.windows(7).any(|window| window == b"sk-test"));
    }

    #[test]
    fn venice_request_is_plain_and_names_wizper() {
        let wav = b"RIFF0000WAVEfake".to_vec();
        let request = plain_request(&VENICE, "vk-test", &wav);
        assert_eq!(request.url, "https://api.venice.ai/api/v1/audio/transcriptions");
        assert_eq!(request.headers.len(), 2);
        assert_eq!(request.headers[0], ("Authorization".into(), "Bearer vk-test".into()));
        let text = String::from_utf8_lossy(&request.body);
        assert_eq!(text.matches("Content-Disposition").count(), 3);
        assert!(text.contains("name=\"model\"\r\n\r\nfal-ai/wizper\r\n"));
        assert!(text.contains("name=\"language\"\r\n\r\nen\r\n"));
        assert!(!text.contains("prompt"));
        assert!(request.body.windows(wav.len()).any(|window| window == wav));
    }

    #[test]
    fn this_build_uses_its_provider() {
        assert_eq!(PROVIDER, if cfg!(feature = "venice") { &VENICE } else { &NEAR_AI });
    }

    #[test]
    fn replies() {
        assert_eq!(
            parse_reply(200, br#"{"text":" Send 25 NEAR to alice.testnet."}"#).unwrap(),
            " Send 25 NEAR to alice.testnet."
        );
        assert_eq!(parse_reply(503, br#"{"text":"hi"}"#), Err("status_503".into()));
        assert_eq!(parse_reply(200, br#"{"text":"  "}"#), Err("no_text".into()));
        assert_eq!(parse_reply(200, br#"{"text":null}"#), Err("bad_reply".into()));
        assert_eq!(parse_reply(200, b"not json"), Err("bad_reply".into()));
        // The Venice reply of 2026-11-12, with its extra field.
        assert_eq!(
            parse_reply(
                200,
                br#"{"text":"Approve proposal 3. Send 0.1 near to seams-faucet.testnet.","duration":5.047}"#
            )
            .unwrap(),
            "Approve proposal 3. Send 0.1 near to seams-faucet.testnet."
        );
    }
}
