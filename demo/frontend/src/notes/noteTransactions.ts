// The transaction that added each note, so a visitor can look at it on chain. The notes contract
// does not store it. So the page reads the newest transactions of the notes contract from
// FastNEAR's transactions API (src/txApi.ts), and the contract's `note_added` event in each one:
// the event names the note.

import { contractEventsOf, newestTransactions } from '../txApi.ts';

/** The newest transactions to read. The card shows the newest notes only. */
const MAX_TRANSACTIONS = 20;

/**
 * The hash of the transaction that added each note, by note id, from the answer of
 * `POST /v0/transactions`. Only an event of the notes contract counts. With two transactions for
 * one note id (a contract that started again), the first one in `transactions` wins: give them
 * newest first.
 */
export function noteTransactionsOf(body: unknown, contract: string): Record<number, string> {
  const found: Record<number, string> = {};
  for (const { hash, event, data } of contractEventsOf(body, contract, 'community_notes')) {
    if (event !== 'note_added') continue;
    for (const { note_id: noteId } of data) {
      if (typeof noteId === 'number' && Number.isSafeInteger(noteId) && !(noteId in found)) found[noteId] = hash;
    }
  }
  return found;
}

/** Reads the transactions of the newest notes of `contract`. Rejects when the API fails. */
export async function findNoteTransactions(apiUrl: string, contract: string, signal?: AbortSignal): Promise<Record<number, string>> {
  const body = await newestTransactions(apiUrl, contract, { is_function_call: true, is_real_receiver: true }, MAX_TRANSACTIONS, signal);
  return noteTransactionsOf(body, contract);
}
