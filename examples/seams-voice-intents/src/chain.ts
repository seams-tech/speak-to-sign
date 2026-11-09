/* NEAR testnet reads and amounts for the Seams Voice Intents example. The page reads the
   owner's balance straight from NEAR RPC. Spoken payments go from the owner's
   own account through the Wallet. */

export const DEFAULT_RECEIVER = 'seams-v1.testnet';
export const RECEIPT_BASE_URL = 'https://testnet.nearblocks.io/txns/';
export const FAUCET_URL = 'https://docs.near.org/getting-started/faucet';

const YOCTO_PER_NEAR = 10n ** 24n;
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
/** A 0.01 NEAR spoken payment and the gas of one transfer (under 0.0001 NEAR), with a margin. */
export const PAYMENT_NEED_YOCTO = 20_000_000_000_000_000_000_000n;
const MAX_SPOKEN_HUNDREDTHS = 100_000_000n;

export type SpokenAmount =
  | Readonly<{ ok: true; amount: string }>
  | Readonly<{ ok: false; message: string }>;

type RpcReply = Readonly<{ result?: unknown; error?: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yocto(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('NEAR RPC returned an amount that is not a whole number.');
  }
  return BigInt(value);
}

async function rpcQuery(rpcUrl: string, params: Record<string, unknown>): Promise<RpcReply> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'seams-voice-intents', method: 'query', params }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('NEAR RPC returned no JSON object.');
  return body;
}

/** The balance the account can spend (its amount less its storage stake), or null if it does not exist. */
export async function readFreeBalance(rpcUrl: string, accountId: string): Promise<bigint | null> {
  const reply = await rpcQuery(rpcUrl, {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  const account = reply.result;
  if (isRecord(account) && typeof account.amount === 'string') {
    const storage = BigInt(Number(account.storage_usage ?? 0));
    return yocto(account.amount) - storage * STORAGE_YOCTO_PER_BYTE;
  }
  if (JSON.stringify(reply.error ?? '').includes('UNKNOWN_ACCOUNT')) return null;
  throw new Error(`view_account failed: ${JSON.stringify(reply.error).slice(0, 200)}`);
}

/** Yocto as NEAR with at most four decimals, rounded down. */
export function formatNear(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / YOCTO_PER_NEAR;
  const fraction = ((magnitude % YOCTO_PER_NEAR) / 10n ** 20n).toString().padStart(4, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return `${sign}${whole}${trimmed ? `.${trimmed}` : ''} NEAR`;
}

/** The verifier speaks whole hundredths of NEAR from 0.01 to 1,000,000. */
export function parseSpokenAmount(text: string): SpokenAmount {
  const value = text.trim();
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return { ok: false, message: 'Type an amount in NEAR with at most two decimals.' };
  const [, whole = '0', fraction = ''] = match;
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hundredths < 1n || hundredths > MAX_SPOKEN_HUNDREDTHS) {
    return { ok: false, message: 'Type an amount from 0.01 to 1,000,000 NEAR.' };
  }
  return { ok: true, amount: value };
}
