// Reads the note markets with the views of the pm-notes contract over NEAR JSON-RPC.

import { config } from '../config';
import type { MarketView, PositionView } from './types';

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string; cause?: { name?: string } };
}

/** The views that the market strip needs. */
export class MarketStore {
  constructor(
    private readonly rpcUrl: string,
    private readonly contractId: string,
  ) {}

  /** The newest market of a note, or null. */
  async marketForNote(noteId: number): Promise<MarketView | null> {
    return (await this.view<MarketView | null>('get_market_for_note', { note_id: noteId })) ?? null;
  }

  async position(marketId: number, accountId: string): Promise<PositionView> {
    return await this.view<PositionView>('get_position', { market_id: marketId, account_id: accountId });
  }

  private async view<T>(methodName: string, args: unknown): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'notes-market',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'optimistic',
          account_id: this.contractId,
          method_name: methodName,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
    const body = (await response.json()) as RpcResponse;
    const cause = body.error?.cause?.name;
    if (cause === 'UNKNOWN_ACCOUNT' || cause === 'NO_CONTRACT_CODE') throw new MarketNotDeployed(this.contractId);
    if (body.error) throw new Error(cause ?? body.error.message ?? 'NEAR RPC error.');
    if (body.result?.error) throw new Error(body.result.error);
    const bytes = body.result?.result;
    if (!bytes) throw new Error('NEAR RPC gave no result.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
  }
}

/** The market contract is not on testnet (yet). */
export class MarketNotDeployed extends Error {
  constructor(readonly contractId: string) {
    super(`The market contract ${contractId} is not on testnet yet.`);
  }
}

export const marketStore = new MarketStore(config.marketRpcUrl, config.marketContract);
