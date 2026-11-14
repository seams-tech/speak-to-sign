// The words of the multisig board that depend on its state: the name of a multisig, the name of
// a signer, the next step of the person, and how long ago something happened. No network.

import { shortAccount } from '../guards.ts';
import type { Proposal } from './contractViews.ts';

/** The short name of a multisig: "Demo multisig", or the first part of its account ("m2"). */
export function multisigName(contract: string, demoContract: string): string {
  return contract === demoContract ? 'Demo multisig' : (contract.split('.')[0] ?? contract);
}

/** "You" for the signed-in wallet, and the short account for each other signer. */
export function signerName(signer: string, account: string | undefined): string {
  return signer === account ? 'You' : shortAccount(signer);
}

export interface NextStep {
  text: string;
  /** The person must sign in first. */
  signIn: boolean;
}

/**
 * What the person does next on this multisig. `proposals` are newest first, as the contract
 * gives them. The newest open proposal decides.
 */
export function nextStep(input: {
  account: string | undefined;
  signers: readonly string[];
  threshold: number;
  proposals: readonly Proposal[];
  /** The demo multisig: a visitor is not one of its signers. */
  demo: boolean;
}): NextStep {
  const { account, signers, threshold, proposals, demo } = input;
  const others = signers.length === 2 ? 'the other signer' : 'the other signers';
  if (!account) {
    return {
      text: demo
        ? `This multisig is for its ${signers.length} signers. Sign in to create a multisig of your own.`
        : 'Sign in with the wallet of a signer to propose or approve.',
      signIn: true,
    };
  }
  if (!signers.includes(account)) {
    return {
      text: demo
        ? `This multisig is for its ${signers.length} signers. To try it, create a multisig of your own.`
        : 'Your wallet is not a signer of this multisig.',
      signIn: false,
    };
  }
  const open = proposals.find((proposal) => proposal.status === 'open');
  if (!open) {
    // A new multisig of the factory: the other signer does not have its link yet.
    const first = proposals.length === 0 && !demo ? `Send the link to ${others}. Then propose a transfer, and tell them the sentence.` : null;
    return { text: first ?? `Propose a transfer. Then tell ${others} the sentence.`, signIn: false };
  }
  if (open.approvals.length >= threshold) {
    return {
      text:
        open.proposer === account
          ? `Proposal ${open.id} has all of its approvals. Execute it.`
          : `Proposal ${open.id} has all of its approvals. The proposer executes it.`,
      signIn: false,
    };
  }
  if (!open.approvals.includes(account)) {
    return { text: `Proposal ${open.id} waits for your approval. Say the proposal that the proposer told you.`, signIn: false };
  }
  return { text: `Proposal ${open.id} waits for ${others}. Tell them the sentence.`, signIn: false };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "8 minutes ago", "3 hours ago", "2 days ago", or the date after a week. */
export function timeAgo(atMs: number, nowMs: number): string {
  const age = Math.max(0, nowMs - atMs);
  const count = (unit: number, name: string) => {
    const n = Math.floor(age / unit);
    return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  };
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return count(MINUTE_MS, 'minute');
  if (age < DAY_MS) return count(HOUR_MS, 'hour');
  if (age < 7 * DAY_MS) return count(DAY_MS, 'day');
  return new Date(atMs).toLocaleDateString('en-US', { dateStyle: 'medium' });
}
