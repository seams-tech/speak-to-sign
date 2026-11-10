//! `pm-notes`: a parimutuel prediction market on community notes, for the Speak-to-Sign demo.
//!
//! The currency is NEAR testnet USDC (NEP-141, 6 decimals). Money comes in with the token's
//! `ft_transfer_call`, and the message says what it is for.
//!
//! - **Create:** anyone opens a yes-or-no market about a note ("Will this note hold up?") with
//!   context text for the AI and a close time. The USDC sent (at least 1) is the creator's seed,
//!   split 50/50 into a YES stake and a NO stake.
//! - **Bet:** anyone puts USDC (at least 0.1) into the YES pool or the NO pool until the close.
//!   The odds are the pool split.
//! - **Resolve:** after the close, any account calls `request_resolution`. The contract calls
//!   the OutLayer resolver worker, which asks JEV (Typesafe) or NEAR AI for the probability
//!   that the answer is YES. The admin can resolve instead (`resolve`).
//! - **Claim:** the probability, snapped at the ends, is the payout weight `w`. With the total
//!   pool `T`, the YES bets share `w × T` and the NO bets share `(1 − w) × T`, each in
//!   proportion to the stakes. So a grey answer pays both sides. If one pool is empty,
//!   everyone gets the stake back.
//!
//! Amounts are USDC base units (10^6 for 1 USDC), as `U128` strings in the JSON. Each payout
//! rounds down, so the payouts never add up to more than the pool. The `request_resolution`
//! fee is NEAR, because OutLayer charges NEAR.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use spoken_intent::{request_digest, BetOutcomeV1, NearAccount, Network, SpokenRequestV1, UsdcAmount};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, env,
    near,
};

/// NEAR testnet USDC (Circle), the default currency.
pub const DEFAULT_TOKEN: &str = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
/// 1 USDC in base units (6 decimals).
pub const ONE_USDC: u128 = 1_000_000;
/// The smallest seed of a new market: 1 USDC.
pub const MIN_SEED: u128 = ONE_USDC;
/// The smallest bet: 0.1 USDC.
pub const MIN_BET: u128 = ONE_USDC / 10;
/// The largest total pool of one market: 1,000,000 USDC. It keeps every product in a u128.
pub const MAX_POOL: u128 = 1_000_000 * ONE_USDC;
/// The gas for the token's `ft_transfer` of a claim, and for the callback after it.
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(10);
pub const CLAIM_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The longest question, in Unicode scalar values.
pub const MAX_QUESTION_CHARS: usize = 200;
/// The longest context (the note text and the post text for the AI).
pub const MAX_CONTEXT_CHARS: usize = 1_000;
/// The longest rationale that a resolution keeps.
pub const MAX_RATIONALE_CHARS: usize = 500;
/// A market closes at most 30 days after it opens.
pub const MAX_OPEN_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// `get_markets` returns at most this many markets.
pub const MAX_MARKETS_PER_VIEW: u64 = 50;
/// The odds history keeps this many points for each market.
pub const MAX_ODDS_POINTS: usize = 50;
/// 100% in basis points.
pub const BPS: u16 = 10_000;
/// A probability at or above this pays the YES bets in full (`w` = 1).
pub const SNAP_HIGH_BPS: u16 = 9_000;
/// A probability at or below this pays the NO bets in full (`w` = 0).
pub const SNAP_LOW_BPS: u16 = 1_000;
/// The smallest deposit for `request_resolution`. It pays the OutLayer run: OutLayer's estimate
/// for the resource limits below is 0.007 NEAR (10 Nov 2026), and it refunds the unused part to
/// the account that asked.
pub const MIN_RESOLUTION_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// The gas for OutLayer `request_execution`.
pub const OUTLAYER_GAS: Gas = Gas::from_tgas(200);
/// The gas for the `on_resolution` callback.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(20);
/// `request_resolution` needs at least this much prepaid gas. Attach 300 Tgas.
pub const MIN_REQUEST_GAS: Gas = Gas::from_tgas(250);
/// After this time, a request without an answer no longer blocks a new request.
pub const PENDING_TIMEOUT_MS: u64 = 15 * 60 * 1_000;
/// The longest worker error that `resolution_failed` shows.
pub const MAX_ERROR_CHARS: usize = 200;
/// The largest resolver answer that the callback reads.
pub const MAX_RESULT_BYTES: usize = 4_096;
/// The default OutLayer project of the resolver worker.
pub const DEFAULT_PROJECT_ID: &str = "seams-v1.testnet/pm-notes-resolver";

const MAX_INSTRUCTIONS: u64 = 1_000_000_000;
const MAX_MEMORY_MB: u32 = 128;
const MAX_EXECUTION_SECONDS: u64 = 60;

/// The key of the Seams voice verifier on testnet, which signs each verdict. The admin can set
/// another key (`set_voice_verifier_key`).
pub const DEFAULT_VOICE_VERIFIER_KEY: &str = "ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U";
/// The network that the request digest of a bet names.
const NETWORK: Network = Network::Testnet;
// The voice settings are under raw storage keys, not in the contract's state struct, so an
// upgrade needs no state migration.
const VOICE_VERIFIER_KEY: &[u8] = b"voice:verifier_key";
/// Holds one byte, 0, when bets need no verdict. Absent: bets need one.
const VOICE_REQUIRED_KEY: &[u8] = b"voice:required";
/// The prefix of the marker of a used verdict: `voice:used:<SHA-256 of the verdict JSON>`.
const VOICE_USED_PREFIX: &[u8] = b"voice:used:";

const EVENT_STANDARD: &str = "pm_notes";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Yes,
    No,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolutionSource {
    /// The OutLayer resolver worker (JEV or NEAR AI).
    Ai,
    /// The contract admin.
    Admin,
}

