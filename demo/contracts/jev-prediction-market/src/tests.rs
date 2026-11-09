use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseOrValue, PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
/// 1 USDC in base units.
const USDC: u128 = 1_000_000;
/// 10 USDC: the unit of most test amounts.
const TEN: u128 = 10 * USDC;
/// A unit count for the math tests: 10^6.
const UNIT: u128 = 1_000_000;
/// 10 Nov 2026, 12:00 UTC.
const T0: u64 = 1_794_312_000_000;
const HOUR: u64 = 60 * 60 * 1_000;
const QUESTION: &str = "Is this note accurate and helpful context for this post?";

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn contract_id() -> AccountId {
    account("pm-notes")
}

fn context(caller: &AccountId, at_ms: u64, deposit: u128, gas_tgas: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .block_timestamp(at_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(gas_tgas))
        .build()
}

/// Sets the next call: `who` at `at_ms` with `deposit` yoctoNEAR and 300 Tgas.
fn call(who: &str, at_ms: u64, deposit: u128) {
    testing_env!(context(&account(who), at_ms, deposit, 300));
}

/// Sets the next call as the OutLayer callback with one promise result.
fn as_callback(at_ms: u64, result: PromiseResult) {
    testing_env!(
        context(&contract_id(), at_ms, 0, 20),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn setup() -> PredictionMarkets {
    call("admin", T0, 0);
    // The mocked storage lives on between contracts in one test: start empty.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    call("admin", T0, 0);
    PredictionMarkets::new(account("admin"), Some(token()), None)
}

/// The test USDC contract.
fn token() -> AccountId {
    account("usdc")
}

/// `who` sends `amount` USDC with `ft_transfer_call` and `msg`: the token calls `ft_on_transfer`.
fn send(contract: &mut PredictionMarkets, who: &str, at_ms: u64, amount: u128, msg: Value) {
    testing_env!(context(&token(), at_ms, 0, 300));
    match contract.ft_on_transfer(account(who), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(unused) => assert_eq!(unused, U128(0), "ft_on_transfer uses all of the USDC"),
        PromiseOrValue::Promise(_) => panic!("ft_on_transfer returns a value"),
    }
}

fn create_msg(question: &str, context: Option<&str>, note_id: Option<u64>, closes_at_ms: u64) -> Value {
    json!({ "action": "create_market", "question": question, "context": context, "note_id": note_id, "closes_at_ms": closes_at_ms })
}

fn bet_msg(market_id: u64, outcome: &str) -> Value {
    json!({ "action": "bet", "market_id": market_id, "outcome": outcome })
}

/// `who` claims market 1 and gets the amount from the `claimed` event.
fn claim(contract: &mut PredictionMarkets, who: &str, at_ms: u64) -> u128 {
    call(who, at_ms, 0);
    let _ = contract.claim(1);
    let event = last_event();
    assert_eq!(event["event"], "claimed");
    event["data"][0]["amount"].as_str().unwrap().parse().unwrap()
}

/// Maya opens a market with a 10 USDC seed that closes after one hour.
fn open_market(contract: &mut PredictionMarkets) -> u64 {
    send(contract, "maya", T0, TEN, create_msg(QUESTION, Some("Note 2 on post 7"), Some(2), T0 + HOUR));
    contract.last_market_id
}

/// A bet on market 1. Returns the account's stake on that outcome.
fn bet(contract: &mut PredictionMarkets, who: &str, outcome: Outcome, amount: u128) -> u128 {
    let side = if outcome == Outcome::Yes { "yes" } else { "no" };
    send(contract, who, T0 + 1, amount, bet_msg(1, side));
    let stake = contract.stakes.get(&(1, account(who))).copied().unwrap();
    if outcome == Outcome::Yes { stake.yes } else { stake.no }
}

fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|json| serde_json::from_str(json).unwrap())
        .collect()
}

fn last_event() -> Value {
    events().pop().expect("an event")
}

fn answer(value: Value) -> PromiseResult {
    PromiseResult::Successful(value.to_string().into_bytes())
}

/// Closes market 1, requests a resolution as `who` and returns the request id.
fn request(contract: &mut PredictionMarkets, who: &str, at_ms: u64) -> u64 {
    call(who, at_ms, 50 * MILLI);
    let _ = contract.request_resolution(1);
    contract.markets.get(&1).unwrap().pending.as_ref().unwrap().request_id
}

fn stored(contract: &PredictionMarkets, id: u64) -> Market {
    contract.markets.get(&id).cloned().unwrap()
}

// --- parimutuel math ---

#[test]
fn the_odds_are_the_pool_split() {
    assert_eq!(yes_share_bps(3, 1), 7_500);
    assert_eq!(yes_share_bps(1, 2), 3_333);
    assert_eq!(yes_share_bps(0, 0), 5_000);
    assert_eq!(yes_share_bps(5, 0), 10_000);
}

#[test]
fn the_payout_shares_the_pool_by_the_weight() {
    // Pools 3 YES and 1 NO (T = 4), JEV says 72%: YES bets share 2.88, NO bets share 1.12.
    let (yes, no) = (3 * UNIT, UNIT);
    assert_eq!(payout(UNIT, 0, yes, no, 7_200), 960_000, "1/3 of 2.88");
    assert_eq!(payout(0, UNIT, yes, no, 7_200), 1_120_000, "all of 1.12");
    assert_eq!(payout(3 * UNIT, 0, yes, no, 7_200) + payout(0, UNIT, yes, no, 7_200), 4 * UNIT);
    assert_eq!(payout(UNIT, UNIT, yes, no, 10_000), 4 * UNIT / 3, "a full YES pays NO nothing");
    assert_eq!(payout(UNIT, UNIT, yes, no, 0), 4 * UNIT, "a full NO pays YES nothing");
}

