// An in-memory MarketSource for the preview page and for UI work before the contract exists.
// Bets, claims and JEV requests change local state after a short delay, as a transaction would.

import type { SignResult } from '../signer/notesSigner';
import { yesShareBps } from './math';
import {
  NEAR_CURRENCY,
  type Currency,
  type MarketPosition,
  type MarketSource,
  type NoteMarket,
  type OddsPoint,
  type SignProgress,
} from './types';
import { spokenBetSentence } from './spokenBet';

export interface MockMarketSource extends MarketSource {
  /** Ends betting, as the close time would. */
  close(noteId: number): void;
  /** Sets JEV's verdict, as the contract's resolution callback would. */
  resolve(noteId: number, verdictBps: number, rationale?: string): void;
}

interface MockOptions {
  /** The notes that have a market. Default: every note. */
  noteIds?: number[];
  signsByVoice?: boolean;
  /** True: a bet needs a spoken sentence, as on the contract. The mock accepts every recording. */
  spokenBets?: boolean;
  /** The time that a bet or a claim takes. A JEV request takes twice as long. */
  delayMs?: number;
  /** JEV's answer to "Ask JEV now". Default: 93%, which snaps to a full YES. */
  jevAnswer?: { verdictBps: number; rationale: string };
  /** The money of the markets. Default: NEAR. With USDC, the pools are 10 times larger. */
  currency?: Currency;
  /** The signed-in account: the creator of the markets that it opens. */
  account?: string;
}

const DAY_MS = 86_400_000;

/** The contract's snapping: a verdict of 90% or more pays as 100%, and 10% or less as 0%. */
function snap(verdictBps: number): number | undefined {
  if (verdictBps >= 9_000) return 10_000;
  if (verdictBps <= 1_000) return 0;
  return undefined;
}

