# Note market UI

A small parimutuel bet strip for a community note, and its bet sheet. JEV
decides each market. The JEV prediction market contract
(`demo/contracts/jev-prediction-market/`) is the real data source
(`contractSource.ts`). `mockSource.ts` fills the same interface for the
preview.

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
| `contractSource.ts` | The source of the pm-notes contract, and `MarketSourceContext`. |
| `marketStore.ts`, `marketSigner.ts`, `contractTypes.ts` | The contract views, the Wallet calls and the view types. |
| `noteContext.ts` | The text that JEV reads for a new market. |
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

## The contract source

`contractSource.ts` fills `MarketSource` from the pm-notes contract
(`demo/contracts/jev-prediction-market/`; interface in its README).
`src/showcase/live.tsx` gives it to the notes app through
`MarketSourceContext`, with the Seams Wallet as the signer
(`marketSigner.ts`). A build without a Seams key reads the markets and cannot
sign. `NoteCard` in `src/components/NotesBox.tsx` mounts the strip on the post
page with `useMarketSource()`.

| `MarketSource` | Contract call | Notes |
| -------------- | ------------- | ----- |
| `getMarketForNote(noteId)` | view `get_market_for_note({note_id})` | `null` before the deploy too. |
| `getPosition(marketId, accountId)` | view `get_position({market_id, account_id})` | `payout` (null before the resolution) and `claimed`. |
| `getOddsHistory(marketId)` | view `get_odds_history({market_id})` | The last 50 points, oldest first. |
| `bet({marketId, side, amount})` | USDC `ft_transfer_call` to the market, `msg` `{"action":"bet","market_id","outcome"}`, 1 yoctoNEAR, 100 Tgas | At least 0.1 USDC. A refused bet comes back, and the signer reports it from the missing `bet` event. |
| `claim(marketId)` | `claim({market_id})`, 50 Tgas | The market sends the USDC with `ft_transfer`. A `claim_failed` event becomes a `refused` result. |
| `requestResolution(marketId)` | `request_resolution({market_id})`, 0.01 NEAR (OutLayer refunds the unused part), 300 Tgas | A `resolution_failed` event becomes a `refused` result with its reason. |
| `createMarket(input)` | USDC `ft_transfer_call`, `msg` `{"action":"create_market","question","context","note_id","closes_at_ms"}`, amount `seed` | Optional in the interface. The strip then shows "Open a market" on a note without a market. |
| `closeMarket(marketId)` | `close_market({market_id})` | Optional. The creator sees "Close betting now". |
| `canOpenMarkets()` | view `get_config` | False before the deploy: "Open a market" stays hidden. |
| `currency` | — | `USDC_CURRENCY`: 6 decimals, chips 1, 5 and 10 USDC. Without it, a source is in NEAR (the mock). |
| `getBalance(accountId)` | USDC view `ft_balance_of` | The bet sheet shows it, and a hint to the faucet when it is too low. |
| `signsByVoice` | — | `false`. See "Spoken bets". |

The strip takes `context`, the text that JEV reads for a new market
(`noteContext.ts`: the post and the note). The contract freezes it at the
open.

The money is NEAR testnet USDC (Circle, from https://faucet.circle.com).
Settings: `VITE_MARKET_CONTRACT` (default `pm-notes.seams-v1.testnet`),
`VITE_MARKET_TOKEN` (default: testnet USDC) and `VITE_MARKET_RPC_URL`
(default: the notes RPC). `/market-preview.html?usdc` shows the mock in USDC. The contract README explains a
local sandbox with seeded markets for a check before the deploy.

### Spoken bets

When `signsByVoice` is true, the sheet shows the sentence to say, for example
"bet zero point five near yes on this note" (`betSentence` in `math.ts`), and
the button is "Say it to bet". A spoken bet needs a new spoken request kind in
the Seams Wallet, as `MergeApproval` was for merges. Until the Wallet has
one, set `signsByVoice: false`. Then sign `bet` as a plain Wallet transaction
with a passkey, and the button is "Bet 0.50 NEAR on yes".
