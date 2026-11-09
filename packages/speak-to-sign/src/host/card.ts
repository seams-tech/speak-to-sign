import type {
  PhraseCheckView,
  PhraseResultView,
  PhraseSegmentState,
  SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';

// The line under the sentence has one segment for each step of a spoken payment.
const SPEAKER = 1;
const WORDS = 2;
const POLICY = 3;
const VERDICT = 4;
const PAYMENT = 5;
const SEGMENTS = 6;

/** The verifier sends one answer at the end, so its wait names where each check runs. */
const VERIFIER_STEPS = [
  'ReDimNet · Intel TDX CVM on Phala',
  'Whisper large-v3 · NEAR AI Cloud',
  'JEV policy',
  'Signed by the OutLayer TEE verifier',
] as const;

export type TransferCardInput = Readonly<{
  network: 'testnet' | 'mainnet';
  receiver: string;
  /** Decimal NEAR as the sentence says it, such as `"0.01"`. */
  amount: string;
  /** The sentence that the owner read, to compare with the words that the verifier heard. */
  sentence: string;
}>;

/** Segment 1 is the recording; every segment after `from` waits or works. */
function segments(done: number, after: PhraseSegmentState): PhraseSegmentState[] {
  return Array.from({ length: SEGMENTS }, (_, index) => (index < done ? 'done' : after));
}

/** Segments before `at` passed, the one at `at` failed or waits, and the rest did not run. */
function blocked(at: number, state: 'fail' | 'wait'): PhraseSegmentState[] {
  return Array.from({ length: SEGMENTS }, (_, index) =>
    index < at ? 'done' : index === at ? state : 'skip',
  );
}

function networkName(network: TransferCardInput['network']): string {
  return network === 'mainnet' ? 'NEAR mainnet' : 'NEAR testnet';
}

export function verifyingView(): PhraseCheckView {
  const states = segments(1, 'run');
  states[PAYMENT] = 'idle';
  return {
    kind: 'check',
    label: 'Checking',
    caption: 'Checking your voice and words',
    details: VERIFIER_STEPS,
    segments: states,
  };
}

export function sendingView(
  input: TransferCardInput,
  approval: 'voice' | 'passkey',
): PhraseCheckView {
  const states = segments(PAYMENT, 'run');
  return {
    kind: 'check',
    label: 'Checking',
    caption: 'Sending from your account',
    details: [
      `${approval === 'voice' ? 'Signed by your Seams Wallet' : 'Approved with your passkey'} · ${networkName(input.network)}`,
    ],
    segments: states,
  };
}

export function stepUpView(policyText: string | null, waiting: boolean): PhraseResultView {
  return {
    kind: 'result',
    label: 'Not sent yet',
    headline: 'Confirm with your passkey',
    caption: waiting
      ? 'Waiting for your passkey'
      : (policyText ?? 'Your policy asks for a passkey for this payment.'),
    detail: waiting ? 'Use the passkey prompt on your device.' : 'Your voice and words passed.',
    action: { label: 'Confirm with passkey', icon: 'passkey', busy: waiting },
    line: blocked(POLICY, 'wait'),
  };
}

export function paidView(
  input: TransferCardInput,
  hash: string,
  seconds: number,
): PhraseResultView {
  const explorer =
    input.network === 'mainnet'
      ? 'https://nearblocks.io/txns/'
      : 'https://testnet.nearblocks.io/txns/';
  return {
    kind: 'result',
    label: '',
    headline: `Sent ${input.amount} NEAR`,
    caption: `To ${input.receiver}`,
    detail: `Checked and paid in ${seconds.toFixed(1)} s ·`,
    link: { text: 'View transaction', href: `${explorer}${encodeURIComponent(hash)}` },
    action: { label: 'Done' },
    line: 'seal',
  };
}

/** A failed result and whether "Try again" records the sentence again. */
export type FailureView = Readonly<{ view: PhraseResultView; retry: boolean }>;

type FailedResult = Exclude<SpeakToSignTransferResult, { kind: 'sent' } | { kind: 'cancelled' }>;

export function failureView(input: TransferCardInput, result: FailedResult): FailureView {
  const copy = failureCopy(input, result);
  return {
    retry: copy.retry,
    view: {
      kind: 'result',
      label: copy.label ?? 'Nothing was sent',
      headline: copy.headline,
      caption: copy.caption,
      detail: copy.detail,
      action: { label: copy.retry ? 'Try again' : 'Close' },
      line: blocked(copy.at, 'fail'),
    },
  };
}

type FailureCopy = Readonly<{
  label?: string;
  headline: string;
  caption: PhraseResultView['caption'];
  detail: string;
  at: number;
  retry: boolean;
}>;

function failureCopy(input: TransferCardInput, result: FailedResult): FailureCopy {
  const unavailable = {
    headline: 'The check is not available',
    caption: 'A verifier service did not answer.',
    detail: 'Try again in a minute.',
    retry: true,
  };
  if (result.kind === 'unavailable') {
    switch (result.reason) {
      case 'not_submitted':
        return {
          headline: 'The payment was not sent',
          caption: 'Your Wallet did not send the transaction.',
          detail: 'Try again in a minute.',
          at: PAYMENT,
          retry: true,
        };
      case 'submission_unknown':
        return {
          label: 'Check before you pay again',
          headline: 'The payment may have been sent',
          caption: 'The network did not confirm the transaction.',
          detail: 'Check your account before you try again.',
          at: PAYMENT,
          retry: false,
        };
      default:
        return { ...unavailable, at: SPEAKER };
    }
  }
  switch (result.reason) {
    case 'words':
      return {
        headline: 'The words did not match',
        caption: heardCaption(input.sentence, result.detail),
        detail: 'Read the sentence again, word for word.',
        at: WORDS,
        retry: true,
      };
    case 'speaker':
      return {
        headline: 'Your voice did not match',
        caption: 'The verifier did not match your enrolled voice.',
        detail: 'Speak in your usual voice, close to the microphone.',
        at: SPEAKER,
        retry: true,
      };
    case 'quality':
      return {
        headline: 'The recording was not clear',
        caption: 'The verifier could not hear your voice well.',
        detail: 'Move somewhere quieter and speak close to the microphone.',
        at: SPEAKER,
        retry: true,
      };
    case 'audio_reused':
    case 'audio_invalid':
      return {
        headline: 'The recording could not be used',
        caption: 'The verifier did not accept this recording.',
        detail: 'Record the sentence again.',
        at: SPEAKER,
        retry: true,
      };
    case 'template_missing':
      return {
        headline: 'Your voice is not enrolled',
        caption: 'The verifier has no voice for this account.',
        detail: 'Enroll your voice for Speak-to-Sign first.',
        at: SPEAKER,
        retry: false,
      };
    case 'transcriber_unavailable':
      return { ...unavailable, at: WORDS };
    case 'speaker_unavailable':
    case 'storage':
    case 'unsupported':
      return { ...unavailable, at: SPEAKER };
    case 'verdict_mismatch':
      return {
        headline: 'The verdict did not match',
        caption: 'Your Wallet refused the signed verdict for this payment.',
        detail: 'Record the sentence again.',
        at: VERDICT,
        retry: true,
      };
    case 'transaction_failed':
      return {
        label: 'Not paid',
        headline: 'The payment failed',
        caption: 'NEAR refused the transaction.',
        detail: 'Check your balance, then try again.',
        at: PAYMENT,
        retry: true,
      };
    // The flow checks these before it opens the card.
    case 'amount_not_speakable':
    case 'receiver_not_speakable':
    case 'receiver_missing':
      return {
        headline: 'This payment cannot be spoken',
        caption: 'Check the amount and the receiver.',
        detail: '',
        at: SPEAKER,
        retry: false,
      };
    default:
      return result satisfies never;
  }
}

/**
 * The words that the verifier heard, with each word that differs from the sentence marked. The
 * Wallet passes them as `heard: <text>` in the refusal detail.
 */
function heardCaption(sentence: string, detail: string | undefined): PhraseResultView['caption'] {
  const heard = detail?.startsWith('heard: ') ? detail.slice('heard: '.length).trim() : '';
  if (!heard) return 'The verifier heard different words.';
  const expected = new Set(sentence.split(/\s+/).map(normalWord));
  const parts: (string | { mark: string })[] = ['We heard “'];
  for (const [index, word] of heard.split(/\s+/).entries()) {
    if (index > 0) parts.push(' ');
    parts.push(expected.has(normalWord(word)) ? word : { mark: word });
  }
  parts.push('”');
  return parts;
}

function normalWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.-]/gu, '')
    .replace(/\.$/, '');
}
