// The multisigs of a wallet, so that a signer finds a multisig without its link. The factory
// keeps no list. So the page reads the newest transactions of the factory from FastNEAR's
// transactions API (src/txApi.ts), and the factory's `created` event in each one: the event names
// the multisig and its signers.
//
// The list is a help only. If the API fails, the page shows no list, and the link of a multisig
// still opens it.

import { isStringList } from '../guards.ts';
import { contractEventsOf, newestTransactions } from '../txApi.ts';
import { isFactoryMultisig } from './factory.ts';

/** The newest transactions of the factory to read: the most that one call of the API takes. */
const MAX_TRANSACTIONS = 20;

/** A multisig of the factory that names the wallet as a signer. */
export interface OwnMultisig {
  contract: string;
  signers: string[];
  threshold: number;
  /** When the factory created it, in ms, if the answer says. */
  createdAtMs: number | null;
}

/**
 * The multisigs whose `created` event names `account` as a signer, from an answer of
 * `POST /v0/transactions`, in the order of its transactions. Only an event of the factory counts,
 * and only for an account `m<N>.<factory>`.
 */
export function ownMultisigsOf(body: unknown, factory: string, account: string): OwnMultisig[] {
  const found: OwnMultisig[] = [];
  for (const { atMs, event, data } of contractEventsOf(body, factory, 'voice_multisig_factory')) {
    if (event !== 'created') continue;
    for (const { account: contract, signers, threshold } of data) {
      if (typeof contract !== 'string' || !isFactoryMultisig(contract, factory)) continue;
      if (!isStringList(signers) || !signers.includes(account)) continue;
      if (typeof threshold !== 'number' || found.some((multisig) => multisig.contract === contract)) continue;
      found.push({ contract, signers: [...signers], threshold, createdAtMs: atMs });
    }
  }
  return found;
}

/** Reads the newest multisigs of `account`, newest first. Rejects when the API fails. */
export async function findOwnMultisigs(apiUrl: string, factory: string, account: string, signal?: AbortSignal): Promise<OwnMultisig[]> {
  const body = await newestTransactions(apiUrl, factory, { is_function_call: true, is_real_receiver: true }, MAX_TRANSACTIONS, signal);
  return ownMultisigsOf(body, factory, account);
}
