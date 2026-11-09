# Note market UI

A small parimutuel bet strip for a community note, and its bet sheet. JEV
decides each market. The JEV prediction market contract
(`demo/contracts/jev-prediction-market/`, branch `jev-prediction-market`) is
the real data source. Until it is ready, `mockSource.ts` fills the same
interface.

See it with mock data:

```bash
pnpm dev
```

Then open <http://localhost:5173/market-preview.html>. The preview shows an
open market, a closed market with "Ask JEV now", and a resolved market with
a bet to claim. The page is dev only: it is not in the Vite build inputs.

## Files

| File | What it holds |
| ---- | ------------- |
| `types.ts` | The `MarketSource` interface. The UI codes only against it. |
| `math.ts` | The parimutuel payout rule (bigint yoctoNEAR) and the UI words. |
| `NoteMarket.tsx` | `<NoteMarketStrip>` and the bet sheet. |
| `market.css` | The `nm-*` classes. They use the X-style variables of `src/styles.css`. |
| `mockSource.ts` | `createMockMarketSource()`, an in-memory source. |
| `preview.tsx` | The dev preview page (`/market-preview.html`). |

## The rules that the UI shows

- A bettor puts NEAR on YES or NO. The chips are 0.1, 0.5 and 1 NEAR.
- The odds are the pool split: YES share = YES pool / total pool. The odds
  chart is the YES share after each bet.
- At the close, JEV gives the probability `w` that the note holds up.
  YES stakes share `w × total`, and NO stakes share `(1 − w) × total`, each
  in proportion to its stake.
- The contract snaps the weight: `w ≥ 90%` pays as 100%, and `w ≤ 10%` pays
  as 0%. The UI shows JEV's own number and the snapped weight.
- If one side has no bets, every bet is refunded.

`math.ts` `payout()` is the same rule as the contract. The contract decides
the payout. The UI only estimates it before the resolution.

## Wire it into the notes app

1. Make one source for the page, for example in `App.tsx` or in the demo
   context:

   ```tsx
   import { createMockMarketSource } from './market/mockSource';
   const marketSource = createMockMarketSource({ noteIds: [/* contested notes */] });
   ```

   Replace it with the contract source (see below) when the contract is on
   testnet.

2. In `src/components/NotesBox.tsx`, add the strip as the last row of
   `NoteCard`, after the rate row:

   ```tsx
   import { NoteMarketStrip } from '../market/NoteMarket';

   // in NoteCard, inside the card, after the RateRow / OwnNoteRow line:
   {!compact && <NoteMarketStrip noteId={note.id} source={marketSource} account={account} onSignIn={openSignIn} />}
   ```

   - `account` and `openSignIn` come from `useDemo()`. `NoteCard` already reads
     `account` there.
   - `onSignIn` opens the page's sign-in dialog. The strip calls it when a
     signed-out reader presses "Bet yes", "Bet no" or "Ask JEV now".
   - The strip renders nothing when the note has no market. Most notes have
     none, so the strip is safe on every card.
   - The strip stops click propagation, so a click on it does not open the
     card.

3. Keep `compact` cards (the timeline) without the strip. The strip belongs
   on the post page.

## Fill `MarketSource` from the contract

Read views with the NEAR RPC `call_function` query, as
`src/notes/rpcStore.ts` does. Sign changes with the Seams Wallet, as
`src/signer/seamsSigner.ts` does. Convert every `U128` string with
`BigInt(...)`.

| `MarketSource` | Contract call | Notes |
| -------------- | ------------- | ----- |
| `getMarketForNote(noteId)` | view `get_market_for_note({note_id})` | `null` → `null`. |
| `getPosition(marketId, accountId)` | view `get_position({market_id, account_id})` | Map `redeemable` to `payout`. |
| `getOddsHistory(marketId)` | view `get_odds_history({market_id})` (proposed) | See "Odds history". |
| `bet({marketId, side, amount})` | `bet({market_id, outcome})`, deposit `amount` | `outcome` is `"yes"` or `"no"`. |
| `claim(marketId)` | `redeem({market_id})` or `claim` | Use the contract's name. |
| `requestResolution(marketId)` | `request_resolution({market_id})`, 0.05 NEAR, 300 Tgas | Optional. Leave it out to hide the button. |
| `signsByVoice` | — | See "Spoken bets". |

Map a `MarketView` to a `NoteMarket` like this:

```ts
function toNoteMarket(view: MarketView): NoteMarket {
  return {
    id: view.id,
    noteId: view.note_id ?? 0,
    question: view.question, // for example "Will this note hold up?"
    closesAtMs: view.closes_at_ms,
    status: view.status, // "open" | "closed" | "resolving" | "resolved"
    yesPool: BigInt(view.yes_pool),
    noPool: BigInt(view.no_pool),
    bets: view.bets, // the number of bets (proposed field)
    verdictBps: view.resolution?.raw_yes_bps,
    payoutBps: view.resolution?.payout_yes_bps,
    rationale: view.resolution?.rationale,
  };
}
```

`MarketPosition.claimed` is true after a claim. If the contract has no such
field, set it to `false`. After a claim the position is 0, so the strip hides
"Your bets" and shows "You got X NEAR".

A `SignResult` of kind `refused` shows its `reason` under the strip. Give a
plain reason, for example "Betting on this note is closed."

### What the parimutuel contract needs for this UI

The branch's first contract (commit 5cfd53e) is an AMM with `buy`, `sell`
and quotes. For parimutuel bets, the UI needs:

- `bet({market_id, outcome})`, payable. The attached NEAR is the stake. No
  shares, no quotes and no `sell`.
- `MarketView.yes_pool` and `no_pool`: the total YES and NO stakes.
- `MarketView.bets`: the number of bets.
- `PositionView.yes`, `no` (the stakes) and `redeemable`.
- `get_odds_history({market_id})`: see below.

`status`, `resolution`, `request_resolution` and the snapping can stay as
they are.

### Odds history

The chart needs the YES share after each bet. The simplest way: the contract
keeps the last 48 points for each market, `{at_ms, yes_bps}`, and
`get_odds_history` returns them, oldest first. Each point costs about 10
bytes of storage. Another way: read the `bet` events from an indexer. If
there is no history, return `[]`. The strip then hides the chart.

### Spoken bets

When `signsByVoice` is true, the sheet shows the sentence to say, for example
"bet zero point five near yes on this note" (`betSentence` in `math.ts`), and
the button is "Say it to bet". A spoken bet needs a new spoken request kind in
the Seams Wallet, as `MergeApproval` was for merges. Until the Wallet has
one, set `signsByVoice: false`. Then sign `bet` as a plain Wallet transaction
with a passkey, and the button is "Bet 0.50 NEAR on yes".
