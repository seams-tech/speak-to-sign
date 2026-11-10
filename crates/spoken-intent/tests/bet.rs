//! Checks of the market bet: its sentence, its digest, its near misses and
//! the transcripts that Whisper writes for it.

pub mod support;

use spoken_intent::{
    confusion_set, normalize_punctuated, render, request_digest, spoken_text, BetOutcomeV1,
    Network, SpokenRequestV1, UnsupportedReason, UsdcAmount,
};
use support::near_account;

fn bet(market_id: u64, outcome: BetOutcomeV1, units: u128) -> SpokenRequestV1 {
    SpokenRequestV1::MarketBet {
        network: Network::Testnet,
        owner: near_account("owner.testnet"),
        market: near_account("pm-notes.testnet"),
        token: near_account("usdc.testnet"),
        market_id,
        outcome,
        amount: UsdcAmount::from_units(units).expect("speakable"),
    }
}

#[test]
fn a_bet_renders_its_amount_outcome_and_market() {
    let cases = [
        (9, BetOutcomeV1::Yes, 500_000, "Bet 0.5 USDC yes on market 9", "bet zero point five usdc yes on market nine"),
        (12, BetOutcomeV1::No, 1_000_000, "Bet 1 USDC no on market 12", "bet one usdc no on market twelve"),
        (9, BetOutcomeV1::Yes, 100_000, "Bet 0.1 USDC yes on market 9", "bet zero point one usdc yes on market nine"),
        (1_001, BetOutcomeV1::No, 1_250_750_000, "Bet 1,250.75 USDC no on market 1001", "bet one thousand two hundred fifty point seven five usdc no on market one thousand one"),
    ];
    for (market_id, outcome, units, display, spoken) in cases {
        let rendered = render(&bet(market_id, outcome, units));
        assert_eq!(rendered.display_text, display);
        assert_eq!(rendered.spoken_text, spoken);
    }
}

#[test]
fn a_usdc_amount_is_a_whole_multiple_of_a_cent() {
    assert_eq!(UsdcAmount::from_units(10_000).map(UsdcAmount::hundredths), Ok(1));
    assert_eq!(UsdcAmount::from_units(500_000).map(UsdcAmount::units), Ok(500_000));
    for units in [0, 1, 9_999, 10_001, 1_000_000_010_000, u128::MAX] {
        assert_eq!(UsdcAmount::from_units(units), Err(UnsupportedReason::AmountNotSpeakable));
    }
    // Borsh writes the base units, and refuses a value that has no spoken form.
    let amount = UsdcAmount::from_hundredths(50).expect("speakable");
    assert_eq!(borsh::to_vec(&amount).expect("borsh"), 500_000u128.to_le_bytes());
    assert!(borsh::from_slice::<UsdcAmount>(&1u128.to_le_bytes()).is_err());
}

#[test]
fn the_digest_binds_every_field() {
    let base = bet(9, BetOutcomeV1::Yes, 500_000);
    let mut others = vec![
        bet(8, BetOutcomeV1::Yes, 500_000),
        bet(9, BetOutcomeV1::No, 500_000),
        bet(9, BetOutcomeV1::Yes, 510_000),
    ];
    let with = |change: fn(&mut SpokenRequestV1)| {
        let mut request = bet(9, BetOutcomeV1::Yes, 500_000);
        change(&mut request);
        request
    };
    others.push(with(|request| {
        if let SpokenRequestV1::MarketBet { owner, .. } = request {
            *owner = near_account("other.testnet");
        }
    }));
    others.push(with(|request| {
        if let SpokenRequestV1::MarketBet { market, .. } = request {
            *market = near_account("other-market.testnet");
        }
    }));
    others.push(with(|request| {
        if let SpokenRequestV1::MarketBet { token, .. } = request {
            *token = near_account("other-token.testnet");
        }
    }));
    others.push(with(|request| {
        if let SpokenRequestV1::MarketBet { network, .. } = request {
            *network = Network::Mainnet;
        }
    }));
    let digest = request_digest(&base);
    for other in &others {
        assert_ne!(request_digest(other), digest);
    }
    assert_eq!(request_digest(&bet(9, BetOutcomeV1::Yes, 500_000)), digest);
}

#[test]
fn the_near_misses_hold_the_other_outcome_amounts_and_markets() {
    let request = bet(9, BetOutcomeV1::Yes, 500_000);
    let misses: Vec<String> = confusion_set(&request, &[]).iter().map(|tokens| spoken_text(tokens)).collect();
    for expected in [
        "bet zero point five usdc no on market nine",
        "bet five usdc yes on market nine",
        "bet fifty usdc yes on market nine",
        "bet zero point zero five usdc yes on market nine",
        "bet zero point six usdc yes on market nine",
        "bet zero point five usdc yes on market eight",
        "bet zero point five usdc yes on market ten",
        "bet zero point five usdc no on market eight",
        "bet not zero point five usdc yes on market nine",
        "cancel zero point five usdc yes on market nine",
        "sell zero point five usdc yes on market nine",
    ] {
        assert!(misses.iter().any(|miss| miss == expected), "no near miss: {expected}");
    }
    let own = render(&request).spoken_text;
    assert!(misses.iter().all(|miss| *miss != own));
    // Market ids start at 1.
    let first = confusion_set(&bet(1, BetOutcomeV1::Yes, 500_000), &[]);
    assert!(first.iter().all(|tokens| !spoken_text(tokens).ends_with("market zero")));
}

/// Transcripts that Whisper large-v3 wrote for a spoken bet (10 Nov 2026).
#[test]
fn whisper_transcripts_normalize_to_the_spoken_text() {
    let cases = [
        (" Bet 0.5 USDC yes on market 9.", bet(9, BetOutcomeV1::Yes, 500_000)),
        (" Bet 1 USDC no on market 12.", bet(12, BetOutcomeV1::No, 1_000_000)),
        ("Bet 0.1 USDC Yes on Market 9", bet(9, BetOutcomeV1::Yes, 100_000)),
    ];
    for (transcript, request) in cases {
        let tokens = normalize_punctuated(transcript, &[]).expect("normalizable");
        assert_eq!(spoken_text(&tokens), render(&request).spoken_text, "{transcript}");
    }
    // A dollar sign has no spoken form, so the unit word is "usdc".
    assert!(normalize_punctuated("Bet $0.5 yes on market 9.", &[]).is_err());
}
