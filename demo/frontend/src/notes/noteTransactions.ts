// The transaction that added each note, so a visitor can look at it on chain. The notes contract
// does not store it, and NEAR RPC cannot list the transactions of an account. So the page asks
// FastNEAR's transactions API (config.txApiUrl) for the newest transactions of the notes contract,
// and reads the contract's `note_added` event in each one: the event names the note.
//
// The answer only adds links. If the API fails, the page shows no link and nothing else changes.

/** The newest transactions to read. The card shows the newest notes only. */
const MAX_TRANSACTIONS = 20;

interface AccountTransaction {
  transaction_hash?: unknown;
  tx_block_height?: unknown;
}

/**
 * The hash of the transaction that added each note, by note id, from the answer of
 * `POST /v0/transactions`. Only an event of the notes contract counts. With two transactions for
 * one note id (a contract that started again), the first one in `transactions` wins: give them
 * newest first.
 */
export function noteTransactionsOf(body: unknown, contract: string): Record<number, string> {
  const found: Record<number, string> = {};
  const transactions = (body as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(transactions)) return found;
  for (const entry of transactions as { transaction?: { hash?: unknown; receiver_id?: unknown }; receipts?: unknown }[]) {
    const hash = entry?.transaction?.hash;
    if (typeof hash !== 'string' || entry.transaction?.receiver_id !== contract || !Array.isArray(entry.receipts)) continue;
    for (const receipt of entry.receipts as { receipt?: { receiver_id?: unknown }; execution_outcome?: { outcome?: { logs?: unknown } } }[]) {
      if (receipt?.receipt?.receiver_id !== undefined && receipt.receipt.receiver_id !== contract) continue;
      const logs = receipt?.execution_outcome?.outcome?.logs;
      if (!Array.isArray(logs)) continue;
      for (const noteId of logs.flatMap(addedNoteIds)) {
        if (!(noteId in found)) found[noteId] = hash;
      }
    }
  }
  return found;
}

/** The note ids of a `note_added` event log of the notes contract. */
function addedNoteIds(log: unknown): number[] {
  if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) return [];
  try {
    const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: unknown; event?: unknown; data?: unknown };
    if (event.standard !== 'community_notes' || event.event !== 'note_added' || !Array.isArray(event.data)) return [];
    return (event.data as { note_id?: unknown }[]).flatMap((item) => (Number.isSafeInteger(item?.note_id) ? [item.note_id as number] : []));
  } catch {
    return [];
  }
}

/** Reads the transactions of the newest notes of `contract`. Rejects when the API fails. */
export async function findNoteTransactions(apiUrl: string, contract: string, signal?: AbortSignal): Promise<Record<number, string>> {
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`The transactions API answered ${response.status}.`);
    return response.json();
  };
  const list = (await post('/v0/account', { account_id: contract, is_function_call: true, is_real_receiver: true })) as { account_txs?: unknown };
  const newest = (Array.isArray(list?.account_txs) ? (list.account_txs as AccountTransaction[]) : [])
    .filter((item) => typeof item?.transaction_hash === 'string')
    .sort((a, b) => Number(b.tx_block_height ?? 0) - Number(a.tx_block_height ?? 0))
    .slice(0, MAX_TRANSACTIONS)
    .map((item) => item.transaction_hash as string);
  if (newest.length === 0) return {};
  const details = (await post('/v0/transactions', { tx_hashes: newest })) as { transactions?: { transaction?: { hash?: unknown } }[] };
  // The answer can come in another order: put it back in the newest-first order.
  const order = new Map(newest.map((hash, index) => [hash, index]));
  const sorted = [...(details?.transactions ?? [])].sort(
    (a, b) => (order.get(String(a?.transaction?.hash)) ?? 0) - (order.get(String(b?.transaction?.hash)) ?? 0),
  );
  return noteTransactionsOf({ transactions: sorted }, contract);
}
