// The testnet funds of an account: its NEAR for gas, its USDC for bets, and the faucet. The setup
// card on the page and the notes app read the same state, so the faucet runs once per account.
//
// After sign-in the page asks the faucet by itself when the account has less than it needs, and
// waits until the funds land. There is no "Get" step for the visitor.

import { useEffect, useSyncExternalStore } from 'react';
import { config } from '../config';
import { NOTE_GAS_NEED_YOCTO, readFreeBalance, readTokenBalance, USDC_NEED } from '../notes/nearAccount';
import { requestFaucet } from './client';

export type FaucetState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; hash: string; near: bigint; usdc: bigint }
  /** The account got the faucet before, on another visit. */
  | { kind: 'claimed' }
  | { kind: 'failed'; text: string };

export interface Balance {
  /** Null when the account is not on testnet (yet). */
  free: bigint | null;
  usdc: bigint;
}

export interface Funds {
  /** Null until the first read. */
  balance: Balance | null;
  loading: boolean;
  error: string | null;
  faucet: FaucetState;
}

/** What the funds are for: `gas` for a note or a rating, `bet` for a bet in USDC. */
export type FundsNeed = 'gas' | 'bet';

const EMPTY: Funds = { balance: null, loading: false, error: null, faucet: { kind: 'idle' } };
const ARRIVAL_POLL_MS = 1200;
const ARRIVAL_POLLS = 12;

const store = new Map<string, Funds>();
const listeners = new Set<() => void>();
const running = new Map<string, Promise<boolean>>();

function get(account: string): Funds {
  return store.get(account) ?? EMPTY;
}

function update(account: string, patch: Partial<Funds>) {
  store.set(account, { ...get(account), ...patch });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when `balance` covers `need`. Both needs include NEAR for gas. */
export function covers(balance: Balance | null, need: FundsNeed): boolean {
  if (!balance || balance.free === null || balance.free < NOTE_GAS_NEED_YOCTO) return false;
  return need === 'gas' || balance.usdc >= USDC_NEED;
}

/** The funds of `account` as last read, with no new read. */
export function peekFunds(account: string): Funds {
  return get(account);
}

/** Reads the balances of `account` again. */
export async function readFunds(account: string): Promise<Balance | null> {
  update(account, { loading: true });
  try {
    const [free, usdc] = await Promise.all([
      readFreeBalance(config.rpcUrl, account),
      readTokenBalance(config.marketRpcUrl, config.marketToken, account),
    ]);
    update(account, { balance: { free, usdc }, loading: false, error: null });
    return { free, usdc };
  } catch (cause) {
    update(account, { loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/**
 * Makes sure that `account` has the funds for `need`. If it has less, the faucet sends 0.2 NEAR
 * and 2 USDC (once per account), and this waits until they land. True when the account has them.
 * Calls at the same time share one run.
 */
export function ensureFunds(account: string, need: FundsNeed = 'bet'): Promise<boolean> {
  const current = running.get(account);
  if (current) return current.then(() => covers(get(account).balance, need));
  const run = fill(account).finally(() => running.delete(account));
  running.set(account, run);
  return run.then(() => covers(get(account).balance, need));
}

async function fill(account: string): Promise<boolean> {
  let balance = await readFunds(account);
  // A new wallet can take a few seconds to show on testnet.
  for (let poll = 0; balance && balance.free === null && poll < ARRIVAL_POLLS; poll += 1) {
    await sleep(ARRIVAL_POLL_MS);
    balance = await readFunds(account);
  }
  if (!balance || covers(balance, 'bet')) return covers(balance, 'bet');

  const faucet = get(account).faucet;
  // No second try by itself: a failure waits for the visitor's "Try again".
  if (faucet.kind === 'claimed' || faucet.kind === 'failed') return false;
  if (faucet.kind !== 'sent') {
    update(account, { faucet: { kind: 'sending' } });
    const result = await requestFaucet(account);
    if (!result.ok) {
      update(account, { faucet: result.claimed ? { kind: 'claimed' } : { kind: 'failed', text: result.error } });
      return false;
    }
    update(account, { faucet: { kind: 'sent', hash: result.transactionHash, near: result.near, usdc: result.usdc } });
  }
  // The USDC lands with the faucet's transaction, the NEAR a block or two later.
  for (let poll = 0; poll < ARRIVAL_POLLS; poll += 1) {
    await sleep(ARRIVAL_POLL_MS);
    if (covers(await readFunds(account), 'bet')) return true;
  }
  return false;
}

/** The visitor's "Try again" after a faucet failure. */
export function retryFaucet(account: string): Promise<boolean> {
  update(account, { faucet: { kind: 'idle' } });
  return ensureFunds(account);
}

/** The words for an account that still has less than `need` after the faucet. */
export function fundsProblem(account: string, need: FundsNeed): string {
  const { faucet, error, balance } = get(account);
  if (faucet.kind === 'failed') return faucet.text;
  if (faucet.kind === 'claimed') {
    // Say which part is short: the NEAR for gas, or (for a bet) the USDC.
    return covers(balance, 'gas') && need === 'bet'
      ? 'This account got the testnet faucet before and has less than 1 USDC now.'
      : 'This account got the testnet faucet before and has less than 0.01 NEAR for gas now.';
  }
  return error ?? 'The testnet funds did not arrive in time. Try again in a moment.';
}

/**
 * The funds of `account`, kept current. With `auto`, a signed-in account that has less than a
 * bet needs gets the faucet at once.
 */
export function useFunds(account: string | undefined, auto: boolean): Funds {
  const funds = useSyncExternalStore(subscribe, () => (account ? get(account) : EMPTY));
  useEffect(() => {
    if (account && auto) void ensureFunds(account);
  }, [account, auto]);
  return funds;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
