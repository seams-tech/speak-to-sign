//! `verify` of a market bet.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use seams_voice_verifier::digest::b64u;

use crate::fake::{clip, spoken, OWNER};

const MARKET: &str = "pm-notes.testnet";
const TOKEN: &str = "usdc.testnet";

fn bet_input(wav: &[u8], market_id: u64, outcome: &str, amount_units: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "market_bet",
            "market": MARKET,
            "token": TOKEN,
            "market_id": market_id,
            "outcome": outcome,
            "amount_units": amount_units,
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

#[test]
fn verify_accepts_a_spoken_bet_with_exact_words() {
    use spoken_intent::{request_digest, BetOutcomeV1, NearAccount, Network, SpokenRequestV1, UsdcAmount};
    let wav = clip(0.03);
    // What Whisper wrote for the spoken sentence.
    let (result, verdict) = spoken(bet_input(&wav, 9, "yes", "500000"), " Bet 0.5 USDC yes on market 9.");
    assert_eq!(result, "accept");
    assert_eq!(verdict.heard.as_deref(), Some("bet zero point five usdc yes on market nine"));
    let request = SpokenRequestV1::MarketBet {
        network: Network::Testnet,
        owner: NearAccount::new(OWNER).unwrap(),
        market: NearAccount::new(MARKET).unwrap(),
        token: NearAccount::new(TOKEN).unwrap(),
        market_id: 9,
        outcome: BetOutcomeV1::Yes,
        amount: UsdcAmount::from_units(500_000).unwrap(),
    };
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    assert_eq!(spoken(bet_input(&wav, 12, "no", "1000000"), "Bet 1 USDC no on market 12.").0, "accept");
    // Another outcome, amount or market, a negation or a missing word: refused.
    for transcript in [
        "Bet 0.5 USDC no on market 9.",
        "Bet 5 USDC yes on market 9.",
        "Bet 0.05 USDC yes on market 9.",
        "Bet 0.5 USDC yes on market 8.",
        "Bet 0.5 USDC yes on market 19.",
        "Do not bet 0.5 USDC yes on market 9.",
        "Bet 0.5 USDC yes.",
        "Bet 0.5 yes on market 9.",
        "Cancel 0.5 USDC yes on market 9.",
    ] {
        assert_eq!(spoken(bet_input(&wav, 9, "yes", "500000"), transcript).0, "words", "{transcript}");
    }
}

#[test]
fn bet_inputs_that_are_not_speakable_are_unsupported() {
    let wav = clip(0.03);
    // Not a whole cent, zero, above the range, not decimal digits.
    for units in ["1", "0", "500001", "1000000010000", "-500000", "5e5", ""] {
        assert_eq!(spoken(bet_input(&wav, 9, "yes", units), "anything").0, "unsupported", "{units}");
    }
    assert_eq!(spoken(bet_input(&wav, 0, "yes", "500000"), "anything").0, "unsupported");
    let mut bad_outcome = bet_input(&wav, 9, "yes", "500000");
    bad_outcome["request"]["outcome"] = json!("maybe");
    assert_eq!(spoken(bad_outcome, "anything").0, "unsupported");
    let mut bad_market = bet_input(&wav, 9, "yes", "500000");
    bad_market["request"]["market"] = json!("Not An Account");
    assert_eq!(spoken(bad_market, "anything").0, "unsupported");
    let mut extra = bet_input(&wav, 9, "yes", "500000");
    extra["request"]["receiver"] = json!("mallory.testnet");
    assert_eq!(spoken(extra, "anything").0, "unsupported");
}
