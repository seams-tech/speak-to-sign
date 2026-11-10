// The visitor's call to the voice multisig contract: `propose`, signed by the Seams Wallet as a
// normal function call with its confirm step (passkey). The voice check is on chain: `propose`
// carries the verifier's signed verdict, and the contract checks it. It attaches no NEAR. The
// admins approve and execute through /api/multisig/approve.

import { functionCall } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import type { SignResult } from '../signer/notesSigner';

type Seams = ReturnType<typeof useSeams>['seams'];

const PROPOSE_GAS = (30n * 1_000_000_000_000n).toString();

export interface MultisigSigner {
  propose(input: { proposalId: number; commitmentHex: string; verdictJson: string; signatureB64: string }): Promise<SignResult>;
}

export function createMultisigSigner(owner: { seams: Seams | null; walletId: string | null; contract: string }): MultisigSigner {
  const { seams, walletId, contract } = owner;

  const send = async (method: string, args: Record<string, unknown>, gas: string): Promise<SignResult> => {
    if (!seams) return { kind: 'unavailable', reason: 'This build has no Seams publishable key, so it cannot reach the Wallet.' };
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    try {
      const result = await seams.near.signAndSendTransaction({
        walletSession: walletId,
        receiverId: contract,
        actions: [functionCall({ method, args, gas, deposit: '0' })],
      });
      if (result.success) return { kind: 'sent', transactionHash: result.transactionId };
      switch (result.kind) {
        case 'reverted':
          return { kind: 'refused', reason: contractReason(result.error) };
        case 'not_submitted':
          return { kind: 'unavailable', reason: `Nothing was sent. ${result.error}` };
        case 'submission_unknown':
          return { kind: 'unavailable', reason: `The transaction may have gone out. Check the explorer before you try again. ${result.error}` };
        case 'unresolved':
          return { kind: 'unavailable', reason: `The transaction has no final result yet. ${result.error}` };
      }
    } catch (cause) {
      return { kind: 'unavailable', reason: `The Wallet stopped with an error: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    return { kind: 'unavailable', reason: 'The Wallet gave no result.' };
  };

  return {
    propose: ({ proposalId, commitmentHex, verdictJson, signatureB64 }) =>
      send(
        'propose',
        { proposal_id: proposalId, commitment_hex: commitmentHex, verdict_json: verdictJson, signature_b64: signatureB64 },
        PROPOSE_GAS,
      ),
  };
}

/** The contract's own message out of NEAR's failure text ("Smart contract panicked: ..."). */
function contractReason(error: string): string {
  const match = /Smart contract panicked: ([^"\\]+)/.exec(error);
  return match ? `The contract refused: ${match[1]}.` : `The transaction failed: ${error}`;
}
