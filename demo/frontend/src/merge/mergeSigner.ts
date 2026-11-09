// The spoken merge approval: the owner says "merge pull request … into main", the verifier
// checks the voice and the words, and the Wallet signs `approve_merge` on the merge approvals
// contract from the owner's own account.
//
// The SDK call `speakToSign.requestMergeApproval` comes with the new spoken request kind
// (see merge-approval-spec.md in the shared notes). Until the Wallet has it, this signer
// answers "unavailable" with the reason, so the page still loads.

import type { SpeakToSignNoteResult } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import { errorText, toSignResult } from '../signer/seamsSigner';
import type { SignResult } from '../signer/notesSigner';

type Seams = ReturnType<typeof useSeams>['seams'];

export interface MergeRequest {
  repo: string;
  pullRequest: number;
  base: string;
  /** 40 lowercase hex characters. */
  headCommit: string;
}

type RequestMergeApproval = (input: MergeRequest & { walletId: string; contract: string }) => Promise<SpeakToSignNoteResult>;

export async function requestMergeApproval(
  seams: Seams | null,
  walletId: string | null,
  contract: string,
  request: MergeRequest,
): Promise<SignResult> {
  if (!seams) return { kind: 'unavailable', reason: 'This build has no Seams publishable key, so it cannot reach the Wallet.' };
  if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
  const speakToSign = seams.speakToSign;
  if (!speakToSign) return { kind: 'unavailable', reason: 'Speak-to-Sign is not in the Wallet configuration.' };
  const call = (speakToSign as unknown as { requestMergeApproval?: RequestMergeApproval }).requestMergeApproval;
  if (typeof call !== 'function') {
    return {
      kind: 'unavailable',
      reason: 'This Seams Wallet version has no spoken merge approval yet. It comes with the next SDK release.',
    };
  }
  try {
    return toSignResult(await call.call(speakToSign, { walletId, contract, ...request }));
  } catch (cause) {
    return { kind: 'unavailable', reason: `The Wallet stopped with an error: ${errorText(cause)}` };
  }
}
