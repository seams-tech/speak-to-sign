import {
  base64Encode,
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  type SpeakToSignHostPlugin,
  type SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
export type HostTransfer = NonNullable<TransferInput['transfer']>;

/**
 * One spoken payment: record the sentence on the VoiceID surface, verify it on the Seams server,
 * then hand the verifier output to Wallet core. Core checks the signed verdict against this
 * transfer and sends it from the owner's account: with no confirm on `accept`, and with a fresh
 * approval on `step_up`.
 */
export async function runSpokenTransfer(
  input: Omit<TransferInput, 'transfer'> & { readonly transfer: HostTransfer },
): Promise<SpeakToSignTransferResult> {
  const { transfer, signal } = input;
  const amountYocto = parseSpeakableNear(transfer.amount);
  if (amountYocto === null) return { kind: 'refused', reason: 'amount_not_speakable' };
  if (!isSpeakableAccount(transfer.receiver)) {
    return { kind: 'refused', reason: 'receiver_not_speakable' };
  }
  const receiver = await receiverExists(transfer, signal);
  if (receiver.kind !== 'exists') return receiver.result;

  const clip = await transfer.operations.captureClip({
    sentence: renderTransfer({ receiver: transfer.receiver, amountYocto }).displayText,
    signal,
    surfaceMeasurementBinding: transfer.surfaceMeasurementBinding,
  });
  if (clip.kind === 'cancelled') return clip;
  if (clip.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail };
  }

  const verifyStartedAt = performance.now();
  const reply = await transfer.operations.verify(
    {
      op: 'verify',
      owner: transfer.ownerAccountId,
      request: { kind: 'transfer', receiver: transfer.receiver, amount_yocto: String(amountYocto) },
      contacts: [],
      audio_wav_b64: base64Encode(clip.wav),
    },
    signal,
  );
  const verifiedAt = performance.now();
  if (reply.kind === 'failed') {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: reply.code };
  }

  const payment = await transfer.operations.payWithVerdict(
    { receiver: transfer.receiver, amountYocto },
    reply.output,
    signal,
  );
  const receiptAt = performance.now();
  switch (payment.kind) {
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: payment.transactionHash,
        approval: payment.approval,
        times: {
          speechMs: clip.speechMs,
          verifyMs: Math.round(verifiedAt - verifyStartedAt),
          transactionMs: Math.round(receiptAt - verifiedAt),
          endOfSpeechToReceiptMs: Math.round(receiptAt - clip.endOfSpeechAt),
        },
      };
    case 'reverted':
      return { kind: 'refused', reason: 'transaction_failed', detail: payment.error };
    case 'refused':
      return payment.detail === undefined
        ? { kind: 'refused', reason: payment.reason }
        : { kind: 'refused', reason: payment.reason, detail: payment.detail };
    case 'unavailable':
      return { kind: 'unavailable', reason: 'verifier_unavailable', detail: payment.detail };
    case 'not_submitted':
    case 'submission_unknown':
      return { kind: 'unavailable', reason: payment.kind, detail: payment.error };
    default:
      return payment satisfies never;
  }
}

type ReceiverCheck =
  Readonly<{ kind: 'exists' }> | Readonly<{ kind: 'failed'; result: SpeakToSignTransferResult }>;

/** A transfer to a missing account would fail on chain, after the verifier ran. */
async function receiverExists(transfer: HostTransfer, signal: AbortSignal): Promise<ReceiverCheck> {
  try {
    if (await transfer.operations.receiverExists(transfer.receiver, signal)) {
      return { kind: 'exists' };
    }
  } catch (error) {
    signal.throwIfAborted();
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'account view failed';
    return {
      kind: 'failed',
      result: { kind: 'unavailable', reason: 'verifier_unavailable', detail },
    };
  }
  return { kind: 'failed', result: { kind: 'refused', reason: 'receiver_missing' } };
}