/// How a market resolved. Final.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    /// The probability of YES that the resolver gave, in basis points.
    pub raw_yes_bps: u16,
    /// The payout weight after the snapping: the YES bets share this / 10,000 of the pool.
    pub payout_yes_bps: u16,
    pub source: ResolutionSource,
    /// `jev` or `near-ai` for an AI resolution.
    pub provider: Option<String>,
    pub model: Option<String>,
    pub rationale: String,
    /// The admin, or the account that requested the AI resolution.
    pub resolved_by: AccountId,
    pub resolved_at_ms: u64,
}

/// An OutLayer request that has no answer yet.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingRequest {
    pub request_id: u64,
    pub requested_by: AccountId,
    pub requested_at_ms: u64,
}

/// One point of the odds history: the YES share of the pool after a bet.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OddsPoint {
    pub at_ms: u64,
    pub yes_bps: u16,
}

/// A market as the contract stores it. Amounts are USDC base units.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Market {
    pub creator: AccountId,
    pub question: String,
    /// The note and the post for the AI. Frozen at the open.
    pub context: String,
    pub note_id: Option<u64>,
    pub created_at_ms: u64,
    pub closes_at_ms: u64,
    pub yes_pool: u128,
    pub no_pool: u128,
    /// The number of bets (the seed is not a bet).
    pub bets: u32,
    /// The USDC that the claims paid.
    pub paid_out: u128,
    pub pending: Option<PendingRequest>,
    pub resolution: Option<Resolution>,
}

impl Market {
    fn total(&self) -> u128 {
        self.yes_pool + self.no_pool
    }

    /// True while a request waits for its answer and is not older than the timeout.
    fn request_is_live(&self, now_ms: u64) -> bool {
        self.pending
            .as_ref()
            .is_some_and(|p| now_ms < p.requested_at_ms.saturating_add(PENDING_TIMEOUT_MS))
    }

    fn status(&self, now_ms: u64) -> MarketStatus {
        if self.resolution.is_some() {
            MarketStatus::Resolved
        } else if now_ms < self.closes_at_ms {
            MarketStatus::Open
        } else if self.request_is_live(now_ms) {
            MarketStatus::Resolving
        } else {
            MarketStatus::Closed
        }
    }

    fn view(&self, id: u64) -> MarketView {
        MarketView {
            id,
            question: self.question.clone(),
            context: self.context.clone(),
            note_id: self.note_id,
            creator: self.creator.clone(),
            created_at_ms: self.created_at_ms,
            closes_at_ms: self.closes_at_ms,
            yes_pool: U128(self.yes_pool),
            no_pool: U128(self.no_pool),
            total_pool: U128(self.total()),
            yes_share_bps: yes_share_bps(self.yes_pool, self.no_pool),
            bets: self.bets,
            refund_all: self.yes_pool == 0 || self.no_pool == 0,
            paid_out: U128(self.paid_out),
            status: self.status(env::block_timestamp_ms()),
            pending: self.pending.clone(),
            resolution: self.resolution.clone(),
        }
    }
}

/// An account's stakes in one market.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stake {
    pub yes: u128,
    pub no: u128,
    pub claimed: bool,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketStatus {
    /// Betting is on.
    Open,
    /// Betting is off. The market waits for `request_resolution` or `resolve`.
    Closed,
    /// An OutLayer request waits for its answer.
    Resolving,
    Resolved,
}

/// A market as the views return it. Amounts are USDC base units, as strings.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarketView {
    pub id: u64,
    pub question: String,
    pub context: String,
    pub note_id: Option<u64>,
    pub creator: AccountId,
    pub created_at_ms: u64,
    pub closes_at_ms: u64,
    pub yes_pool: U128,
    pub no_pool: U128,
    pub total_pool: U128,
    /// The YES share of the pool in basis points (0 to 10,000): the odds.
    pub yes_share_bps: u32,
    pub bets: u32,
    /// True when one pool is empty: every claim is then a refund of the stakes.
    pub refund_all: bool,
    pub paid_out: U128,
    pub status: MarketStatus,
    pub pending: Option<PendingRequest>,
    pub resolution: Option<Resolution>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionView {
    /// The account's YES and NO stakes (the creator's seed included).
    pub yes: U128,
    pub no: U128,
    /// What `claim` pays (or paid) this account. Null before the resolution.
    pub payout: Option<U128>,
    pub claimed: bool,
}

/// What a bet would do now.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BetQuote {
    /// The bet, in USDC base units.
    pub amount: U128,
    /// What this bet alone pays if the verdict is 100% its side and no other bet comes.
    pub payout_if_right: U128,
    /// The YES share after the bet, in basis points.
    pub yes_share_bps: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SecretsRef {
    pub profile: String,
    pub account_id: AccountId,
}

/// Where `request_resolution` sends the request.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolverConfig {
    /// `outlayer.testnet` on testnet. The sandbox test uses a fake.
    pub outlayer_account: AccountId,
    /// The OutLayer project of the resolver worker, `owner/name`.
    pub project_id: String,
    /// A version of the project (the WASM SHA-256, hex). Null: the active version.
    #[serde(default)]
    pub version_key: Option<String>,
    /// The OutLayer secrets with `TYPESAFE_API_KEY` and `NEAR_AI_API_KEY`.
    #[serde(default)]
    pub secrets_ref: Option<SecretsRef>,
}

