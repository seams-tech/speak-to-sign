use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
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
    PredictionMarkets::new(account("admin"), None)
}

/// Maya opens a 1 NEAR market that closes after one hour.
fn open_market(contract: &mut PredictionMarkets) -> u64 {
    call("maya", T0, NEAR);
    contract.create_market(QUESTION.into(), Some("Note 2 on post 7".into()), Some(2), T0 + HOUR)
}

fn buy(contract: &mut PredictionMarkets, who: &str, outcome: Outcome, amount: u128) -> u128 {
    call(who, T0 + 1, amount);
    contract.buy(1, outcome, None).0
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

// --- pool math ---

#[test]
fn buy_quote_mints_sets_and_rounds_for_the_pool() {
    // 100 × 100 = 10,000. After 10 sets: other = 110, chosen = ceil(10,000 / 110) = 91.
    let quote = buy_quote(100, 100, 10).unwrap();
    assert_eq!(quote, Quote { shares: 19, chosen_after: 91, other_after: 110 });
    assert!(quote.chosen_after * quote.other_after >= 100 * 100);
}

#[test]
fn sell_quote_burns_sets_and_rounds_for_the_pool() {
    // Selling back for the same 10 NEAR takes 20 shares: one more than the buy gave.
    let quote = sell_quote(91, 110, 10).unwrap();
    assert_eq!(quote, Quote { shares: 20, chosen_after: 101, other_after: 100 });
    assert!(quote.chosen_after * quote.other_after >= 91 * 110);
}

#[test]
fn quotes_refuse_empty_pools_and_amounts_out_of_range() {
    assert_eq!(buy_quote(0, 100, 10), None);
    assert_eq!(buy_quote(100, 0, 10), None);
    assert_eq!(buy_quote(100, 100, 0), None);
    assert_eq!(buy_quote(100, 100, MAX_AMOUNT_UNITS + 1), None);
    assert_eq!(sell_quote(100, 100, 100), None, "the pool cannot burn all its other shares");
    assert_eq!(sell_quote(100, 100, 101), None);
    assert_eq!(sell_quote(100, 100, 0), None);
}

#[test]
fn quotes_never_lower_the_pool_product() {
    let mut rng = Rng(7);
    for _ in 0..5_000 {
        let chosen = 1 + rng.below(1_000_000_000);
        let other = 1 + rng.below(1_000_000_000);
        let amount = 1 + rng.below(100_000_000);
        if let Some(q) = buy_quote(chosen, other, amount) {
            assert!(q.chosen_after * q.other_after >= chosen * other);
            assert_eq!(q.chosen_after, chosen + amount - q.shares);
        }
        if let Some(q) = sell_quote(chosen, other, amount) {
            assert!(q.chosen_after * q.other_after >= chosen * other);
            assert_eq!(q.chosen_after, chosen + q.shares - amount);
        }
    }
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
fn weighted_payout_rounds_down() {
    // 100 YES × 0.73 + 50 NO × 0.27 = 86.5.
    assert_eq!(weighted_payout(100, 50, 7_300), 86);
    assert_eq!(weighted_payout(100, 50, 10_000), 100);
    assert_eq!(weighted_payout(100, 50, 0), 50);
    assert_eq!(weighted_payout(7, 7, 3_333), 7, "a complete set pays exactly 1");
}

#[test]
fn percent_has_two_decimals_only_when_needed() {
    assert_eq!(percent(7_300), "73%");
    assert_eq!(percent(7_325), "73.25%");
    assert_eq!(percent(5), "0.05%");
}

// --- create_market ---

#[test]
fn create_market_stores_the_market_and_counts_ids_from_1() {
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
                "liquidity": NEAR.to_string(),
            }]
        })
    );
    let view = contract.get_market(1).unwrap();
    assert_eq!(
        view,
        MarketView {
            id: 1,
            question: QUESTION.into(),
            context: "Note 2 on post 7".into(),
            note_id: Some(2),
            creator: account("maya"),
            created_at_ms: T0,
            closes_at_ms: T0 + HOUR,
            yes_pool: U128(NEAR),
            no_pool: U128(NEAR),
            yes_price_bps: 5_000,
            collateral: U128(NEAR),
            status: MarketStatus::Open,
            pending: None,
            resolution: None,
        }
    );
    call("kenji", T0, NEAR / 10);
    assert_eq!(contract.create_market("  Second?  ".into(), None, None, T0 + HOUR), 2);
    assert_eq!(contract.get_market(2).unwrap().question, "Second?");
    assert_eq!(contract.get_market(2).unwrap().context, "");
}

