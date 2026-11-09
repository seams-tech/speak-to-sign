# JEV prediction market for community notes: plan

Status: approved by the user on 10 Nov 2026. Demo only, testnet only.
Hackathon end: 14 Nov 2026, 23:59 UTC.

## Goal

A mini prediction market on community notes. Anyone can open a yes-or-no
market about a note ("Is this note accurate and helpful context for this
post?"), trade YES and NO shares with NEAR, and close it. An OutLayer AI call
to JEV (Typesafe) resolves it. JEV answers with a probability (a "noul"). That
probability becomes a payout weight, so a grey, disputed note pays
fractionally.

## Parts and folders

| Part | Folder | Notes |
| ---- | ------ | ----- |
| Contract `pm-notes` | `demo/contracts/jev-prediction-market/` | near-sdk 5.30.1, Rust 1.97.0, setup copied from `merge-approvals/` |
| Sandbox test and fake OutLayer | `demo/contracts/jev-prediction-market/sandbox/` | near-workspaces 0.24.0 (nearcore 2.14.0) |
| Resolver worker | `demo/contracts/jev-prediction-market/resolver/` | OutLayer worker, `wasm32-wasip2`, Rust 1.97.1, `wasi-http-client` 0.2.1 |
| Market widget | `demo/frontend` | Not this session. The demo page session owns it. I give it the interface below. |

## Market rules

- **Create.** `create_market({question, context, note_id, closes_at_ms})`,
  payable. The attached NEAR (at least 0.1) is the starting liquidity. The
  pool gets that many YES and NO shares, so both prices start at 50%.
  - `question`: 1 to 200 characters. `context`: 0 to 1,000 characters (the
    note text and the post text, for the AI). `note_id`: optional.
  - `closes_at_ms`: in the future, at most 30 days ahead.
- **Trade.** `buy({market_id, outcome, min_shares})` (payable, at least
  0.01 NEAR) and `sell({market_id, outcome, amount, max_shares})`. A
  fixed-product pool with complete sets: 1 YES + 1 NO is backed by 1 NEAR. A
  buy names the NEAR in, and a sell names the NEAR out, so the contract needs
  no square root. No fee. Units inside are micro-NEAR (10^18 yoctoNEAR), so
  every product fits in a `u128`. Trading stops at the close time.
- **Close early.** `close_market({market_id})`: the creator or the admin can
  stop the trading now. This keeps the demo short.
- **Resolve.** After the close time:
  - `request_resolution({market_id})`, payable (at least 0.05 NEAR for the
    OutLayer fee), 300 Tgas. Any account can call it. The contract calls
    `outlayer.testnet` `request_execution` with the resolver project, and a
    private callback `on_resolution` reads the answer. One request at a time.
    The callback never fails: a bad or empty answer emits
    `resolution_failed`, and the market stays closed for a new request.
  - `resolve({market_id, yes_bps, rationale})`: the admin fallback. The
    admin can use it at any time after the close, also while a request is
    pending. A late AI answer is then ignored.
  - A resolution is final.
- **Redeem.** `redeem({market_id})` pays the caller for all their YES and NO
  shares at the weight. The creator also gets the pool's shares.
- **Views.** `get_market`, `get_markets` (newest first, at most 50),
  `get_market_for_note`, `get_position`, `quote_buy`, `quote_sell`,
  `get_config`.
- **Events.** NEP-297, standard `pm_notes`: `market_created`, `trade`,
  `market_closed`, `resolution_requested`, `resolution_failed`,
  `market_resolved`, `redeemed`.

## Weighted payout and snapping

- The resolution has a raw probability `raw_yes_bps` (0 to 10,000) and a
  payout weight `w` = `payout_yes_bps` / 10,000.
- A YES share pays `w` NEAR. A NO share pays `1 − w` NEAR. A complete set
  still pays exactly 1 NEAR.
- Snapping (proposed): `raw ≥ 9,000` gives `w = 1`. `raw ≤ 1,000` gives
  `w = 0`. Otherwise `w = raw`. A clear answer then pays like a normal
  market, and only a grey answer pays fractionally.
- Each payout rounds down to the micro-NEAR. The contract keeps the dust.
- Solvency: every YES and NO share comes from a complete set. So the total
  YES shares (pool plus holders) equal the total NO shares, and both equal
  the collateral. The sum of the payouts is then at most the collateral, for
  any weight. A test checks this with random trades.

## Resolver worker

- Input (the `input_data` string from the contract):
  `{"market_id", "question", "context", "note_id", "contract"}`.
- Output (one JSON value on stdout):
  `{"yes_bps": 7300, "provider": "jev", "model": "jev-1.14.0", "rationale": "..."}`.
- Provider 1, **JEV**: `POST https://api.typesafe.ai/v1/systemone`,
  `Authorization: Bearer $TYPESAFE_API_KEY`. One Noul question:
  `{"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}}`.
  The answer `{"type": "noul", "noul": 0.73}` becomes 7,300 bps. JEV gives no
  text, so the worker writes a short rationale. Model pinned to `jev-1.14.0`
  (the newest stable release; `jev-1.13.0` also has Noul).
- Provider 2, **NEAR AI**: `POST https://cloud-api.near.ai/v1/chat/completions`
  with `Qwen/Qwen3.8-27B` (the model that the demo summary function uses),
  temperature 0. The reply is one JSON object
  `{"yes_probability": 0.73, "rationale": "..."}`.
- Order: JEV if the `TYPESAFE_API_KEY` secret is set. If JEV fails or has no
  key, NEAR AI. If both fail, the worker exits with an error, and the
  contract emits `resolution_failed`.
- The note text is untrusted data. The prompt says so.
- OutLayer project: `seams-v1.testnet/pm-notes-resolver`. The manifest allows
  the network hosts `api.typesafe.ai` and `cloud-api.near.ai`.
- Code: new code with the same request shapes as Signal's resolver
  (`resolver/src/jev.rs`, `near_ai.rs`), credited in the README.

## Admin fallback

- The admin is set at `new`. The admin can resolve any closed market, close
  any market early, and change the resolver config (OutLayer account, project,
  version key, secrets profile).
- Use it when the AI call fails, or to show a result fast in the demo.

## Tests

- Contract unit tests: the pool math (rounding favors the pool), every rule
  and its failure message, the snapping, the weighted redeem, the callback
  parsing (good answer, `yes_bps` above 10,000, bad JSON, `null`, a promise
  error, a late answer after an admin resolve).
- Solvency test: many seeded random trades over 5 accounts and random
  weights. After each step, YES total = NO total = collateral. After all
  redeems, the sum of payouts ≤ collateral, and the dust is at most one
  micro-NEAR for each redeemer.
- Sandbox test: a fake OutLayer contract with a scripted answer. It covers
  create → buy → sell → close → `request_resolution` → callback → redeem
  (with real balances), a failed run, the admin resolve, the private
  callback, and the gas.
- Worker tests: native tests with a fake HTTP host. They cover the JEV
  request JSON, the Noul parse, the NEAR AI parse, the fallback order and the
  errors.

## Deploy steps (each one only after the user's yes)

1. Create `pm-notes.seams-v1.testnet` with 2.5 NEAR from `seams-v1.testnet`
   (about 3.6 NEAR now). The code needs about 1.8 NEAR of storage.
2. Deploy the release WASM with `new({admin: "seams-v1.testnet"})`.
3. Build the worker, upload it to FastFS, create the OutLayer project
   `seams-v1.testnet/pm-notes-resolver`, and add the version.
4. Secrets for that project: `NEAR_AI_API_KEY` and, if we have one,
   `TYPESAFE_API_KEY`.
5. Smoke test: a 0.1 NEAR market that closes after 2 minutes, then
   `request_resolution`.

## Interface for the market widget

I write the views and change methods in the README and in a note for the demo
page session. The widget calls the contract with a normal wallet signature.
`request_resolution` needs 300 Tgas, so it does not fit the 30 Tgas of a
spoken request.

## Timeline

- 10 Nov: plan, contract, unit tests.
- 11 Nov: sandbox test, resolver worker, README.
- 12 Nov: deploy after the user's yes, and the hand-over to the widget.

## Decisions (10 Nov 2026)

1. **JEV key.** JEV first, NEAR AI as the fallback. The user adds our own
   `TYPESAFE_API_KEY` to the OutLayer secrets at deploy time.
2. **Snapping.** ≥ 90% → 1 and ≤ 10% → 0, as proposed.
3. **Signal code.** The user allows us to copy Signal code. The README
   credits Signal for the pool formulas and the JEV and NEAR AI request shapes.
4. **Who resolves.** As proposed: any account requests the AI resolution after
   the close; the creator and the admin can close early.
5. **Contract account.** `pm-notes.seams-v1.testnet` is the proposal. I ask
   again with the deploy proposal.
