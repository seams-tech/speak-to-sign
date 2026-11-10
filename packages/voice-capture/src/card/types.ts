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

/** A result or a question: a headline takes the sentence's place, with one action. */
export type PhraseResultView = Readonly<{
  kind: 'result';
  label: string;
  headline: string;
  caption: PhraseText;
  detail: string;
  /** A link after the detail, such as a transaction in a block explorer. */
  link?: Readonly<{ text: string; href: string }>;
  /** `busy` shows the action dimmed while something outside the surface finishes. */
  action: Readonly<{ label: string; icon?: 'passkey'; busy?: boolean }>;
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
