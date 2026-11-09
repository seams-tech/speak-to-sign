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

export function formatNear(yocto: bigint): string {
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = ((yocto % YOCTO_PER_NEAR) * 10_000n) / YOCTO_PER_NEAR;
  return `${whole}.${fraction.toString().padStart(4, '0')} NEAR`;
}
