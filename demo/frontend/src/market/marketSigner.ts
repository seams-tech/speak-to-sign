// The changes of the pm-notes contract, signed by the Seams Wallet with its normal confirm step
// (passkey). The money is USDC: a bet or a seed is the token's `ft_transfer_call` to the market,
// and a claim makes the market call the token's `ft_transfer`. A spoken bet needs a new spoken
// request kind in the Wallet.

import { functionCall } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import type { SignResult } from '../signer/notesSigner';
import { isUserRejection } from '../signer/rejection';
import { type BetVerdict, YOCTO_PER_NEAR, type Side, type SignProgress } from './types';

type Seams = ReturnType<typeof useSeams>['seams'];

const TGAS = 1_000_000_000_000n;
/** A normal market call. */
const CALL_GAS = (30n * TGAS).toString();
/** A claim: the market, the token's `ft_transfer` and the callback. */
const CLAIM_GAS = (50n * TGAS).toString();
/** `ft_transfer_call`: the token, the market's `ft_on_transfer` and the token again. */
const FT_CALL_GAS = (100n * TGAS).toString();
/** `request_resolution` calls OutLayer and waits for the AI answer. */
const REQUEST_GAS = (300n * TGAS).toString();
/**
 * "Close and ask JEV" in one transaction: `close_market`, then `request_resolution` in the same
 * receipt. A transaction holds at most 300 Tgas, and `request_resolution` needs 250 Tgas or more.
 */
const CLOSE_IN_BATCH_GAS = (10n * TGAS).toString();
const REQUEST_IN_BATCH_GAS = (290n * TGAS).toString();
/** The OutLayer fee that `request_resolution` attaches: 0.01 NEAR. OutLayer refunds the unused part. */
export const RESOLUTION_FEE_YOCTO = YOCTO_PER_NEAR / 100n;

export interface MarketSigner {
  createMarket(input: { noteId: number; question: string; context: string; closesAtMs: number; seed: bigint }, progress?: SignProgress): Promise<SignResult>;
  bet(input: { marketId: number; side: Side; amount: bigint; verdict?: BetVerdict }, progress?: SignProgress): Promise<SignResult>;
  closeMarket(marketId: number, progress?: SignProgress): Promise<SignResult>;
  /** A sent request whose AI answer did not count is `refused`, with the contract's reason. */
  requestResolution(marketId: number, progress?: SignProgress): Promise<SignResult>;
  /** `close_market` and `request_resolution` in one transaction (the creator). */
  closeAndRequestResolution(marketId: number, progress?: SignProgress): Promise<SignResult>;
  claim(marketId: number, progress?: SignProgress): Promise<SignResult>;
}

const NO_KEY = 'This build has no Seams publishable key (VITE_SEAMS_PUBLISHABLE_KEY), so it cannot reach the Wallet.';

/** The signer of a build without a Seams publishable key. */
export const missingKeyMarketSigner: MarketSigner = {
  createMarket: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  bet: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  closeMarket: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  requestResolution: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  closeAndRequestResolution: async () => ({ kind: 'unavailable', reason: NO_KEY }),
  claim: async () => ({ kind: 'unavailable', reason: NO_KEY }),
};

/** One function call of a transaction. */
interface Call {
  method: string;
  args: Record<string, unknown>;
  deposit: bigint;
  gas: string;
}

/** What the Wallet's confirm step says about the transaction. */
interface ConfirmText {
  title: string;
  body: string;
}

/** The Wallet's signing phases that the strip shows (see SigningEventPhase in @seams/wallet). */
const CONFIRM_PHASES = new Set(['signing.confirmation.displayed']);
const SENT_PHASES = new Set(['signing.confirmation.approved', 'signing.broadcast.started', 'signing.broadcast.accepted']);

