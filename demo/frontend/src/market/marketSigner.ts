// The market calls, signed by the Seams Wallet with its normal confirm step (passkey). Bets
// attach NEAR, so they are not spoken requests yet: a spoken bet needs a new spoken request
// kind in the Wallet.

import { createContext, useContext } from 'react';
import { functionCall } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import type { MarketTxResult, Outcome } from './types';

type Seams = ReturnType<typeof useSeams>['seams'];

const TGAS = 1_000_000_000_000n;
/** A normal market call. */
const CALL_GAS = (30n * TGAS).toString();
/** `request_resolution` calls OutLayer and waits for the AI answer. */
const REQUEST_GAS = (300n * TGAS).toString();
export const YOCTO_PER_NEAR = 10n ** 24n;
/** The OutLayer fee that `request_resolution` attaches: 0.05 NEAR. */
export const RESOLUTION_FEE_YOCTO = YOCTO_PER_NEAR / 20n;

export interface MarketSigner {
  /** Opens a market. `seed` (yoctoNEAR, at least 0.1 NEAR) goes half on yes and half on no. */
  createMarket(input: { question: string; context: string; noteId: number; closesAtMs: number; seed: bigint }): Promise<MarketTxResult>;
  bet(input: { marketId: number; outcome: Outcome; amount: bigint }): Promise<MarketTxResult>;
  closeMarket(marketId: number): Promise<MarketTxResult>;
  requestResolution(marketId: number): Promise<MarketTxResult>;
  claim(marketId: number): Promise<MarketTxResult>;
}

const NO_KEY = 'This build has no Seams publishable key (VITE_SEAMS_PUBLISHABLE_KEY), so it cannot reach the Wallet.';

/** The signer of a build without a Seams publishable key. */
export const missingKeyMarketSigner: MarketSigner = {
  createMarket: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  bet: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  closeMarket: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  requestResolution: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  claim: async () => ({ kind: 'unavailable', reason: NO_KEY }),
};

export function createSeamsMarketSigner(owner: { seams: Seams; walletId: string | null; contract: string }): MarketSigner {
  const { seams, walletId, contract } = owner;

  const send = async (method: string, args: Record<string, unknown>, deposit: bigint, gas: string): Promise<MarketTxResult> => {
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    try {
      const result = await seams.near.signAndSendTransaction({
        walletSession: walletId,
        receiverId: contract,
        actions: [functionCall({ method, args, gas, deposit: deposit.toString() })],
      });
      if (result.success) return { kind: 'sent', transactionHash: result.transactionId, events: eventsOf(result.result) };
      switch (result.kind) {
        case 'reverted':
          return { kind: 'failed', reason: contractReason(result.error), transactionHash: result.transactionId };
        case 'not_submitted':
          return { kind: 'failed', reason: `Nothing was sent. ${result.error}` };
        case 'submission_unknown':
          return { kind: 'failed', reason: `The transaction may have gone out. Check the explorer before you try again. ${result.error}` };
        case 'unresolved':
          return { kind: 'failed', reason: `The transaction has no final result yet. ${result.error}`, transactionHash: result.transactionId };
      }
    } catch (cause) {
      return { kind: 'failed', reason: `The Wallet stopped with an error: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    return { kind: 'failed', reason: 'The Wallet gave no result.' };
  };

  return {
    createMarket: ({ question, context, noteId, closesAtMs, seed }) =>
      send('create_market', { question, context, note_id: noteId, closes_at_ms: closesAtMs }, seed, CALL_GAS),
    bet: ({ marketId, outcome, amount }) => send('bet', { market_id: marketId, outcome }, amount, CALL_GAS),
    closeMarket: (marketId) => send('close_market', { market_id: marketId }, 0n, CALL_GAS),
    requestResolution: (marketId) => send('request_resolution', { market_id: marketId }, RESOLUTION_FEE_YOCTO, REQUEST_GAS),
    claim: (marketId) => send('claim', { market_id: marketId }, 0n, CALL_GAS),
  };
}

/** The NEP-297 `pm_notes` events in the logs of a final execution outcome. */
function eventsOf(outcome: unknown): { event: string; data: Record<string, unknown> }[] {
  const receipts = (outcome as { receipts_outcome?: { outcome?: { logs?: string[] } }[] } | undefined)?.receipts_outcome ?? [];
  const events: { event: string; data: Record<string, unknown> }[] = [];
  for (const receipt of receipts) {
    for (const log of receipt.outcome?.logs ?? []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const parsed = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: string; event?: string; data?: Record<string, unknown>[] };
        if (parsed.standard === 'pm_notes' && parsed.event) events.push({ event: parsed.event, data: parsed.data?.[0] ?? {} });
      } catch {
        // Not an event of this contract.
      }
    }
  }
  return events;
}

/** The contract's own message out of NEAR's failure text ("Smart contract panicked: ..."). */
function contractReason(error: string): string {
  const match = /Smart contract panicked: ([^"\\]+)/.exec(error);
  return match ? `The contract refused: ${match[1]}.` : `The transaction failed: ${error}`;
}

export const MarketSignerContext = createContext<MarketSigner>(missingKeyMarketSigner);

export function useMarketSigner(): MarketSigner {
  return useContext(MarketSignerContext);
}
