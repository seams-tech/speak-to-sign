// The views of the voice multisig contract (demo/contracts/voice-multisig), read with checks.
// Each reader gives null for a value of another shape (for example the config of an older
// contract), so a wrong answer becomes an error message and not a crash. The page and the
// approve route (functions/api/multisig/approve.ts) use the same readers.

import { isDecimalText, isObject, isStringList } from '../guards.ts';

export interface MultisigConfig {
  /** The key signers. All of them approve a proposal before it can execute. */
  admins: string[];
  verifier_public_key: string;
  /** The most for one proposal, in yoctoNEAR. */
  max_amount_yocto: string;
}

export interface Proposal {
  id: number;
  commitment_hex: string;
  /** The account that proposed by voice. */
  proposer: string;
  /** The admins that approved, in the order that they approved. */
  approvals: string[];
  status: 'open' | 'executed';
  created_at_ms: number;
  /** Only after the transfer arrives. */
  receiver?: string;
  amount_yocto?: string;
}

/** The text that the page shows when a view does not have the expected shape. */
export const UNEXPECTED_VIEW = 'The multisig contract answered in an unexpected form.';

const HEX_32 = /^[0-9a-f]{64}$/;

function isProposalId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** `get_config`: `{ admins, verifier_public_key, max_amount_yocto }`, or null. */
export function readMultisigConfig(value: unknown): MultisigConfig | null {
  if (!isObject(value) || !isStringList(value.admins) || value.admins.length === 0) return null;
  const { verifier_public_key, max_amount_yocto } = value;
  if (typeof verifier_public_key !== 'string' || !isDecimalText(max_amount_yocto)) return null;
  return { admins: [...value.admins], verifier_public_key, max_amount_yocto };
}

/** One `ProposalView`, or null. */
export function readProposal(value: unknown): Proposal | null {
  if (!isObject(value)) return null;
  const { id, commitment_hex, proposer, approvals, status, created_at_ms, receiver, amount_yocto } = value;
  if (!isProposalId(id) || typeof commitment_hex !== 'string' || !HEX_32.test(commitment_hex)) return null;
  if (typeof proposer !== 'string' || !isStringList(approvals)) return null;
  if ((status !== 'open' && status !== 'executed') || typeof created_at_ms !== 'number' || !Number.isFinite(created_at_ms)) return null;
  if (receiver != null && typeof receiver !== 'string') return null;
  if (amount_yocto != null && !isDecimalText(amount_yocto)) return null;
  const proposal: Proposal = { id, commitment_hex, proposer, approvals: [...approvals], status, created_at_ms };
  if (typeof receiver === 'string') proposal.receiver = receiver;
  if (typeof amount_yocto === 'string') proposal.amount_yocto = amount_yocto;
  return proposal;
}

/** `get_proposals`: a list of `ProposalView`, or null if one item has another shape. */
export function readProposals(value: unknown): Proposal[] | null {
  if (!Array.isArray(value)) return null;
  const proposals: Proposal[] = [];
  for (const item of value) {
    const proposal = readProposal(item);
    if (!proposal) return null;
    proposals.push(proposal);
  }
  return proposals;
}

/** `next_proposal_id`: a whole number from 1, or null. */
export function readProposalId(value: unknown): number | null {
  return isProposalId(value) ? value : null;
}