#[test]
fn the_payout_rounds_down() {
    assert_eq!(payout(1, 0, 3, 0, 5_000), 1, "one pool empty: the stake back");
    assert_eq!(payout(1, 0, 3, 1, 5_000), 0, "1/3 × 0.5 × 4 = 0.67 rounds down");
}

#[test]
fn an_empty_pool_refunds_the_stakes() {
    assert_eq!(payout(5, 0, 5, 0, 7_000), 5);
    assert_eq!(payout(0, 4, 0, 4, 10_000), 4);
}

#[test]
fn snapping_pays_clear_answers_in_full() {
    for (raw, weight) in [
        (0, 0),
        (1_000, 0),
        (1_001, 1_001),
        (5_000, 5_000),
        (7_300, 7_300),
        (8_999, 8_999),
        (9_000, 10_000),
        (10_000, 10_000),
    ] {
        assert_eq!(snap(raw), weight, "snap({raw})");
    }
}

#[test]
fn percent_has_two_decimals_only_when_needed() {
    assert_eq!(percent(7_300), "73%");
    assert_eq!(percent(7_325), "73.25%");
    assert_eq!(percent(5), "0.05%");
}

// --- create_market ---

#[test]
fn create_market_seeds_both_pools_and_counts_ids_from_1() {
    let mut contract = setup();
    assert_eq!(open_market(&mut contract), 1);
    assert_eq!(
        last_event(),
        json!({
            "standard": "pm_notes",
            "version": "1.0.0",
            "event": "market_created",
            "data": [{
                "market_id": 1,
                "creator": "maya.testnet",
                "question": QUESTION,
                "note_id": 2,
                "closes_at_ms": T0 + HOUR,
                "seed": TEN.to_string(),
            }]
        })
    );
    assert_eq!(
        contract.get_market(1).unwrap(),
        MarketView {
            id: 1,
            question: QUESTION.into(),
            context: "Note 2 on post 7".into(),
            note_id: Some(2),
            creator: account("maya"),
            created_at_ms: T0,
            closes_at_ms: T0 + HOUR,
            yes_pool: U128(TEN / 2),
            no_pool: U128(TEN / 2),
            total_pool: U128(TEN),
            yes_share_bps: 5_000,
            bets: 0,
            refund_all: false,
            paid_out: U128(0),
            status: MarketStatus::Open,
            pending: None,
            resolution: None,
        }
    );
    assert_eq!(
        contract.get_position(1, account("maya")),
        PositionView { yes: U128(TEN / 2), no: U128(TEN / 2), payout: None, claimed: false },
        "the seed is the creator's stakes"
    );
    assert_eq!(contract.get_odds_history(1), vec![OddsPoint { at_ms: T0, yes_bps: 5_000 }]);
    send(&mut contract, "kenji", T0, USDC, create_msg("  Second?  ", None, None, T0 + HOUR));
    assert_eq!(contract.last_market_id, 2);
    assert_eq!(contract.get_market(2).unwrap().question, "Second?");
    assert_eq!(contract.get_market(2).unwrap().context, "");
}

#[test]
fn an_odd_seed_puts_the_extra_unit_on_no() {
    let mut contract = setup();
    send(&mut contract, "maya", T0, USDC + 1, create_msg(QUESTION, None, None, T0 + HOUR));
    let market = stored(&contract, 1);
    assert_eq!((market.yes_pool, market.no_pool), (500_000, 500_001));
}

fn create_fails(question: &str, context: Option<&str>, closes_at_ms: u64, deposit: u128, message: &str) {
    let mut contract = setup();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        send(&mut contract, "maya", T0, deposit, create_msg(question, context, None, closes_at_ms))
    }));
    let error = result.expect_err("create_market must fail");
    let text = error
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| error.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap();
    assert!(text.contains(message), "{text:?} does not contain {message:?}");
}

#[test]
fn create_market_rules() {
    create_fails("   ", None, T0 + HOUR, TEN, "question must have 1 to 200 characters");
    create_fails(&"é".repeat(201), None, T0 + HOUR, TEN, "question must have 1 to 200 characters");
    create_fails(QUESTION, Some(&"n".repeat(1_001)), T0 + HOUR, TEN, "context must have at most 1000 characters");
    create_fails(QUESTION, None, T0, TEN, "closes_at_ms must be in the future");
    create_fails(QUESTION, None, T0 + MAX_OPEN_MS + 1, TEN, "closes_at_ms must be at most 30 days ahead");
    create_fails(QUESTION, None, T0 + HOUR, USDC - 1, "the seed must be at least 1 USDC");
    create_fails(QUESTION, None, T0 + HOUR, 1_000_000 * USDC + 1, "the seed must be at most 1,000,000 USDC");
}

#[test]
fn create_market_allows_200_characters_and_30_days() {
    let mut contract = setup();
    send(&mut contract, "maya", T0, TEN, create_msg(&"é".repeat(200), Some(&"n".repeat(1_000)), None, T0 + MAX_OPEN_MS));
}

// --- bet ---

