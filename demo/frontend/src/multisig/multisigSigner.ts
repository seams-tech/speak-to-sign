// The signer's calls to the voice multisig contract, signed by the Seams Wallet as normal
// function calls with its confirm step (passkey): `propose` and `approve` carry the verifier's
// signed verdict, and the contract checks it; `execute` carries the opening. None attaches NEAR.

import { functionCall } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import { isCancelError, isUserRejection } from '../signer/rejection';
import { contractReason, walletErrorText } from '../signer/seamsSigner';

type Seams = ReturnType<typeof useSeams>['seams'];

/** `refused`: the transaction ran and failed; its hash is the record of the failure. */
export type SendResult =
  | { kind: 'sent'; transactionHash: string }
  | { kind: 'refused'; reason: string; transactionHash: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string };

/** 30 Tgas. The sandbox measured 2.5 Tgas for `propose` and `approve`, 5.0 Tgas for `execute`. */
const GAS = (30n * 1_000_000_000_000n).toString();

export interface MultisigSigner {
  propose(input: { proposalId: number; commitmentHex: string; verdictJson: string; signatureB64: string }): Promise<SendResult>;
  approve(input: { proposalId: number; verdictJson: string; signatureB64: string }): Promise<SendResult>;
  execute(input: { proposalId: number; receiver: string; amountYocto: string; saltHex: string }): Promise<SendResult>;
}

export function createMultisigSigner(owner: { seams: Seams | null; walletId: string | null; contract: string }): MultisigSigner {
  const { seams, walletId, contract } = owner;

  const send = async (method: string, args: Record<string, unknown>): Promise<SendResult> => {
    if (!seams) return { kind: 'unavailable', reason: 'This build has no Seams publishable key, so it cannot reach the Wallet.' };
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    try {
      const result = await seams.near.signAndSendTransaction({
        walletSession: walletId,
        receiverId: contract,
        actions: [functionCall({ method, args, gas: GAS, deposit: '0' })],
      });
      if (result.success) return { kind: 'sent', transactionHash: result.transactionId };
      switch (result.kind) {
        case 'reverted':
          return { kind: 'refused', reason: contractReason(result.error), transactionHash: result.transactionId };
        case 'not_submitted':
          // The owner closed or rejected the confirm step: a cancel, not an error.
          if (isUserRejection(result.error)) return { kind: 'cancelled' };
          return { kind: 'unavailable', reason: `Nothing was sent. ${result.error}` };
        case 'submission_unknown':
          return { kind: 'unavailable', reason: `The transaction may have gone out. Check the explorer before you try again. ${result.error}` };
        case 'unresolved':
          return { kind: 'unavailable', reason: `The transaction has no final result yet. ${result.error}` };
      }
    } catch (cause) {
      return isCancelError(cause) ? { kind: 'cancelled' } : { kind: 'unavailable', reason: walletErrorText(cause) };
    }
    return { kind: 'unavailable', reason: 'The Wallet gave no result.' };
  };

  return {
    propose: ({ proposalId, commitmentHex, verdictJson, signatureB64 }) =>
      send('propose', { proposal_id: proposalId, commitment_hex: commitmentHex, verdict_json: verdictJson, signature_b64: signatureB64 }),
    approve: ({ proposalId, verdictJson, signatureB64 }) =>
      send('approve', { proposal_id: proposalId, verdict_json: verdictJson, signature_b64: signatureB64 }),
    execute: ({ proposalId, receiver, amountYocto, saltHex }) =>
      send('execute', { proposal_id: proposalId, receiver, amount_yocto: amountYocto, salt_hex: saltHex }),
  };
}