impl Default for ResolverConfig {
    fn default() -> Self {
        Self {
            outlayer_account: "outlayer.testnet".parse().unwrap(),
            project_id: DEFAULT_PROJECT_ID.to_owned(),
            version_key: None,
            secrets_ref: None,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub admin: AccountId,
    /// The NEP-141 token of the bets: USDC.
    pub token: AccountId,
    pub resolver: ResolverConfig,
    pub snap_high_bps: u16,
    pub snap_low_bps: u16,
    pub min_seed: U128,
    pub min_bet: U128,
    pub min_resolution_deposit: U128,
    pub max_open_ms: u64,
}

/// A valid resolver answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiAnswer {
    pub yes_bps: u16,
    pub provider: String,
    pub model: Option<String>,
    pub rationale: String,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Markets,
    Stakes,
    NoteMarkets,
    Odds,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PredictionMarkets {
    /// Can resolve and close every market, and change the resolver config.
    admin: AccountId,
    /// The NEP-141 token of the bets (USDC). Only it can call `ft_on_transfer`.
    token: AccountId,
    resolver: ResolverConfig,
    /// The id of the newest market. The first market gets id 1.
    last_market_id: u64,
    /// The id of the newest OutLayer request. The first request gets id 1.
    last_request_id: u64,
    markets: LookupMap<u64, Market>,
    stakes: LookupMap<(u64, AccountId), Stake>,
    /// The newest market of each community note.
    note_markets: LookupMap<u64, u64>,
    /// The last 50 odds points of each market.
    odds: LookupMap<u64, Vec<OddsPoint>>,
}

#[near]
impl PredictionMarkets {
    /// `token` defaults to NEAR testnet USDC. `resolver` defaults to `outlayer.testnet` and the
    /// project `seams-v1.testnet/pm-notes-resolver`, with no secrets. Register this contract
    /// with the token (`storage_deposit`) before the first claim.
    #[init]
    pub fn new(admin: AccountId, token: Option<AccountId>, resolver: Option<ResolverConfig>) -> Self {
        let resolver = resolver.unwrap_or_default();
        check_resolver_config(&resolver);
        Self {
            admin,
            token: token.unwrap_or_else(|| DEFAULT_TOKEN.parse().unwrap()),
            resolver,
            last_market_id: 0,
            last_request_id: 0,
            markets: LookupMap::new(StorageKey::Markets),
            stakes: LookupMap::new(StorageKey::Stakes),
            note_markets: LookupMap::new(StorageKey::NoteMarkets),
            odds: LookupMap::new(StorageKey::Odds),
        }
    }

    /// The token calls this for `ft_transfer_call` (NEP-141). `msg` says what the USDC is for:
    /// - `{"action": "create_market", "question", "context"?, "note_id"?, "closes_at_ms"}`: the
    ///   USDC is the seed of a new market (at least 1 USDC).
    /// - `{"action": "bet", "market_id", "outcome": "yes" | "no", "verdict_json", "signature_b64"}`:
    ///   a bet (at least 0.1 USDC). The verdict is the bettor's spoken bet, signed by the voice
    ///   verifier: the contract takes the bet only if the verdict is for this account, this
    ///   market, this outcome and this amount, has not expired and was not used before.
    ///
    /// It uses all of the USDC and returns 0. A refused transfer fails, and the token then
    /// sends the USDC back.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token {
            env::panic_str("only the market token can send to this contract");
        }
        let mut message: TransferMessage = serde_json::from_str(&msg).unwrap_or_else(|_| {
            env::panic_str("msg must be a create_market or bet message")
        });
        let action = std::mem::take(&mut message.action);
        match (action.as_str(), message) {
            ("create_market", TransferMessage { question: Some(question), context, note_id, closes_at_ms: Some(closes_at_ms), market_id: None, outcome: None, .. }) => {
                self.create_market(sender_id, amount.0, question, context, note_id, closes_at_ms);
            }
            ("bet", TransferMessage { market_id: Some(market_id), outcome: Some(outcome), question: None, context: None, note_id: None, closes_at_ms: None, verdict_json, signature_b64, .. }) => {
                self.check_spoken_bet(&sender_id, amount.0, market_id, outcome, verdict_json.as_deref(), signature_b64.as_deref());
                self.bet(sender_id, amount.0, market_id, outcome);
            }
            _ => env::panic_str("msg must be a create_market or bet message"),
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Stops the betting now. Only the creator or the admin, and only while the market is open.
    pub fn close_market(&mut self, market_id: u64) {
        let caller = env::predecessor_account_id();
        let mut market = self.open_market(market_id);
        if caller != market.creator && caller != self.admin {
            env::panic_str("only the creator or the admin can close this market");
        }
        market.closes_at_ms = env::block_timestamp_ms();
        self.markets.insert(market_id, market);
        emit("market_closed", MarketClosed { market_id, closed_by: &caller });
    }

    /// Asks the OutLayer resolver worker for the probability of YES. Any account can call it
    /// after the close. Attach at least 0.01 NEAR (the OutLayer fee) and 300 Tgas. OutLayer
    /// refunds the unused part of the fee to the caller (`payer_account_id`). The result of the
    /// transaction is the result of `on_resolution`: true if the market resolved.
    #[payable]
    pub fn request_resolution(&mut self, market_id: u64) -> Promise {
        let deposit = env::attached_deposit();
        if deposit < MIN_RESOLUTION_DEPOSIT {
            env::panic_str("attach at least 0.01 NEAR for the OutLayer run");
        }
        if env::prepaid_gas() < MIN_REQUEST_GAS {
            env::panic_str("attach 300 Tgas to request a resolution");
        }
        let now = env::block_timestamp_ms();
        let mut market = self.market(market_id);
        match market.status(now) {
            MarketStatus::Closed => {}
            MarketStatus::Open => env::panic_str("this market is still open for betting"),
            MarketStatus::Resolving => env::panic_str("a resolution request is already pending"),
            MarketStatus::Resolved => env::panic_str("this market is resolved"),
        }
        let requested_by = env::predecessor_account_id();
        self.last_request_id += 1;
        let request_id = self.last_request_id;
        let input = serde_json::to_string(&ResolverInput {
            market_id,
            question: &market.question,
            context: &market.context,
            note_id: market.note_id,
            contract: &env::current_account_id(),
        })
        .unwrap_or_else(|_| env::panic_str("cannot serialize the resolver input"));
        market.pending = Some(PendingRequest {
            request_id,
            requested_by: requested_by.clone(),
            requested_at_ms: now,
        });
        self.markets.insert(market_id, market);
        emit(
            "resolution_requested",
            ResolutionRequested {
                market_id,
                request_id,
                requested_by: &requested_by,
                deposit: U128(deposit.as_yoctonear()),
            },
        );

        let args = outlayer_args(&self.resolver, input, &requested_by);
        Promise::new(self.resolver.outlayer_account.clone())
            .function_call("request_execution".to_owned(), args, deposit, OUTLAYER_GAS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_resolution".to_owned(),
                to_json_bytes(&CallbackArgs { market_id, request_id }),
                NearToken::from_yoctonear(0),
                CALLBACK_GAS,
            ))
    }

    /// The OutLayer callback. It never fails, because a failed callback would lose the answer.
    /// A bad or missing answer emits `resolution_failed`, and the market waits for a new
    /// request. Returns true if the market resolved.
    #[private]
    pub fn on_resolution(&mut self, market_id: u64, request_id: u64) -> bool {
        let result = env::promise_result_checked(0, MAX_RESULT_BYTES);
        let Some(mut market) = self.markets.get(&market_id).cloned() else {
            return false;
        };
        let failed = |reason: &str| {
            emit("resolution_failed", ResolutionFailed { market_id, request_id, reason });
            false
        };
        if market.resolution.is_some() {
            return failed("the market was resolved first");
        }
        let requested_by = match market.pending.take() {
            Some(pending) if pending.request_id == request_id => pending.requested_by,
            _ => return failed("a newer request replaced this one"),
        };
        match parse_answer(result) {
            Ok(answer) => {
                let rationale = if answer.rationale.is_empty() {
                    format!(
                        "{} gave a YES probability of {}.",
                        answer.provider,
                        percent(answer.yes_bps)
                    )
                } else {
                    answer.rationale
                };
                let resolution = Resolution {
                    raw_yes_bps: answer.yes_bps,
                    payout_yes_bps: snap(answer.yes_bps),
                    source: ResolutionSource::Ai,
                    provider: Some(answer.provider),
                    model: answer.model,
                    rationale,
                    resolved_by: requested_by,
                    resolved_at_ms: env::block_timestamp_ms(),
                };
                emit_resolved(market_id, &resolution);
                market.resolution = Some(resolution);
                self.markets.insert(market_id, market);
                true
            }
            Err(reason) => {
                self.markets.insert(market_id, market);
                failed(&reason)
            }
        }
    }

    /// The admin fallback: resolves a closed market with a YES probability in basis points
    /// (0 to 10,000). The same snapping applies. A pending AI answer is then ignored.
    pub fn resolve(&mut self, market_id: u64, yes_bps: u32, rationale: Option<String>) {
        let caller = env::predecessor_account_id();
        if caller != self.admin {
            env::panic_str("only the admin can resolve a market");
        }
        if yes_bps > u32::from(BPS) {
            env::panic_str("yes_bps must be 0 to 10000");
        }
        let rationale = rationale.unwrap_or_default().trim().to_owned();
        if rationale.chars().count() > MAX_RATIONALE_CHARS {
            env::panic_str("rationale must have at most 500 characters");
        }
        let now = env::block_timestamp_ms();
        let mut market = self.market(market_id);
        match market.status(now) {
            MarketStatus::Closed | MarketStatus::Resolving => {}
            MarketStatus::Open => env::panic_str("this market is still open for betting"),
            MarketStatus::Resolved => env::panic_str("this market is resolved"),
        }
        let yes_bps = yes_bps as u16;
        let resolution = Resolution {
            raw_yes_bps: yes_bps,
            payout_yes_bps: snap(yes_bps),
            source: ResolutionSource::Admin,
            provider: None,
            model: None,
            rationale: if rationale.is_empty() {
                "Resolved by the admin.".to_owned()
            } else {
                rationale
            },
            resolved_by: caller,
            resolved_at_ms: now,
        };
        emit_resolved(market_id, &resolution);
        market.pending = None;
        market.resolution = Some(resolution);
        self.markets.insert(market_id, market);
    }

    /// Sends the caller's payout in USDC, once: the caller's share of `w × T` for the YES stake
    /// and of `(1 − w) × T` for the NO stake, rounded down. If one pool is empty, the payout is
    /// the stakes. The result is the USDC paid (0 if the token refused the transfer). Attach
    /// 30 Tgas or more.
    pub fn claim(&mut self, market_id: u64) -> PromiseOrValue<U128> {
        let account = env::predecessor_account_id();
        let mut market = self.market(market_id);
        let Some(weight) = market.resolution.as_ref().map(|r| r.payout_yes_bps) else {
            env::panic_str("this market is not resolved yet");
        };
        let key = (market_id, account.clone());
        let Some(mut stake) = self.stakes.get(&key).copied() else {
            env::panic_str("nothing to claim");
        };
        if stake.claimed {
            env::panic_str("already claimed");
        }
        let amount = payout(stake.yes, stake.no, market.yes_pool, market.no_pool, weight);
        stake.claimed = true;
        self.stakes.insert(key, stake);
        market.paid_out += amount;
        if market.paid_out > market.total() {
            env::panic_str("the market has too little NEAR");
        }
        let refund = market.yes_pool == 0 || market.no_pool == 0;
        self.markets.insert(market_id, market);
        emit(
            "claimed",
            Claimed { market_id, account_id: &account, amount: U128(amount), refund },
        );
        if amount == 0 {
            return PromiseOrValue::Value(U128(0));
        }
        let transfer = to_json_bytes(&FtTransferArgs { receiver_id: &account, amount: U128(amount), memo: "pm-notes claim" });
        Promise::new(self.token.clone())
            .function_call("ft_transfer".to_owned(), transfer, NearToken::from_yoctonear(1), FT_TRANSFER_GAS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_claim_transfer".to_owned(),
                to_json_bytes(&ClaimCallbackArgs { market_id, account_id: &account, amount: U128(amount) }),
                NearToken::from_yoctonear(0),
                CLAIM_CALLBACK_GAS,
            ))
            .into()
    }