export function createMockMarketSource(options: MockOptions = {}): MockMarketSource {
  const markets = new Map<number, NoteMarket>();
  const histories = new Map<number, OddsPoint[]>();
  const positions = new Map<number, MarketPosition>();
  const delay = () => new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 700));
  /** The Wallet's confirm, then the transaction: each takes one delay. */
  const signed = async (progress?: SignProgress) => {
    progress?.('confirm');
    await delay();
    progress?.('sent');
    await delay();
  };
  const currency = options.currency ?? NEAR_CURRENCY;
  // A tenth of the pool unit: 0.1 NEAR, or 1 USDC.
  const tenth = currency.symbol === 'NEAR' ? 10n ** BigInt(currency.decimals) / 10n : 10n ** BigInt(currency.decimals);

  const marketOf = (noteId: number): NoteMarket | null => {
    if (options.noteIds && !options.noteIds.includes(noteId) && !markets.has(noteId)) return null;
    let market = markets.get(noteId);
    if (!market) {
      // A deterministic pool for each note, so a reload shows the same market.
      const yesTenths = BigInt(18 + ((noteId * 7) % 23));
      const noTenths = BigInt(9 + ((noteId * 5) % 13));
      market = {
        id: noteId,
        noteId,
        question: 'Will this note hold up?',
        closesAtMs: Date.now() + 2 * DAY_MS,
        status: 'open',
        yesPool: yesTenths * tenth,
        noPool: noTenths * tenth,
        bets: 4 + (noteId % 7),
      };
      markets.set(noteId, market);
      histories.set(market.id, walk(noteId, yesShareBps(market.yesPool, market.noPool), market.bets));
    }
    return market;
  };

  const sent = (): SignResult => ({ kind: 'sent', transactionHash: `mock${Math.random().toString(36).slice(2, 12)}` });
  const answer = answerWith(options, sent);

  return {
    signsByVoice: options.signsByVoice ?? true,
    voice: options.spokenBets
      ? {
          required: async () => true,
          sentence: spokenBetSentence,
          async check() {
            await delay();
            return { kind: 'accepted', verdictJson: '{"mock":true}', signatureB64: '' };
          },
        }
      : undefined,
    currency,
    async getBalance() {
      return 20n * tenth;
    },

    async getMarketForNote(noteId) {
      const market = marketOf(noteId);
      return market ? { ...market } : null;
    },

    async getPosition(marketId) {
      return { ...(positions.get(marketId) ?? { yes: 0n, no: 0n, claimed: false }) };
    },

    async getOddsHistory(marketId) {
      return [...(histories.get(marketId) ?? [])];
    },

    async bet({ marketId, side, amount }, progress) {
      await signed(progress);
      const market = markets.get(marketId);
      if (!market || market.status !== 'open') return { kind: 'refused', reason: 'This market is closed for bets.' };
      if (side === 'yes') market.yesPool += amount;
      else market.noPool += amount;
      market.bets += 1;
      const position = positions.get(marketId) ?? { yes: 0n, no: 0n, claimed: false };
      if (side === 'yes') position.yes += amount;
      else position.no += amount;
      positions.set(marketId, position);
      histories.get(marketId)?.push({ atMs: Date.now(), yesBps: yesShareBps(market.yesPool, market.noPool) });
      return sent();
    },

    async claim(marketId, progress) {
      await signed(progress);
      const market = markets.get(marketId);
      const position = positions.get(marketId);
      if (!market || market.status !== 'resolved' || !position) return { kind: 'refused', reason: 'Nothing to claim yet.' };
      position.claimed = true;
      return sent();
    },

    async requestResolution(marketId, progress) {
      await signed(progress);
      await delay();
      return answer(markets.get(marketId), false);
    },

    async closeAndRequestResolution(marketId, progress) {
      await signed(progress);
      await delay();
      return answer(markets.get(marketId), true);
    },

    async closeMarket(marketId) {
      await delay();
      const market = markets.get(marketId);
      if (!market || market.status !== 'open') return { kind: 'refused', reason: 'This market is not open.' };
      market.status = 'closed';
      return sent();
    },

    async createMarket({ noteId, question, closesAtMs, seed }, progress) {
      await signed(progress);
      if (markets.has(noteId)) return { kind: 'refused', reason: 'This note has a market.' };
      const half = seed / 2n;
      const market: NoteMarket = {
        id: noteId,
        noteId,
        question,
        closesAtMs,
        status: 'open',
        yesPool: half,
        noPool: seed - half,
        bets: 0,
        creator: options.account,
      };
      markets.set(noteId, market);
      histories.set(noteId, [{ atMs: Date.now(), yesBps: 5_000 }]);
      positions.set(noteId, { yes: half, no: seed - half, claimed: false });
      return sent();
    },

    close(noteId) {
      const market = marketOf(noteId);
      if (market && market.status === 'open') market.status = 'closed';
    },

    resolve(noteId, verdictBps, rationale) {
      const market = marketOf(noteId);
      if (market) applyVerdict(market, verdictBps, rationale);
    },
  };
}

/** Tells whether a closed market (or an open one with `closeFirst`) went to JEV, and applies JEV's answer. */
function answerWith(
  options: MockOptions,
  sent: () => SignResult,
): (market: NoteMarket | undefined, closeFirst: boolean) => SignResult {
  return (market, closeFirst) => {
    const ready = market && (market.status === 'closed' || (closeFirst && market.status === 'open'));
    if (!market || !ready) return { kind: 'refused', reason: 'Only a closed market can go to JEV.' };
    const answer = options.jevAnswer ?? {
      verdictBps: 9_300,
      rationale: 'The note links the original study, and the post misquotes its main number. The sources agree.',
    };
    applyVerdict(market, answer.verdictBps, answer.rationale);
    return sent();
  };
}

function applyVerdict(market: NoteMarket, verdictBps: number, rationale?: string) {
  market.status = 'resolved';
  market.verdictBps = verdictBps;
  market.payoutBps = snap(verdictBps);
  market.rationale = rationale;
}

/** A made-up odds history of `count` points that ends at `endBps`. */
function walk(seed: number, endBps: number, count: number): OddsPoint[] {
  const points: OddsPoint[] = [];
  let value = 5_000;
  const now = Date.now();
  for (let index = 0; index < count; index += 1) {
    const towards = endBps + (5_000 - endBps) * (1 - index / Math.max(1, count - 1));
    const noise = Math.sin(seed * 999 + index * 7.3) * 10_000;
    const wobble = (noise - Math.floor(noise) - 0.5) * 1_400;
    value = index === count - 1 ? endBps : Math.max(500, Math.min(9_500, Math.round(towards + wobble)));
    points.push({ atMs: now - (count - index) * 3_600_000, yesBps: value });
  }
  return points;
}