#[test]
fn a_bet_goes_into_its_pool_and_moves_the_odds() {
    let mut contract = setup();
    open_market(&mut contract);
    assert_eq!(bet(&mut contract, "kenji", Outcome::Yes, TEN), TEN);
    let view = contract.get_market(1).unwrap();
    assert_eq!((view.yes_pool, view.no_pool, view.total_pool), (U128(3 * TEN / 2), U128(TEN / 2), U128(2 * TEN)));
    assert_eq!((view.yes_share_bps, view.bets), (7_500, 1));
    assert_eq!(
        last_event()["data"][0],
        json!({
            "market_id": 1,
            "account_id": "kenji.testnet",
            "outcome": "yes",
            "amount": TEN.to_string(),
            "yes_pool": (3 * TEN / 2).to_string(),
            "no_pool": (TEN / 2).to_string(),
            "yes_share_bps": 7_500,
            "bets": 1,
        })
    );
    assert_eq!(bet(&mut contract, "kenji", Outcome::Yes, TEN / 2), 3 * TEN / 2, "the stake adds up");
    assert_eq!(bet(&mut contract, "kenji", Outcome::No, TEN / 10), TEN / 10, "both sides are allowed");
    assert_eq!(
        contract.get_position(1, account("kenji")),
        PositionView { yes: U128(3 * TEN / 2), no: U128(TEN / 10), payout: None, claimed: false }
    );
    let odds: Vec<u16> = contract.get_odds_history(1).iter().map(|p| p.yes_bps).collect();
    assert_eq!(odds, vec![5_000, 7_500, 8_000, 7_692]);
}

#[test]
fn the_odds_history_keeps_the_last_50_points() {
    let mut contract = setup();
    open_market(&mut contract);
    for _ in 0..60 {
        bet(&mut contract, "kenji", Outcome::No, TEN / 10);
    }
    let odds = contract.get_odds_history(1);
    assert_eq!(odds.len(), 50);
    assert_eq!(odds[49].yes_bps, yes_share_bps(TEN / 2, TEN / 2 + 6 * TEN) as u16);
    assert_eq!(contract.get_market(1).unwrap().bets, 60);
    assert_eq!(contract.get_odds_history(9), vec![]);
}

#[test]
#[should_panic(expected = "bet at least 1 USDC")]
fn a_bet_needs_one_usdc() {
    let mut contract = setup();
    open_market(&mut contract);
    bet(&mut contract, "kenji", Outcome::Yes, USDC - 1);
}

#[test]
#[should_panic(expected = "this market is closed for betting")]
fn betting_stops_at_the_close() {
    let mut contract = setup();
    open_market(&mut contract);
    send(&mut contract, "kenji", T0 + HOUR, TEN, bet_msg(1, "yes"));
}

#[test]
#[should_panic(expected = "market 9 does not exist")]
fn a_bet_needs_a_market() {
    let mut contract = setup();
    send(&mut contract, "kenji", T0, TEN, bet_msg(9, "yes"));
}

#[test]
#[should_panic(expected = "the pool is full")]
fn the_pool_has_a_limit() {
    let mut contract = setup();
    send(&mut contract, "maya", T0, 1_000_000 * USDC, create_msg(QUESTION, None, None, T0 + HOUR));
    bet(&mut contract, "kenji", Outcome::Yes, USDC);
}

#[test]
fn quote_bet_shows_the_payout_if_right() {
    let mut contract = setup();
    open_market(&mut contract);
    // Pools 5 / 5 USDC. A 10 USDC YES bet: 10 of 15 YES, and a full YES pays all of T = 20.
    let quote = contract.quote_bet(1, Outcome::Yes, U128(TEN)).unwrap();
    assert_eq!(
        quote,
        BetQuote { amount: U128(TEN), payout_if_right: U128(13_333_333), yes_share_bps: 7_500 }
    );
    let quote = contract.quote_bet(1, Outcome::No, U128(TEN / 2)).unwrap();
    assert_eq!(quote.amount, U128(TEN / 2));
    assert_eq!(quote.payout_if_right, U128(3 * TEN / 4), "0.5 of 1 NO pays half of T = 1.5");
    assert_eq!(quote.yes_share_bps, 3_333);
    assert_eq!(contract.quote_bet(1, Outcome::No, U128(USDC - 1)), None);
    assert_eq!(contract.quote_bet(9, Outcome::No, U128(TEN)), None);
    call("kenji", T0 + HOUR, 0);
    assert_eq!(contract.quote_bet(1, Outcome::No, U128(TEN)), None, "closed");
}

// --- close_market ---

#[test]
fn the_creator_or_the_admin_can_close_early() {
    let mut contract = setup();
    open_market(&mut contract);
    call("maya", T0 + 10, 0);
    contract.close_market(1);
    assert_eq!(contract.get_market(1).unwrap().status, MarketStatus::Closed);
    assert_eq!(contract.get_market(1).unwrap().closes_at_ms, T0 + 10);
    assert_eq!(
        last_event()["data"][0],
        json!({ "market_id": 1, "closed_by": "maya.testnet" })
    );
    send(&mut contract, "admin", T0, TEN, create_msg(QUESTION, None, None, T0 + HOUR));
    call("admin", T0, 0);
    contract.close_market(2);
    assert_eq!(contract.get_market(2).unwrap().status, MarketStatus::Closed);
}

#[test]
#[should_panic(expected = "only the creator or the admin can close this market")]
fn others_cannot_close() {
    let mut contract = setup();
    open_market(&mut contract);
    call("kenji", T0 + 10, 0);
    contract.close_market(1);
}

