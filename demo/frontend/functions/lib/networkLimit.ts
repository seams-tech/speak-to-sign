// The faucet's limit for each network: a few accounts for each IP address in one UTC day, so that
// one script cannot empty the faucet with new account IDs. The counts are in KV (FAUCET_LIMITS),
// one key for each network and day. A key expires two days after its last write.
//
// KV has no atomic increment, so requests at the same moment can pass the limit by one or two.
// The drip key's nonce stops most of such a burst: two drips that read the same nonce do not
// both go through.

/** The accounts that one network can get from the faucet in one UTC day. */
export const ACCOUNTS_PER_DAY = 3;

/** Seconds that a count stays in the store: longer than its day. */
const COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;

/** The part of a KV namespace that the limit uses. */
export interface CountStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * The network of a client IP address: an IPv4 address, or the /64 network of an IPv6 address,
 * because one host can hold all the addresses of its /64.
 */
export function networkOf(ip: string | null): string {
  const text = (ip ?? '').trim().toLowerCase();
  if (!text.includes(':')) return text || 'unknown';
  const [head = '', tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0');
  const groups = [...left, ...zeros, ...right].slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ''));
  return `${groups.join(':')}::/64`;
}

/**
 * Takes one of the network's accounts of the UTC day of `nowMs`. Null when the network has used
 * all of them. Otherwise a function that gives the account back, for a drip that sent nothing.
 */
export async function takeAccount(
  store: CountStore,
  ip: string | null,
  limit = ACCOUNTS_PER_DAY,
  nowMs = Date.now(),
): Promise<(() => Promise<void>) | null> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const key = `faucet:${networkOf(ip)}:${day}`;
  const write = (count: number) => store.put(key, String(count), { expirationTtl: COUNT_TTL_SECONDS });
  const used = Number(await store.get(key)) || 0;
  if (used >= limit) return null;
  await write(used + 1);
  return async () => {
    const now = Number(await store.get(key)) || 0;
    await write(Math.max(0, now - 1));
  };
}
