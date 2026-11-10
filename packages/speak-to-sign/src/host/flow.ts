import {
  isSpeakableAccount,
  messageActionRefusal,
  messageVerifyRequest,
  noteActionRefusal,
  noteVerifyRequest,
  parseSpeakableNear,
  renderMessage,
  renderNoteAction,
  renderTransfer,
  type SpeakToSignHostOperations,
  type SpeakToSignHostPlugin,
  type SpeakToSignMessageResult,
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
  signedView,
  stepUpView,
  verifyingView,
  type CardInput,
} from './card';
import { recordClip, withPrompt } from './prompt';
import {
  mapMessage,
  mapPayment,
  shortDetail,
  stageTimes,
  verifierUnavailable,
  type FailedResult,
  type MessageFailedResult,
  type SpokenResult,
} from './result';
import { verifyInput } from './verifier';

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
export type HostTransfer = NonNullable<TransferInput['transfer']>;
type NoteInput = Parameters<SpeakToSignHostPlugin['requestNoteAction']>[0];
type MessageInput = Parameters<SpeakToSignHostPlugin['requestMessage']>[0];
type StageTimes = ReturnType<typeof stageTimes>;
type Cancelled = Readonly<{ kind: 'cancelled' }>;

/** What core's outcome means for the request: its success, a cancel or a failure. */
type Settled<Done, Failed> = Readonly<{ kind: 'done'; done: Done }> | Cancelled | Failed;

/**
 * One spoken request on the VoiceID card: the sentence to say, the request that the verifier
 * checks, the card copy, and the core operation that checks the verdict and signs. `Done` is
 * the success of the request and `Failed` its failures.
 */
type SpokenRequest<Done, Failed extends FailedResult> = Readonly<{
  operations: SpeakToSignHostOperations;
  ownerAccountId: string;
  surfaceMeasurementBinding: HostTransfer['surfaceMeasurementBinding'];
  sentence: string;
  verifyRequest: Readonly<Record<string, unknown>>;
  card: CardInput;
  /** Checks the verdict and signs, then names core's outcome as the result of the request. */
  sign(
    output: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
    times: () => StageTimes,
  ): Promise<Settled<Done, Failed>>;
  /** Shows the success on the card and waits for "Done" there. */
  showDone(done: Done, onCard: PaymentHooks): Promise<unknown>;
}>;

type SentResult = Extract<SpokenResult, { kind: 'sent' }>;
type SignedMessage = Extract<SpeakToSignMessageResult, { kind: 'signed' }>;

/** A signed transaction: the result of a payment, and the paid card with its link. */
function settlePayment(
  payment: SpeakToSignPayment,
  times: StageTimes,
): Settled<SentResult, FailedResult> {
  const result = mapPayment(payment, times);
  return result.kind === 'sent' ? { kind: 'done', done: result } : result;
}

function showPaid(done: SentResult, onCard: PaymentHooks): Promise<unknown> {
  return onCard.paid(done.transactionHash);
}

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
      sign: async (output, signal, hooks, times) =>
        settlePayment(
          await transfer.operations.payWithVerdict(
            { receiver: transfer.receiver, amountYocto },
            output,
            signal,
            hooks,
          ),
          times(),
        ),
      showDone: showPaid,
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
      sign: async (output, signal, hooks, times) =>
        settlePayment(
          await note.operations.signNoteWithVerdict(action, output, signal, hooks),
          times(),
        ),
      showDone: showPaid,
    },
    signal,
  );
}

/**
 * One spoken NEP-413 message: the owner says the summary, and core signs the message with the
 * key of the account on an accepted verdict. Nothing goes to the chain.
 */
export async function runSpokenMessage(
  input: Pick<MessageInput, 'network' | 'signal' | 'message'>,
): Promise<SpeakToSignMessageResult> {
  const { message, signal } = input;
  const { action } = message;
  const refusal = messageActionRefusal(action);
  if (refusal) return { kind: 'refused', reason: refusal };
  const rendered = renderMessage(action);
  return await runSpoken<SignedMessage, MessageFailedResult>(
    {
      operations: message.operations,
      ownerAccountId: message.ownerAccountId,
      surfaceMeasurementBinding: message.surfaceMeasurementBinding,
      sentence: rendered.displayText,
      verifyRequest: messageVerifyRequest(action),
      card: {
        network: input.network,
        noun: 'message',
        doneHeadline: 'Message signed',
        doneCaption: `For ${action.recipient}`,
        spokenText: rendered.spokenText,
      },
      sign: async (output, signal, hooks, times) => {
        const result = mapMessage(
          await message.operations.signMessageWithVerdict(action, output, signal, hooks),
          times(),
        );
        return result.kind === 'signed' ? { kind: 'done', done: result } : result;
      },
      showDone: (_, onCard) => onCard.signed(),
    },
    signal,
  );
}

/** Each "Try again" is a new verify call, so one request has at most this many recordings. */
const MAX_RECORDINGS = 5;

async function runSpoken<Done, Failed extends FailedResult>(
  request: SpokenRequest<Done, Failed>,
  signal: AbortSignal,
) {
  const { sentence, surfaceMeasurementBinding } = request;
  return await withPrompt(
    request.operations,
    { sentence, signal, surfaceMeasurementBinding },
    async (prompt) => {
      const run: Run<Done, Failed> = { request, signal, prompt };
      for (let recording = 1; ; recording += 1) {
        const attempt = await signOnce(run, recording < MAX_RECORDINGS);
        if (attempt.kind === 'final') return attempt.result;
      }
    },
  );
}

type Run<Done, Failed extends FailedResult> = Readonly<{
  request: SpokenRequest<Done, Failed>;
  signal: AbortSignal;
  prompt: SpeakToSignPrompt;
}>;

type Attempt<Result> = Readonly<{ kind: 'final'; result: Result }> | Readonly<{ kind: 'again' }>;

/**
 * One recording, one verdict and at most one signature, then the result on the card.
 * `canRetry` is false for the last recording, whose refusal offers only "Close".
 */
async function signOnce<Done, Failed extends FailedResult>(
  run: Run<Done, Failed>,
  canRetry: boolean,
): Promise<
  Attempt<Done | Cancelled | Failed | Exclude<Awaited<ReturnType<typeof recordClip>>, { kind: 'captured' }> | ReturnType<typeof verifierUnavailable>>
> {
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
  const times = () =>
    stageTimes({
      speechMs: clip.speechMs,
      endOfSpeechAt: clip.endOfSpeechAt,
      verifyStartedAt,
      verifiedAt,
      receiptAt: performance.now(),
    });
  const settled = await request.sign(reply.output, signal, onCard.hooks, times);
  if (settled.kind === 'cancelled') return { kind: 'final', result: settled };
  if (settled.kind === 'done') {
    await request.showDone(settled.done, onCard);
    return { kind: 'final', result: settled.done };
  }
  return await showFailure(run, settled, canRetry);
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
  /** Shows the card of a signed message and waits for "Done" there. */
  signed(): Promise<unknown>;
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
  const seconds = () => {
    const from = approval.kind === 'passkey' ? approval.approvedAt : endOfSpeechAt;
    return (performance.now() - from) / 1_000;
  };
  const showPaid = (transactionHash: string) =>
    prompt.show(paidView(card, transactionHash, seconds()));
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
    signed: () => prompt.show(signedView(card, seconds())),
  };
}

async function showFailure<Done, Failed extends FailedResult, Result extends FailedResult>(
  run: Run<Done, Failed>,
  result: Result,
  canRetry: boolean,
): Promise<Attempt<Result>> {
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
