// The voice multisig factory (demo/contracts/voice-multisig-factory) on the page: a visitor
// creates a 2 of 2 multisig with one other signer, and the page address names it, so that the
// other signer can open it.
//
// The page shows only the demo multisig or a multisig that the factory made. A multisig of the
// factory is the account `m<N>.<factory>`, and only the factory can create its subaccounts. So a
// link cannot make the page work with another contract.

import { hasExactKeys, isAccountId, isObject } from '../guards.ts';

/** 0.15 NEAR, in yoctoNEAR: the storage of the new multisig, and the NEAR of a first transfer. */
export const CREATE_DEPOSIT_YOCTO = '150000000000000000000000';
/** 100 Tgas: the creation with `new`, and the factory's callback. The sandbox measured 14 Tgas. */
export const CREATE_GAS = '100000000000000';

export interface FactoryConfig {
  /** The code hash of the global voice-multisig code, base58. */
  code_hash: string;
  verifier_public_key: string;
  /** The names that the factory gave. */
  names: number;
}

/** `get_config` of the factory: exactly `{ code_hash, verifier_public_key, names }`, or null. */
export function readFactoryConfig(value: unknown): FactoryConfig | null {
  if (!isObject(value) || !hasExactKeys(value, ['code_hash', 'verifier_public_key', 'names'])) return null;
  const { code_hash, verifier_public_key, names } = value;
  if (typeof code_hash !== 'string' || typeof verifier_public_key !== 'string') return null;
  if (typeof names !== 'number' || !Number.isSafeInteger(names) || names < 0) return null;
  return { code_hash, verifier_public_key, names };
}

/** An account that the factory made: `m<N>.<factory>`. */
export function isFactoryMultisig(account: string, factory: string): boolean {
  const suffix = `.${factory}`;
  return factory !== '' && account.endsWith(suffix) && /^m[1-9]\d*$/.test(account.slice(0, -suffix.length));
}

/**
 * The multisig of a page address. `?m=<account>` names a multisig of the factory. With no name
 * the page shows the demo multisig. With another account it also shows the demo multisig, and
 * `refused` is true.
 */
export function multisigOfSearch(search: string, demoContract: string, factory: string): { contract: string; refused: boolean } {
  const named = new URLSearchParams(search).get('m');
  if (named === null || named === demoContract) return { contract: demoContract, refused: false };
  return isFactoryMultisig(named, factory) ? { contract: named, refused: false } : { contract: demoContract, refused: true };
}

/** The query of the page address that shows `contract`: empty for the demo multisig. */
export function searchOfMultisig(contract: string, demoContract: string): string {
  return contract === demoContract ? '' : `?m=${encodeURIComponent(contract)}`;
}

/** Why `other` cannot be the second signer of `own`'s multisig, or null if it can. */
export function otherSignerError(other: string, own: string): string | null {
  if (!isAccountId(other)) return 'Write a NEAR account: the 64 characters of a wallet, or a named account.';
  if (other === own) return 'This is your own account. Name the account of the other signer.';
  return null;
}

/** The account in the answer of `create`: a multisig of the factory, or null (the creation failed). */
export function readCreated(value: unknown, factory: string): string | null {
  return typeof value === 'string' && isFactoryMultisig(value, factory) ? value : null;
}