#[test]
fn create_market_keeps_less_than_a_micro_near_in_the_contract() {
    let mut contract = setup();
    call("maya", T0, NEAR / 10 + 999);
    contract.create_market(QUESTION.into(), None, None, T0 + HOUR);
    assert_eq!(contract.get_market(1).unwrap().collateral, U128(NEAR / 10));
}

fn create_fails(question: &str, context: Option<&str>, closes_at_ms: u64, deposit: u128, message: &str) {
    let mut contract = setup();
    call("maya", T0, deposit);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.create_market(question.into(), context.map(Into::into), None, closes_at_ms)
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
    create_fails("   ", None, T0 + HOUR, NEAR, "question must have 1 to 200 characters");
    create_fails(&"é".repeat(201), None, T0 + HOUR, NEAR, "question must have 1 to 200 characters");
    create_fails(QUESTION, Some(&"n".repeat(1_001)), T0 + HOUR, NEAR, "context must have at most 1000 characters");
    create_fails(QUESTION, None, T0, NEAR, "closes_at_ms must be in the future");
    create_fails(QUESTION, None, T0 + MAX_OPEN_MS + 1, NEAR, "closes_at_ms must be at most 30 days ahead");
    create_fails(QUESTION, None, T0 + HOUR, NEAR / 10 - 1, "attach at least 0.1 NEAR of liquidity");
    create_fails(QUESTION, None, T0 + HOUR, 1_000_001 * NEAR, "attach at most 1,000,000 NEAR");
}

#[test]
fn create_market_allows_200_characters_and_30_days() {
    let mut contract = setup();
    call("maya", T0, NEAR);
    contract.create_market("é".repeat(200), Some("n".repeat(1_000)), None, T0 + MAX_OPEN_MS);
}

// --- buy and sell ---

#[test]
fn buy_gives_shares_and_moves_the_price() {
    let mut contract = setup();
    open_market(&mut contract);
    // 1 NEAR pool, buy 1 NEAR of YES: other = 2, chosen = 0.5, shares = 1 + 1 − 0.5 = 1.5.
    let shares = buy(&mut contract, "kenji", Outcome::Yes, NEAR);
    assert_eq!(shares, 3 * NEAR / 2);
    let view = contract.get_market(1).unwrap();
    assert_eq!(view.yes_pool, U128(NEAR / 2));
    assert_eq!(view.no_pool, U128(2 * NEAR));
    assert_eq!(view.yes_price_bps, 8_000);
    assert_eq!(view.collateral, U128(2 * NEAR));
    assert_eq!(
        contract.get_position(1, account("kenji")),
        PositionView { yes: U128(3 * NEAR / 2), no: U128(0), redeemable: None }
    );
    assert_eq!(
        last_event()["data"][0],
        json!({
            "market_id": 1,
            "account_id": "kenji.testnet",
            "side": "buy",
            "outcome": "yes",
            "amount": NEAR.to_string(),
            "shares": (3 * NEAR / 2).to_string(),
            "yes_price_bps": 8_000,
        })
    );
}

#[test]
#[should_panic(expected = "fewer shares than min_shares")]
fn buy_checks_min_shares() {
    let mut contract = setup();
    open_market(&mut contract);
    call("kenji", T0 + 1, NEAR);
    contract.buy(1, Outcome::Yes, Some(U128(3 * NEAR / 2 + 1)));
}

#[test]
#[should_panic(expected = "attach at least 0.01 NEAR to buy")]
fn buy_needs_a_hundredth_of_a_near() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::Yes, 10 * MILLI - 1);
}