    /// After the token's `ft_transfer` of a claim. If the transfer failed (for example, the
    /// account is not registered with the token), the claim is open again. Returns the USDC paid.
    #[private]
    pub fn on_claim_transfer(&mut self, market_id: u64, account_id: AccountId, amount: U128) -> U128 {
        if env::promise_result_checked(0, 64).is_ok() {
            return amount;
        }
        let key = (market_id, account_id.clone());
        if let Some(mut stake) = self.stakes.get(&key).copied() {
            stake.claimed = false;
            self.stakes.insert(key, stake);
        }
        if let Some(mut market) = self.markets.get(&market_id).cloned() {
            market.paid_out = market.paid_out.saturating_sub(amount.0);
            self.markets.insert(market_id, market);
        }
        emit("claim_failed", ClaimFailed { market_id, account_id: &account_id, amount });
        U128(0)
    }

    /// Sets the key of the voice verifier that signs the verdict of each bet,
    /// `ed25519:<base58 of 32 bytes>`. Only the admin.
    pub fn set_voice_verifier_key(&mut self, verifier_public_key: String) {
        if env::predecessor_account_id() != self.admin {
            env::panic_str("only the admin can change the voice verifier key");
        }
        let key = verdict::parse_ed25519_key(&verifier_public_key)
            .unwrap_or_else(|| env::panic_str("verifier_public_key must be ed25519:<base58 of 32 bytes>"));
        env::storage_write(VOICE_VERIFIER_KEY, &key);
    }

