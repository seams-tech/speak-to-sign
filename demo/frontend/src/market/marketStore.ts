// Reads the note markets with the views of the pm-notes contract over NEAR JSON-RPC.

import type { MarketView, OddsPointView, PositionView } from './contractTypes';

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string; cause?: { name?: string } };
}

/** The views that the market strip needs. */
export class MarketStore {
  constructor(
    private readonly rpcUrl: string,
    readonly contractId: string,
  ) {}

  /** The newest market of a note, or null. */
  async marketForNote(noteId: number): Promise<MarketView | null> {
    return (await this.view<MarketView | null>('get_market_for_note', { note_id: noteId })) ?? null;
  }

  async position(marketId: number, accountId: string): Promise<PositionView> {
    return await this.view<PositionView>('get_position', { market_id: marketId, account_id: accountId });
  }

  async oddsHistory(marketId: number): Promise<OddsPointView[]> {
    return (await this.view<OddsPointView[]>('get_odds_history', { market_id: marketId })) ?? [];
  }

  /** The USDC balance of an account, from the token's `ft_balance_of`. */
  async balance(tokenId: string, accountId: string): Promise<bigint> {
    return BigInt(await this.viewOn<string>(tokenId, 'ft_balance_of', { account_id: accountId }));
  }

  /** True when the contract takes a bet only with the verdict of the spoken bet. */
  async voiceRequired(): Promise<boolean> {
    return (await this.view<{ required?: boolean }>('get_voice_config', {})).required === true;
  }

  /** True when the contract answers its views (it is on the network). */
  async deployed(): Promise<boolean> {
    try {
      await this.view<unknown>('get_config', {});
      return true;
    } catch (cause) {
      if (cause instanceof MarketNotDeployed) return false;
      throw cause;
    }
  }

  private view<T>(methodName: string, args: unknown): Promise<T> {
    return this.viewOn<T>(this.contractId, methodName, args);
  }

  private async viewOn<T>(accountId: string, methodName: string, args: unknown): Promise<T> {
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
          account_id: accountId,
          method_name: methodName,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
    const body = (await response.json()) as RpcResponse;
    const cause = body.error?.cause?.name;
    if (cause === 'UNKNOWN_ACCOUNT' || cause === 'NO_CONTRACT_CODE') throw new MarketNotDeployed(accountId);
    if (body.error) throw new Error(cause ?? body.error.message ?? 'NEAR RPC error.');
    if (body.result?.error) throw new Error(body.result.error);
    const bytes = body.result?.result;
    if (!bytes) throw new Error('NEAR RPC gave no result.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
  }
}

/** The market contract is not on the network (yet). */
export class MarketNotDeployed extends Error {
  constructor(readonly contractId: string) {
    super(`The market contract ${contractId} is not on testnet yet.`);
  }
}
