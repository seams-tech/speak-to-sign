import {
  isSpeakableAccount,
  noteActionRefusal,
  noteVerifyRequest,
  parseSpeakableNear,
  renderNoteAction,
  renderTransfer,
  type SpeakToSignHostOperations,
  type SpeakToSignHostPlugin,
  type SpeakToSignNoteResult,
  type SpeakToSignPayment,
  type SpeakToSignPaymentHooks,
  type SpeakToSignPrompt,
  type SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';
import {
  failureView,
  paidView,
  sendingView,
  stepUpView,
  verifyingView,
  type CardInput,
} from './card';
import { recordClip, withPrompt } from './prompt';
import {
  mapPayment,
  shortDetail,
  stageTimes,
  verifierUnavailable,
  type FailedResult,
  type SpokenResult,
} from './result';
import { verifyInput } from './verifier';

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
export type HostTransfer = NonNullable<TransferInput['transfer']>;
type NoteInput = Parameters<SpeakToSignHostPlugin['requestNoteAction']>[0];

/**
 * One spoken request on the VoiceID card: the sentence to say, the request that the verifier
 * checks, the card copy, and the core operation that checks the verdict and signs.
 */
type SpokenRequest = Readonly<{
  operations: SpeakToSignHostOperations;
  ownerAccountId: string;
  surfaceMeasurementBinding: HostTransfer['surfaceMeasurementBinding'];
  sentence: string;
  verifyRequest: Readonly<Record<string, unknown>>;
  card: CardInput;
  sign(
    output: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
  ): Promise<SpeakToSignPayment>;
}>;

/**
 * One spoken payment: record the sentence on the VoiceID surface, verify it on the Seams server,
 * then hand the verifier output to Wallet core. Core checks the signed verdict against this
 * transfer and sends it from the owner's account: with no confirm on `accept`, and with a fresh
 * approval on `step_up`. The surface stays open: it shows the check and the result, and "Try
 * again" records the sentence again, up to five recordings in all.
 */
export async function runSpokenTransfer(
  input: Pick<TransferInput, 'network' | 'signal'> & { readonly transfer: HostTransfer },
): Promise<SpeakToSignTransferResult> {
  const { transfer, signal } = input;
  const amountYocto = parseSpeakableNear(transfer.amount);
  if (amountYocto === null) return { kind: 'refused', reason: 'amount_not_speakable' };
  if (!isSpeakableAccount(transfer.receiver)) {
    return { kind: 'refused', reason: 'receiver_not_speakable' };
  }
  const receiver = await receiverExists(transfer, signal);
  if (receiver.kind !== 'exists') return receiver.result;

  const rendered = renderTransfer({ receiver: transfer.receiver, amountYocto });
  return await runSpoken(
    {
      operations: transfer.operations,
      ownerAccountId: transfer.ownerAccountId,
      surfaceMeasurementBinding: transfer.surfaceMeasurementBinding,
      sentence: rendered.displayText,
      verifyRequest: {
        kind: 'transfer',
        receiver: transfer.receiver,
        amount_yocto: String(amountYocto),
      },
      card: {
        network: input.network,
        noun: 'payment',
        doneHeadline: `Sent ${transfer.amount} NEAR`,
        doneCaption: `To ${transfer.receiver}`,
        spokenText: rendered.spokenText,
      },
      sign: (output, signal, hooks) =>
        transfer.operations.payWithVerdict(
          { receiver: transfer.receiver, amountYocto },
          output,
          signal,
          hooks,
        ),
    },
    signal,
  );
}

/**
 * One spoken community note, note rating, merge approval, market bet or general transaction, as
 * a payment: the owner says the summary or the sentence of the request, and core signs its
 * transaction on an approved verdict. A bet is the token's `ft_transfer_call` to the market,
 * with the verdict. A general transaction is the application's own transaction.
 */
export async function runSpokenNote(
  input: Pick<NoteInput, 'network' | 'signal' | 'note'>,
): Promise<SpeakToSignNoteResult> {
  const { note, signal } = input;
  const { action } = note;
  const refusal = noteActionRefusal(input.network, action);
  if (refusal) return { kind: 'refused', reason: refusal };
  const rendered = renderNoteAction(action);
  const verifyRequest = await noteVerifyRequest(action);
  signal.throwIfAborted();
  return await runSpoken(
    {
      operations: note.operations,
      ownerAccountId: note.ownerAccountId,
      surfaceMeasurementBinding: note.surfaceMeasurementBinding,
      sentence: rendered.displayText,
      verifyRequest,
      card: {
        network: input.network,
        ...noteCopy(action, rendered.displayText),
        spokenText: rendered.spokenText,
      },
      sign: (output, signal, hooks) =>
        note.operations.signNoteWithVerdict(action, output, signal, hooks),
    },
    signal,
  );
}

/** Each "Try again" is a new verify call, so one request has at most this many recordings. */
const MAX_RECORDINGS = 5;

async function runSpoken(request: SpokenRequest, signal: AbortSignal): Promise<SpokenResult> {
  const { sentence, surfaceMeasurementBinding } = request;
  return await withPrompt(
    request.operations,
    { sentence, signal, surfaceMeasurementBinding },
    async (prompt) => {
      const run: Run = { request, signal, prompt };
      for (let recording = 1; ; recording += 1) {
        const attempt = await signOnce(run, recording < MAX_RECORDINGS);
        if (attempt.kind === 'final') return attempt.result;
      }
    },
  );
}

type Run = Readonly<{
  request: SpokenRequest;
  signal: AbortSignal;
  prompt: SpeakToSignPrompt;
}>;

type Attempt =
  | Readonly<{ kind: 'final'; result: SpokenResult }>
  | Readonly<{ kind: 'again' }>;

/**
 * One recording, one verdict and at most one signed transaction, then the result on the card.
 * `canRetry` is false for the last recording, whose refusal offers only "Close".
 */
async function signOnce(run: Run, canRetry: boolean): Promise<Attempt> {
  const { request, prompt, signal } = run;
  const clip = await recordClip(prompt);
  if (clip.kind !== 'captured') return { kind: 'final', result: clip };
  void prompt.show(verifyingView());

  const verifyStartedAt = performance.now();
  const reply = await request.operations.verify(
    verifyInput(request.ownerAccountId, request.verifyRequest, clip.wav),
    signal,
  );
  const verifiedAt = performance.now();
  if (reply.kind === 'failed') {
    return await showFailure(run, verifierUnavailable(reply.code), canRetry);
  }

  const onCard = paymentHooks(prompt, request.card, clip.endOfSpeechAt);
  const payment = await request.sign(reply.output, signal, onCard.hooks);
  const times = stageTimes({
    speechMs: clip.speechMs,
    endOfSpeechAt: clip.endOfSpeechAt,
    verifyStartedAt,
    verifiedAt,
    receiptAt: performance.now(),
  });
  const result = mapPayment(payment, times);
  if (result.kind === 'cancelled') return { kind: 'final', result };
  if (result.kind === 'sent') {
    await onCard.paid(result.transactionHash);
    return { kind: 'final', result };
  }
  return await showFailure(run, result, canRetry);
}

/**
 * How the owner approved the payment. A step-up waits for the owner, so the time on the paid card
 * then starts at the passkey approval, not at the end of speech.
 */
type Approval = Readonly<{ kind: 'voice' }> | Readonly<{ kind: 'passkey'; approvedAt: number }>;

type PaymentHooks = Readonly<{
  hooks: SpeakToSignPaymentHooks;
  /** Shows the paid card, unless a block already showed it, and waits for "Done" there. */
  paid(transactionHash: string): Promise<unknown>;
}>;

/**
 * The hooks that make the card follow the payment in core. A plain transfer shows as sent when a
 * block holds it; the result still waits for the outcome.
 */
function paymentHooks(
  prompt: SpeakToSignPrompt,
  card: CardInput,
  endOfSpeechAt: number,
): PaymentHooks {
  let approval: Approval = { kind: 'voice' };
  let paidCard: Promise<unknown> | null = null;
  const showPaid = (transactionHash: string) => {
    const from = approval.kind === 'passkey' ? approval.approvedAt : endOfSpeechAt;
    return prompt.show(paidView(card, transactionHash, (performance.now() - from) / 1_000));
  };
  return {
    hooks: {
      accepted: () => void prompt.show(sendingView(card, 'voice')),
      approveStepUp: async (policyText) => {
        const choice = await prompt.show(stepUpView(card.noun, policyText, 'asking'));
        if (choice !== 'action') return false;
        approval = { kind: 'passkey', approvedAt: performance.now() };
        void prompt.show(stepUpView(card.noun, policyText, 'waiting'));
        return true;
      },
      broadcasting: () => {
        if (approval.kind === 'passkey') void prompt.show(sendingView(card, 'passkey'));
      },
      included: (transactionHash) => {
        paidCard = showPaid(transactionHash);
      },
    },
    paid: (transactionHash) => paidCard ?? showPaid(transactionHash),
  };
}

async function showFailure(run: Run, result: FailedResult, canRetry: boolean): Promise<Attempt> {
  const failure = failureView(run.request.card, result, canRetry);
  const choice = await run.prompt.show(failure.view);
  return choice === 'action' && failure.retry ? { kind: 'again' } : { kind: 'final', result };
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
    const detail = error instanceof Error ? shortDetail(error.message) : 'account view failed';
    return { kind: 'failed', result: verifierUnavailable(detail) };
  }
  return { kind: 'failed', result: { kind: 'refused', reason: 'receiver_missing' } };
}

/** The card copy of a spoken note, rating, merge approval, bet or general transaction. */
function noteCopy(
  action: NoteInput['note']['action'],
  displayText: string,
): Pick<CardInput, 'noun' | 'doneHeadline' | 'doneCaption'> {
  switch (action.kind) {
    case 'community_note':
      return { noun: 'note', doneHeadline: 'Note posted', doneCaption: `“${action.summary}”` };
    case 'note_rating':
      return { noun: 'rating', doneHeadline: 'Rating saved', doneCaption: displayText };
    case 'merge_approval':
      return { noun: 'approval', doneHeadline: 'Merge approved', doneCaption: displayText };
    case 'market_bet':
      return { noun: 'bet', doneHeadline: 'Bet placed', doneCaption: displayText };
    case 'transaction':
      return {
        noun: 'transaction',
        doneHeadline: 'Transaction sent',
        doneCaption: `To ${action.transaction.receiverId}`,
      };
  }
}