export function createSeamsMarketSigner(owner: { seams: Seams; walletId: string | null; contract: string; token: string }): MarketSigner {
  const { seams, walletId, contract, token } = owner;

  /**
   * Sends one transaction of `calls` to `receiverId`. `check` can turn a sent transaction into a
   * refusal (from its events). `progress` hears when the Wallet asks and when the transaction
   * went out.
   */
  const send = async (
    calls: Call[],
    confirm: ConfirmText,
    progress: SignProgress | undefined,
    check?: (events: ContractEvent[], outcome: unknown) => string | null,
    receiverId = contract,
  ): Promise<SignResult> => {
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    let sent = false;
    try {
      const result = await seams.near.signAndSendTransaction({
        walletSession: walletId,
        receiverId,
        actions: calls.map(({ method, args, gas, deposit }) => functionCall({ method, args, gas, deposit: deposit.toString() })),
        options: {
          confirmerText: confirm,
          onEvent: (event) => {
            if (CONFIRM_PHASES.has(event.phase)) progress?.('confirm');
            else if (!sent && SENT_PHASES.has(event.phase)) {
              sent = true;
              progress?.('sent');
            }
          },
        },
      });
      if (result.success) {
        const refusal = check?.(eventsOf(result.result), result.result) ?? null;
        return refusal ? { kind: 'refused', reason: refusal } : { kind: 'sent', transactionHash: result.transactionId };
      }
      switch (result.kind) {
        case 'reverted':
          return { kind: 'refused', reason: contractReason(result.error) };
        case 'not_submitted':
          // The owner closed or rejected the confirm step: a cancel, not an error.
          if (isUserRejection(result.error)) return { kind: 'cancelled' };
          return { kind: 'unavailable', reason: `Nothing was sent. ${result.error}` };
        case 'submission_unknown':
          return { kind: 'unavailable', reason: `The transaction may have gone out. Check the explorer before you try again. ${result.error}` };
        case 'unresolved':
          return { kind: 'unavailable', reason: `The transaction has no final result yet. ${result.error}` };
      }
    } catch (cause) {
      return { kind: 'unavailable', reason: `The Wallet stopped with an error: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    return { kind: 'unavailable', reason: 'The Wallet gave no result.' };
  };

  /**
   * Sends USDC to the market with `ft_transfer_call`. If the market refuses, the token gives the
   * USDC back and the transaction still succeeds, so the market's event tells a refusal apart.
   */
  const sendUsdc = (amount: bigint, msg: Record<string, unknown>, expectedEvent: string, confirm: ConfirmText, progress?: SignProgress) =>
    send(
      [{ method: 'ft_transfer_call', args: { receiver_id: contract, amount: amount.toString(), msg: JSON.stringify(msg) }, deposit: 1n, gas: FT_CALL_GAS }],
      confirm,
      progress,
      (events, outcome) =>
        events.some((event) => event.event === expectedEvent)
          ? null
          : `The market refused it, and the USDC came back. ${panicOf(outcome) ?? ''}`.trim(),
      token,
    );

  const usdc = (amount: bigint) => `${Number(amount) / 1_000_000} USDC`;
  const jevAnswered = (events: ContractEvent[]) => {
    const failed = events.find((event) => event.event === 'resolution_failed');
    return failed ? `JEV gave no answer that counts: ${String(failed.data.reason)}. You can ask again.` : null;
  };
  const ASK_JEV: ConfirmText = {
    title: 'Ask JEV to decide',
    body: 'JEV reads the post and the note, and its answer splits the pool. The fee is at most 0.01 NEAR; the unused part comes back.',
  };

  return {
    createMarket: ({ noteId, question, context, closesAtMs, seed }, progress) =>
      sendUsdc(
        seed,
        { action: 'create_market', question, context, note_id: noteId, closes_at_ms: closesAtMs },
        'market_created',
        { title: `Open a market with ${usdc(seed)}`, body: 'Half of your seed goes on yes and half on no. It pays like any other bet.' },
        progress,
      ),
    bet: ({ marketId, side, amount, verdict }, progress) =>
      sendUsdc(
        amount,
        // The verdict of the spoken bet goes with the bet, byte for byte: the contract checks it.
        verdict
          ? { action: 'bet', market_id: marketId, outcome: side, verdict_json: verdict.verdictJson, signature_b64: verdict.signatureB64 }
          : { action: 'bet', market_id: marketId, outcome: side },
        'bet',
        { title: `Bet ${usdc(amount)} on ${side}`, body: 'JEV decides at the close. Its answer splits the pool.' },
        progress,
      ),
    closeMarket: (marketId, progress) =>
      send(
        [{ method: 'close_market', args: { market_id: marketId }, deposit: 0n, gas: CALL_GAS }],
        { title: 'Close the betting', body: 'Nobody can bet after this.' },
        progress,
      ),
    requestResolution: (marketId, progress) =>
      send([{ method: 'request_resolution', args: { market_id: marketId }, deposit: RESOLUTION_FEE_YOCTO, gas: REQUEST_GAS }], ASK_JEV, progress, jevAnswered),
    closeAndRequestResolution: (marketId, progress) =>
      send(
        [
          { method: 'close_market', args: { market_id: marketId }, deposit: 0n, gas: CLOSE_IN_BATCH_GAS },
          { method: 'request_resolution', args: { market_id: marketId }, deposit: RESOLUTION_FEE_YOCTO, gas: REQUEST_IN_BATCH_GAS },
        ],
        { title: 'Close the betting and ask JEV', body: ASK_JEV.body },
        progress,
        jevAnswered,
      ),
    claim: (marketId, progress) =>
      send(
        [{ method: 'claim', args: { market_id: marketId }, deposit: 0n, gas: CLAIM_GAS }],
        { title: 'Claim your payout', body: 'The market sends your USDC to this account.' },
        progress,
        (events) =>
          events.some((event) => event.event === 'claim_failed')
            ? 'The USDC could not arrive: your account is not registered with USDC. Register it, then claim again.'
            : null,
      ),
  };
}

interface ContractEvent {
  event: string;
  data: Record<string, unknown>;
}

/** The NEP-297 `pm_notes` events in the logs of a final execution outcome. */
function eventsOf(outcome: unknown): ContractEvent[] {
  const receipts = (outcome as { receipts_outcome?: { outcome?: { logs?: string[] } }[] } | undefined)?.receipts_outcome ?? [];
  const events: ContractEvent[] = [];
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

/** The first contract message of a failed receipt in a final execution outcome, if any. */
function panicOf(outcome: unknown): string | null {
  const match = /Smart contract panicked: ([^"\\]+)/.exec(JSON.stringify(outcome ?? null));
  return match ? `The market says: ${match[1]}.` : null;
}

/** The contract's own message out of NEAR's failure text ("Smart contract panicked: ..."). */
function contractReason(error: string): string {
  const match = /Smart contract panicked: ([^"\\]+)/.exec(error);
  return match ? `The contract refused: ${match[1]}.` : `The transaction failed: ${error}`;
}
