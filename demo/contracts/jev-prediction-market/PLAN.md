# JEV prediction market for community notes: plan

Status: approved by the user on 10 Nov 2026, then changed to parimutuel bets
(the user's decision, 10 Nov 2026). Demo only, testnet only.
Hackathon end: 14 Nov 2026, 23:59 UTC.

## Goal

A mini prediction market on community notes. Anyone can open a yes-or-no
market about a note ("Will this note hold up?"), bet NEAR on YES or NO, and
close it. An OutLayer AI call
to JEV (Typesafe) resolves it. JEV answers with a probability (a "noul"). That
probability becomes a payout weight, so a grey, disputed note pays
fractionally.

## Parts and folders

| Part | Folder | Notes |
| ---- | ------ | ----- |
| Contract `pm-notes` | `demo/contracts/jev-prediction-market/` | near-sdk 5.30.1, Rust 1.97.0, setup copied from `merge-approvals/` |
| Sandbox test and fake OutLayer | `demo/contracts/jev-prediction-market/sandbox/` | near-workspaces 0.24.0 (nearcore 2.14.0) |
| Resolver worker | `demo/contracts/jev-prediction-market/resolver/` | OutLayer worker, `wasm32-wasip2`, Rust 1.97.1, `wasi-http-client` 0.2.1 |
| Market strip | `demo/frontend` (the notes example) | The user asked this session to build it (10 Nov 2026), after the contract. I agree the files with the demo page session. |

## Market rules (parimutuel)

- **Create.** `create_market({question, context, note_id, closes_at_ms})`,
  payable, at least 0.1 NEAR. The attached NEAR is the creator's seed: half is
  a YES stake and half is a NO stake, so the odds start at 50% and one early
  bet cannot swing them to 100%. The seed is paid like any other bet.
  - `question`: 1 to 200 characters. `context`: 0 to 1,000 characters (the
    note text and the post text, for the AI). It is frozen at the open, so
    bettors cannot change the evidence. `note_id`: optional. Any note can
    have a market.
  - `closes_at_ms`: in the future, at most 30 days ahead.
- **Bet.** `bet({market_id, outcome})`, payable, at least 0.1 NEAR. The NEAR
  goes into the YES pool or the NO pool. There is no sell: a bet stays until
  the payout. The odds are the pool split: YES share = YES pool / total pool.
  Betting stops at the close time. Each bet adds a point to the odds history
  (the last 50 points).
- **Close early.** `close_market({market_id})`: the creator or the admin can
  stop the betting now. This keeps the demo short.
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
  - A resolution is final. Bettors' ratings of the note do not count: only
    the AI (or the admin) resolves.
- **Claim.** `claim({market_id})` sends the caller's payout to the wallet.
- **Views.** `get_market`, `get_markets` (newest first, at most 50),
  `get_market_for_note`, `get_position`, `quote_bet`, `get_odds_history`,
  `get_config`.
- **Events.** NEP-297, standard `pm_notes`: `market_created`, `bet`,
  `market_closed`, `resolution_requested`, `resolution_failed`,
  `market_resolved`, `claimed`.

## Weighted payout and snapping

- The resolution has a raw probability `raw_yes_bps` (0 to 10,000) and a
  payout weight `w` = `payout_yes_bps` / 10,000.
- With the total pool `T`, the YES bets share `w × T` and the NO bets share
  `(1 − w) × T`, each in proportion to the stakes.
- Snapping: `raw ≥ 9,000` gives `w = 1`. `raw ≤ 1,000` gives `w = 0`.
  Otherwise `w = raw`. A clear answer then pays like a normal market, and
  only a grey answer pays fractionally.
- If one pool is empty, everyone gets the stake back. (With the seed, both
  pools always have NEAR.)
- Each payout rounds down to the micro-NEAR. The contract keeps the dust.
- Solvency: the shares of the payouts add up to `w × T + (1 − w) × T = T`, and
  each payout rounds down. So the sum is at most the pool. A test checks this
  with random bets and random weights.

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

- Contract unit tests: every rule and its failure message, the seed, the odds
  and the odds history, the quote, the snapping, the weighted claim, the
  refund, the callback parsing (good answer, `yes_bps` above 10,000, bad
  JSON, `null`, a worker error, a promise error, a late answer after an admin
  resolve).
- Solvency test: many seeded random bets over 5 accounts and random weights.
  After all claims, the sum of payouts ≤ the pool, and the dust is at most
  one micro-NEAR for each claim.
- Sandbox test: a fake OutLayer contract with a scripted answer. It covers
  create → bet → close → `request_resolution` → callback → claim (with real
  balances), a failed run, the admin resolve, the private callback, and the
  gas.
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

## Market strip in the notes example

The design is `pm-ui-mock.html` in the shared notes. One strip inside the
note card, no new page:

1. **Open:** "Will this note hold up?", "JEV decides · closes in …", the
   pool bar, the pool size and the bet count, Bet yes and Bet no. A note
   without a market shows "Open a market" (0.1 NEAR seed).
2. **Bet sheet:** the side with its share, the chips 0.1, 0.5 and 1 NEAR,
   "Win about X NEAR if JEV says 100% yes and the pools stay as they are",
   "A grey answer pays by its probability", and "Odds change until the
   close". The bet is signed with the Wallet's normal confirm. Spoken bets
   need a new spoken request kind and a Wallet release: later.
3. **Resolved:** "JEV: 72% this note holds up", the bar, "Yes bets share 72%
   of 4.7 NEAR", the account's bet and payout with Claim, and "Why JEV
   decided this" (the rationale).

`request_resolution` needs 300 Tgas, so it does not fit the 30 Tgas of a
spoken request. The strip signs it as a normal wallet call.

## Timeline

- 10 Nov: plan, contract, unit tests.
- 11 Nov: sandbox test, resolver worker, README. Change to parimutuel bets.
- 11–12 Nov: the market strip in the notes example.
- 12 Nov: deploy after the user's yes.

## Decisions (10 Nov 2026)

1. **JEV key.** JEV first, NEAR AI as the fallback. The user adds our own
   `TYPESAFE_API_KEY` to the OutLayer secrets at deploy time.
2. **Snapping.** ≥ 90% → 1 and ≤ 10% → 0, as proposed.
3. **Signal code.** The user allows us to copy Signal code. The README
   credits Signal for the JEV and NEAR AI request shapes and the OutLayer
   callback pattern.
4. **Who resolves.** As proposed: any account requests the AI resolution after
   the close; the creator and the admin can close early.
5. **Contract account.** `pm-notes.seams-v1.testnet` is the proposal. I ask
   again with the deploy proposal.
6. **Parimutuel bets, not an AMM** (the user's words: "parimutuel bets are
   MUCH simpler, and better/easier to embed into a twitter community note").
7. **Money flow.** Each bet attaches its NEAR. Claim sends the payout to the
   wallet. No balance inside the contract.
8. **Seed.** The creator seeds at least 0.1 NEAR, split 50/50.
9. **Bet sizes.** At least 0.1 NEAR; chips 0.1, 0.5 and 1 NEAR.
10. **Which notes.** Any note: a user can open a market on any note, so the
    demo is easy to use.
11. **Front end.** This session builds the market strip into the notes
    example after the contract.
12. **Currency** (the user, 10 Nov 2026): NEAR testnet USDC
    (`3e2210e1…b8af`, 6 decimals). Bets and seeds come in with the token's
    `ft_transfer_call`, and claims go out with `ft_transfer`. The
    `request_resolution` fee stays NEAR. The minimum bet and seed are 1 USDC,
    and the chips are 1, 5 and 10 USDC. `cyan-loong.testnet` holds USDC to
    seed demo markets. This replaces decisions 7 and 9 for the amounts.
13. **Smallest bet** (the user, 10 Nov 2026): 0.1 USDC. The seed stays at least
    1 USDC. The bet chips are 0.1, 0.5 and 1 USDC; the seed chips 1, 2 and 5.
14. **JEV on NEAR AI** (the user, 10 Nov 2026): the worker calls JEV through
    NEAR AI Cloud (`typesafe/jev-1.13`) with the NEAR AI key, so no Typesafe
    key is needed.
