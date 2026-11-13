// The phrase surface: one card that shows a sentence, records it, and then shows the caller's
// check and result. The shapes are the same as the Seams Wallet's phrase surface, so a wallet
// plugin can pass this surface on.

/** One clip of a shown sentence: 16 kHz mono samples that passed the quality check. */
export type PhraseRecording =
  | Readonly<{
      kind: 'recorded';
      samples: Float32Array;
      /**
       * `performance.now()` of the last voiced frame: the person stopped speaking then, before
       * the pause that ends the recording.
       */
      endOfSpeechAt: number;
    }>
  | Readonly<{ kind: 'cancelled' }>;

/** One segment of the line that shows a check: waiting, working, passed, failed or held. */
export type PhraseSegmentState = 'idle' | 'run' | 'done' | 'fail' | 'wait' | 'skip';

/** Text in which some words are marked, such as words that a verifier heard differently. */
export type PhraseText = string | readonly (string | Readonly<{ mark: string }>)[];

/**
 * A check after the recording: the sentence stays and dims, the action row goes, and the line
 * becomes segments. Segments that change from `run` to `done` fill one after another.
 */
export type PhraseCheckView = Readonly<{
  kind: 'check';
  label: string;
  caption: string;
  /** The second line. Several lines change every 1.3 s and stay on the last one. */
  details: readonly string[];
  segments: readonly PhraseSegmentState[];
}>;

/**
 * The proof of a result, in a box between the caption and the detail: who checked what, and a
 * link to check it again, such as a TEE attestation.
 */
export type PhraseReceipt = Readonly<{
  /** For example "TEE receipt". */
  title: string;
  /** Where the checks ran, at the right of the title, for example "Intel TDX · OutLayer". */
  source?: string;
  /** One checked line each, for example `{ label: 'Voice', value: 'matched alice.near' }`. */
  rows: readonly Readonly<{ label: string; value: string }>[];
  /** A link under the rows, for example the attestation of the call. */
  link?: Readonly<{ text: string; href: string }>;
}>;

/** A result or a question: a headline takes the sentence's place, with one action. */
export type PhraseResultView = Readonly<{
  kind: 'result';
  label: string;
  headline: string;
  caption: PhraseText;
  /** The proof of the result, under the caption. */
  receipt?: PhraseReceipt;
  detail: string;
  /** A link after the detail, such as a transaction in a block explorer. */
  link?: Readonly<{ text: string; href: string }>;
  /**
   * `busy` shows the action dimmed while something outside the surface finishes. `retry`: the
   * action records the sentence again ("Try again"). The next recording then starts with no
   * second press, and a host's `retry` press can run this action. No host press runs another
   * action, such as a confirmation.
   */
  action: Readonly<{ label: string; icon?: 'passkey'; busy?: boolean; retry?: boolean }>;
  /** `seal`: the line closes into the success seal. */
  line: 'seal' | readonly PhraseSegmentState[];
}>;

export type PhraseView = PhraseCheckView | PhraseResultView;

/** `replaced`: another view or a recording took the surface first. */
export type PhraseChoice = 'action' | 'closed' | 'replaced';

/**
 * The phrase surface stays open after a recording, so the caller can show its check and the
 * result in the same card. The caller closes it.
 */
export interface PhraseSurface {
  /** Shows the sentence with Record and records one clip. A later call records again. */
  record(): Promise<PhraseRecording>;
  /** A check view settles only when it is replaced; a result settles on its action or close. */
  show(view: PhraseView): Promise<PhraseChoice>;
  close(): void;
}
