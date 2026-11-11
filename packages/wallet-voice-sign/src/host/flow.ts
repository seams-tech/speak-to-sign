import type {
  SpeakToSignApprovalResult,
  SpeakToSignHostApproval,
  SpeakToSignPaymentHooks,
  SpeakToSignRequestView,
  SpeakToSignSurface,
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
import {
  mapSigning,
  showNow,
  stageTimes,
  verifierUnavailable,
  voiceIdUnavailable,
  type FailedResult,
} from './result';

/** Each "Try again" is a new verify call, so one request has at most this many recordings. */
const MAX_RECORDINGS = 5;

/**
 * One spoken request on the card that Wallet core opened with its sentence: record the
 * sentence, let core verify the recording, then hand the verifier output to core. Core checks
 * the signed verdict against the request of this flow and signs it: with no confirm on
 * `accept`, and with a fresh approval on `step_up`. The plugin draws the check and the result.
 * It passes no request, no sentence and no audio to core. "Try again" records the sentence
 * again, up to five recordings in all.
 */
export async function runApproval(
  input: SpeakToSignHostApproval,
): Promise<SpeakToSignApprovalResult> {
  const card = cardInput(input);
  for (let recording = 1; ; recording += 1) {
    const attempt = await signOnce(input, card, recording < MAX_RECORDINGS);
    if (attempt.kind === 'final') return attempt.result;
  }
}

type Attempt =
  | Readonly<{ kind: 'final'; result: SpeakToSignApprovalResult }>
  | Readonly<{ kind: 'again' }>;

/**
 * One recording, one verdict and at most one signature, then the result on the card.
 * `canRetry` is false for the last recording, whose refusal offers only "Close".
 */
async function signOnce(
  input: SpeakToSignHostApproval,
  card: CardInput,
  canRetry: boolean,
): Promise<Attempt> {
  const { operations, surface } = input;
  const clip = await operations.record();
  if (clip.kind === 'cancelled') return { kind: 'final', result: clip };
  if (clip.kind === 'unavailable') {
    return { kind: 'final', result: voiceIdUnavailable(clip.detail) };
  }
  showNow(surface, verifyingView());

  const verifyStartedAt = performance.now();
  const reply = await operations.verify(clip);
  const verifiedAt = performance.now();
  if (reply.kind === 'failed') {
    return await showFailure(surface, card, verifierUnavailable(reply.code), canRetry);
  }

  const onCard = paymentHooks(surface, card, clip.endOfSpeechAt);
  const signing = await operations.sign(reply.output, onCard.hooks);
  const result = mapSigning(
    signing,
    stageTimes({
      speechMs: clip.speechMs,
      endOfSpeechAt: clip.endOfSpeechAt,
      verifyStartedAt,
      verifiedAt,
      receiptAt: performance.now(),
    }),
  );
  switch (result.kind) {
    case 'cancelled':
      return { kind: 'final', result };
    case 'sent':
      await onCard.paid(result.transactionHash);
      return { kind: 'final', result };
    // A signature that core did not send has no transaction to show.
    case 'signed_transaction':
    case 'signed_delegate':
    case 'signed':
      await onCard.signed();
      return { kind: 'final', result };
    default:
      return await showFailure(surface, card, result, canRetry);
  }
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
  /** Shows the card of a signature that was not sent and waits for "Done" there. */
  signed(): Promise<unknown>;
}>;

/**
 * The hooks that make the card follow the payment in core. A plain transfer shows as sent when a
 * block holds it; the result still waits for the outcome.
 */
function paymentHooks(
  surface: SpeakToSignSurface,
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
    surface.show(paidView(card, transactionHash, seconds()));
  return {
    hooks: {
      accepted: () => showNow(surface, sendingView(card, 'voice')),
      approveStepUp: async (policyText) => {
        const choice = await surface.show(stepUpView(card.noun, policyText, 'asking'));
        if (choice !== 'action') return false;
        approval = { kind: 'passkey', approvedAt: performance.now() };
        showNow(surface, stepUpView(card.noun, policyText, 'waiting'));
        return true;
      },
      broadcasting: () => {
        if (approval.kind === 'passkey') showNow(surface, sendingView(card, 'passkey'));
      },
      included: (transactionHash) => {
        paidCard = showPaid(transactionHash);
      },
    },
    paid: (transactionHash) => paidCard ?? showPaid(transactionHash),
    signed: () => surface.show(signedView(card, seconds())),
  };
}

async function showFailure(
  surface: SpeakToSignSurface,
  card: CardInput,
  result: FailedResult,
  canRetry: boolean,
): Promise<Attempt> {
  const failure = failureView(card, result, canRetry);
  const choice = await surface.show(failure.view);
  return choice === 'action' && failure.retry ? { kind: 'again' } : { kind: 'final', result };
}

function cardInput(input: SpeakToSignHostApproval): CardInput {
  const { request } = input;
  return { network: input.network, ...cardCopy(request), spokenText: request.spokenText };
}

/** The card copy of each kind of request, from the texts that core gives. */
function cardCopy(
  request: SpeakToSignRequestView,
): Pick<CardInput, 'noun' | 'doneHeadline' | 'doneCaption'> {
  const { displayText } = request;
  switch (request.kind) {
    case 'account_transfer':
      return {
        noun: 'payment',
        doneHeadline: `Sent ${request.amount} NEAR`,
        doneCaption: `To ${request.counterparty}`,
      };
    case 'community_note':
      return { noun: 'note', doneHeadline: 'Note posted', doneCaption: `“${request.summary}”` };
    case 'note_rating':
      return { noun: 'rating', doneHeadline: 'Rating saved', doneCaption: displayText };
    case 'merge_approval':
      return { noun: 'approval', doneHeadline: 'Merge approved', doneCaption: displayText };
    case 'market_bet':
      return { noun: 'bet', doneHeadline: 'Bet placed', doneCaption: displayText };
    case 'signed_message':
      return {
        noun: 'message',
        doneHeadline: 'Message signed',
        doneCaption: `For ${request.counterparty}`,
      };
    case 'transaction':
      if (request.form === 'send') {
        return {
          noun: 'transaction',
          doneHeadline: 'Transaction sent',
          doneCaption: `To ${request.counterparty}`,
        };
      }
      return {
        noun: 'signature',
        doneHeadline: request.form === 'sign' ? 'Transaction signed' : 'Delegate action signed',
        doneCaption: `For ${request.counterparty}`,
      };
  }
}
