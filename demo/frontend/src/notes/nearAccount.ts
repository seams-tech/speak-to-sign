// The free balance of the signed-in account, so the setup panel can say when it needs testnet NEAR.

const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
const YOCTO_PER_NEAR = 10n ** 24n;
/** Gas for a few note calls (30 Tgas each, mostly refunded), with a margin. */
export const NOTE_GAS_NEED_YOCTO = 10n ** 22n;

/** The free balance in yoctoNEAR, or null when the account is not on testnet yet. */
export async function readFreeBalance(rpcUrl: string, accountId: string): Promise<bigint | null> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'notes-demo',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
  const body = (await response.json()) as {
    result?: { amount?: string; storage_usage?: number };
    error?: { cause?: { name?: string }; message?: string };
  };
  if (body.error) {
    if (body.error.cause?.name === 'UNKNOWN_ACCOUNT') return null;
    throw new Error(body.error.cause?.name ?? body.error.message ?? 'NEAR RPC error.');
  }
  const amount = BigInt(body.result?.amount ?? '0');
  const storage = BigInt(body.result?.storage_usage ?? 0);
  return amount - storage * STORAGE_YOCTO_PER_BYTE;
}

/** NEAR with four decimals and no unit: "0.2100". */
export function nearAmount(yocto: bigint): string {
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = ((yocto % YOCTO_PER_NEAR) * 10_000n) / YOCTO_PER_NEAR;
  return `${whole}.${fraction.toString().padStart(4, '0')}`;
}

export function formatNear(yocto: bigint): string {
  return `${nearAmount(yocto)} NEAR`;
}

/** One USDC in base units (testnet USDC has 6 decimals). */
export const USDC_UNIT = 1_000_000n;
/** The smallest bet of the note market (pm-notes MIN_BET): 1 USDC. */
export const USDC_NEED = USDC_UNIT;

/** A NEP-141 token balance in base units: 0 when the account holds none or is not registered. */
export async function readTokenBalance(rpcUrl: string, token: string, accountId: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'notes-demo',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: token,
        method_name: 'ft_balance_of',
        args_base64: btoa(JSON.stringify({ account_id: accountId })),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
  const body = (await response.json()) as { result?: { result?: number[] }; error?: { message?: string } };
  if (body.error || !body.result?.result) throw new Error(body.error?.message ?? 'NEAR RPC error.');
  const text = new TextDecoder().decode(Uint8Array.from(body.result.result));
  return BigInt(JSON.parse(text) as string);
}

/** USDC with two decimals and no unit: "2.00". */
export function usdcAmount(units: bigint): string {
  const whole = units / USDC_UNIT;
  const cents = ((units % USDC_UNIT) * 100n) / USDC_UNIT;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}

export function formatUsdc(units: bigint): string {
  return `${usdcAmount(units)} USDC`;
}
