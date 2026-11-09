import {
  base64Encode,
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  type SpeakToSignHostPlugin,
  type SpeakToSignPayment,
  type SpeakToSignPrompt,
  type SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';
import {
  failureView,
  paidView,
  sendingView,
  stepUpView,
  verifyingView,
  type TransferCardInput,
} from './card';

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
export type HostTransfer = NonNullable<TransferInput['transfer']>;

/**
 * One spoken payment: record the sentence on the VoiceID surface, verify it on the Seams server,
 * then hand the verifier output to Wallet core. Core checks the signed verdict against this
 * transfer and sends it from the owner's account: with no confirm on `accept`, and with a fresh
 * approval on `step_up`. The surface stays open: it shows the check and the result, and "Try
 * again" records the sentence again.
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

  const sentence = renderTransfer({ receiver: transfer.receiver, amountYocto }).displayText;
  const opened = await transfer.operations.openPrompt({
    sentence,
    signal,
    surfaceMeasurementBinding: transfer.surfaceMeasurementBinding,
  });
  if (opened.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: opened.detail };
  }
  const payment: Payment = {
    transfer,
    amountYocto,
    signal,
    prompt: opened.prompt,
    card: {
      network: input.network,
      receiver: transfer.receiver,
      amount: transfer.amount,
      sentence,
    },
  };
  try {
    for (;;) {
      const attempt = await payOnce(payment);
      if (attempt.kind === 'final') return attempt.result;
    }
  } finally {
    opened.prompt.close();
  }
}

type Payment = Readonly<{
  transfer: HostTransfer;
  amountYocto: bigint;
  signal: AbortSignal;
  prompt: SpeakToSignPrompt;
  card: TransferCardInput;
}>;

type Attempt =
  | Readonly<{ kind: 'final'; result: SpeakToSignTransferResult }>
  | Readonly<{ kind: 'again' }>;

/** One recording, one verdict and at most one payment, then the result on the card. */
async function payOnce(payment: Payment): Promise<Attempt> {
  const { transfer, prompt, signal } = payment;
  const clip = await prompt.record();
  if (clip.kind === 'cancelled') return { kind: 'final', result: clip };
  if (clip.kind === 'unavailable') {
    return {
      kind: 'final',
      result: { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail },
    };
  }
  void prompt.show(verifyingView());

  const verifyStartedAt = performance.now();
  const reply = await transfer.operations.verify(
    {
      op: 'verify',
      owner: transfer.ownerAccountId,
      request: {
        kind: 'transfer',
        receiver: transfer.receiver,
        amount_yocto: String(payment.amountYocto),
      },
      contacts: [],
      audio_wav_b64: base64Encode(clip.wav),
    },
    signal,
  );
  const verifiedAt = performance.now();
  if (reply.kind === 'failed') {
    return await showFailure(payment, {
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: reply.code,
    });
  }

  // A step-up waits for the owner, so the paid time then starts at the approval.
  let paidFrom = clip.endOfSpeechAt;
  let approved = false;
  const result = mapPayment(
    await transfer.operations.payWithVerdict(
      { receiver: transfer.receiver, amountYocto: payment.amountYocto },
      reply.output,
      signal,
      {
        accepted: () => void prompt.show(sendingView(payment.card, 'voice')),
        approveStepUp: async (policyText) => {
          const choice = await prompt.show(stepUpView(policyText, false));
          if (choice !== 'action') return false;
          approved = true;
          paidFrom = performance.now();
          void prompt.show(stepUpView(policyText, true));
          return true;
        },
        broadcasting: () => {
          if (approved) void prompt.show(sendingView(payment.card, 'passkey'));
        },
      },
    ),
    {
      speechMs: clip.speechMs,
      verifyMs: Math.round(verifiedAt - verifyStartedAt),
      verifiedAt,
      endOfSpeechAt: clip.endOfSpeechAt,
    },
  );
  if (result.kind === 'cancelled') return { kind: 'final', result };
  if (result.kind === 'sent') {
    const seconds = (performance.now() - paidFrom) / 1_000;
    await prompt.show(paidView(payment.card, result.transactionHash, seconds));
    return { kind: 'final', result };
  }
  return await showFailure(payment, result);
}

async function showFailure(
  payment: Payment,
  result: Exclude<SpeakToSignTransferResult, { kind: 'sent' } | { kind: 'cancelled' }>,
): Promise<Attempt> {
  const failure = failureView(payment.card, result);
  const choice = await payment.prompt.show(failure.view);
  return choice === 'action' && failure.retry ? { kind: 'again' } : { kind: 'final', result };
}

type StageTimes = Readonly<{
  speechMs: number;
  verifyMs: number;
  verifiedAt: number;
  endOfSpeechAt: number;
}>;

function mapPayment(payment: SpeakToSignPayment, times: StageTimes): SpeakToSignTransferResult {
  const receiptAt = performance.now();
  switch (payment.kind) {
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: payment.transactionHash,
        approval: payment.approval,
        times: {
          speechMs: times.speechMs,
          verifyMs: times.verifyMs,
          transactionMs: Math.round(receiptAt - times.verifiedAt),
          endOfSpeechToReceiptMs: Math.round(receiptAt - times.endOfSpeechAt),
        },
      };
    case 'reverted':
      return { kind: 'refused', reason: 'transaction_failed', detail: payment.error };
    case 'refused':
      return payment.detail === undefined
        ? { kind: 'refused', reason: payment.reason }
        : { kind: 'refused', reason: payment.reason, detail: payment.detail };
    case 'cancelled':
      return payment;
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
