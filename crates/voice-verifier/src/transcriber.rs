//! The word model: Whisper large-v3 on NEAR AI Cloud (plan Section 8.2).
//!
//! The request holds only the audio and the fields `model` and `language`.
//! It never holds the expected text or a prompt. NEAR AI is a trusted party
//! for the transcript: a transcription has no signature today.
use serde::Deserialize;

use crate::config::{
    NEAR_AI_LANGUAGE, NEAR_AI_MAX_RESPONSE_BYTES, NEAR_AI_MODEL, NEAR_AI_TIMEOUT_SECS, NEAR_AI_TRANSCRIPTIONS_URL,
};
use crate::digest::{hex, sha256};
use crate::host::PostRequest;

/// `multipart/form-data` with exactly the fields `model`, `language` and
/// `file`. The boundary comes from the WAV digest, so it is deterministic
/// and is not in the body. Returns (content type, body).
pub fn multipart_body(wav: &[u8]) -> (String, Vec<u8>) {
    let boundary = format!("seams{}", hex(&sha256(wav)));
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in [("model", NEAR_AI_MODEL), ("language", NEAR_AI_LANGUAGE)] {
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

/// The POST to NEAR AI, without the network.
pub fn transcription_request(api_key: &str, wav: &[u8]) -> PostRequest {
    let (content_type, body) = multipart_body(wav);
    PostRequest {
        url: NEAR_AI_TRANSCRIPTIONS_URL.to_string(),
        headers: vec![
            ("Authorization".to_string(), format!("Bearer {api_key}")),
            ("Content-Type".to_string(), content_type),
            // No model alias, so the gateway runs the named model.
            ("x-no-aliasing".to_string(), "true".to_string()),
        ],
        body,
        timeout_secs: NEAR_AI_TIMEOUT_SECS,
        max_response_bytes: NEAR_AI_MAX_RESPONSE_BYTES,
    }
}

/// Reads a reply: status 200 and a JSON object whose `text` is a string with
/// a character that is not white space.
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
        let request = transcription_request("sk-test", &wav);
        assert_eq!(request.url, "https://cloud-api.near.ai/v1/audio/transcriptions");
        assert_eq!(request.headers[0], ("Authorization".into(), "Bearer sk-test".into()));
        let text = String::from_utf8_lossy(&request.body);
        assert_eq!(text.matches("Content-Disposition").count(), 3);
        assert!(text.contains("openai/whisper-large-v3"));
        assert!(!text.contains("prompt"));
        assert!(request.body.windows(wav.len()).any(|window| window == wav));
    }

    #[test]
    fn replies() {
        assert_eq!(parse_reply(200, br#"{"text":" Send 25 NEAR to alice.testnet."}"#).unwrap(), " Send 25 NEAR to alice.testnet.");
        assert_eq!(parse_reply(503, br#"{"text":"hi"}"#), Err("status_503".into()));
        assert_eq!(parse_reply(200, br#"{"text":"  "}"#), Err("no_text".into()));
        assert_eq!(parse_reply(200, br#"{"text":null}"#), Err("bad_reply".into()));
        assert_eq!(parse_reply(200, b"not json"), Err("bad_reply".into()));
    }
}
