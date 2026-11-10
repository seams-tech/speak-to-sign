// The page side of the approve route (functions/api/multisig/approve.ts). The page sends the
// opening of a proposal. The two admin signers approve it, and admin B executes it.

import { isObject } from '../guards.ts';
import { readProposal, type Proposal } from './contractViews.ts';
import type { Opening } from './openings';

export type ApproveAnswer =
  /** `executed`: the transfer arrived. False: the NEAR came back, and the proposal is open again. */
  | { kind: 'done'; proposal: Proposal | null; transactionHash: string; executed: boolean }
  /** HTTP 409: the proposal is executed already, for example by an earlier call. */
  | { kind: 'executed_before'; message: string }
  | { kind: 'failed'; message: string };

export async function requestApproval(proposalId: number, opening: Opening): Promise<ApproveAnswer> {
  let response: Response;
  try {
    response = await fetch('/api/multisig/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal_id: proposalId,
        receiver: opening.receiver,
        amount_yocto: opening.amount_yocto,
        salt_hex: opening.salt_hex,
      }),
    });
  } catch {
    return { kind: 'failed', message: 'The page could not reach /api/multisig/approve.' };
  }
  return readApproveAnswer(response.status, await response.json().catch(() => null));
}

/** The route's JSON answer, read with care: it comes over the network. */
export function readApproveAnswer(status: number, body: unknown): ApproveAnswer {
  const value = isObject(body) ? body : {};
  const error = typeof value.error === 'string' ? value.error : `The approve route answered ${status}.`;
  if (status === 409) return { kind: 'executed_before', message: error };
  if (status !== 200 || typeof value.executeTransactionHash !== 'string' || typeof value.executed !== 'boolean') {
    return { kind: 'failed', message: error };
  }
  const proposal = readProposal(value.proposal);
  return { kind: 'done', proposal, transactionHash: value.executeTransactionHash, executed: value.executed };
}
