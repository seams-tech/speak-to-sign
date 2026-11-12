// The bets of one account, each with its transaction, so "Your bets" can link to the explorer.
// The market contract keeps the position, not the transactions. So the page reads the account's
// newest transactions from FastNEAR's transactions API (src/txApi.ts), and the market's `bet`
// event in each one: the event names the market, the bettor, the side and the amount.

import { contractEventsOf, newestTransactions } from '../txApi.ts';
import type { Side } from './types.ts';

/** The newest transactions of the account to read. */
const MAX_TRANSACTIONS = 40;

/** One bet that the market took. */
export interface PlacedBet {
  hash: string;
  /** When the bet's block was made, in ms, if the API says. */
  atMs: number | null;
  marketId: number;
  side: Side;
  /** In the market token's base units. */
  amount: bigint;
}

/**
 * The bets of `accountId` from an answer of `POST /v0/transactions`, in the order of its
 * transactions (give them newest first). Only a `bet` event of the market contract that names
 * the account counts.
 */
export function placedBetsOf(body: unknown, marketContract: string, accountId: string): PlacedBet[] {
  const bets: PlacedBet[] = [];
  for (const { hash, atMs, event, data } of contractEventsOf(body, marketContract, 'pm_notes')) {
    if (event !== 'bet') continue;
    for (const item of data) {
      const { market_id: marketId, account_id: account, outcome, amount } = item;
      if (account !== accountId || typeof marketId !== 'number' || (outcome !== 'yes' && outcome !== 'no') || typeof amount !== 'string') continue;
      if (!/^\d+$/.test(amount)) continue;
      bets.push({ hash, atMs, marketId, side: outcome, amount: BigInt(amount) });
    }
  }
  return bets;
}

/** Reads the newest bets of `accountId`, newest first. Rejects when the API fails. */
export async function findPlacedBets(apiUrl: string, marketContract: string, accountId: string, signal?: AbortSignal): Promise<PlacedBet[]> {
  return placedBetsOf(await newestTransactions(apiUrl, accountId, {}, MAX_TRANSACTIONS, signal), marketContract, accountId);
}
