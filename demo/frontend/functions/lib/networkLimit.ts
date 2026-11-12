// The faucet's limit for each network: a few accounts for each IP address, with no reset, so that
// one script cannot empty the faucet with new account IDs. The counts are in KV (FAUCET_LIMITS).
//
// KV has no atomic increment, so requests at the same moment can pass the limit by one or two.
// The drip key's nonce stops most of such a burst: two drips that read the same nonce do not
// both go through.

/** The accounts that one network can get from the faucet. */
export const ACCOUNTS_PER_NETWORK = 3;

/** The part of a KV namespace that the limit uses. */
export interface CountStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
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
 * Takes one of the network's accounts. Null when the network has used all of them. Otherwise a
 * function that gives the account back, for a drip that sent nothing.
 */
export async function takeAccount(
  store: CountStore,
  ip: string | null,
  limit = ACCOUNTS_PER_NETWORK,
): Promise<(() => Promise<void>) | null> {
  const key = `faucet:${networkOf(ip)}`;
  const used = Number(await store.get(key)) || 0;
  if (used >= limit) return null;
  await store.put(key, String(used + 1));
  return async () => {
    const now = Number(await store.get(key)) || 0;
    await store.put(key, String(Math.max(0, now - 1)));
  };
}