#[test]
#[should_panic(expected = "this market is closed for betting")]
fn a_closed_market_cannot_close_again() {
    let mut contract = setup();
    open_market(&mut contract);
    call("maya", T0 + HOUR, 0);
    contract.close_market(1);
}

// --- request_resolution ---

#[test]
fn request_resolution_calls_outlayer_and_the_callback() {
    let mut contract = setup();
    open_market(&mut contract);
    assert_eq!(request(&mut contract, "kenji", T0 + HOUR), 1);
    let market = contract.get_market(1).unwrap();
    assert_eq!(market.status, MarketStatus::Resolving);
    assert_eq!(
        market.pending,
        Some(PendingRequest {
            request_id: 1,
            requested_by: account("kenji"),
            requested_at_ms: T0 + HOUR,
        })
    );
    assert_eq!(
        last_event()["data"][0],
        json!({
            "market_id": 1,
            "request_id": 1,
            "requested_by": "kenji.testnet",
            "deposit": (50 * MILLI).to_string(),
        })
    );

    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, account("outlayer"));
    let MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, .. } =
        &receipts[0].actions[0]
    else {
        panic!("a function call");
    };
    assert_eq!(method_name, b"request_execution");
    assert_eq!(*attached_deposit, NearToken::from_yoctonear(50 * MILLI));
    assert_eq!(*prepaid_gas, OUTLAYER_GAS);
    let args: Value = serde_json::from_slice(args).unwrap();
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(
        input,
        json!({
            "market_id": 1,
            "question": QUESTION,
            "context": "Note 2 on post 7",
            "note_id": 2,
            "contract": "pm-notes.testnet",
        })
    );
    assert_eq!(
        args,
        json!({
            "source": { "Project": { "project_id": DEFAULT_PROJECT_ID, "version_key": null } },
            "input_data": args["input_data"],
            "resource_limits": {
                "max_instructions": 1_000_000_000u64,
                "max_memory_mb": 128,
                "max_execution_seconds": 60,
            },
            "response_format": "Json",
        })
    );

    assert_eq!(receipts[1].receiver_id, contract_id());
    let MockAction::FunctionCallWeight { method_name, args, prepaid_gas, .. } =
        &receipts[1].actions[0]
    else {
        panic!("a function call");
    };
    assert_eq!(method_name, b"on_resolution");
    assert_eq!(*prepaid_gas, CALLBACK_GAS);
    assert_eq!(
        serde_json::from_slice::<Value>(args).unwrap(),
        json!({ "market_id": 1, "request_id": 1 })
    );
}

#[test]
fn request_resolution_sends_the_secrets_ref_and_the_version() {
    call("admin", T0, 0);
    let key = "ab".repeat(32);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    call("admin", T0, 0);
    let mut contract = PredictionMarkets::new(
        account("admin"),
        Some(token()),
        Some(ResolverConfig {
            outlayer_account: account("fake-outlayer"),
            project_id: "seams-v1.testnet/pm-notes-resolver".into(),
            version_key: Some(key.clone()),
            secrets_ref: Some(SecretsRef { profile: "main".into(), account_id: account("cyan-loong") }),
        }),
    );
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id, account("fake-outlayer"));
    let MockAction::FunctionCallWeight { args, .. } = &receipts[0].actions[0] else {
        panic!("a function call");
    };
    let args: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(args["source"]["Project"]["version_key"], json!(key));
    assert_eq!(args["secrets_ref"], json!({ "profile": "main", "account_id": "cyan-loong.testnet" }));
}

#[test]
#[should_panic(expected = "this market is still open for betting")]
fn request_resolution_waits_for_the_close() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR - 1);
}

#[test]
#[should_panic(expected = "attach at least 0.05 NEAR for the OutLayer run")]
fn request_resolution_needs_the_fee() {
    let mut contract = setup();
    open_market(&mut contract);
    call("kenji", T0 + HOUR, 50 * MILLI - 1);
    let _ = contract.request_resolution(1);
}

#[test]
#[should_panic(expected = "attach 300 Tgas to request a resolution")]
fn request_resolution_needs_the_gas() {
    let mut contract = setup();
    open_market(&mut contract);
    testing_env!(context(&account("kenji"), T0 + HOUR, 50 * MILLI, 249));
    let _ = contract.request_resolution(1);
}

#[test]
#[should_panic(expected = "a resolution request is already pending")]
fn one_request_at_a_time() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    request(&mut contract, "ana", T0 + HOUR + PENDING_TIMEOUT_MS - 1);
}

#[test]
fn a_stale_request_does_not_block_a_new_one() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    call("kenji", T0 + HOUR + PENDING_TIMEOUT_MS, 0);
    assert_eq!(contract.get_market(1).unwrap().status, MarketStatus::Closed);
    assert_eq!(request(&mut contract, "ana", T0 + HOUR + PENDING_TIMEOUT_MS), 2);
    // The late answer of request 1 does not count.
    as_callback(T0 + HOUR + PENDING_TIMEOUT_MS + 1, answer(json!({ "yes_bps": 7_300, "provider": "jev" })));
    assert!(!contract.on_resolution(1, 1));
    assert_eq!(
        last_event()["data"][0],
        json!({ "market_id": 1, "request_id": 1, "reason": "a newer request replaced this one" })
    );
    assert_eq!(stored(&contract, 1).pending.unwrap().request_id, 2);
    assert!(stored(&contract, 1).resolution.is_none());
}

// --- on_resolution ---