#[test]
#[should_panic(expected = "this market is closed for trading")]
fn buy_stops_at_the_close() {
    let mut contract = setup();
    open_market(&mut contract);
    call("kenji", T0 + HOUR, NEAR);
    contract.buy(1, Outcome::Yes, None);
}

#[test]
#[should_panic(expected = "market 9 does not exist")]
fn buy_needs_a_market() {
    let mut contract = setup();
    call("kenji", T0, NEAR);
    contract.buy(9, Outcome::Yes, None);
}

#[test]
fn sell_pays_near_and_takes_shares() {
    let mut contract = setup();
    open_market(&mut contract);
    let bought = buy(&mut contract, "kenji", Outcome::No, NEAR);
    call("kenji", T0 + 2, 0);
    let taken = contract.sell(1, Outcome::No, U128(NEAR / 2), None).0;
    assert!(taken > NEAR / 2 && taken < bought);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, account("kenji"));
    assert!(matches!(
        receipts[0].actions[..],
        [MockAction::Transfer { deposit, .. }] if deposit == NearToken::from_yoctonear(NEAR / 2)
    ));
    assert_eq!(contract.get_market(1).unwrap().collateral, U128(3 * NEAR / 2));
    assert_eq!(contract.get_position(1, account("kenji")).no, U128(bought - taken));
    assert_eq!(last_event()["data"][0]["side"], "sell");
}

#[test]
fn sell_of_everything_removes_the_position() {
    let mut contract = setup();
    open_market(&mut contract);
    let bought = buy(&mut contract, "kenji", Outcome::Yes, NEAR);
    // Find the largest sell that the shares cover.
    let mut amount = NEAR;
    loop {
        let quote = contract.quote_sell(1, Outcome::Yes, U128(amount)).unwrap();
        if quote.shares.0 <= bought {
            break;
        }
        amount -= MILLI;
    }
    call("kenji", T0 + 2, 0);
    let taken = contract.sell(1, Outcome::Yes, U128(amount), None).0;
    assert!(taken <= bought);
    if taken == bought {
        assert!(!contract.positions.contains_key(&(1, account("kenji"))));
    }
}

#[test]
#[should_panic(expected = "not enough shares for this amount")]
fn sell_needs_the_shares() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::Yes, NEAR / 10);
    call("kenji", T0 + 2, 0);
    contract.sell(1, Outcome::Yes, U128(NEAR / 5), None);
}

#[test]
#[should_panic(expected = "more shares than max_shares")]
fn sell_checks_max_shares() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::Yes, NEAR);
    call("kenji", T0 + 2, 0);
    contract.sell(1, Outcome::Yes, U128(NEAR / 2), Some(U128(NEAR / 2)));
}

#[test]
#[should_panic(expected = "amount must be at least 0.000001 NEAR")]
fn sell_needs_a_micro_near() {
    let mut contract = setup();
    open_market(&mut contract);
    call("kenji", T0 + 2, 0);
    contract.sell(1, Outcome::Yes, U128(YOCTO_PER_UNIT - 1), None);
}

