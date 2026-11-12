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
open market, a closed market with "Ask JEV now", a resolved market with a bet
to claim, a note without a market, and one-tap bets. `?usdc` shows the
markets in USDC, and `?signedout` starts signed out (the sign-in "succeeds"
after 0.8 s, and the action then runs). The page is dev only: it is not in the
Vite build inputs.

## The flow

The strip keeps the steps few. Each step below is one tap and, where it signs,
one Wallet confirm.

1. **Open a market.** "Open a market" opens one at once: the first seed chip
   (1 USDC) and 3 minutes of betting. "Change" opens the sheet for another
   seed or time.
2. **Bet.** "Bet yes" or "Bet no". With `directBet`, the bet goes out at once;
   without it, the bet sheet asks for the side and the amount. The bar, the
   pool and "Your bets" move as soon as the Wallet sends the transaction, and
   the bar pulses until the market's view has the bet.
3. **Close and ask JEV.** The creator sees "Close betting and ask JEV now":
   `close_market` and `request_resolution` in one transaction. After the
   close time, anyone sees "Ask JEV now".
4. **JEV decides.** The strip says "Confirm in the Wallet", then "JEV is
   reading the post and the note…". When JEV answers, the bar slides to JEV's
   split, the number counts up, and the result slides in with JEV's answer in
   plain words.
5. **Claim.** "Claim 1.62 USDC" sends the payout to the wallet.

One flow is one dialog (the user's rule): no dialog opens on top of, or after,
another. The bet sheet and the open sheet open at once, also signed out. Each
one hosts the page's sign-in as its own step (`hostSignIn` and `SignInStep`
from the page, `Morph` for the change in place), and goes on in the same
dialog after it. A tap on "Open a market" while signed out opens the sheet at
its sign-in step, then opens the market with the defaults. The preview has no
page context, so its sheets ask `onSignIn` without a hosted step.

An action that starts while signed out asks for the sign-in (`onSignIn`) and
runs after it. If `onSignIn` returns a promise, the tapped button says
"Setting up your wallet…", and the action runs only when the promise resolves
true (the page resolves it when the visitor is signed in and the faucet's
USDC arrived); false drops it. Without a promise, the action runs when
`account` arrives, within 2 minutes. The strip reads the
market again every 10 s (3 s while JEV decides), so other people's bets show.
The Wallet's confirm step gets its own title and text for each action
(`confirmerText`), and the strip follows the Wallet's signing events
(`onEvent`).

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

- A bettor puts USDC on YES or NO (NEAR in the mock without `?usdc`). The
  chips are 0.1, 0.5 and 1 USDC.
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
     signed-out reader presses "Bet yes", "Bet no", "Open a market" or "Ask
     JEV now", and runs that action after the sign-in. It can return
     `Promise<boolean>`: true when the visitor can act (signed in and funded).
     Keep the strip mounted while the sign-in dialog shows.
   - The strip renders nothing when the note has no market. Most notes have
     none, so the strip is safe on every card.
   - The strip stops click propagation, so a click on it does not open the
     card.

3. The timeline's card (`src/x/Timeline.tsx`) mounts the strip for a note of
   this app. Its `openBet` prop opens the bet sheet when a click on the card
   asks for it.

## The contract source

`contractSource.ts` fills `MarketSource` from the pm-notes contract
(`demo/contracts/jev-prediction-market/`; interface in its README).
`src/showcase/live.tsx` gives it to the notes app through
`MarketSourceContext`, with the Seams Wallet as the signer
(`marketSigner.ts`). A build without a Seams key reads the markets and cannot
sign. The timeline's card mounts the strip with `useMarketSource()`.