#[test]
fn a_good_answer_resolves_the_market_at_its_weight() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    as_callback(
        T0 + HOUR + 5_000,
        answer(json!({
            "yes_bps": 7_300,
            "provider": "jev",
            "model": "jev-1.14.0",
            "rationale": "  The note cites the source.  ",
            "extra": true,
        })),
    );
    assert!(contract.on_resolution(1, 1));
    let market = contract.get_market(1).unwrap();
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.pending, None);
    assert_eq!(
        market.resolution,
        Some(Resolution {
            raw_yes_bps: 7_300,
            payout_yes_bps: 7_300,
            source: ResolutionSource::Ai,
            provider: Some("jev".into()),
            model: Some("jev-1.14.0".into()),
            rationale: "The note cites the source.".into(),
            resolved_by: account("kenji"),
            resolved_at_ms: T0 + HOUR + 5_000,
        })
    );
    assert_eq!(
        last_event(),
        json!({
            "standard": "pm_notes",
            "version": "1.0.0",
            "event": "market_resolved",
            "data": [{
                "market_id": 1,
                "source": "ai",
                "raw_yes_bps": 7_300,
                "payout_yes_bps": 7_300,
                "provider": "jev",
                "model": "jev-1.14.0",
                "resolved_by": "kenji.testnet",
            }]
        })
    );
}

#[test]
fn a_clear_answer_snaps_and_an_empty_rationale_gets_a_default() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    as_callback(T0 + HOUR + 1, answer(json!({ "yes_bps": 9_420, "provider": "near-ai" })));
    assert!(contract.on_resolution(1, 1));
    let resolution = stored(&contract, 1).resolution.unwrap();
    assert_eq!((resolution.raw_yes_bps, resolution.payout_yes_bps), (9_420, 10_000));
    assert_eq!(resolution.rationale, "near-ai gave a YES probability of 94.20%.");
    assert_eq!(resolution.model, None);
}

#[test]
fn a_long_rationale_is_cut_to_500_characters() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    as_callback(
        T0 + HOUR + 1,
        answer(json!({ "yes_bps": 5_000, "provider": "jev", "rationale": "é".repeat(800) })),
    );
    assert!(contract.on_resolution(1, 1));
    assert_eq!(stored(&contract, 1).resolution.unwrap().rationale.chars().count(), 500);
}

fn bad_answer(result: PromiseResult, reason: &str) {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    as_callback(T0 + HOUR + 1, result);
    assert!(!contract.on_resolution(1, 1), "{reason}");
    assert_eq!(
        last_event(),
        json!({
            "standard": "pm_notes",
            "version": "1.0.0",
            "event": "resolution_failed",
            "data": [{ "market_id": 1, "request_id": 1, "reason": reason }]
        })
    );
    let market = contract.get_market(1).unwrap();
    assert_eq!(market.status, MarketStatus::Closed, "a new request can follow");
    assert_eq!(market.pending, None);
    assert_eq!(market.resolution, None);
    assert_eq!(request(&mut contract, "kenji", T0 + HOUR + 2), 2);
}

#[test]
fn a_bad_answer_fails_without_a_panic() {
    bad_answer(PromiseResult::Failed, "the OutLayer call failed");
    bad_answer(answer(Value::Null), "the resolver returned no answer");
    bad_answer(
        answer(json!({ "error": "  JEV: HTTP 401; NEAR AI: no NEAR_AI_API_KEY  " })),
        "the resolver failed: JEV: HTTP 401; NEAR AI: no NEAR_AI_API_KEY",
    );
    bad_answer(
        answer(json!({ "yes_bps": 5_000, "provider": "jev", "error": "e".repeat(300) })),
        &format!("the resolver failed: {}", "e".repeat(200)),
    );
    bad_answer(
        answer(json!(json!({ "yes_bps": 5_000, "provider": "jev" }).to_string())),
        "the resolver answer is not an answer object",
    );
    bad_answer(
        answer(json!({ "yes_bps": "5000", "provider": "jev" })),
        "the resolver answer is not an answer object",
    );
    bad_answer(PromiseResult::Successful(b"not json".to_vec()), "the resolver answer is not an answer object");
    bad_answer(answer(json!([7300])), "the resolver answer is not an answer object");
    bad_answer(
        answer(json!({ "yes_bps": 10_001, "provider": "jev" })),
        "yes_bps must be an integer from 0 to 10000",
    );
    bad_answer(
        answer(json!({ "yes_bps": 73.5, "provider": "jev" })),
        "yes_bps must be an integer from 0 to 10000",
    );
    bad_answer(
        answer(json!({ "yes_bps": -1, "provider": "jev" })),
        "yes_bps must be an integer from 0 to 10000",
    );
    bad_answer(
        answer(json!({ "yes_bps": 5_000 })),
        "provider must be 1 to 32 characters a-z, 0-9, '-' or '.'",
    );
    bad_answer(
        answer(json!({ "yes_bps": 5_000, "provider": "JEV" })),
        "provider must be 1 to 32 characters a-z, 0-9, '-' or '.'",
    );
    bad_answer(
        answer(json!({ "yes_bps": 5_000, "provider": "jev", "model": "" })),
        "model must be 1 to 64 printable ASCII characters",
    );
    bad_answer(
        answer(json!({ "yes_bps": 5_000, "provider": "jev", "rationale": 7 })),
        "the resolver answer is not an answer object",
    );
    bad_answer(
        PromiseResult::Successful(vec![b' '; MAX_RESULT_BYTES + 1]),
        "the resolver answer is too long",
    );
}