#[test]
fn quotes_match_the_trades() {
    let mut contract = setup();
    open_market(&mut contract);
    let quote = contract.quote_buy(1, Outcome::Yes, U128(NEAR)).unwrap();
    assert_eq!(
        quote,
        QuoteView { amount: U128(NEAR), shares: U128(3 * NEAR / 2), yes_price_bps: 8_000 }
    );
    assert_eq!(buy(&mut contract, "kenji", Outcome::Yes, NEAR), quote.shares.0);
    let quote = contract.quote_sell(1, Outcome::Yes, U128(NEAR / 2)).unwrap();
    call("kenji", T0 + 2, 0);
    assert_eq!(contract.sell(1, Outcome::Yes, U128(NEAR / 2), None), quote.shares);
    assert_eq!(contract.get_market(1).unwrap().yes_price_bps, quote.yes_price_bps);
    assert_eq!(contract.quote_buy(1, Outcome::No, U128(10 * MILLI - 1)), None);
    assert_eq!(contract.quote_buy(9, Outcome::No, U128(NEAR)), None);
    call("kenji", T0 + HOUR, 0);
    assert_eq!(contract.quote_buy(1, Outcome::No, U128(NEAR)), None, "closed");
    assert_eq!(contract.quote_sell(1, Outcome::No, U128(MILLI)), None, "closed");
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
    call("admin", T0, NEAR);
    contract.create_market(QUESTION.into(), None, None, T0 + HOUR);
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
#[should_panic(expected = "this market is closed for trading")]
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
    let mut contract = PredictionMarkets::new(
        account("admin"),
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
#[should_panic(expected = "this market is still open for trading")]
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
#[should_panic(expected = "this market is still open for trading")]
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

// --- redeem ---

#[test]
fn redeem_pays_each_share_at_the_weight() {
    let mut contract = setup();
    open_market(&mut contract);
    let kenji_yes = buy(&mut contract, "kenji", Outcome::Yes, NEAR); // 1.5 YES
    let ana_no = buy(&mut contract, "ana", Outcome::No, NEAR);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 7_300, None);
    let collateral = stored(&contract, 1).collateral * YOCTO_PER_UNIT;
    assert_eq!(collateral, 3 * NEAR);

    let expected_kenji = kenji_yes / YOCTO_PER_UNIT * 7_300 / 10_000 * YOCTO_PER_UNIT;
    assert_eq!(contract.get_position(1, account("kenji")).redeemable, Some(U128(expected_kenji)));
    call("kenji", T0 + HOUR + 1, 0);
    assert_eq!(contract.redeem(1).0, expected_kenji);
    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id, account("kenji"));
    assert!(matches!(
        receipts[0].actions[..],
        [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == expected_kenji
    ));
    assert_eq!(
        last_event()["data"][0],
        json!({
            "market_id": 1,
            "account_id": "kenji.testnet",
            "pool": false,
            "amount": expected_kenji.to_string(),
        })
    );

    call("ana", T0 + HOUR + 1, 0);
    let ana = contract.redeem(1).0;
    assert_eq!(ana, ana_no / YOCTO_PER_UNIT * 2_700 / 10_000 * YOCTO_PER_UNIT);

    // Maya created the market: the pool's shares are hers.
    let market = stored(&contract, 1);
    let pool = weighted_payout(market.yes_pool, market.no_pool, 7_300) * YOCTO_PER_UNIT;
    call("maya", T0 + HOUR + 1, 0);
    assert_eq!(contract.get_position(1, account("maya")).redeemable, Some(U128(pool)));
    assert_eq!(contract.redeem(1).0, pool);
    assert_eq!(last_event()["data"][0]["pool"], true);
    assert_eq!(contract.get_position(1, account("maya")).redeemable, Some(U128(0)));

    let paid = expected_kenji + ana + pool;
    assert!(paid <= collateral);
    assert!(collateral - paid <= 3 * YOCTO_PER_UNIT, "at most one micro-NEAR of dust per redeem");
    assert_eq!(stored(&contract, 1).collateral * YOCTO_PER_UNIT, collateral - paid);
}

#[test]
#[should_panic(expected = "nothing to redeem")]
fn redeem_twice_fails() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::Yes, NEAR);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 10_000, None);
    call("kenji", T0 + HOUR + 1, 0);
    contract.redeem(1);
    contract.redeem(1);
}

#[test]
fn a_losing_position_redeems_to_zero_without_a_transfer() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::No, NEAR);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 9_500, None);
    call("kenji", T0 + HOUR + 1, 0);
    assert_eq!(contract.redeem(1), U128(0));
    assert!(get_created_receipts().is_empty());
    assert!(!contract.positions.contains_key(&(1, account("kenji"))));
}

#[test]
#[should_panic(expected = "this market is not resolved yet")]
fn redeem_waits_for_the_resolution() {
    let mut contract = setup();
    open_market(&mut contract);
    buy(&mut contract, "kenji", Outcome::Yes, NEAR);
    call("kenji", T0 + HOUR, 0);
    contract.redeem(1);
}

