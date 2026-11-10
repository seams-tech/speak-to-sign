// The page side of the testnet faucet (functions/api/faucet.ts): one request, and the faucet
// sends the account 0.2 NEAR and 2 USDC in one transaction, once.

export type FaucetResult =
  | { ok: true; transactionHash: string; near: bigint; usdc: bigint }
  /** `claimed`: the account got the faucet before (HTTP 409). */
  | { ok: false; error: string; transactionHash?: string; claimed?: boolean };

export async function requestFaucet(accountId: string): Promise<FaucetResult> {
  let response: Response;
  try {
    response = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
  } catch {
    return { ok: false, error: 'The faucet is not reachable.' };
  }
  const body = (await response.json().catch(() => null)) as {
    transactionHash?: string;
    near?: string;
    usdc?: string;
    error?: string;
  } | null;
  if (response.ok && body?.transactionHash && body.near && body.usdc) {
    return { ok: true, transactionHash: body.transactionHash, near: BigInt(body.near), usdc: BigInt(body.usdc) };
  }
  return {
    ok: false,
    error: body?.error ?? `The faucet answered ${response.status}.`,
    transactionHash: body?.transactionHash,
    claimed: response.status === 409,
  };
}