#[test]
fn an_answer_after_the_admin_resolve_is_ignored() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    call("admin", T0 + HOUR + 1, 0);
    contract.resolve(1, 2_000, None);
    as_callback(T0 + HOUR + 2, answer(json!({ "yes_bps": 9_900, "provider": "jev" })));
    assert!(!contract.on_resolution(1, 1));
    assert_eq!(last_event()["data"][0]["reason"], "the market was resolved first");
    let resolution = stored(&contract, 1).resolution.unwrap();
    assert_eq!(resolution.source, ResolutionSource::Admin);
    assert_eq!(resolution.payout_yes_bps, 2_000);
}

#[test]
fn the_callback_of_an_unknown_market_does_nothing() {
    let mut contract = setup();
    as_callback(T0, answer(json!({ "yes_bps": 9_900, "provider": "jev" })));
    assert!(!contract.on_resolution(5, 1));
}

// The `#[private]` check lives in the WASM entry point, so the sandbox test covers it.

// --- resolve (admin) ---

#[test]
fn the_admin_resolves_with_snapping_and_a_rationale() {
    let mut contract = setup();
    open_market(&mut contract);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 600, Some("  Wrong date in the note. ".into()));
    assert_eq!(
        stored(&contract, 1).resolution.unwrap(),
        Resolution {
            raw_yes_bps: 600,
            payout_yes_bps: 0,
            source: ResolutionSource::Admin,
            provider: None,
            model: None,
            rationale: "Wrong date in the note.".into(),
            resolved_by: account("admin"),
            resolved_at_ms: T0 + HOUR,
        }
    );
    assert_eq!(last_event()["data"][0]["source"], "admin");
}

#[test]
fn the_admin_resolve_has_a_default_rationale_and_clears_the_request() {
    let mut contract = setup();
    open_market(&mut contract);
    request(&mut contract, "kenji", T0 + HOUR);
    call("admin", T0 + HOUR + 1, 0);
    contract.resolve(1, 5_000, None);
    let market = stored(&contract, 1);
    assert_eq!(market.pending, None);
    assert_eq!(market.resolution.unwrap().rationale, "Resolved by the admin.");
}

fn resolve_fails(who: &str, at_ms: u64, yes_bps: u32, rationale: Option<String>) {
    let mut contract = setup();
    open_market(&mut contract);
    call(who, at_ms, 0);
    contract.resolve(1, yes_bps, rationale);
}

#[test]
#[should_panic(expected = "only the admin can resolve a market")]
fn only_the_admin_resolves() {
    resolve_fails("maya", T0 + HOUR, 5_000, None);
}

#[test]
#[should_panic(expected = "this market is still open for betting")]
fn the_admin_resolves_only_after_the_close() {
    resolve_fails("admin", T0 + HOUR - 1, 5_000, None);
}

#[test]
#[should_panic(expected = "yes_bps must be 0 to 10000")]
fn the_admin_resolve_checks_the_probability() {
    resolve_fails("admin", T0 + HOUR, 10_001, None);
}

#[test]
#[should_panic(expected = "rationale must have at most 500 characters")]
fn the_admin_resolve_checks_the_rationale() {
    resolve_fails("admin", T0 + HOUR, 5_000, Some("n".repeat(501)));
}

#[test]
#[should_panic(expected = "this market is resolved")]
fn a_resolution_is_final() {
    let mut contract = setup();
    open_market(&mut contract);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 5_000, None);
    contract.resolve(1, 6_000, None);
}

#[test]
#[should_panic(expected = "this market is resolved")]
fn a_resolved_market_takes_no_request() {
    let mut contract = setup();
    open_market(&mut contract);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 5_000, None);
    request(&mut contract, "kenji", T0 + HOUR + 1);
}

// --- claim ---

#[test]
fn claim_pays_each_stake_its_share_of_the_weighted_pool() {
    let mut contract = setup();
    open_market(&mut contract); // Maya: 5 USDC on YES + 5 on NO.
    bet(&mut contract, "kenji", Outcome::Yes, 5 * TEN / 2); // YES pool 3
    bet(&mut contract, "ana", Outcome::No, TEN / 2); // NO pool 1, T = 4
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 7_200, None);

    // Pools: YES 30, NO 10, T = 40 USDC.
    // Kenji: 25 / 30 × 0.72 × 40 = 24. Ana: 5 / 10 × 0.28 × 40 = 5.6.
    // Maya: 5 / 30 × 28.8 + 5 / 10 × 11.2 = 4.8 + 5.6 = 10.4.
    for (who, expected) in [("kenji", 24_000_000), ("ana", 5_600_000), ("maya", 10_400_000)] {
        assert_eq!(contract.get_position(1, account(who)).payout, Some(U128(expected)), "{who}");
        assert_eq!(claim(&mut contract, who, T0 + HOUR + 1), expected, "{who}");
        let receipts = get_created_receipts();
        assert_eq!(receipts[0].receiver_id, token());
        let MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, .. } = &receipts[0].actions[0] else {
            panic!("a function call");
        };
        assert_eq!(method_name, b"ft_transfer");
        assert_eq!(*attached_deposit, NearToken::from_yoctonear(1), "ft_transfer needs 1 yoctoNEAR");
        assert_eq!(*prepaid_gas, FT_TRANSFER_GAS);
        assert_eq!(
            serde_json::from_slice::<Value>(args).unwrap(),
            json!({ "receiver_id": format!("{who}.testnet"), "amount": expected.to_string(), "memo": "pm-notes claim" })
        );
        assert_eq!(receipts[1].receiver_id, contract_id());
        let MockAction::FunctionCallWeight { method_name, args, .. } = &receipts[1].actions[0] else {
            panic!("a function call");
        };
        assert_eq!(method_name, b"on_claim_transfer");
        assert_eq!(
            serde_json::from_slice::<Value>(args).unwrap(),
            json!({ "market_id": 1, "account_id": format!("{who}.testnet"), "amount": expected.to_string() })
        );
        assert_eq!(
            last_event()["data"][0],
            json!({ "market_id": 1, "account_id": format!("{who}.testnet"), "amount": expected.to_string(), "refund": false })
        );
        let position = contract.get_position(1, account(who));
        assert!(position.claimed);
        assert_eq!(position.payout, Some(U128(expected)), "the payout stays visible after the claim");
    }
    assert_eq!(contract.get_market(1).unwrap().paid_out, U128(4 * TEN));
}