#[test]
#[should_panic(expected = "nothing to redeem")]
fn redeem_needs_a_position() {
    let mut contract = setup();
    open_market(&mut contract);
    call("admin", T0 + HOUR, 0);
    contract.resolve(1, 5_000, None);
    call("kenji", T0 + HOUR, 0);
    contract.redeem(1);
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
        PositionView { yes: U128(0), no: U128(0), redeemable: None }
    );
}

#[test]
fn get_config_shows_the_rules() {
    let contract = setup();
    assert_eq!(
        contract.get_config(),
        ConfigView {
            admin: account("admin"),
            resolver: ResolverConfig::default(),
            snap_high_bps: 9_000,
            snap_low_bps: 1_000,
            min_liquidity: U128(NEAR / 10),
            min_buy: U128(NEAR / 100),
            min_resolution_deposit: U128(NEAR / 20),
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

/// YES total = NO total = collateral, with the pool and every holder.
fn check_sets(contract: &PredictionMarkets, traders: &[&str]) {
    let market = stored(contract, 1);
    let (mut yes, mut no) = (market.yes_pool, market.no_pool);
    for trader in traders {
        if let Some(position) = contract.positions.get(&(1, account(trader))) {
            yes += position.yes;
            no += position.no;
        }
    }
    assert_eq!(yes, market.collateral, "YES total");
    assert_eq!(no, market.collateral, "NO total");
}

#[test]
fn random_trades_stay_solvent_for_any_weight() {
    let traders = ["t1", "t2", "t3", "t4", "t5"];
    for seed in 1..=20u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        let mut contract = setup();
        let liquidity = NEAR / 10 + rng.below(10 * NEAR);
        call("maya", T0, liquidity);
        contract.create_market(QUESTION.into(), None, None, T0 + HOUR);
        let mut paid_in = liquidity / YOCTO_PER_UNIT;
        let mut paid_out = 0u128;

        for step in 0..150 {
            let trader = traders[rng.below(5) as usize];
            let outcome = if rng.below(2) == 0 { Outcome::Yes } else { Outcome::No };
            let at = T0 + 1 + step;
            if rng.below(3) > 0 {
                let amount = 10 * MILLI + rng.below(5 * NEAR);
                call(trader, at, amount);
                contract.buy(1, outcome, None);
                paid_in += amount / YOCTO_PER_UNIT;
            } else {
                let held = contract.get_position(1, account(trader));
                let held = match outcome {
                    Outcome::Yes => held.yes.0,
                    Outcome::No => held.no.0,
                };
                let amount = rng.below(held / 2 + 1) / YOCTO_PER_UNIT * YOCTO_PER_UNIT;
                let Some(quote) = contract.quote_sell(1, outcome, U128(amount)) else {
                    continue;
                };
                if quote.shares.0 > held {
                    continue;
                }
                call(trader, at, 0);
                contract.sell(1, outcome, U128(amount), None);
                paid_out += amount / YOCTO_PER_UNIT;
            }
            check_sets(&contract, &traders);
        }

        let weight = match seed % 4 {
            0 => 0,
            1 => 10_000,
            _ => rng.below(10_001) as u32,
        };
        call("admin", T0 + HOUR, 0);
        contract.resolve(1, weight, None);
        let collateral = stored(&contract, 1).collateral;
        assert_eq!(collateral, paid_in - paid_out);

        let mut payouts = 0u128;
        let mut redeemers = 0u128;
        for who in traders.iter().chain(std::iter::once(&"maya")) {
            let held = contract.get_position(1, account(who));
            if held.redeemable.is_none() || (held.yes.0 == 0 && held.no.0 == 0 && *who != "maya") {
                continue;
            }
            call(who, T0 + HOUR + 1, 0);
            payouts += contract.redeem(1).0 / YOCTO_PER_UNIT;
            redeemers += 1;
        }
        assert!(payouts <= collateral, "seed {seed}: paid {payouts} of {collateral}");
        assert!(
            collateral - payouts <= redeemers,
            "seed {seed}: dust {} for {redeemers} redeems",
            collateral - payouts
        );
        assert_eq!(stored(&contract, 1).collateral, collateral - payouts);
    }
}
