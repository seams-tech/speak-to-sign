// The parimutuel arithmetic of the note market, in yoctoNEAR (bigint), and the words of the UI.
// The contract must pay by the same rule; the UI only estimates.

import type { MarketPosition, NoteMarket, Side } from './types';
import { YOCTO_PER_NEAR } from './types';

const FULL_BPS = 10_000n;

/** The YES share of the pool in basis points. An empty pool shows 50%. */
export function yesShareBps(yesPool: bigint, noPool: bigint): number {
  const total = yesPool + noPool;
  if (total === 0n) return 5_000;
  return Number((yesPool * FULL_BPS) / total);
}

/**
 * The payout of a new bet if the pool stays as it is after the bet, and JEV says
 * `verdictBps` (10,000 = YES fully holds). The UI shows it with "about".
 */
export function estimatePayout(market: NoteMarket, side: Side, amount: bigint, verdictBps = 10_000): bigint {
  const yes = market.yesPool + (side === 'yes' ? amount : 0n);
  const no = market.noPool + (side === 'no' ? amount : 0n);
  return payout({ yes: side === 'yes' ? amount : 0n, no: side === 'no' ? amount : 0n }, yes, no, verdictBps);
}

/** The payout of a position in a resolved market. */
export function positionPayout(market: NoteMarket, position: Pick<MarketPosition, 'yes' | 'no'>): bigint {
  return payout(position, market.yesPool, market.noPool, payoutWeightBps(market));
}

/** The payout weight of a resolved market: the snapped weight if the contract gives one. */
export function payoutWeightBps(market: NoteMarket): number {
  return market.payoutBps ?? market.verdictBps ?? 5_000;
}

/**
 * The parimutuel rule with a JEV weight w: YES stakes share w × total, NO stakes share
 * (1 − w) × total, each in proportion to its stake. When one side has no stakes, every stake
 * is refunded, because nobody could take that side's share.
 */
export function payout(position: Pick<MarketPosition, 'yes' | 'no'>, yesPool: bigint, noPool: bigint, verdictBps: number): bigint {
  if (yesPool === 0n || noPool === 0n) return position.yes + position.no;
  const total = yesPool + noPool;
  const w = BigInt(Math.max(0, Math.min(10_000, Math.round(verdictBps))));
  const fromYes = (position.yes * total * w) / (yesPool * FULL_BPS);
  const fromNo = (position.no * total * (FULL_BPS - w)) / (noPool * FULL_BPS);
  return fromYes + fromNo;
}

/** "0.70 NEAR": NEAR with two decimals, rounded down. */
export function nearText(yocto: bigint, decimals = 2): string {
  const scale = 10n ** BigInt(decimals);
  const value = (yocto * scale) / YOCTO_PER_NEAR;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction} NEAR`;
}

/** "0.1", "0.5", "1": the amount of a chip, without the unit. */
export function chipText(yocto: bigint): string {
  return nearText(yocto, 2)
    .replace(/\.?0+ NEAR$/, '')
    .replace(/ NEAR$/, '');
}

/** "68%" from basis points. */
export function percentText(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

/** "2 d left", "5 h left", "closing". */
export function timeLeftText(closesAtMs: number, nowMs = Date.now()): string {
  const minutes = Math.floor((closesAtMs - nowMs) / 60_000);
  if (minutes <= 0) return 'closing';
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h left`;
  return `${Math.floor(hours / 24)} d left`;
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * The sentence for a spoken bet, for example "bet zero point five near yes on this note".
 * The Wallet's spoken request kind decides the final words; this is what the sheet shows.
 */
export function betSentence(side: Side, amount: bigint): string {
  const tenths = (amount * 10n) / YOCTO_PER_NEAR;
  const whole = Number(tenths / 10n);
  const tenth = Number(tenths % 10n);
  const number = whole < 10 ? (tenth === 0 ? DIGITS[whole] : `${DIGITS[whole]} point ${DIGITS[tenth]}`) : String(whole);
  return `bet ${number} near ${side} on this note`;
}
