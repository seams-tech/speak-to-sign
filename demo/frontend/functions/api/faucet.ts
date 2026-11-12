// POST /api/faucet  { accountId }  ->  { transactionHash, near, usdc }  or  { error }
//
// The testnet faucet of the setup card. One transaction: the faucet account calls `drip` on
// its own contract (demo/contracts/faucet), which registers the account with testnet USDC,
// sends it 2 USDC, then sends it 0.2 NEAR. Each account gets it once; the contract keeps the
// list. The key here is a function-call key that can call `drip` and nothing else.
//
// A new Seams wallet is an implicit account, which is not on the chain until its first NEAR.
// The drip's NEAR transfer creates it, so the faucet takes such an account as it is. A named
// account must exist first: its USDC would go to an account that nobody holds.
//
// Each network (IP address) gets the faucet for ACCOUNTS_PER_NETWORK accounts, so that a script
// with new account IDs cannot empty the faucet (lib/networkLimit.ts).

import { isImplicitAccount } from '../../src/guards.ts';
import { accountExists, signAndSendCall, viewCall } from '../../src/faucet/nearTx.ts';
import { DEFAULT_RPC_URL, isAccountId, json, refuseOtherOrigin } from '../lib/http.ts';
import { ACCOUNTS_PER_NETWORK, takeAccount } from '../lib/networkLimit.ts';

interface Env {
  /** "ed25519:..." The function-call key of the faucet account for `drip`. */
  FAUCET_PRIVATE_KEY?: string;
  /** KV: the accounts that each network got. No faucet without it. */
  FAUCET_LIMITS?: KVNamespace;
  /** Optional. Default seams-faucet.testnet. */
  FAUCET_ACCOUNT?: string;
  /** Optional. Default https://test.rpc.fastnear.com. */
  NEAR_RPC_URL?: string;
}

const DEFAULT_FAUCET = 'seams-faucet.testnet';
const DRIP_GAS = 150_000_000_000_000n;

interface FaucetConfig {
  near_amount: string;
  token_amount: string;
  free_near: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const refused = refuseOtherOrigin(request);
  if (refused) return refused;
  if (!env.FAUCET_PRIVATE_KEY) {
    return json({ error: 'The faucet has no key on this server.' }, 503);
  }
  if (!env.FAUCET_LIMITS) {
    return json({ error: 'The faucet has no limit store on this server.' }, 503);
  }
  const limits = env.FAUCET_LIMITS;
  const faucet = env.FAUCET_ACCOUNT ?? DEFAULT_FAUCET;
  const rpcUrl = env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;

  let accountId = '';
  try {
    const body = (await request.json()) as { accountId?: unknown };
    accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  } catch {
    return json({ error: 'Send JSON in the form { "accountId": "..." }.' }, 400);
  }
  if (!isAccountId(accountId)) {
    return json({ error: 'That is not a NEAR account ID.' }, 400);
  }

  try {
    if (await viewCall<boolean>(rpcUrl, faucet, 'has_claimed', { account_id: accountId })) {
      return json({ error: 'This account already got testnet NEAR and USDC from the faucet.' }, 409);
    }
    if (!isImplicitAccount(accountId) && !(await accountExists(rpcUrl, accountId))) {
      return json({ error: 'This account is not on NEAR testnet yet.' }, 400);
    }
    const config = await viewCall<FaucetConfig>(rpcUrl, faucet, 'get_config', {});
    const giveBack = await takeAccount(limits, request.headers.get('CF-Connecting-IP'));
    if (!giveBack) {
      return json({ error: `Your network already got testnet funds for ${ACCOUNTS_PER_NETWORK} accounts.` }, 429);
    }
    // From here an error keeps the network's account: the drip may have gone through.
    const outcome = await signAndSendCall(rpcUrl, faucet, faucet, env.FAUCET_PRIVATE_KEY, {
      methodName: 'drip',
      args: { account_id: accountId },
      gas: DRIP_GAS,
      deposit: 0n,
    });
    if (outcome.failure) {
      await giveBack();
      return json({ error: `The faucet stopped: ${outcome.failure}`, transactionHash: outcome.transactionHash }, 502);
    }
    if (outcome.value !== true) {
      await giveBack();
      return json(
        { error: 'The faucet could not send USDC (it may be empty). Nothing was sent.', transactionHash: outcome.transactionHash },
        502,
      );
    }
    return json({ transactionHash: outcome.transactionHash, near: config.near_amount, usdc: config.token_amount });
  } catch (cause) {
    return json({ error: `The faucet is not reachable: ${cause instanceof Error ? cause.message : String(cause)}` }, 502);
  }
};
