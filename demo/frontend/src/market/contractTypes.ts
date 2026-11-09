// The views of the pm-notes contract (demo/contracts/jev-prediction-market/), as JSON-RPC
// returns them. NEAR amounts are yoctoNEAR strings. Ids, times (Unix ms) and basis points are
// JSON numbers. contractSource.ts turns them into the types of types.ts.

import type { MarketStatus } from './types';

export interface Resolution {
  /** The probability of YES that the resolver gave, in basis points. */
  raw_yes_bps: number;
  /** The payout weight after the snapping (≥ 90% → 10,000, ≤ 10% → 0). */
  payout_yes_bps: number;
  source: 'ai' | 'admin';
  /** `jev` or `near-ai` for an AI resolution. */
  provider: string | null;
  model: string | null;
  rationale: string;
  resolved_by: string;
  resolved_at_ms: number;
}

export interface MarketView {
  id: number;
  question: string;
  context: string;
  note_id: number | null;
  creator: string;
  created_at_ms: number;
  closes_at_ms: number;
  yes_pool: string;
  no_pool: string;
  total_pool: string;
  /** The YES share of the pool, in basis points: the odds. */
  yes_share_bps: number;
  bets: number;
  /** One pool is empty: every claim is a refund. */
  refund_all: boolean;
  paid_out: string;
  status: MarketStatus;
  pending: { request_id: number; requested_by: string; requested_at_ms: number } | null;
  resolution: Resolution | null;
}

export interface PositionView {
  yes: string;
  no: string;
  /** What `claim` pays (or paid). Null before the resolution. */
  payout: string | null;
  claimed: boolean;
}

/** One point of `get_odds_history`. */
export interface OddsPointView {
  at_ms: number;
  yes_bps: number;
}
