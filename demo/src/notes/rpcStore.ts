import type { Note, NotesStore, Rating } from './types';

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string; cause?: { name?: string }; data?: unknown };
}

/** Reads notes with the contract view `get_notes` over NEAR JSON-RPC. */
export class RpcNotesStore implements NotesStore {
  constructor(
    private readonly rpcUrl: string,
    private readonly contractId: string,
  ) {}

  async getNotes(postId: number): Promise<Note[]> {
    const notes = await this.view<Note[]>('get_notes', { post_id: postId });
    return Array.isArray(notes) ? notes : [];
  }

  async getRating(noteId: number, accountId: string): Promise<Rating | null> {
    return (await this.view<Rating | null>('get_rating', { note_id: noteId, account_id: accountId })) ?? null;
  }

  private async view<T>(methodName: string, args: unknown): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'notes-demo',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'optimistic',
          account_id: this.contractId,
          method_name: methodName,
          args_base64: toBase64(JSON.stringify(args)),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`NEAR RPC answered ${response.status}.`);
    }
    const body = (await response.json()) as RpcResponse;
    if (body.error) {
      const cause = body.error.cause?.name;
      throw new Error((cause && RPC_ERRORS[cause]) ?? cause ?? body.error.message ?? 'NEAR RPC error.');
    }
    if (body.result?.error) {
      throw new Error(body.result.error);
    }
    const bytes = body.result?.result;
    if (!bytes) {
      throw new Error('NEAR RPC gave no result.');
    }
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
  }
}

const RPC_ERRORS: Record<string, string> = {
  UNKNOWN_ACCOUNT: 'the notes contract account does not exist.',
  NO_CONTRACT_CODE: 'the notes contract account has no contract code.',
  CONTRACT_EXECUTION_ERROR: 'the contract view failed.',
};

function toBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