| `MarketSource` | Contract call | Notes |
| -------------- | ------------- | ----- |
| `getMarketForNote(noteId)` | view `get_market_for_note({note_id})` | `null` before the deploy too. |
| `getPosition(marketId, accountId)` | view `get_position({market_id, account_id})` | `payout` (null before the resolution) and `claimed`. |
| `getOddsHistory(marketId)` | view `get_odds_history({market_id})` | The last 50 points, oldest first. |
| `bet({marketId, side, amount}, progress?)` | USDC `ft_transfer_call` to the market, `msg` `{"action":"bet","market_id","outcome"}`, 1 yoctoNEAR, 100 Tgas | At least 0.1 USDC. A refused bet comes back, and the signer reports it from the missing `bet` event. |
| `claim(marketId, progress?)` | `claim({market_id})`, 50 Tgas | The market sends the USDC with `ft_transfer`. A `claim_failed` event becomes a `refused` result. |
| `requestResolution(marketId, progress?)` | `request_resolution({market_id})`, 0.01 NEAR (OutLayer refunds the unused part), 300 Tgas | A `resolution_failed` event becomes a `refused` result with its reason. |
| `createMarket(input, progress?)` | USDC `ft_transfer_call`, `msg` `{"action":"create_market","question","context","note_id","closes_at_ms"}`, amount `seed` | Optional in the interface. The strip then shows "Open a market" on a note without a market. |
| `closeAndRequestResolution(marketId, progress?)` | One transaction: `close_market({market_id})` (10 Tgas), then `request_resolution({market_id})` (0.01 NEAR, 290 Tgas) | Optional. The creator sees "Close betting and ask JEV now". Checked on testnet with market 8 (transaction `5cHZdpNKUSZ21YdNoQhZCb9dC6kTENxyXmA4E6sxmQtw`). |
| `closeMarket(marketId)` | `close_market({market_id})` | Optional. The strip does not use it now. |
| `canOpenMarkets()` | view `get_config` | False before the deploy: "Open a market" stays hidden. |
| `currency` | — | `USDC_CURRENCY`: 6 decimals, bet chips 0.1, 0.5 and 1 USDC, seed chips 1, 2 and 5 USDC. Without it, a source is in NEAR (the mock). |
| `getBalance(accountId)` | USDC view `ft_balance_of` | The bet sheet shows it, and a hint to the faucet when it is too low. |
| `signsByVoice` | — | `true`. See "Spoken bets". |

`progress` hears `confirm` when the Wallet shows its confirm step, and `sent`
when the transaction goes out (`SignProgress` in `types.ts`).

The strip takes `context`, the text that JEV reads for a new market
(`noteContext.ts`: the post and the note). The contract freezes it at the
open.

The money is NEAR testnet USDC (Circle, from https://faucet.circle.com).
Settings: `VITE_MARKET_CONTRACT` (default `pm-notes.seams-v1.testnet`),
`VITE_MARKET_TOKEN` (default: testnet USDC) and `VITE_MARKET_RPC_URL`
(default: the notes RPC). `/market-preview.html?usdc` shows the mock in USDC. The contract README explains a
local sandbox with seeded markets for a check before the deploy.

### Spoken bets

A bet is a spoken request of the Seams Wallet (0.68.1):
`seams.near.spoken.bet` in `marketSigner.ts`. The Wallet card shows
the sentence ("bet zero point five usdc yes on market nine") and records it.
The verifier checks the voice and the words. The Wallet then sends the token's
`ft_transfer_call` with the signed verdict in the `msg`, with no confirm step.
The contract can check that verdict (`get_voice_config().required`). After the
Wallet's answer, the page reads the final outcome from the RPC: a bet that the
market refused has no `bet` event, and its USDC came back. Before the bet, the
page asks for the sign-in, the voice setup and the test USDC
(`source.signsByVoice`).

A new market is a spoken request too: `seams.near.signAndSendTransaction` with `approval`
with the summary "Open a prediction market on this note" (`OPEN_MARKET_SENTENCE`).
The verdict binds the receiver and the actions, so the sentence names no amount.

`source.voice`, `<SayBet>` and the request kind `market_bet` of
`/api/voice-verify` are the older page-side "say it" step. Only the mock
source uses them now (`/market-preview.html?voice`).