    /// Says if a bet needs a voice verdict. It does by default. Only the admin: it is the way
    /// to keep the markets open if the voice verifier is down.
    pub fn set_voice_required(&mut self, required: bool) {
        if env::predecessor_account_id() != self.admin {
            env::panic_str("only the admin can change the voice rule");
        }
        if required {
            env::storage_remove(VOICE_REQUIRED_KEY);
        } else {
            env::storage_write(VOICE_REQUIRED_KEY, &[0]);
        }
    }

    /// The voice rule of a bet: if a bet needs a verdict, and the key that must sign it.
    pub fn get_voice_config(&self) -> VoiceConfigView {
        VoiceConfigView { required: voice_required(), verifier_public_key: verdict::format_ed25519_key(&voice_verifier_key()) }
    }

    /// Changes where `request_resolution` sends the request. Only the admin.
    pub fn set_resolver_config(&mut self, resolver: ResolverConfig) {
        if env::predecessor_account_id() != self.admin {
            env::panic_str("only the admin can change the resolver config");
        }
        check_resolver_config(&resolver);
        self.resolver = resolver;
    }

    // --- views ---

    pub fn get_market(&self, market_id: u64) -> Option<MarketView> {
        self.markets.get(&market_id).map(|market| market.view(market_id))
    }

    /// The newest markets first, at most 50. `before` starts below that id.
    pub fn get_markets(&self, before: Option<u64>, limit: Option<u64>) -> Vec<MarketView> {
        let limit = limit.unwrap_or(MAX_MARKETS_PER_VIEW).min(MAX_MARKETS_PER_VIEW);
        let top = before.map_or(self.last_market_id, |b| {
            b.saturating_sub(1).min(self.last_market_id)
        });
        (1..=top)
            .rev()
            .take(limit as usize)
            .filter_map(|id| self.get_market(id))
            .collect()
    }

    /// The newest market about a community note.
    pub fn get_market_for_note(&self, note_id: u64) -> Option<MarketView> {
        self.note_markets.get(&note_id).and_then(|id| self.get_market(*id))
    }

    pub fn get_position(&self, market_id: u64, account_id: AccountId) -> PositionView {
        let stake = self.stakes.get(&(market_id, account_id)).copied().unwrap_or_default();
        let payout = self.markets.get(&market_id).and_then(|market| {
            let weight = market.resolution.as_ref()?.payout_yes_bps;
            Some(U128(payout(stake.yes, stake.no, market.yes_pool, market.no_pool, weight)))
        });
        PositionView {
            yes: U128(stake.yes),
            no: U128(stake.no),
            payout,
            claimed: stake.claimed,
        }
    }

    /// What a bet of `amount` USDC (base units) on `outcome` would do now, or null when the
    /// market is not open or the amount is below 0.1 USDC.
    pub fn quote_bet(&self, market_id: u64, outcome: Outcome, amount: U128) -> Option<BetQuote> {
        let market = self.markets.get(&market_id)?;
        let units = amount.0;
        if market.status(env::block_timestamp_ms()) != MarketStatus::Open
            || units < MIN_BET
            || market.total() + units > MAX_POOL
        {
            return None;
        }
        let (yes, no) = match outcome {
            Outcome::Yes => (market.yes_pool + units, market.no_pool),
            Outcome::No => (market.yes_pool, market.no_pool + units),
        };
        let paid = match outcome {
            Outcome::Yes => payout(units, 0, yes, no, BPS),
            Outcome::No => payout(0, units, yes, no, 0),
        };
        Some(BetQuote {
            amount: U128(units),
            payout_if_right: U128(paid),
            yes_share_bps: yes_share_bps(yes, no),
        })
    }

    /// The last 50 odds points of a market, oldest first. The first point is the open.
    pub fn get_odds_history(&self, market_id: u64) -> Vec<OddsPoint> {
        self.odds.get(&market_id).cloned().unwrap_or_default()
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin: self.admin.clone(),
            token: self.token.clone(),
            resolver: self.resolver.clone(),
            snap_high_bps: SNAP_HIGH_BPS,
            snap_low_bps: SNAP_LOW_BPS,
            min_seed: U128(MIN_SEED),
            min_bet: U128(MIN_BET),
            min_resolution_deposit: U128(MIN_RESOLUTION_DEPOSIT.as_yoctonear()),
            max_open_ms: MAX_OPEN_MS,
        }
    }
}

