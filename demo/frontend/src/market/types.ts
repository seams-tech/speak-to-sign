// The note market's data interface. The UI in this folder codes only against these types.
//
// The market is a parimutuel pool (the user's decision, 10 Nov 2026): bettors put NEAR on YES
// or NO, and at the close JEV gives the probability w that YES holds. YES stakes then share
// w of the whole pool, and NO stakes share 1 − w, each in proportion to its stake.
//
// `createMockMarketSource` (mockSource.ts) fills this interface for the preview. The JEV
// prediction market contract fills it for real: see README.md in this folder.

import type { SignResult } from '../signer/notesSigner';

export type Side = 'yes' | 'no';

/**
 * `open`: bets are on. `closed`: bets are off, and the market waits for JEV. `resolving`: a
 * request to JEV waits for its answer. `resolved`: final.
 */
export type MarketStatus = 'open' | 'closed' | 'resolving' | 'resolved';

/**
 * The money of a market. Amounts are bigint base units: yoctoNEAR for NEAR (24 decimals), and
 * 10^-6 USDC for USDC (6 decimals).
 */
export interface Currency {
  /** "NEAR" or "USDC". */
  symbol: string;
  decimals: number;
  /** The amount chips of the bet sheet and the seed, in base units. */
  chips: readonly bigint[];
  /** The word for the unit in a spoken bet: "near", "dollars". */
  spoken: string;
}

/** One market about one community note. Amounts are base units of the source's currency. */
export interface NoteMarket {
  id: number;
  noteId: number;
  /** The question on the strip, for example "Will this note hold up?". */
  question: string;
  closesAtMs: number;
  status: MarketStatus;
  yesPool: bigint;
  noPool: bigint;
  /** The number of bets so far. */
  bets: number;
  /** JEV's probability that YES holds, 0 to 10,000, once the market is resolved. */
  verdictBps?: number;
  /**
   * The payout weight, 0 to 10,000, when it is not `verdictBps`. The JEV contract snaps a
   * verdict of 90% or more to 100%, and 10% or less to 0% (`payout_yes_bps`).
   */
  payoutBps?: number;
  /** JEV's reason in plain words, once the market is resolved. */
  rationale?: string;
  /** The account that opened the market. It can close the betting early. */
  creator?: string;
}

/** One account's stakes in one market. */
export interface MarketPosition {
  yes: bigint;
  no: bigint;
  /** True after the account took its payout. */
  claimed: boolean;
  /**
   * What a claim pays now, when the contract says it (`redeemable`). Without it, the UI
   * calculates the payout with the rule in math.ts.
   */
  payout?: bigint;
}

/** One point of the odds chart: the YES share of the pool after a bet. */
export interface OddsPoint {
  atMs: number;
  yesBps: number;
}

export interface MarketSource {
  /** The market about a note, or null when the note has none (most notes have none). */
  getMarketForNote(noteId: number): Promise<NoteMarket | null>;
  getPosition(marketId: number, accountId: string): Promise<MarketPosition>;
  /** The newest points of the odds chart, oldest first (the contract keeps about 50). */
  getOddsHistory(marketId: number): Promise<OddsPoint[]>;
  /** Puts `amount` on `side`. The Wallet signs; a spoken bet when `signsByVoice`. */
  bet(input: { marketId: number; side: Side; amount: bigint }): Promise<SignResult>;
  /** Takes the account's payout of a resolved market. */
  claim(marketId: number): Promise<SignResult>;
  /**
   * Asks JEV to decide a closed market (the contract's `request_resolution`, which needs a fee).
   * Leave it out to hide the "Ask JEV now" button, for example when a script resolves markets.
   */
  requestResolution?(marketId: number): Promise<SignResult>;
  /** True when the Wallet signs a bet by voice: the sheet then shows the sentence to say. */
  signsByVoice: boolean;
  /**
   * Opens a market on a note (the contract's `create_market`). `seed` goes half on yes and half
   * on no. Leave it out to hide "Open a market".
   */
  createMarket?(input: { noteId: number; question: string; context: string; closesAtMs: number; seed: bigint }): Promise<SignResult>;
  /** Stops the betting now (the creator of the market). Leave it out to hide "Close betting now". */
  closeMarket?(marketId: number): Promise<SignResult>;
  /** False while new markets cannot open, for example before the contract is on testnet. */
  canOpenMarkets?(): Promise<boolean>;
  /** The money of the markets. Default: NEAR. */
  currency?: Currency;
  /** The account's balance of the currency, for the bet sheet. */
  getBalance?(accountId: string): Promise<bigint>;
}

/** The question of a new market. */
export const MARKET_QUESTION = 'Will this note hold up?';

export const YOCTO_PER_NEAR = 10n ** 24n;

/** The amount chips of the bet sheet: 0.1, 0.5 and 1 NEAR. */
export const BET_CHIPS: readonly bigint[] = [YOCTO_PER_NEAR / 10n, YOCTO_PER_NEAR / 2n, YOCTO_PER_NEAR];

export const NEAR_CURRENCY: Currency = { symbol: 'NEAR', decimals: 24, chips: BET_CHIPS, spoken: 'near' };

/** 1 USDC in base units. */
export const ONE_USDC = 1_000_000n;

/** NEAR testnet USDC: chips of 1, 5 and 10 USDC. */
export const USDC_CURRENCY: Currency = { symbol: 'USDC', decimals: 6, chips: [ONE_USDC, 5n * ONE_USDC, 10n * ONE_USDC], spoken: 'dollars' };
