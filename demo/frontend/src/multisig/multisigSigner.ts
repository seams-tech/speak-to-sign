// The signer's calls to the voice multisig contract, signed by the Seams Wallet as normal
// function calls with its confirm step (passkey): `propose` and `approve` carry the verifier's
// signed verdict, and the contract checks it; `execute` carries the opening. None attaches NEAR.
//
// `createMultisig` is the one call to the factory (demo/contracts/voice-multisig-factory): it
// attaches the NEAR of the new multisig.

import { functionCall } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import { isObject } from '../guards';
import { isCancelError, isUserRejection } from '../signer/rejection';
import { contractReason, walletErrorText } from '../signer/seamsSigner';
import { CREATE_DEPOSIT_YOCTO, CREATE_GAS } from './factory';

type Seams = ReturnType<typeof useSeams>['seams'];

/**
 * `sent`: the transaction ran, and `value` is the JSON that the call returned (null for none).
 * `refused`: the transaction ran and failed; its hash is the record of the failure.
 */
export type SendResult =
  | { kind: 'sent'; transactionHash: string; value: unknown }
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

/** The Wallet of the person, or null parts when there is none. */
export interface WalletOwner {
  seams: Seams | null;
  walletId: string | null;
}

interface Call {
  receiverId: string;
  method: string;
  args: Record<string, unknown>;
  gas: string;
  /** yoctoNEAR. */
  deposit: string;
}

/** The JSON that a call returned, from the status of its transaction. Null for no value. */
function returnedValue(status: unknown): unknown {
  const encoded = isObject(status) && typeof status.SuccessValue === 'string' ? status.SuccessValue : '';
  if (encoded === '') return null;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))) as unknown;
  } catch {
    return null;
  }
}

/** One function call, signed and sent by the Wallet after its confirm step. */
async function send({ seams, walletId }: WalletOwner, call: Call): Promise<SendResult> {
  if (!seams) return { kind: 'unavailable', reason: 'This build has no Seams publishable key, so it cannot reach the Wallet.' };
  if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
  try {
    const result = await seams.near.signAndSendTransaction({
      walletSession: walletId,
      receiverId: call.receiverId,
      actions: [functionCall({ method: call.method, args: call.args, gas: call.gas, deposit: call.deposit })],
    });
    if (result.success) return { kind: 'sent', transactionHash: result.transactionId, value: returnedValue(result.result.status) };
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
}

export function createMultisigSigner(owner: WalletOwner & { contract: string }): MultisigSigner {
  const call = (method: string, args: Record<string, unknown>) =>
    send(owner, { receiverId: owner.contract, method, args, gas: GAS, deposit: '0' });
  return {
    propose: ({ proposalId, commitmentHex, verdictJson, signatureB64 }) =>
      call('propose', { proposal_id: proposalId, commitment_hex: commitmentHex, verdict_json: verdictJson, signature_b64: signatureB64 }),
    approve: ({ proposalId, verdictJson, signatureB64 }) =>
      call('approve', { proposal_id: proposalId, verdict_json: verdictJson, signature_b64: signatureB64 }),
    execute: ({ proposalId, receiver, amountYocto, saltHex }) =>
      call('execute', { proposal_id: proposalId, receiver, amount_yocto: amountYocto, salt_hex: saltHex }),
  };
}

/**
 * Asks the factory for a new multisig with these signers. The Wallet sends it 0.15 NEAR. The
 * `value` of a `sent` result is the account of the multisig, or null if the creation failed.
 */
export function createMultisig(owner: WalletOwner, factory: string, input: { signers: string[]; threshold: number }): Promise<SendResult> {
  return send(owner, { receiverId: factory, method: 'create', args: input, gas: CREATE_GAS, deposit: CREATE_DEPOSIT_YOCTO });
}