impl PredictionMarkets {
    /// Opens a market with `seed` USDC from `creator`: half goes into the YES pool and half into
    /// the NO pool, as the creator's stakes. So the odds start at 50%. Returns the market id.
    fn create_market(
        &mut self,
        creator: AccountId,
        seed: u128,
        question: String,
        context: Option<String>,
        note_id: Option<u64>,
        closes_at_ms: u64,
    ) -> u64 {
        let question = question.trim().to_owned();
        let chars = question.chars().count();
        if chars == 0 || chars > MAX_QUESTION_CHARS {
            env::panic_str("question must have 1 to 200 characters");
        }
        let context = context.unwrap_or_default().trim().to_owned();
        if context.chars().count() > MAX_CONTEXT_CHARS {
            env::panic_str("context must have at most 1000 characters");
        }
        let now = env::block_timestamp_ms();
        if closes_at_ms <= now {
            env::panic_str("closes_at_ms must be in the future");
        }
        if closes_at_ms - now > MAX_OPEN_MS {
            env::panic_str("closes_at_ms must be at most 30 days ahead");
        }
        if seed < MIN_SEED {
            env::panic_str("the seed must be at least 1 USDC");
        }
        if seed > MAX_POOL {
            env::panic_str("the seed must be at most 1,000,000 USDC");
        }
        let yes = seed / 2;
        let no = seed - yes;

        self.last_market_id += 1;
        let id = self.last_market_id;
        self.markets.insert(
            id,
            Market {
                creator: creator.clone(),
                question: question.clone(),
                context,
                note_id,
                created_at_ms: now,
                closes_at_ms,
                yes_pool: yes,
                no_pool: no,
                bets: 0,
                paid_out: 0,
                pending: None,
                resolution: None,
            },
        );
        self.stakes.insert((id, creator.clone()), Stake { yes, no, claimed: false });
        self.odds.insert(id, vec![OddsPoint { at_ms: now, yes_bps: yes_share_bps(yes, no) as u16 }]);
        if let Some(note_id) = note_id {
            self.note_markets.insert(note_id, id);
        }
        emit(
            "market_created",
            MarketCreated {
                market_id: id,
                creator: &creator,
                question: &question,
                note_id,
                closes_at_ms,
                seed: U128(seed),
            },
        );
        id
    }

    /// A bet of `amount` USDC on `outcome`. Returns the account's stake on that outcome.
    /// Panics unless the bet has the verdict of its own spoken sentence. The request digest
    /// names the bettor, this contract, the token, the market, the outcome and the amount, so a
    /// verdict for any other bet does not pass. A verdict passes once.
    fn check_spoken_bet(&self, account: &AccountId, amount: u128, market_id: u64, outcome: Outcome, verdict_json: Option<&str>, signature_b64: Option<&str>) {
        if !voice_required() {
            return;
        }
        let (Some(verdict_json), Some(signature_b64)) = (verdict_json, signature_b64) else {
            env::panic_str("say the bet: it needs verdict_json and signature_b64 from the voice verifier");
        };
        let request = SpokenRequestV1::MarketBet {
            network: NETWORK,
            owner: near_account(account),
            market: near_account(&env::current_account_id()),
            token: near_account(&self.token),
            market_id,
            outcome: match outcome {
                Outcome::Yes => BetOutcomeV1::Yes,
                Outcome::No => BetOutcomeV1::No,
            },
            amount: UsdcAmount::from_units(amount)
                .unwrap_or_else(|_| env::panic_str("a spoken bet is a whole number of cents, up to 1,000,000 USDC")),
        };
        verdict::check_verdict(&voice_verifier_key(), &request_digest(&request), verdict_json, signature_b64);
        let mut used = VOICE_USED_PREFIX.to_vec();
        used.extend_from_slice(&env::sha256_array(verdict_json.as_bytes()));
        if env::storage_has_key(&used) {
            env::panic_str("this verdict was used for a bet before");
        }
        env::storage_write(&used, &[1]);
    }

    fn bet(&mut self, account: AccountId, amount: u128, market_id: u64, outcome: Outcome) -> u128 {
        if amount < MIN_BET {
            env::panic_str("bet at least 0.1 USDC");
        }
        let mut market = self.open_market(market_id);
        if market.total() + amount > MAX_POOL {
            env::panic_str("the pool is full");
        }
        match outcome {
            Outcome::Yes => market.yes_pool += amount,
            Outcome::No => market.no_pool += amount,
        }
        market.bets += 1;
        let share = yes_share_bps(market.yes_pool, market.no_pool);

        let key = (market_id, account.clone());
        let mut stake = self.stakes.get(&key).copied().unwrap_or_default();
        let staked = match outcome {
            Outcome::Yes => {
                stake.yes += amount;
                stake.yes
            }
            Outcome::No => {
                stake.no += amount;
                stake.no
            }
        };
        self.stakes.insert(key, stake);

        let mut odds = self.odds.get(&market_id).cloned().unwrap_or_default();
        if odds.len() >= MAX_ODDS_POINTS {
            odds.remove(0);
        }
        odds.push(OddsPoint { at_ms: env::block_timestamp_ms(), yes_bps: share as u16 });
        self.odds.insert(market_id, odds);

        emit(
            "bet",
            BetPlaced {
                market_id,
                account_id: &account,
                outcome,
                amount: U128(amount),
                yes_pool: U128(market.yes_pool),
                no_pool: U128(market.no_pool),
                yes_share_bps: share,
                bets: market.bets,
            },
        );
        self.markets.insert(market_id, market);
        staked
    }


