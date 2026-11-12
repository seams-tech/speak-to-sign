// FastNEAR's transactions API (config.txApiUrl). NEAR RPC cannot list the transactions of an
// account, so the page asks this API for an account's newest transactions, then reads the NEP-297
// events that a contract logged in them: the note that a transaction added, or the bet that it
// placed.
//
// The answers only add links and lists. If the API fails, the page shows less, and nothing else
// changes.

/** One NEP-297 event that a contract logged in a transaction. */
export interface LoggedEvent {
  /** The transaction's hash. */
  hash: string;
  /** When the transaction's block was made, in ms, if the answer says. */
  atMs: number | null;
  event: string;
  data: Record<string, unknown>[];
}

type Entry = {
  transaction?: { hash?: unknown; receiver_id?: unknown };
  execution_outcome?: { block_timestamp?: unknown };
  receipts?: unknown;
};
type Receipt = { receipt?: { receiver_id?: unknown }; execution_outcome?: { outcome?: { logs?: unknown } } };

/**
 * The events of `standard` that `contract` logged, from an answer of `POST /v0/transactions`, in
 * the order of its transactions. A receipt counts when `contract` ran it; a receipt with no
 * receiver counts when the transaction went to `contract`.
 */
export function contractEventsOf(body: unknown, contract: string, standard: string): LoggedEvent[] {
  const transactions = (body as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(transactions)) return [];
  const events: LoggedEvent[] = [];
  for (const entry of transactions as Entry[]) {
    const hash = entry?.transaction?.hash;
    if (typeof hash !== 'string' || !Array.isArray(entry.receipts)) continue;
    const toContract = entry.transaction?.receiver_id === contract;
    const nanos = entry.execution_outcome?.block_timestamp;
    const atMs = typeof nanos === 'string' || typeof nanos === 'number' ? Number(BigInt(nanos) / 1_000_000n) : null;
    for (const receipt of entry.receipts as Receipt[]) {
      const receiver = receipt?.receipt?.receiver_id;
      if (receiver === undefined ? !toContract : receiver !== contract) continue;
      const logs = receipt?.execution_outcome?.outcome?.logs;
      if (!Array.isArray(logs)) continue;
      for (const log of logs) {
        const parsed = parseEvent(log, standard);
        if (parsed) events.push({ hash, atMs, ...parsed });
      }
    }
  }
  return events;
}

function parseEvent(log: unknown, standard: string): Pick<LoggedEvent, 'event' | 'data'> | null {
  if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) return null;
  try {
    const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: unknown; event?: unknown; data?: unknown };
    if (event.standard !== standard || typeof event.event !== 'string' || !Array.isArray(event.data)) return null;
    return { event: event.event, data: event.data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) };
  } catch {
    return null;
  }
}

/**
 * The newest `limit` transactions of `accountId`, with their receipts and logs, newest first: the
 * answer of `POST /v0/transactions`. `filter` narrows the list (for example
 * `{ is_real_receiver: true }`). Rejects when the API fails.
 */
export async function newestTransactions(
  apiUrl: string,
  accountId: string,
  filter: Record<string, boolean>,
  limit: number,
  signal?: AbortSignal,
): Promise<{ transactions: unknown[] }> {
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`The transactions API answered ${response.status}.`);
    return response.json();
  };
  const list = (await post('/v0/account', { account_id: accountId, ...filter })) as { account_txs?: unknown };
  const newest = (Array.isArray(list?.account_txs) ? (list.account_txs as { transaction_hash?: unknown; tx_block_height?: unknown }[]) : [])
    .filter((item) => typeof item?.transaction_hash === 'string')
    .sort((a, b) => Number(b.tx_block_height ?? 0) - Number(a.tx_block_height ?? 0))
    .slice(0, limit)
    .map((item) => item.transaction_hash as string);
  if (newest.length === 0) return { transactions: [] };
  const details = (await post('/v0/transactions', { tx_hashes: newest })) as { transactions?: { transaction?: { hash?: unknown } }[] };
  // The answer can come in another order: put it back in the newest-first order.
  const order = new Map(newest.map((hash, index) => [hash, index]));
  const transactions = [...(details?.transactions ?? [])].sort(
    (a, b) => (order.get(String(a?.transaction?.hash)) ?? 0) - (order.get(String(b?.transaction?.hash)) ?? 0),
  );
  return { transactions };
}