#[test]
fn a_full_answer_pays_the_losing_side_nothing() {
    let mut contract = setup();
    open_market(&mut contract);
    bet(&mut contract, "kenji", Outcome::No, TEN);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 9_500, None);
    call("kenji", T0 + HOUR + 1, 0);
    assert!(matches!(contract.claim(1), PromiseOrValue::Value(U128(0))));
    assert!(get_created_receipts().is_empty(), "no transfer of 0");
    assert!(contract.get_position(1, account("kenji")).claimed);
    assert_eq!(claim(&mut contract, "maya", T0 + HOUR + 1), 2 * TEN, "Maya's 5 USDC on YES is the whole YES pool");
}

#[test]
#[should_panic(expected = "already claimed")]
fn a_claim_happens_once() {
    let mut contract = setup();
    open_market(&mut contract);
    bet(&mut contract, "kenji", Outcome::Yes, TEN);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 10_000, None);
    call("kenji", T0 + HOUR + 1, 0);
    let _ = contract.claim(1);
    let _ = contract.claim(1);
}

#[test]
#[should_panic(expected = "this market is not resolved yet")]
fn a_claim_waits_for_the_resolution() {
    let mut contract = setup();
    open_market(&mut contract);
    bet(&mut contract, "kenji", Outcome::Yes, TEN);
    call("kenji", T0 + HOUR, 0);
    let _ = contract.claim(1);
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn a_claim_needs_a_stake() {
    let mut contract = setup();
    open_market(&mut contract);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 5_000, None);
    call("kenji", T0 + HOUR, 0);
    let _ = contract.claim(1);
}

#[test]
fn a_failed_transfer_opens_the_claim_again() {
    let mut contract = setup();
    open_market(&mut contract);
    bet(&mut contract, "kenji", Outcome::Yes, TEN);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 10_000, None);
    let paid = claim(&mut contract, "kenji", T0 + HOUR + 1);
    assert_eq!(paid, 13_333_333, "10 of the 15 USDC on YES, and a full YES pays all of 20");
    as_callback(T0 + HOUR + 2, PromiseResult::Failed);
    assert_eq!(contract.on_claim_transfer(1, account("kenji"), U128(paid)), U128(0));
    assert_eq!(
        last_event()["data"][0],
        json!({ "market_id": 1, "account_id": "kenji.testnet", "amount": paid.to_string() })
    );
    assert_eq!(last_event()["event"], "claim_failed");
    assert!(!contract.get_position(1, account("kenji")).claimed);
    assert_eq!(contract.get_market(1).unwrap().paid_out, U128(0));
    assert_eq!(claim(&mut contract, "kenji", T0 + HOUR + 3), paid, "the claim works again");
    as_callback(T0 + HOUR + 4, PromiseResult::Successful(b"".to_vec()));
    assert_eq!(contract.on_claim_transfer(1, account("kenji"), U128(paid)), U128(paid));
    assert!(contract.get_position(1, account("kenji")).claimed);
}

// --- ft_on_transfer ---

#[test]
#[should_panic(expected = "only the market token can send to this contract")]
fn only_the_token_sends_money() {
    let mut contract = setup();
    call("maya", T0, 0);
    let _ = contract.ft_on_transfer(account("maya"), U128(TEN), create_msg(QUESTION, None, None, T0 + HOUR).to_string());
}

#[test]
#[should_panic(expected = "msg must be a create_market or bet message")]
fn the_message_must_say_what_the_money_is_for() {
    let mut contract = setup();
    send(&mut contract, "maya", T0, TEN, json!({ "action": "donate" }));
}

#[test]
#[should_panic(expected = "msg must be a create_market or bet message")]
fn a_message_with_unknown_fields_is_refused() {
    let mut contract = setup();
    open_market(&mut contract);
    send(&mut contract, "kenji", T0 + 1, TEN, json!({ "action": "bet", "market_id": 1, "outcome": "yes", "extra": 1 }));
}

// --- views and config ---

#[test]
fn views_list_markets_newest_first() {
    let mut contract = setup();
    for _ in 0..3 {
        open_market(&mut contract);
    }
    let ids = |markets: Vec<MarketView>| markets.iter().map(|m| m.id).collect::<Vec<_>>();
    assert_eq!(ids(contract.get_markets(None, None)), vec![3, 2, 1]);
    assert_eq!(ids(contract.get_markets(Some(3), None)), vec![2, 1]);
    assert_eq!(ids(contract.get_markets(None, Some(1))), vec![3]);
    assert_eq!(ids(contract.get_markets(Some(1), None)), Vec::<u64>::new());
    assert_eq!(ids(contract.get_markets(Some(99), Some(500))), vec![3, 2, 1]);
    assert_eq!(contract.get_market_for_note(2).unwrap().id, 3, "the newest market of the note");
    assert_eq!(contract.get_market_for_note(3), None);
    assert_eq!(contract.get_market(4), None);
    assert_eq!(
        contract.get_position(1, account("nobody")),
        PositionView { yes: U128(0), no: U128(0), payout: None, claimed: false }
    );
}