    fn market(&self, market_id: u64) -> Market {
        self.markets
            .get(&market_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("market {market_id} does not exist")))
    }

    fn open_market(&self, market_id: u64) -> Market {
        let market = self.market(market_id);
        match market.status(env::block_timestamp_ms()) {
            MarketStatus::Open => market,
            MarketStatus::Closed | MarketStatus::Resolving => {
                env::panic_str("this market is closed for betting")
            }
            MarketStatus::Resolved => env::panic_str("this market is resolved"),
        }
    }
}

// --- parimutuel math ---

/// The YES share of the pool in basis points. 50% for an empty pool.
pub fn yes_share_bps(yes_pool: u128, no_pool: u128) -> u32 {
    let total = yes_pool + no_pool;
    if total == 0 { 5_000 } else { (yes_pool * u128::from(BPS) / total) as u32 }
}

/// The payout weight for a YES probability: at or above 90% pays the YES bets in full, at or
/// below 10% pays the NO bets in full, and the grey zone between pays the probability itself.
pub fn snap(raw_yes_bps: u16) -> u16 {
    if raw_yes_bps >= SNAP_HIGH_BPS {
        BPS
    } else if raw_yes_bps <= SNAP_LOW_BPS {
        0
    } else {
        raw_yes_bps
    }
}

/// The payout (units) of the stakes `yes` and `no` at the weight `w`:
/// `yes / yes_pool × w × T + no / no_pool × (1 − w) × T`, each part rounded down. If one pool
/// is empty, the payout is the stakes.
pub fn payout(yes: u128, no: u128, yes_pool: u128, no_pool: u128, payout_yes_bps: u16) -> u128 {
    if yes_pool == 0 || no_pool == 0 {
        return yes + no;
    }
    let total = yes_pool + no_pool;
    let w = u128::from(payout_yes_bps.min(BPS));
    let bps = u128::from(BPS);
    yes * w * total / (yes_pool * bps) + no * (bps - w) * total / (no_pool * bps)
}

// --- resolver answer ---

/// The resolver answer as it arrives. Unknown fields are ignored.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RawAnswer {
    #[serde(default)]
    yes_bps: Option<f64>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    rationale: Option<String>,
    /// The worker's reason when it has no answer, for example "JEV: HTTP 401".
    #[serde(default)]
    error: Option<String>,
}

/// Reads the resolver answer `{"yes_bps", "provider", "model", "rationale"}`. OutLayer gives
/// `null` for a failed run. A worker without an answer sends `{"error": "..."}`.
pub fn parse_answer(result: Result<Vec<u8>, PromiseError>) -> Result<AiAnswer, String> {
    check_answer(result).map_err(|reason| match reason {
        Reason::Fixed(text) => text.to_owned(),
        Reason::Worker(error) => {
            let error: String = error.trim().chars().take(MAX_ERROR_CHARS).collect();
            format!("the resolver failed: {error}")
        }
    })
}

/// Why an answer does not count.
enum Reason {
    Fixed(&'static str),
    Worker(String),
}

impl From<&'static str> for Reason {
    fn from(text: &'static str) -> Self {
        Reason::Fixed(text)
    }
}

fn check_answer(result: Result<Vec<u8>, PromiseError>) -> Result<AiAnswer, Reason> {
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(PromiseError::TooLong(_)) => return Err("the resolver answer is too long".into()),
        Err(_) => return Err("the OutLayer call failed".into()),
    };
    // serde also reads a struct from a JSON array: accept only an object or null.
    if !matches!(bytes.iter().find(|b| !b.is_ascii_whitespace()), Some(b'{' | b'n')) {
        return Err("the resolver answer is not an answer object".into());
    }
    let answer = serde_json::from_slice::<Option<RawAnswer>>(&bytes)
        .map_err(|_| "the resolver answer is not an answer object")?
        .ok_or("the resolver returned no answer")?;
    if let Some(error) = answer.error.filter(|e| !e.trim().is_empty()) {
        return Err(Reason::Worker(error));
    }
    let yes_bps = answer
        .yes_bps
        .filter(|bps| bps.fract() == 0.0 && (0.0..=f64::from(BPS)).contains(bps))
        .ok_or("yes_bps must be an integer from 0 to 10000")? as u16;
    let provider = answer
        .provider
        .filter(|p| is_label(p))
        .ok_or("provider must be 1 to 32 characters a-z, 0-9, '-' or '.'")?;
    if answer
        .model
        .as_ref()
        .is_some_and(|m| m.is_empty() || m.len() > 64 || !m.bytes().all(|b| b.is_ascii_graphic()))
    {
        return Err("model must be 1 to 64 printable ASCII characters".into());
    }
    let rationale = answer
        .rationale
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_RATIONALE_CHARS)
        .collect();
    Ok(AiAnswer { yes_bps, provider, model: answer.model, rationale })
}

fn is_label(text: &str) -> bool {
    (1..=32).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
}

/// The arguments of OutLayer `request_execution`.
/// `payer` gets OutLayer's refund of the unused fee.
fn outlayer_args(config: &ResolverConfig, input_data: String, payer: &AccountId) -> Vec<u8> {
    to_json_bytes(&ExecutionArgs {
        source: Source {
            project: ProjectSource {
                project_id: &config.project_id,
                version_key: config.version_key.as_deref(),
            },
        },
        input_data,
        resource_limits: ResourceLimits {
            max_instructions: MAX_INSTRUCTIONS,
            max_memory_mb: MAX_MEMORY_MB,
            max_execution_seconds: MAX_EXECUTION_SECONDS,
        },
        secrets_ref: config.secrets_ref.as_ref(),
        response_format: "Json",
        payer_account_id: payer,
    })
}

