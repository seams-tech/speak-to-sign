# pm-notes: a JEV prediction market for community notes

A mini prediction market for the Spoken Notes demo. Anyone opens a yes-or-no
market about a community note ("Is this note accurate and helpful context for
this post?"), and anyone trades YES and NO shares with NEAR. After the close,
an OutLayer AI call to JEV (Typesafe) gives the probability that the answer is
YES. That probability is the payout weight, so a grey, disputed note pays
fractionally. Demo only, testnet only. The plan is in `PLAN.md`.

| Part | Folder | What it is |
| ---- | ------ | ---------- |
| Contract | `src/` | The market: create, trade, close, resolve, redeem |
| Sandbox test | `sandbox/` | The release WASM in a local nearcore sandbox, with a fake OutLayer (`sandbox/fake-outlayer/`) |
| Resolver worker | `resolver/` | The OutLayer worker (`wasm32-wasip2`): JEV first, NEAR AI second |

## Toolchain

- Contract: the same as `../merge-approvals/`. Rust 1.97.0
  (`rust-toolchain.toml`), near-sdk 5.30.1, near-workspaces 0.24.0 with the
  nearcore 2.14.0 sandbox. `.cargo/config.toml` adds `--cfg near` to each
  WASM build, so a failed call keeps its message on chain.
- Worker: Rust 1.97.1 with `wasm32-wasip2` (`resolver/rust-toolchain.toml`),
  `wasi-http-client` 0.2.1, serde_json.

## How a market works

1. **Create.** The creator attaches at least 0.1 NEAR. This is the starting
   liquidity: the pool gets that many YES and NO shares, and both prices start
   at 50%.
2. **Trade.** A buy (at least 0.01 NEAR) mints complete sets (1 YES + 1 NO
   for 1 NEAR) and swaps against a fixed-product pool. A sell names the NEAR
   out. The price of YES is NO pool / (YES pool + NO pool). No fee. Trading
   stops at `closes_at_ms`, or earlier when the creator or the admin calls
   `close_market`.
3. **Resolve.** After the close, any account calls `request_resolution` with
   at least 0.05 NEAR and 300 Tgas. The contract calls `outlayer.testnet`
   `request_execution` with the resolver project. The callback
   `on_resolution` reads the answer. The admin can call `resolve` instead.
   A resolution is final.
4. **Redeem.** Each holder calls `redeem` and gets `w` NEAR for each YES share
   and `1 − w` NEAR for each NO share. The creator also gets the pool's shares.

### Weighted payout and snapping

The resolver gives `raw_yes_bps`, the probability of YES in basis points. The
payout weight `payout_yes_bps` is:

| Raw probability | Payout weight |
| --------------- | ------------- |
| 9,000 or more (≥ 90%) | 10,000: YES pays 1 NEAR, NO pays 0 |
| 1,000 or less (≤ 10%) | 0: YES pays 0, NO pays 1 NEAR |
| Between | the raw probability: YES pays `w`, NO pays `1 − w` |

Each payout rounds down to the micro-NEAR (10^18 yoctoNEAR). The contract
keeps the dust, at most one micro-NEAR for each redeem.

Solvency: every share comes from a complete set. So the YES total and the NO
total (pool plus holders) both equal the collateral, and the sum of the
weighted payouts is at most the collateral, for any weight. The unit test
`random_trades_stay_solvent_for_any_weight` checks this after each of 3,000
random trades (20 seeds) and after all redeems.

## Interface

Amounts and shares are yoctoNEAR strings. One share is worth 1 NEAR at most.
Ids, times and basis points are JSON numbers. Times are Unix milliseconds.
`outcome` is `"yes"` or `"no"`.

| Method | Kind | Arguments | Deposit and gas | Returns |
| ------ | ---- | --------- | --------------- | ------- |
| `new` | init | `{"admin", "resolver"?}` | | |
| `create_market` | change | `{"question", "context"?, "note_id"?, "closes_at_ms"}` | 0.1 NEAR or more, 30 Tgas | `u64`, the market id |
| `buy` | change | `{"market_id", "outcome", "min_shares"?}` | 0.01 NEAR or more, 30 Tgas | the shares |
| `sell` | change | `{"market_id", "outcome", "amount", "max_shares"?}` | 0, 30 Tgas | the shares that it took |
| `close_market` | change | `{"market_id"}` | 0, 30 Tgas | |
| `request_resolution` | change | `{"market_id"}` | 0.05 NEAR or more, 300 Tgas | `true` if the market resolved |
| `on_resolution` | private callback | `{"market_id", "request_id"}` | | `true` if the market resolved |
| `resolve` | change, admin | `{"market_id", "yes_bps", "rationale"?}` | 0, 30 Tgas | |
| `redeem` | change | `{"market_id"}` | 0, 30 Tgas | the NEAR paid |
| `set_resolver_config` | change, admin | `{"resolver"}` | 0, 30 Tgas | |
| `get_market` | view | `{"market_id"}` | | `MarketView` or `null` |
| `get_markets` | view | `{"before"?, "limit"?}` | | `MarketView[]`, newest first, at most 50 |
| `get_market_for_note` | view | `{"note_id"}` | | the newest `MarketView` of the note, or `null` |
| `get_position` | view | `{"market_id", "account_id"}` | | `PositionView` |
| `quote_buy` | view | `{"market_id", "outcome", "amount"}` | | `QuoteView`, or `null` if the market is not open |
| `quote_sell` | view | `{"market_id", "outcome", "amount"}` | | `QuoteView` or `null` |
| `get_config` | view | `{}` | | `ConfigView` |

Rules:

- `question`: 1 to 200 characters. `context`: at most 1,000 characters (the
  note text and the post text, for the AI). Both are trimmed.
- `closes_at_ms`: in the future, at most 30 days ahead.
- Liquidity and trades: at most 1,000,000 NEAR. A deposit below one
  micro-NEAR stays in the contract.
- `request_resolution`: only when the status is `closed`. One request at a
  time. A request without an answer after 15 minutes no longer blocks a new
  one.
- `resolve`: only the admin, only when the status is `closed` or `resolving`.
  `yes_bps` is 0 to 10,000. `rationale`: at most 500 characters.
- The callback never fails. A bad or missing answer emits `resolution_failed`
  and the market goes back to `closed`, for a new request or the admin.

`MarketView` (`status` is `open`, `closed`, `resolving` or `resolved`):

```json
{
  "id": 1,
  "question": "Is this note accurate and helpful context for this post?",
  "context": "Post: ... Note: ...",
  "note_id": 2,
  "creator": "maya.testnet",
  "created_at_ms": 1794312000000,
  "closes_at_ms": 1794315600000,
  "yes_pool": "500000000000000000000000",
  "no_pool": "2000000000000000000000000",
  "yes_price_bps": 8000,
  "collateral": "2000000000000000000000000",
  "status": "resolved",
  "pending": null,
  "resolution": {
    "raw_yes_bps": 7300,
    "payout_yes_bps": 7300,
    "source": "ai",
    "provider": "jev",
    "model": "jev-1.14.0",
    "rationale": "JEV (jev-1.14.0) gave a YES probability of 73%.",
    "resolved_by": "kenji.testnet",
    "resolved_at_ms": 1794315605000
  }
}
```

`pending`, while a request waits: `{"request_id", "requested_by", "requested_at_ms"}`.
`source` is `ai` or `admin`.

`PositionView`: `{"yes", "no", "redeemable"}`. `redeemable` is what `redeem`
pays the account now (with the pool for the creator), or `null` before the
resolution.

`QuoteView`: `{"amount", "shares", "yes_price_bps"}`. `yes_price_bps` is the
price after the trade.

`ConfigView`: `{"admin", "resolver", "snap_high_bps", "snap_low_bps",
"min_liquidity", "min_buy", "min_resolution_deposit", "max_open_ms"}`.
`resolver` is `{"outlayer_account", "project_id", "version_key",
"secrets_ref"}`; `secrets_ref` is `{"profile", "account_id"}` or `null`.

### Events

Each change logs NEP-297 events, standard `pm_notes`, version `1.0.0`. The
data is an array of one object.

| Event | Data |
| ----- | ---- |
| `market_created` | `market_id`, `creator`, `question`, `note_id`, `closes_at_ms`, `liquidity` |
| `trade` | `market_id`, `account_id`, `side` (`buy` or `sell`), `outcome`, `amount`, `shares`, `yes_price_bps` |
| `market_closed` | `market_id`, `closed_by` |
| `resolution_requested` | `market_id`, `request_id`, `requested_by`, `deposit` |
| `resolution_failed` | `market_id`, `request_id`, `reason` |
| `market_resolved` | `market_id`, `source`, `raw_yes_bps`, `payout_yes_bps`, `provider`, `model`, `resolved_by` |
| `redeemed` | `market_id`, `account_id`, `pool`, `amount` |

```text
EVENT_JSON:{"standard":"pm_notes","version":"1.0.0","event":"market_resolved","data":[{"market_id":1,"source":"ai","raw_yes_bps":7300,"payout_yes_bps":7300,"provider":"jev","model":"jev-1.14.0","resolved_by":"kenji.testnet"}]}
```

`resolution_failed` reasons: `the OutLayer call failed`, `the resolver
returned no answer`, `the resolver failed: <worker error>`, `the resolver
answer is not an answer object`, `the resolver answer is too long`, `yes_bps
must be an integer from 0 to 10000`, `provider must be 1 to 32 characters
a-z, 0-9, '-' or '.'`, `model must be 1 to 64 printable ASCII characters`,
`a newer request replaced this one`, `the market was resolved first`.

## The OutLayer request

`request_resolution` sends this to `request_execution`, with the attached
deposit and 200 Tgas. The callback gets 20 Tgas.

```json
{
  "source": { "Project": { "project_id": "seams-v1.testnet/pm-notes-resolver", "version_key": null } },
  "input_data": "{\"market_id\":1,\"question\":\"...\",\"context\":\"...\",\"note_id\":2,\"contract\":\"pm-notes.seams-v1.testnet\"}",
  "resource_limits": { "max_instructions": 1000000000, "max_memory_mb": 128, "max_execution_seconds": 60 },
  "secrets_ref": { "profile": "...", "account_id": "..." },
  "response_format": "Json"
}
```

`secrets_ref` is left out when the config has none. OutLayer gives the
worker's JSON output to the callback, or `null` for a failed run.

## Resolver worker

`resolver/` reads the input above on stdin and writes one JSON object:

```json
{"yes_bps": 7300, "provider": "jev", "model": "jev-1.14.0", "rationale": "JEV (jev-1.14.0) gave a YES probability of 73%."}
```

If no provider answers, it writes `{"error": "JEV: HTTP 401; NEAR AI: no
NEAR_AI_API_KEY"}` and exits with 0, so that the contract shows the reason.

1. **JEV** (if the secret `TYPESAFE_API_KEY` is set):
   `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer …`,
   model `jev-1.14.0` (pinned). The state is the question and the context.
   One Noul question, `answer_is_yes`, with the criteria `true` (the answer is
   YES) and `false` (the answer is NO). The answer
   `{"type": "noul", "noul": 0.73}` becomes 7,300 bps. JEV gives no text, so
   the rationale names the model and the probability.
2. **NEAR AI** (if JEV fails or has no key, and `NEAR_AI_API_KEY` is set):
   `POST https://cloud-api.near.ai/v1/chat/completions` with
   `Qwen/Qwen3.8-27B`, temperature 0, thinking off. The reply is one JSON
   object `{"yes_probability": 0.62, "rationale": "..."}`.

The prompts say that the note and the post are untrusted data. The error text
names only the provider and the HTTP status; it never holds a secret or a
response body. `resolver/manifest/outlayer.json` allows the hosts
`api.typesafe.ai` and `cloud-api.near.ai`.

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`):

| Call | Gas burnt |
| ---- | --------- |
| `create_market`, longest context (1,000 characters) | 2.25 Tgas |
| `buy`, new position | 2.28 Tgas |
| `sell` | 3.01 Tgas |
| `close_market` | 2.06 Tgas |
| `request_resolution` with the fake OutLayer, answer and callback | 7.15 Tgas |
| `resolve` (admin) | 2.03 Tgas |
| `redeem` | 2.98 Tgas |

The real OutLayer uses more gas than the fake (yield and resume), so
`request_resolution` needs 300 Tgas. It does not fit the 30 Tgas of a spoken
request: the market widget signs it as a normal wallet call.

The largest market uses 1,293 bytes of storage (0.013 NEAR). The contract code
is 254,385 bytes, about 2.54 NEAR of storage. The contract balance pays for
all storage, and the market collateral is part of that balance. Keep about
0.5 NEAR free above the code.

## Build and test

```bash
./build.sh
```

The build of 10 Nov 2026 gave `res/jev_prediction_market.wasm`, 254,385
bytes, SHA-256
`24732cc68ad2fa4ca78889aa86e0a35bb3e94e89bdb06b2d60c8ed2387b0f37c`. It also
builds `res/fake_outlayer.wasm` for the sandbox test.

```bash
cargo test -p jev-prediction-market
```

```bash
./build.sh && cargo test -p jev-prediction-market-sandbox -- --nocapture
```

The sandbox crate downloads the nearcore sandbox binary on its first build.
To use a binary that you have, set `NEAR_SANDBOX_BIN_PATH`.

```bash
cd resolver && cargo test && ./build.sh
```

The worker build of 10 Nov 2026 gave `resolver/res/pm-notes-resolver.wasm`,
428,038 bytes, SHA-256
`ef5bf8c327cdc9d82248e493b400bc2012c34d7d30a72b55d0f9a5f82064db73`. The
SHA-256 is the OutLayer version key.

## Deploy to testnet

Not deployed. Each step needs the user's yes. The account name
`pm-notes.seams-v1.testnet` is the proposal.

1. Create the contract account with 3 NEAR (`seams-v1.testnet` had 3.62 NEAR
   on 10 Nov 2026):

   ```bash
   near account create-account fund-myself pm-notes.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

2. Deploy and initialize. Set `secrets_ref` to the OutLayer secrets of step 4:

   ```bash
   near contract deploy pm-notes.seams-v1.testnet use-file res/jev_prediction_market.wasm with-init-call new json-args '{"admin":"seams-v1.testnet","resolver":{"outlayer_account":"outlayer.testnet","project_id":"seams-v1.testnet/pm-notes-resolver","secrets_ref":{"profile":"pm-notes","account_id":"seams-v1.testnet"}}}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

3. Upload `resolver/res/pm-notes-resolver.wasm` to FastFS
   (`crates/voice-verifier/scripts/fastfs_chunks.py`), create the OutLayer
   project `seams-v1.testnet/pm-notes-resolver` and add the version, the same
   way as `seams-v1.testnet/voice-verifier`. Use the manifest in
   `resolver/manifest/outlayer.json`.
4. Store the secrets `NEAR_AI_API_KEY` and `TYPESAFE_API_KEY` for that project.
   If the resolver config names other secrets, change it with
   `set_resolver_config`.
5. Smoke test: create a 0.1 NEAR market, close it, and request a resolution:

   ```bash
   near contract call-function as-read-only pm-notes.seams-v1.testnet get_markets json-args '{}' network-config testnet now
   ```

## Credits

The pool formulas (a buy names the NEAR in, a sell names the NEAR out, both
rounded for the pool), the JEV request and Noul answer shapes, the NEAR AI
request, the OutLayer `request_execution` arguments with a callback, and the
fake OutLayer for the sandbox test follow Signal's prediction market
(`get-signal/prediction-market`: `contracts/market-core/src/math.rs`,
`resolver/src/jev.rs`, `resolver/src/near_ai.rs`,
`contracts/market-core/src/resolution.rs`, `contracts/test-fixture`). The
user allowed the use of that code here.