#[test]
fn get_config_shows_the_rules() {
    let contract = setup();
    assert_eq!(
        contract.get_config(),
        ConfigView {
            admin: account("admin"),
            token: token(),
            resolver: ResolverConfig::default(),
            snap_high_bps: 9_000,
            snap_low_bps: 1_000,
            min_seed: U128(USDC),
            min_bet: U128(USDC),
            min_resolution_deposit: U128(50 * MILLI),
            max_open_ms: 30 * 24 * HOUR,
        }
    );
    assert_eq!(
        serde_json::to_value(contract.get_config().resolver).unwrap(),
        json!({
            "outlayer_account": "outlayer.testnet",
            "project_id": "seams-v1.testnet/pm-notes-resolver",
            "version_key": null,
            "secrets_ref": null,
        })
    );
}

#[test]
fn the_resolver_config_json_may_leave_out_the_options() {
    let config: ResolverConfig = serde_json::from_value(json!({
        "outlayer_account": "outlayer.testnet",
        "project_id": "seams-v1.testnet/pm-notes-resolver",
    }))
    .unwrap();
    assert_eq!(config, ResolverConfig::default());
}

#[test]
fn the_admin_changes_the_resolver_config() {
    let mut contract = setup();
    let config = ResolverConfig {
        outlayer_account: account("outlayer"),
        project_id: "seams-v1.testnet/pm-notes-resolver".into(),
        version_key: Some("0f".repeat(32)),
        secrets_ref: Some(SecretsRef { profile: "pm_notes-1".into(), account_id: account("seams-v1") }),
    };
    call("admin", T0, 0);
    contract.set_resolver_config(config.clone());
    assert_eq!(contract.get_config().resolver, config);
}

fn config_fails(who: &str, config: ResolverConfig) {
    let mut contract = setup();
    call(who, T0, 0);
    contract.set_resolver_config(config);
}

#[test]
#[should_panic(expected = "only the admin can change the resolver config")]
fn only_the_admin_changes_the_resolver_config() {
    config_fails("maya", ResolverConfig::default());
}

#[test]
#[should_panic(expected = "project_id must be owner/name")]
fn the_project_id_is_checked() {
    config_fails("admin", ResolverConfig { project_id: "pm-notes-resolver".into(), ..Default::default() });
}

#[test]
#[should_panic(expected = "version_key must be 64 lowercase hex characters")]
fn the_version_key_is_checked() {
    config_fails("admin", ResolverConfig { version_key: Some("AB".repeat(32)), ..Default::default() });
}

#[test]
#[should_panic(expected = "the secrets profile must be 1 to 64 letters, digits, '-' or '_'")]
fn the_secrets_profile_is_checked() {
    config_fails(
        "admin",
        ResolverConfig {
            secrets_ref: Some(SecretsRef { profile: "my profile".into(), account_id: account("a") }),
            ..Default::default()
        },
    );
}

// --- solvency ---

/// A small seeded random generator (xorshift64*), so the test needs no extra crate.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: u128) -> u128 {
        u128::from(self.next()) % n
    }
}

#[test]
fn random_bets_stay_solvent_for_any_weight() {
    let bettors = ["t1", "t2", "t3", "t4", "t5"];
    for seed in 1..=30u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        let mut contract = setup();
        let seed_usdc = USDC + rng.below(30 * USDC);
        send(&mut contract, "maya", T0, seed_usdc, create_msg(QUESTION, None, None, T0 + HOUR));
        let mut paid_in = seed_usdc;
        // Some markets get bets on one side only, so the seed is the other side.
        let one_side = seed % 5 == 0;
        for step in 0..(1 + rng.below(60) as u64) {
            let outcome = if one_side || rng.below(3) > 0 { Outcome::Yes } else { Outcome::No };
            let amount = USDC + rng.below(50 * USDC);
            let side = if outcome == Outcome::Yes { "yes" } else { "no" };
            send(&mut contract, bettors[rng.below(5) as usize], T0 + 1 + step, amount, bet_msg(1, side));
            paid_in += amount;
        }
        let market = stored(&contract, 1);
        assert_eq!(market.yes_pool + market.no_pool, paid_in, "seed {seed}: the pools hold every bet");

        let weight = match seed % 4 {
            0 => 0,
            1 => 10_000,
            _ => rng.below(10_001) as u32,
        };
        call("admin", T0 + HOUR, 0);
        contract.resolve(1, weight, None);

        let mut paid = 0u128;
        let mut claims = 0u128;
        for who in bettors.iter().chain(std::iter::once(&"maya")) {
            if !contract.stakes.contains_key(&(1, account(who))) {
                continue;
            }
            paid += claim(&mut contract, who, T0 + HOUR + 1);
            claims += 1;
        }
        assert!(paid <= paid_in, "seed {seed}: paid {paid} of {paid_in}");
        assert!(paid_in - paid <= 2 * claims, "seed {seed}: dust {} for {claims} claims", paid_in - paid);
        assert_eq!(stored(&contract, 1).paid_out, paid);
    }
}
