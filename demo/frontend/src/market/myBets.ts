// "Your bets" in the right column: the markets where the signed-in account has a stake, with its
// position in each (from the market contract) and the transactions of its bets (from the
// transactions API, src/market/betTransactions.ts). A strip that places a bet announces it, and
// the list reads again.

import { useEffect, useState } from 'react';
import { config } from '../config';
import { findPlacedBets, type PlacedBet } from './betTransactions';
import type { MarketPosition, MarketSource, NoteMarket } from './types';

/** One market of "Your bets". `bets` has the transactions that the API knows, newest first. */
export interface MyMarket {
  market: NoteMarket;
  position: MarketPosition;
  bets: PlacedBet[];
}

/**
 * The transactions API sees a new transaction a few seconds after the chain does. After a bet,
 * the list reads again at once (the position), then after this time (the transaction).
 */
const API_DELAY_MS = 5000;

const listeners = new Set<() => void>();

/** A bet went out: "Your bets" reads again. */
export function announceBet(): void {
  for (const listener of listeners) listener();
}

/** The markets where `account` has a stake, newest first. Empty while it reads, or with no source. */
export function useMyBets(account: string | undefined, source: MarketSource): MyMarket[] {
  const [markets, setMarkets] = useState<MyMarket[]>([]);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const again = () => {
      setReads((count) => count + 1);
      window.setTimeout(() => setReads((count) => count + 1), API_DELAY_MS);
    };
    listeners.add(again);
    return () => {
      listeners.delete(again);
    };
  }, []);

  useEffect(() => {
    setMarkets([]);
  }, [account]);

  useEffect(() => {
    if (!account || !source.getPositions) return;
    const controller = new AbortController();
    void (async () => {
      const positions = await source.getPositions!(account).catch(() => null);
      if (!positions || controller.signal.aborted) return;
      // The transactions only add links: without them, the positions still show.
      const bets = await findPlacedBets(config.txApiUrl, config.marketContract, account, controller.signal).catch(() => [] as PlacedBet[]);
      if (controller.signal.aborted) return;
      setMarkets(positions.map((entry) => ({ ...entry, bets: bets.filter((bet) => bet.marketId === entry.market.id) })));
    })();
    return () => controller.abort();
  }, [account, source, reads]);

  return markets;
}
