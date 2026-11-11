// The MarketSource of the pm-notes contract (demo/contracts/jev-prediction-market/): views over
// NEAR JSON-RPC, and changes signed by the Seams Wallet (see marketSigner.ts).

import { createContext, useContext } from 'react';
import { config } from '../config';
import type { MarketView } from './contractTypes';
import { type MarketSigner, missingKeyMarketSigner } from './marketSigner';
import { MarketNotDeployed, MarketStore } from './marketStore';
import { USDC_CURRENCY, type MarketSource, type NoteMarket } from './types';

export function createContractMarketSource(signer: MarketSigner, store = new MarketStore(config.marketRpcUrl, config.marketContract)): MarketSource {
  let deployed: Promise<boolean> | null = null;
  const isDeployed = () => {
    deployed ??= store.deployed().catch(() => {
      deployed = null; // Try again next time.
      return false;
    });
    return deployed;
  };

  return {
    async getMarketForNote(noteId) {
      try {
        const view = await store.marketForNote(noteId);
        return view ? toNoteMarket(view) : null;
      } catch (cause) {
        // Before the deploy, no note has a market. The strip then stays quiet.
        if (cause instanceof MarketNotDeployed) return null;
        throw cause;
      }
    },
    async getPosition(marketId, accountId) {
      const view = await store.position(marketId, accountId);
      return {
        yes: BigInt(view.yes),
        no: BigInt(view.no),
        claimed: view.claimed,
        payout: view.payout === null ? undefined : BigInt(view.payout),
      };
    },
    async getOddsHistory(marketId) {
      return (await store.oddsHistory(marketId)).map((point) => ({ atMs: point.at_ms, yesBps: point.yes_bps }));
    },
    bet: (input, progress) => signer.bet(input, progress),
    claim: (marketId, progress) => signer.claim(marketId, progress),
    requestResolution: (marketId, progress) => signer.requestResolution(marketId, progress),
    closeAndRequestResolution: (marketId, progress) => signer.closeAndRequestResolution(marketId, progress),
    createMarket: (input, progress) => signer.createMarket(input, progress),
    closeMarket: (marketId) => signer.closeMarket(marketId),
    canOpenMarkets: isDeployed,
    currency: USDC_CURRENCY,
    getBalance: (accountId) => store.balance(config.marketToken, accountId),
    // The Wallet signs a bet as a spoken request: its card records the sentence, and the bet
    // carries the signed verdict for the contract. So the page has no "say it" step (`voice`).
    signsByVoice: true,
  };
}

export function toNoteMarket(view: MarketView): NoteMarket {
  return {
    id: view.id,
    noteId: view.note_id ?? 0,
    question: view.question,
    closesAtMs: view.closes_at_ms,
    // The view's status is at the last block. An open market past its close is closed.
    status: view.status === 'open' && Date.now() >= view.closes_at_ms ? 'closed' : view.status,
    yesPool: BigInt(view.yes_pool),
    noPool: BigInt(view.no_pool),
    bets: view.bets,
    verdictBps: view.resolution?.raw_yes_bps,
    payoutBps: view.resolution?.payout_yes_bps,
    rationale: view.resolution?.rationale,
    creator: view.creator,
  };
}

/** The market source of the notes app. A build without a Seams key reads, and cannot sign. */
export const MarketSourceContext = createContext<MarketSource>(createContractMarketSource(missingKeyMarketSigner));

export function useMarketSource(): MarketSource {
  return useContext(MarketSourceContext);
}
