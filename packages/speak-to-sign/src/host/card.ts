import type {
  PhraseCheckView,
  PhraseResultView,
  PhraseSegmentState,
  VerifierRefusal,
} from '@seams/wallet/speak-to-sign-host';

// The line under the sentence has one segment for each step of a spoken request.
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

/** What the card calls the request it signs. */
export type CardNoun = 'payment' | 'note' | 'rating';

export type CardInput = Readonly<{
  network: 'testnet' | 'mainnet';
  noun: CardNoun;
  /** The result, such as "Sent 0.01 NEAR" and "To bob.testnet". */
  doneHeadline: string;
  doneCaption: string;
  /** The spoken form of the sentence, to align with the words that the verifier heard. */
  spokenText: string;
}>;

const NOUN_COPY: Readonly<
  Record<
    CardNoun,
    Readonly<{ done: string; failedLabel: string; failedDetail: string; unknownLabel: string }>
  >
> = {
  payment: {
    done: 'paid',
    failedLabel: 'Not paid',
    failedDetail: 'Check your balance, then try again.',
    unknownLabel: 'Check before you pay again',
  },
  note: {
    done: 'posted',
    failedLabel: 'Not posted',
    failedDetail: 'Check the post and your balance, then try again.',
    unknownLabel: 'Check before you post again',
  },
  rating: {
    done: 'saved',
    failedLabel: 'Not saved',
    failedDetail: 'Check the note and your balance, then try again.',
    unknownLabel: 'Check before you rate again',
  },
};

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

function networkName(network: CardInput['network']): string {
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
  input: CardInput,
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

export function stepUpView(
  noun: CardNoun,
  policyText: string | null,
  waiting: boolean,
): PhraseResultView {
  return {
    kind: 'result',
    label: 'Not sent yet',
    headline: 'Confirm with your passkey',
    caption: waiting
      ? 'Waiting for your passkey'
      : (policyText ?? `Your policy asks for a passkey for this ${noun}.`),
    detail: waiting ? 'Use the passkey prompt on your device.' : 'Your voice and words passed.',
    action: { label: 'Confirm with passkey', icon: 'passkey', busy: waiting },
    line: blocked(POLICY, 'wait'),
  };
}

export function paidView(input: CardInput, hash: string, seconds: number): PhraseResultView {
  const explorer =
    input.network === 'mainnet'
      ? 'https://nearblocks.io/txns/'
      : 'https://testnet.nearblocks.io/txns/';
  return {
    kind: 'result',
    label: '',
    headline: input.doneHeadline,
    caption: input.doneCaption,
    detail: `Checked and ${NOUN_COPY[input.noun].done} in ${seconds.toFixed(1)} s ·`,
    link: { text: 'View transaction', href: `${explorer}${encodeURIComponent(hash)}` },
    action: { label: 'Done' },
    line: 'seal',
  };
}

// An enrollment uses the same line: segment 1 is the recordings, segment 2 the owner's signed
// message, and the rest the verifier, which stores the template.
const ENROLL_SIGNATURE = 1;
const ENROLL_TEMPLATE = 2;

/** After the third phrase, until the Wallet confirm of the enrollment message opens over it. */
export function enrollSigningView(): PhraseCheckView {
  const states = segments(ENROLL_SIGNATURE, 'idle');
  states[ENROLL_SIGNATURE] = 'wait';
  return {
    kind: 'check',
    label: 'Enrolling',
    caption: 'Preparing your signed enrollment',
    details: ['Next, confirm one message that names these three recordings.'],
    segments: states,
  };
}

export function enrollSavingView(): PhraseCheckView {
  return {
    kind: 'check',
    label: 'Enrolling',
    caption: 'Storing your voice template',
    details: ['ReDimNet · Intel TDX CVM on Phala', 'Signed by the OutLayer TEE verifier'],
    segments: segments(ENROLL_TEMPLATE, 'run'),
  };
}

export function enrolledView(templateEpoch: number, agreementMilli: number): PhraseResultView {
  return {
    kind: 'result',
    label: '',
    headline: 'Voice enrolled',
    caption: 'The verifier stored your voice template.',
    detail: `Template ${templateEpoch} · agreement ${(agreementMilli / 1000).toFixed(3)}`,
    action: { label: 'Done' },
    line: 'seal',
  };
}

/** The verifier refused the recordings, or did not answer. Nothing was stored. */
export function notEnrolledView(
  result: Readonly<{ kind: 'refused' | 'unavailable'; reason: string }>,
): PhraseResultView {
  const refused = result.kind === 'refused';
  return {
    kind: 'result',
    label: 'Not enrolled',
    headline: refused ? 'The verifier refused the recordings' : 'The check is not available',
    caption: refused ? `Reason: ${result.reason}` : 'A verifier service did not answer.',
    detail: refused ? 'Record the three phrases again.' : 'Try again in a minute.',
    action: { label: 'Close' },
    line: blocked(ENROLL_TEMPLATE, 'fail'),
  };
}

/** A failed result and whether "Try again" records the sentence again. */
export type FailureView = Readonly<{ view: PhraseResultView; retry: boolean }>;

/** A failure after the card opened. The flow refuses an unspeakable request before that. */
export type FailedResult =
  | Readonly<{
      kind: 'refused';
      reason:
        | VerifierRefusal
        | 'verdict_mismatch'
        | 'voice_limit'
        | 'cosigner_refused'
        | 'transaction_failed';
      detail?: string;
    }>
  | Readonly<{
      kind: 'unavailable';
      reason: 'voiceid_unavailable' | 'verifier_unavailable' | 'not_submitted' | 'submission_unknown';
      detail?: string;
    }>;

/** `canRetry` is false for the last recording of a request. */
export function failureView(
  input: CardInput,
  result: FailedResult,
  canRetry: boolean,
): FailureView {
  const found = failureCopy(input, result);
  const copy = { ...found, retry: found.retry && canRetry };
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

function failureCopy(input: CardInput, result: FailedResult): FailureCopy {
  const noun = NOUN_COPY[input.noun];
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
          headline: `The ${input.noun} was not sent`,
          caption: 'Your Wallet did not send the transaction.',
          detail: 'Try again in a minute.',
          at: PAYMENT,
          retry: true,
        };
      case 'submission_unknown':
        return {
          label: noun.unknownLabel,
          headline: `The ${input.noun} may have been sent`,
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
        caption: heardCaption(input.spokenText, result.detail),
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
        caption: `Your Wallet refused the signed verdict for this ${input.noun}.`,
        detail: 'Record the sentence again.',
        at: VERDICT,
        retry: true,
      };
    case 'voice_limit':
      return {
        headline: 'Over your voice limit',
        caption:
          result.detail === 'over_daily_limit'
            ? 'Your voice payments in the last 24 hours reached the limit.'
            : 'This amount is over the limit for one voice payment.',
        detail: 'Pay with the normal confirm instead.',
        at: POLICY,
        retry: false,
      };
    case 'cosigner_refused':
      return {
        headline: 'Seams refused the verdict',
        caption: `The Seams co-signer did not accept the verdict for this ${input.noun}.`,
        detail: 'Record the sentence again.',
        at: PAYMENT,
        retry: true,
      };
    case 'transaction_failed':
      return {
        label: noun.failedLabel,
        headline: `The ${input.noun} failed`,
        caption: 'NEAR refused the transaction.',
        detail: noun.failedDetail,
        at: PAYMENT,
        retry: true,
      };
    default:
      return result satisfies never;
  }
}