fn check_resolver_config(config: &ResolverConfig) {
    let project = &config.project_id;
    let valid_project = (3..=128).contains(&project.len())
        && project.bytes().all(|b| b.is_ascii_graphic())
        && project.split('/').count() == 2
        && project.split('/').all(|part| !part.is_empty());
    if !valid_project {
        env::panic_str("project_id must be owner/name");
    }
    if let Some(key) = &config.version_key {
        if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            env::panic_str("version_key must be 64 lowercase hex characters");
        }
    }
    if let Some(secrets) = &config.secrets_ref {
        let profile = &secrets.profile;
        if !(1..=64).contains(&profile.len())
            || !profile.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            env::panic_str("the secrets profile must be 1 to 64 letters, digits, '-' or '_'");
        }
    }
}

// --- helpers ---


/// 7300 → "73%", 7325 → "73.25%".
fn percent(bps: u16) -> String {
    if bps % 100 == 0 {
        format!("{}%", bps / 100)
    } else {
        format!("{}.{:02}%", bps / 100, bps % 100)
    }
}

fn emit_resolved(market_id: u64, resolution: &Resolution) {
    emit(
        "market_resolved",
        MarketResolved {
            market_id,
            source: resolution.source,
            raw_yes_bps: resolution.raw_yes_bps,
            payout_yes_bps: resolution.payout_yes_bps,
            provider: resolution.provider.as_deref(),
            model: resolution.model.as_deref(),
            resolved_by: &resolution.resolved_by,
        },
    );
}

fn to_json_bytes<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap_or_else(|_| env::panic_str("cannot serialize the arguments"))
}

// --- token messages and arguments ---

/// The `msg` of an `ft_transfer_call` to this contract. One flat struct, because a tagged enum
/// costs about 30 KB of WASM. `action` is `create_market` or `bet`.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TransferMessage {
    action: String,
    #[serde(default)]
    question: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    note_id: Option<u64>,
    #[serde(default)]
    closes_at_ms: Option<u64>,
    #[serde(default)]
    market_id: Option<u64>,
    #[serde(default)]
    outcome: Option<Outcome>,
    /// The verdict of a spoken bet, as the voice verifier gave it, byte for byte.
    #[serde(default)]
    verdict_json: Option<String>,
    /// Standard base64 of the verifier's signature of the verdict.
    #[serde(default)]
    signature_b64: Option<String>,
}

/// NEAR and `spoken-intent` have the same account id rules, so this holds for each valid
/// `AccountId`.
fn near_account(account: &AccountId) -> NearAccount {
    NearAccount::new(account.as_str()).unwrap_or_else(|_| env::panic_str("the account id is not valid for spoken-intent"))
}

/// True unless the admin turned the voice rule off.
fn voice_required() -> bool {
    env::storage_read(VOICE_REQUIRED_KEY).is_none_or(|value| value != [0])
}

/// The key that signs each verdict: the one that the admin set, or the default.
fn voice_verifier_key() -> [u8; 32] {
    env::storage_read(VOICE_VERIFIER_KEY)
        .and_then(|bytes| bytes.try_into().ok())
        .or_else(|| verdict::parse_ed25519_key(DEFAULT_VOICE_VERIFIER_KEY))
        .unwrap_or_else(|| env::panic_str("the voice verifier key is not valid"))
}

/// The voice rule, as `get_voice_config` gives it.
#[near(serializers = [json])]
pub struct VoiceConfigView {
    pub required: bool,
    pub verifier_public_key: String,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct FtTransferArgs<'a> {
    receiver_id: &'a AccountId,
    amount: U128,
    memo: &'static str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ClaimCallbackArgs<'a> {
    market_id: u64,
    account_id: &'a AccountId,
    amount: U128,
}

// --- OutLayer arguments and the resolver input ---

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ResolverInput<'a> {
    market_id: u64,
    question: &'a str,
    context: &'a str,
    note_id: Option<u64>,
    contract: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ExecutionArgs<'a> {
    source: Source<'a>,
    input_data: String,
    resource_limits: ResourceLimits,
    #[serde(skip_serializing_if = "Option::is_none")]
    secrets_ref: Option<&'a SecretsRef>,
    response_format: &'static str,
    payer_account_id: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Source<'a> {
    #[serde(rename = "Project")]
    project: ProjectSource<'a>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ProjectSource<'a> {
    project_id: &'a str,
    version_key: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ResourceLimits {
    max_instructions: u64,
    max_memory_mb: u32,
    max_execution_seconds: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct CallbackArgs {
    market_id: u64,
    request_id: u64,
}

// --- events ---

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MarketCreated<'a> {
    market_id: u64,
    creator: &'a AccountId,
    question: &'a str,
    note_id: Option<u64>,
    closes_at_ms: u64,
    seed: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct BetPlaced<'a> {
    market_id: u64,
    account_id: &'a AccountId,
    outcome: Outcome,
    amount: U128,
    yes_pool: U128,
    no_pool: U128,
    yes_share_bps: u32,
    bets: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MarketClosed<'a> {
    market_id: u64,
    closed_by: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ResolutionRequested<'a> {
    market_id: u64,
    request_id: u64,
    requested_by: &'a AccountId,
    deposit: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ResolutionFailed<'a> {
    market_id: u64,
    request_id: u64,
    reason: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MarketResolved<'a> {
    market_id: u64,
    source: ResolutionSource,
    raw_yes_bps: u16,
    payout_yes_bps: u16,
    provider: Option<&'a str>,
    model: Option<&'a str>,
    resolved_by: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Claimed<'a> {
    market_id: u64,
    account_id: &'a AccountId,
    amount: U128,
    refund: bool,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ClaimFailed<'a> {
    market_id: u64,
    account_id: &'a AccountId,
    amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [T; 1],
}

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"pm_notes",...}`. The data is an array of
/// one object.
fn emit<T: Serialize>(event: &str, data: T) {
    let log = EventLog { standard: EVENT_STANDARD, version: EVENT_VERSION, event, data: [data] };
    let json =
        serde_json::to_string(&log).unwrap_or_else(|_| env::panic_str("cannot serialize the event"));
    env::log_str(&format!("EVENT_JSON:{json}"));
}

mod verdict;

#[cfg(test)]
mod tests;
