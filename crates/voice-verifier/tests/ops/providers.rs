//! The speech-to-text service of the build (see `src/transcriber.rs`): NEAR
//! AI by default, Venice AI with the feature `venice`. These tests run in
//! both builds.
use seams_voice_verifier::config::{NEAR_AI_API_KEY_ENV, SPEAKER_EMBED_URL, VENICE_API_KEY_ENV, VERIFIER_VERSION};

use crate::fake::{call, checked_verdict, clip, embedding, enrolled, outcome_name, verify_input, WORDS_URL};

const VENICE: bool = cfg!(feature = "venice");
/// The OutLayer secret with the API key of the build's service.
const WORDS_KEY_ENV: &str = if VENICE { VENICE_API_KEY_ENV } else { NEAR_AI_API_KEY_ENV };

#[test]
fn the_verdict_names_the_service_that_heard_the_words() {
    let mut fake = enrolled();
    fake.transcript = Some(" Send 2 NEAR to alice.testnet.".into());
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    fake.events.clear();
    let out = call(&mut fake, verify_input(&wav));
    let verdict = checked_verdict(&out);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(verdict.verifier, VERIFIER_VERSION);
    assert_eq!(verdict.verifier.ends_with("+venice"), VENICE);
    assert_eq!(fake.posts, [SPEAKER_EMBED_URL, WORDS_URL]);
    assert_eq!(WORDS_URL.contains("venice.ai"), VENICE);
    // Only the NEAR AI path has a checked gateway: its record and its stages.
    assert_eq!(fake.events.contains(&"worker_get"), !VENICE);
    assert_eq!(out["ms"]["tee"].is_u64(), !VENICE);
}

#[test]
fn the_words_need_the_key_of_the_build_s_service() {
    let mut fake = enrolled();
    fake.transcript = Some(" Send 2 NEAR to alice.testnet.".into());
    fake.secrets.remove(WORDS_KEY_ENV);
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    let out = call(&mut fake, verify_input(&wav));
    assert_eq!(outcome_name(&checked_verdict(&out)), "transcriber_unavailable");
    assert_eq!(out["detail"], "transcriber: no_api_key");
    assert!(fake.posts.is_empty());
}

/// The `venice` build needs the NEAR AI key only for a note (the summary
/// check) and for `detect` (the chat model), not for a transfer.
#[test]
fn a_transfer_needs_the_near_ai_key_only_in_the_near_ai_build() {
    let mut fake = enrolled();
    fake.transcript = Some(" Send 2 NEAR to alice.testnet.".into());
    fake.secrets.remove(NEAR_AI_API_KEY_ENV);
    let wav = clip(0.03);
    fake.voice(&wav, embedding(0, 0.3));
    let out = call(&mut fake, verify_input(&wav));
    let expected = if VENICE { "accept" } else { "transcriber_unavailable" };
    assert_eq!(outcome_name(&checked_verdict(&out)), expected, "{out}");
}
