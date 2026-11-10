# pm-notes: a JEV prediction market for community notes

A mini parimutuel prediction market for the Spoken Notes demo, in NEAR testnet
USDC. Anyone opens a yes-or-no market about a community note ("Will this note
hold up?"), and anyone bets USDC on YES or NO. After the close, an OutLayer AI
call to JEV (Typesafe) gives the probability that the answer is YES. That
probability is the payout weight, so a grey, disputed note pays both sides.
Demo only, testnet only. The plan is in `PLAN.md`.

| Part | Folder | What it is |
| ---- | ------ | ---------- |
| Contract | `src/` | The market: create, bet, close, resolve, claim |
| Sandbox test | `sandbox/` | The release WASM in a local nearcore sandbox, with a fake USDC (`sandbox/fake-usdc/`) and a fake OutLayer (`sandbox/fake-outlayer/`) |
| Resolver worker | `resolver/` | The OutLayer worker (`wasm32-wasip2`): JEV first, NEAR AI second |

## Toolchain

- Contract: the same as `../merge-approvals/`. Rust 1.97.0
  (`rust-toolchain.toml`), near-sdk 5.30.1, near-workspaces 0.24.0 with the
  nearcore 2.14.0 sandbox. `.cargo/config.toml` adds `--cfg near` to each
  WASM build, so a failed call keeps its message on chain.
- Worker: Rust 1.97.1 with `wasm32-wasip2` (`resolver/rust-toolchain.toml`),
  `wasi-http-client` 0.2.1, serde_json.

## The currency: NEAR testnet USDC

The money is Circle's USDC on NEAR testnet, a NEP-141 token with 6 decimals:
`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (the
default `token` of `new`). Testnet USDC comes from https://faucet.circle.com
(network: Near Testnet). `cyan-loong.testnet` holds about 10,000 USDC to seed
demo markets.

- USDC comes in with the token's `ft_transfer_call` to this contract. Its
  `msg` says what the USDC is for. The token calls `ft_on_transfer`, and only
  the token can. If the market refuses, the token gives the USDC back.
- USDC goes out with the token's `ft_transfer` (1 yoctoNEAR attached by the
  contract). The receiver must be registered with the token; an account that
  holds USDC is registered.
- The contract account must be registered with the token once:
  `storage_deposit` with 0.00125 NEAR.
- The `request_resolution` fee is NEAR, because OutLayer charges NEAR.

Amounts in the JSON are USDC base units as strings: `"1000000"` is 1 USDC.

## How a market works

1. **Create.** The creator sends at least 1 USDC as the seed. Half goes into
   the YES pool and half into the NO pool, as the creator's stakes. So the
   odds start at 50%, and one early bet cannot swing them to 100%. Any note
   can have a market.
2. **Bet.** Anyone sends at least 0.1 USDC on YES or NO. The USDC stays in its
   pool until the payout: there is no sell. The odds are the pool split, YES
   pool / total pool. Each bet adds a point to the odds history. Betting stops
   at `closes_at_ms`, or earlier when the creator or the admin calls
   `close_market`.
3. **Resolve.** After the close, any account calls `request_resolution` with
   at least 0.05 NEAR and 300 Tgas. The contract calls `outlayer.testnet`
   `request_execution` with the resolver project. The callback
   `on_resolution` reads the answer. The admin can call `resolve` instead.
   A resolution is final. Ratings of the note do not count.
4. **Claim.** Each bettor calls `claim` once, and the payout goes to the
   account in USDC. If the token refuses the transfer, the claim opens again
   (`claim_failed`).

### Weighted payout and snapping

The resolver gives `raw_yes_bps`, the probability of YES in basis points. The
payout weight `w` = `payout_yes_bps` / 10,000 is:

| Raw probability | Payout weight |
| --------------- | ------------- |
| 9,000 or more (≥ 90%) | 10,000: the YES bets share the whole pool |
| 1,000 or less (≤ 10%) | 0: the NO bets share the whole pool |
| Between | the raw probability |

With the total pool `T`, the YES bets share `w × T` and the NO bets share
`(1 − w) × T`, each in proportion to the stakes:

```text
payout = yes_stake / yes_pool × w × T  +  no_stake / no_pool × (1 − w) × T
```

Example: the pools are 30 USDC YES and 10 USDC NO, and JEV says 72%. The YES
bets share 28.80 USDC, and the NO bets share 11.20 USDC. A 10 USDC YES bet
gets 9.60 USDC. A 5 USDC NO bet gets 5.60 USDC.

If one pool is empty, every claim is a refund of the stakes (`refund_all`).
With the seed, both pools always have USDC. Each part of a payout rounds down
to the base unit (0.000001 USDC), so the payouts never add up to more than the
pool. The unit test `random_bets_stay_solvent_for_any_weight` checks this for
30 random markets and weights.

## Interface

Ids, times (Unix ms) and basis points are JSON numbers. `outcome` is `"yes"`
or `"no"`.

| Method | Kind | Arguments | Deposit and gas | Returns |
| ------ | ---- | --------- | --------------- | ------- |
| `new` | init | `{"admin", "token"?, "resolver"?}` | | |
| `ft_on_transfer` | change, token only | `{"sender_id", "amount", "msg"}` (NEP-141) | | `"0"`: all USDC used |
| `close_market` | change | `{"market_id"}` | 0, 30 Tgas | |
| `request_resolution` | change | `{"market_id"}` | 0.05 NEAR or more, 300 Tgas | `true` if the market resolved |
| `on_resolution` | private callback | `{"market_id", "request_id"}` | | `true` if the market resolved |
| `resolve` | change, admin | `{"market_id", "yes_bps", "rationale"?}` | 0, 30 Tgas | |
| `claim` | change | `{"market_id"}` | 0, 30 Tgas or more (the page sends 50) | the USDC paid (`"0"` if the transfer failed) |
| `on_claim_transfer` | private callback | `{"market_id", "account_id", "amount"}` | | the USDC paid |
| `set_resolver_config` | change, admin | `{"resolver"}` | 0, 30 Tgas | |
| `get_market` | view | `{"market_id"}` | | `MarketView` or `null` |
| `get_markets` | view | `{"before"?, "limit"?}` | | `MarketView[]`, newest first, at most 50 |
| `get_market_for_note` | view | `{"note_id"}` | | the newest `MarketView` of the note, or `null` |
| `get_position` | view | `{"market_id", "account_id"}` | | `PositionView` |
| `quote_bet` | view | `{"market_id", "outcome", "amount"}` | | `BetQuote`, or `null` if the market is not open or the amount is below 0.1 USDC |
| `get_odds_history` | view | `{"market_id"}` | | `OddsPoint[]`, the last 50, oldest first |
| `get_config` | view | `{}` | | `ConfigView` |

To create a market or bet, call the token (1 yoctoNEAR, 100 Tgas):

```json
{"receiver_id": "pm-notes.seams-v1.testnet", "amount": "5000000", "msg": "{\"action\":\"bet\",\"market_id\":1,\"outcome\":\"yes\"}"}
```

The `msg` is one of:

- `{"action": "create_market", "question", "context"?, "note_id"?, "closes_at_ms"}`: the USDC is the seed (1 to 1,000,000 USDC).
- `{"action": "bet", "market_id", "outcome"}`: a bet (at least 0.1 USDC).

Other fields fail the transfer, and the token gives the USDC back.

Rules:

- `question`: 1 to 200 characters. `context`: at most 1,000 characters (the
  note text and the post text, for the AI). Both are trimmed. The context is
  frozen at the open.
- `closes_at_ms`: in the future, at most 30 days ahead.
- A market pool holds at most 1,000,000 USDC.
- `request_resolution`: only when the status is `closed`. One request at a
  time. A request without an answer after 15 minutes no longer blocks a new
  one.
- `resolve`: only the admin, only when the status is `closed` or `resolving`.
  `yes_bps` is 0 to 10,000. `rationale`: at most 500 characters.
- The callbacks never fail. A bad or missing AI answer emits
  `resolution_failed`, and the market goes back to `closed`, for a new request
  or the admin.

`MarketView` (`status` is `open`, `closed`, `resolving` or `resolved`):

```json
{
  "id": 1,
  "question": "Will this note hold up?",
  "context": "Post: ... Note: ...",
  "note_id": 2,
  "creator": "maya.testnet",
  "created_at_ms": 1794312000000,
  "closes_at_ms": 1794315600000,
  "yes_pool": "30000000",
  "no_pool": "10000000",
  "total_pool": "40000000",
  "yes_share_bps": 7500,
  "bets": 3,
  "refund_all": false,
  "paid_out": "0",
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

`PositionView`: `{"yes", "no", "payout", "claimed"}`. `yes` and `no` are the
stakes (the creator's seed included). `payout` is what `claim` pays (or paid),
or `null` before the resolution.

`BetQuote`: `{"amount", "payout_if_right", "yes_share_bps"}`.
`payout_if_right` is what this bet alone pays if the verdict is 100% its side
and no other bet comes. `yes_share_bps` is the odds after the bet.

`OddsPoint`: `{"at_ms", "yes_bps"}`. The first point is the open (50%).

`ConfigView`: `{"admin", "token", "resolver", "snap_high_bps",
"snap_low_bps", "min_seed", "min_bet", "min_resolution_deposit",
"max_open_ms"}`. `resolver` is `{"outlayer_account", "project_id",
"version_key", "secrets_ref"}`; `secrets_ref` is `{"profile", "account_id"}`
or `null`.

### Events

Each change logs NEP-297 events, standard `pm_notes`, version `1.0.0`. The
data is an array of one object.

| Event | Data |
| ----- | ---- |
| `market_created` | `market_id`, `creator`, `question`, `note_id`, `closes_at_ms`, `seed` |
| `bet` | `market_id`, `account_id`, `outcome`, `amount`, `yes_pool`, `no_pool`, `yes_share_bps`, `bets` |
| `market_closed` | `market_id`, `closed_by` |
| `resolution_requested` | `market_id`, `request_id`, `requested_by`, `deposit` (NEAR) |
| `resolution_failed` | `market_id`, `request_id`, `reason` |
| `market_resolved` | `market_id`, `source`, `raw_yes_bps`, `payout_yes_bps`, `provider`, `model`, `resolved_by` |
| `claimed` | `market_id`, `account_id`, `amount`, `refund` |
| `claim_failed` | `market_id`, `account_id`, `amount` (the token refused the transfer; the claim is open again) |

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

The prompts define the question: "this note" is the community note, and a
note holds up when it is accurate and adds helpful context to the post. They
say that the note and the post are untrusted data. The error text
names only the provider and the HTTP status; it never holds a secret or a
response body. `resolver/manifest/outlayer.json` allows the hosts
`api.typesafe.ai` and `cloud-api.near.ai`.

## Market strip in the notes example

The strip is `<NoteMarketStrip>` in `demo/frontend/src/market/` (its README
has the details). It codes against `MarketSource`. `contractSource.ts` fills
that interface from this contract: views over NEAR RPC, and changes signed by
the Seams Wallet with its normal confirm step. Bets and seeds are the USDC
token's `ft_transfer_call`. `NoteCard` mounts the strip on the post page:

- No market: "Will this note hold up?" and **Open a market** (a seed of 1, 2
  or 5 USDC, and a close time of 10 minutes to 3 days). The context that JEV
  reads is the post text and the note text, frozen at the open.
- Open: the pool bar, the odds, the odds line from `get_odds_history`, the
  pool size, the bet count, and **Bet yes** / **Bet no** (chips 0.1, 0.5 and 1
  USDC, with the account's USDC balance). The creator sees **Close betting
  now**.
- Closed: **Ask JEV now** (0.05 NEAR, 300 Tgas). A `resolution_failed` event
  shows its reason.
- Resolved: "JEV: 72% this note holds up", the split of the pool, the
  account's payout with **Claim**, and "Why JEV decided this".

Spoken bets need a new spoken request kind in the Wallet, so the source has
`signsByVoice: false`.

Settings: `VITE_MARKET_CONTRACT` (default `pm-notes.seams-v1.testnet`),
`VITE_MARKET_TOKEN` (default: testnet USDC) and `VITE_MARKET_RPC_URL`
(default: the notes RPC). Until the contract is on testnet, the strip stays
hidden.

To see all states before the deploy, run a local stand-in for testnet. It
deploys the notes contract, a fake USDC and this contract to a sandbox, writes
four notes on post 1, and opens markets that are open, closed and resolved:

```bash
./build.sh && NOTES_WASM=../community-notes/res/community_notes.wasm UI_DEMO_OUT=/tmp/ui-demo.json cargo test -p jev-prediction-market-sandbox --test ui_demo -- --ignored --nocapture
```

Put the printed `VITE_NEAR_RPC_URL`, `VITE_NOTES_CONTRACT`,
`VITE_MARKET_CONTRACT` and `VITE_MARKET_TOKEN` in
`demo/frontend/.env.development.local`, run `pnpm dev` and open
`#/notes/post/1`. The page cannot sign in that setup. The preview page
`/market-preview.html?usdc` shows the bet sheet with USDC and mock data.

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`), for the
whole transaction:

| Call | Gas burnt |
| ---- | --------- |
| `create_market` through `ft_transfer_call`, longest context (1,000 characters) | 7.07 Tgas |
| `bet` through `ft_transfer_call` | 6.84 Tgas |
| `close_market` | 2.12 Tgas |
| `request_resolution` with the fake OutLayer, answer and callback | 7.24 Tgas |
| `resolve` (admin) | 2.08 Tgas |
| `claim` with the token's `ft_transfer` and the callback | 6.69 Tgas |

The real OutLayer uses more gas than the fake (yield and resume), so
`request_resolution` needs 300 Tgas. It does not fit the 30 Tgas of a spoken
request: the market strip signs it as a normal wallet call.

The largest market uses 1,455 bytes of storage (0.015 NEAR), with its odds
history. A full odds history adds about 500 bytes. The contract code is
274,282 bytes, about 2.74 NEAR of storage. The contract's NEAR pays for the
storage; the USDC is in the token contract. Keep about 0.5 NEAR free above the
code.

## Build and test

```bash
./build.sh
```

The build of 10 Nov 2026 with the 0.1 USDC smallest bet gave
`res/jev_prediction_market.wasm`, 274,282 bytes, SHA-256
`077f554e7ae3d20b91b24df73969e0475bf7c2ac8818581b8c68615a10b255be`. It also
builds `res/fake_usdc.wasm` and `res/fake_outlayer.wasm` for the sandbox
test.

```bash
cargo test -p jev-prediction-market
```

```bash
./build.sh && cargo test -p jev-prediction-market-sandbox --test sandbox -- --nocapture
```

The sandbox crate downloads the nearcore sandbox binary on its first build.
To use a binary that you have, set `NEAR_SANDBOX_BIN_PATH`.

```bash
cd resolver && cargo test && ./build.sh
```

The worker build of 10 Nov 2026 gave `resolver/res/pm-notes-resolver.wasm`,
429,160 bytes, SHA-256
`360beda42aab4479a0c1ad38ef0a06878ea1819abdba05b06cab3541589d223a`. The
SHA-256 is the OutLayer version key. `resolver/manifest/outlayer.json` is
linked into the WASM as the `outlayer.manifest` custom section; without it,
OutLayer gives the worker no network access.

## Testnet deployment

Deployed on 10 Nov 2026 from this branch (commit `33a2dfa` and its parents).

| Item | Value |
| ---- | ----- |
| Contract account | `pm-notes.seams-v1.testnet`, created by `seams-v1.testnet` with 3 NEAR, transaction `9DSNvSAoJtgZ7iFxwg6kYtJkQvgYfZrcceznF2FWDoX8` |
| Deploy and `new` | transaction `BsCqyBD52fZykqEU622qmqrh9aaQ5g2AmrmGQouP7WFU`; admin `seams-v1.testnet`; token: testnet USDC; resolver `outlayer.testnet`, project `seams-v1.testnet/pm-notes-resolver`, no `secrets_ref` yet |
| Code hash (base58) | `WGU9Uhk1J5UWFrdSYRRmAxfdpa33QHZqmuAJmKCi6dB`, the SHA-256 `077f554e…55be` of the release WASM above. Upgrade to the 0.1 USDC smallest bet: transaction `Bz551nVETJEVgp2LDu9YyNiREEa3KrGv51WHYHWJTkN7` (no init call; the state stays). The first code was `a1f89e15…544621`. |
| USDC registration | `pm-notes.seams-v1.testnet`: transaction `B5EAbZHXDb2qXmCBnXFcxCeCQxWdTaF6tKPGSmPMEjpj`; `seams-v1.testnet`: transaction `6vdntmaFRLHc1h61gPAF2a133dswbAUxcWHtif3Ks1p` |
| Worker upload | FastFS transaction `BHYUcVBUby77RkacXUkGzCEwjFmaxcd1MN6bV8m4aCPY` (it fails with `MethodNotFound` by design: FastFS reads the arguments), URL `https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/74dfc1f972c31dc0c8efa5505e8df2db7424a40f77a41d96dc4f67865d3d37b2.wasm` |
| OutLayer project | `seams-v1.testnet/pm-notes-resolver`, `create_project` transaction `DZM1ogMNDQ5ErcjmC1shRaYHFRyL4jpRFbxqHfgqkHZy` (0.03 NEAR) with version `74dfc1f9…37b2`. Active version `360beda4…223a` (JEV on NEAR AI first): FastFS transaction `DQm7sdhvKZtaHXkJKtxj86huoz7k7GBkPSgQtkFTAS2p`, `add_version` transaction `B7aiWF1QvReAssRgAmepDxrWmuBPufcvsT1FiqfwTCzU` |
| Secrets | `NEAR_AI_API_KEY`, stored by the user for the project, profile `main`, owner `cyan-loong.testnet`, `set_resolver_config` transaction `CHQwMo4QzejReMNGUM7jJYU4fhGkWaSMD98Sy7t1x6DE` names it. OutLayer judges each access rule against the signer of the transaction, so a plain whitelist of the contract refuses every user. The rule must be `{"Predecessor":{"condition":{"Whitelist":{"accounts":["pm-notes.seams-v1.testnet"]}}}}` ("Calling account must…" in the dashboard), which judges the contract that calls OutLayer. The dashboard's "Direct calls only" is wrong here: it also requires the signer to be the contract. Stored on 10 Nov 2026 at 03:04 UTC as an AND with this one condition. |
| Markets | 1: a smoke test without a note (2 USDC seed, 1 USDC bet; an OutLayer run refused by the secret's rule, `2AJa14zS6W8qFhXG3SARxefA2WQ21RhsRSr6E59gjLzL`; admin resolve at 60%, `2HoS6vUx4okHA1ruJ299qtDC8p8Se4uMs1g3kiP151fE`; claim of 3 USDC, `4fypN2aCNB1QXVTrfUqdNnodWb5eWzUvjYt7SzfL456c`). 2: note 0, the post's context box, "Is this note true?", 10 USDC seed, closes 14 Nov 2026 23:59 UTC (transaction `4veiVAoxTFhxS3CagM9AYDRCMvPzmA9p6Ui5mhsmQmWB`). 3: a smoke test of JEV without a note (1 USDC seed, `37qakdLQR6jNaPZ7GWUKNPwrPK6Yf4RhMSVsPsHkFiRV`; closed, `7QLhZchgVyjRrB5U3EXg4ubxPyEH3yqHcs3rp35aJxv8`; Ask JEV, `2wryCU3a8hng5mWZXJR5GmLdtgJhNRdi8vjSCP7UP9NB`: OutLayer ran the worker in 1.5 s for 0.00126 NEAR, and JEV `typesafe/jev-1.13-20260917` on NEAR AI gave 27% yes, `market_resolved` with source `ai` and provider `jev`; claim of 1 USDC, `Cidc9HPHoGDXvYjD3zrma15MYL2Kc8k3Aj6n11yANbwk`). |

For a new deployment, and what is left:

1. **OutLayer secrets** (stored for this deployment on 10 Nov 2026). For a
   new secret: store `NEAR_AI_API_KEY` and, if you have it,
   `TYPESAFE_API_KEY` for the project `seams-v1.testnet/pm-notes-resolver`,
   with the rule "Calling account must…" and, inside it, a whitelist
   `pm-notes.seams-v1.testnet` (not "Direct calls only"). Then
   the admin names the secrets:

   ```bash
   near contract call-function as-transaction pm-notes.seams-v1.testnet set_resolver_config json-args '{"resolver":{"outlayer_account":"outlayer.testnet","project_id":"seams-v1.testnet/pm-notes-resolver","secrets_ref":{"profile":"main","account_id":"cyan-loong.testnet"}}}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

   Without the secret, "Ask JEV now" ends with `resolution_failed` and the
   reason `the resolver failed: ...` with each route's error. With a plain
   whitelist, OutLayer refuses the run ("Access denied by access condition")
   and the reason is `the resolver returned no answer`. In both cases the
   admin can `resolve`.
2. **USDC for demo markets.** Send USDC from `cyan-loong.testnet` (for
   example to `seams-v1.testnet`, which is registered), then open a market
   with `ft_transfer_call`:

   ```bash
   near contract call-function as-transaction 3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af ft_transfer_call json-args '{"receiver_id":"pm-notes.seams-v1.testnet","amount":"10000000","msg":"{\"action\":\"create_market\",\"question\":\"Will this note hold up?\",\"context\":\"...\",\"note_id\":2,\"closes_at_ms\":1794500000000}"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as cyan-loong.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. **NEAR.** On 10 Nov 2026, `seams-v1.testnet` has about 0.5 NEAR free, and
   `pm-notes.seams-v1.testnet` about 0.3 NEAR above its storage (about 10
   markets). Add NEAR from `cyan-loong.testnet` before a busy demo.

Checks:

```bash
near contract call-function as-read-only pm-notes.seams-v1.testnet get_config json-args '{}' network-config testnet now
```

```bash
near contract call-function as-read-only outlayer.testnet get_project json-args '{"project_id":"seams-v1.testnet/pm-notes-resolver"}' network-config testnet now
```

## Demo script

What a judge can do on the demo page (`#/notes/post/1`):

1. **Get money.** The setup card's faucet gives a new account 0.2 NEAR and 2
   USDC in one transaction (`seams-faucet.testnet`, from the demo page
   session).
2. **Bet.** Under the post, the X-style "Readers added context" box asks "Do
   you bet this is true or false?". **Bet** opens the Note dialog with market 2
   (note 0). One tap on **Bet yes** or **Bet no** sends USDC with the token's
   `ft_transfer_call`; the Seams Wallet asks for a confirm. The bar, the odds
   and the pool move after the transaction.
3. **Open a market.** After someone writes a note on the post, its card shows
   "Will this note hold up?" and **Open a market** (a seed of 1, 2 or 5 USDC,
   and a close time from 10 minutes to 3 days). The creator can close the
   betting early.
4. **Ask JEV.** After the close, **Ask JEV now** sends `request_resolution`
   (0.05 NEAR, 300 Tgas). OutLayer runs the resolver: JEV on NEAR AI gives the
   probability that the note holds up. The strip then shows "JEV: 72% this
   note holds up", how the pool is split, and "Why JEV decided this".
5. **Claim.** **Claim** sends the account's USDC payout.

Checked on testnet on 10 Nov 2026: create, bet, close, the admin resolve, Ask
JEV (OutLayer ran the worker, and JEV on NEAR AI answered 27% for market 3),
and the claims (3 USDC and 1 USDC back through `ft_transfer`). Not yet
checked: a bet signed with the Seams Wallet (it needs a person with a
passkey).

## Credits

The JEV request and Noul answer shapes, the NEAR AI request, the OutLayer
`request_execution` arguments with a callback, and the fake OutLayer and the
NEP-141 test token for the sandbox test follow Signal's prediction market
(`get-signal/prediction-market`: `resolver/src/jev.rs`,
`resolver/src/near_ai.rs`, `contracts/market-core/src/resolution.rs`,
`contracts/test-fixture`). The user allowed the use of that code here. The
market itself is parimutuel in USDC, by the user's decisions of 10 Nov 2026.