/** A refused verdict is not signature-checked, so its text is cut short and shown as plain text. */
const MAX_HEARD_CHARS = 160;

/**
 * The words that the verifier heard, with each word that the alignment with the spoken sentence
 * does not match marked. The Wallet passes them as `heard: <words>` in the refusal detail.
 */
function heardCaption(spokenText: string, detail: string | undefined): PhraseResultView['caption'] {
  const heard = detail?.startsWith('heard: ')
    ? detail.slice('heard: '.length).slice(0, MAX_HEARD_CHARS).trim()
    : '';
  if (!heard) return 'The verifier heard different words.';
  const words = heard.split(/\s+/);
  const matched = alignedWords(words.map(normalWord), spokenText.split(' ').map(normalWord));
  const parts: (string | { mark: string })[] = ['We heard “'];
  for (const [index, word] of words.entries()) {
    if (index > 0) parts.push(' ');
    parts.push(matched.has(index) ? word : { mark: word });
  }
  parts.push('”');
  return parts;
}

/** The indices of heard words in a longest common subsequence with the expected words. */
function alignedWords(heard: readonly string[], expected: readonly string[]): Set<number> {
  const lengths = Array.from({ length: heard.length + 1 }, () =>
    new Array<number>(expected.length + 1).fill(0),
  );
  for (let i = heard.length - 1; i >= 0; i -= 1) {
    for (let j = expected.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        heard[i] === expected[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < heard.length && j < expected.length) {
    if (heard[i] === expected[j]) {
      matched.add(i);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1;
    else j += 1;
  }
  return matched;
}

function normalWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
