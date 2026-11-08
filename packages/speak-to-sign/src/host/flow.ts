import type {
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';
import {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  sha256,
  type VaultTransferRequest,
} from './intent';
import { parseVaultState, transferArgs, verifyInput, type VaultState } from './request';
import { checkVerdict, parseVerifyOutput } from './verdict';

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
export type HostTransfer = NonNullable<TransferInput['transfer']>;

/**
 * One spoken payment: read the vault, record the sentence on the VoiceID surface, verify it
 * on the Seams server, check the signed verdict against the vault's pinned key, then send
 * `transfer_with_verdict`. Nothing reaches the vault unless the local check accepts the verdict.
 */
export async function runSpokenTransfer(
  input: Omit<TransferInput, 'transfer'> & { readonly transfer: HostTransfer },
): Promise<SpeakToSignTransferResult> {
  const { transfer, signal } = input;
  const amountYocto = parseSpeakableNear(transfer.amount);
  if (amountYocto === null) return { kind: 'refused', reason: 'amount_not_speakable' };
  if (!isSpeakableAccount(transfer.receiver)) {
    return { kind: 'refused', reason: 'receiver_not_contact' };
  }

  const vault = await readVault(transfer, signal);
  if (vault.kind !== 'ready') return vault.result;
  if (!vault.state.activeContacts.has(transfer.receiver)) {
    return { kind: 'refused', reason: 'receiver_not_contact' };
  }
  const request: VaultTransferRequest = {
    network: input.network,
    vault: input.vault,
    owner: transfer.ownerAccountId,
    receiver: transfer.receiver,
    amountYocto,
    nonce: vault.state.nonce,
  };

  const clip = await transfer.operations.captureClip({
    sentence: renderTransfer(request).displayText,
    signal,
    surfaceMeasurementBinding: transfer.surfaceMeasurementBinding,
  });
  if (clip.kind === 'cancelled') return clip;
  if (clip.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail };
  }

  const verifyStartedAt = performance.now();
  const reply = await transfer.operations.verify(
    verifyInput(request, vault.state.contacts, clip.wav),
    signal,
  );
  const verifiedAt = performance.now();
  if (reply.kind === 'failed') {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: reply.code };
  }
  const output = parseVerifyOutput(reply.output);
  if (!output) {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'invalid output' };
  }
  const check = await checkVerdict({
    output,
    request,
    audioDigest: await sha256(clip.wav),
    pinnedVerifierKey: vault.state.verifierPublicKey,
  });
  const checkedAt = performance.now();
  if (check.kind === 'refused') return check;
  if (check.kind === 'mismatch') {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: check.detail };
  }

  const submission = await transfer.operations.submitTransfer(
    transferArgs(request, check.verdictJson, check.signatureB64),
    signal,
  );
  const receiptAt = performance.now();
  switch (submission.kind) {
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: submission.transactionHash,
        times: {
          speechMs: clip.speechMs,
          verifyMs: Math.round(verifiedAt - verifyStartedAt),
          checkMs: Math.round(checkedAt - verifiedAt),
          transactionMs: Math.round(receiptAt - checkedAt),
          endOfSpeechToReceiptMs: Math.round(receiptAt - clip.endOfSpeechAt),
        },
      };
    case 'reverted':
      return { kind: 'refused', reason: 'vault_rejected', detail: submission.error };
    case 'not_submitted':
    case 'submission_unknown':
      return { kind: 'unavailable', reason: submission.kind, detail: submission.error };
    default:
      return submission satisfies never;
  }
}

type VaultRead =
  | Readonly<{ kind: 'ready'; state: VaultState }>
  | Readonly<{ kind: 'failed'; result: SpeakToSignTransferResult }>;

async function readVault(transfer: HostTransfer, signal: AbortSignal): Promise<VaultRead> {
  const { operations } = transfer;
  let views: [unknown, unknown, unknown];
  try {
    views = await Promise.all([
      operations.viewVault('get_vault', signal),
      operations.viewVault('get_contacts', signal),
      operations.viewVault('get_verifier', signal),
    ]);
  } catch (error) {
    signal.throwIfAborted();
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'vault view failed';
    return {
      kind: 'failed',
      result: { kind: 'unavailable', reason: 'verifier_unavailable', detail },
    };
  }
  if (views[0] === null) {
    return { kind: 'failed', result: { kind: 'unavailable', reason: 'vault_missing' } };
  }
  const state = parseVaultState({ vault: views[0], contacts: views[1], verifier: views[2] });
  if (!state || state.nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      kind: 'failed',
      result: {
        kind: 'unavailable',
        reason: 'verifier_unavailable',
        detail: 'invalid vault state',
      },
    };
  }
  return { kind: 'ready', state };
}
