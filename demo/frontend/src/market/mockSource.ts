// An in-memory MarketSource for the preview page and for UI work before the contract exists.
// Bets, claims and JEV requests change local state after a short delay, as a transaction would.

import type { SignResult } from '../signer/notesSigner';
import { yesShareBps } from './math';
import { YOCTO_PER_NEAR, type MarketPosition, type MarketSource, type NoteMarket, type OddsPoint } from './types';

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
  /** The time that a bet or a claim takes. A JEV request takes twice as long. */
  delayMs?: number;
  /** JEV's answer to "Ask JEV now". Default: 93%, which snaps to a full YES. */
  jevAnswer?: { verdictBps: number; rationale: string };
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

  const marketOf = (noteId: number): NoteMarket | null => {
    if (options.noteIds && !options.noteIds.includes(noteId)) return null;
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
        yesPool: (yesTenths * YOCTO_PER_NEAR) / 10n,
        noPool: (noTenths * YOCTO_PER_NEAR) / 10n,
        bets: 4 + (noteId % 7),
      };
      markets.set(noteId, market);
      histories.set(market.id, walk(noteId, yesShareBps(market.yesPool, market.noPool), market.bets));
    }
    return market;
  };

  const sent = (): SignResult => ({ kind: 'sent', transactionHash: `mock${Math.random().toString(36).slice(2, 12)}` });

  return {
    signsByVoice: options.signsByVoice ?? true,

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

    async bet({ marketId, side, amount }) {
      await delay();
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

    async claim(marketId) {
      await delay();
      const market = markets.get(marketId);
      const position = positions.get(marketId);
      if (!market || market.status !== 'resolved' || !position) return { kind: 'refused', reason: 'Nothing to claim yet.' };
      position.claimed = true;
      return sent();
    },

    async requestResolution(marketId) {
      await delay();
      await delay();
      const market = markets.get(marketId);
      if (!market || market.status !== 'closed') return { kind: 'refused', reason: 'Only a closed market can go to JEV.' };
      const answer = options.jevAnswer ?? {
        verdictBps: 9_300,
        rationale: 'The note links the original study, and the post misquotes its main number. The sources agree.',
      };
      applyVerdict(market, answer.verdictBps, answer.rationale);
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
