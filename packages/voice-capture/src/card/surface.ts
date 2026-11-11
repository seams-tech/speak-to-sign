// The phrase surface of the package: the prompt, the recorder and the phrase card on one element.

import { captureConfig } from '../config';
import {
  recordVoice,
  voiceQualityMessage,
  type VoiceCaptureEvent,
  type VoiceRecordingOptions,
  VoiceUserActionNeededError,
} from '../microphone';
import { VoiceMicrophoneInterruptedError } from '../microphoneInput';
import { expectedSpeechMs } from '../speechPause';
import { voiceActivityModel } from '../voiceActivity';
import { PhraseCard, type HandedOverRows } from './phraseCard';
import { leaveSurface, VoicePrompt } from './prompt';
import type { PhraseChoice, PhraseRecording, PhraseSurface, PhraseView } from './types';

const LABEL = 'Say this with your voice';
const PROMPT_LABEL = 'Say this sentence';
const PROMPT_MESSAGE = 'Read it naturally, then pause.';

/** What the host page adds around the card. Every field is optional. */
export type PhraseCardFrame = Readonly<{
  /** The element that gets the card. Default: the document body. */
  parent?: HTMLElement;
  /** More class names for the surface element, such as the host's theme class. */
  className?: string;
  /**
   * The corner controls of the card. `close` (default): Close in the trailing corner. `back`: Back
   * in the leading corner, in place of Close. `back_and_close`: both. Each one, and Escape, ends
   * the card as cancelled.
   */
  controls?: PhraseCardControls;
  /** Runs when the person presses Back or Close, before the card ends. Escape is not a press. */
  pressed?(control: PhraseCardControl): void;
  /** The host sizes its frame to the surface, so the card follows the frame. */
  hugged?: boolean;
  /** Runs when the surface is in the document. Its return value runs when the surface closes. */
  mounted?(element: HTMLElement): (() => void) | void;
}>;

/** The corner controls of a phrase card. */
export type PhraseCardControls = 'close' | 'back' | 'back_and_close';

/** One corner control of a phrase card. */
export type PhraseCardControl = 'back' | 'close';

export type PhraseCardInput = Readonly<{
  sentence: string;
  signal: AbortSignal;
  frame?: PhraseCardFrame;
  /** The speech detector of the recordings. Default: `model`. */
  detector?: VoiceRecordingOptions['detector'];
  /**
   * The first recording starts when the caller asks for it, with no press on Record. Use it
   * when the person just asked for this card, with a click or a key. If the browser does not
   * start audio without a press, the card stays with its Record button.
   */
  autoStart?: boolean;
}>;

/**
 * Shows the given sentence in the prompt. The surface records clips with the quality check, and
 * stays open so the caller can show its check and the result in the same card. A too quiet or
 * interrupted recording stays on the surface for another try.
 */
export function openPhraseCard(input: PhraseCardInput): PhraseSurface {
  return new CardSurface(input);
}

class CardSurface implements PhraseSurface {
  private readonly element: HTMLElement;
  private readonly prompt: VoicePrompt;
  private readonly card: PhraseCard;
  private readonly unmounted: (() => void) | void;
  private readonly outer: AbortSignal;
  private readonly detector: VoiceRecordingOptions['detector'];
  private readonly pressed: PhraseCardFrame['pressed'];
  /** Back, when the card shows it apart from Close. */
  private readonly back: HTMLButtonElement | null;
  private recorder: AbortController | null = null;
  private recording: Deferred<PhraseRecording> | null = null;
  private choice: ((choice: PhraseChoice) => void) | null = null;
  private view: PhraseView | null = null;
  private started = false;
  private closed = false;
  /** The next recording starts with no press. A card that continues another never does. */
  private autoStart: boolean;
  /** The voiced time of the whole sentence, after which a shorter pause ends a recording. */
  private readonly expectedSpeechMs: number;
  /** The speech detector has started; before that, a recording waits for it to load. */
  private speechDetectorReady = false;

  constructor(input: PhraseCardInput) {
    const { sentence, frame = {} } = input;
    const outer = input.signal;
    this.outer = outer;
    this.detector = input.detector;
    this.autoStart = input.autoStart === true;
    this.expectedSpeechMs = expectedSpeechMs(sentence);
    // A card that the host just finished stays on screen for this card: the host marks it.
    const handedOver = document.querySelector<HTMLElement>(
      '.seams-voiceid-activation-surface[data-seams-voiceid-handoff]',
    );
    // The first recording on a page waits for the speech detector (about 16 MB with its engine),
    // so it starts loading while the person reads the sentence. A failure shows on Record.
    if (input.detector === 'level') this.speechDetectorReady = true;
    else voiceActivityModel.prepare().then(this.detectorStarted, ignoreEarlyLoad);
    const parent = frame.parent ?? document.body;
    this.element = document.createElement('section');
    this.element.className = ['seams-voiceid-activation-surface', frame.className]
      .filter(Boolean)
      .join(' ');
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', LABEL);
    this.prompt = new VoicePrompt(document, LABEL, sentence);
    this.prompt.title.textContent = PROMPT_LABEL;
    // A sentence that already ends with punctuation, such as an enrollment phrase, keeps it.
    const shown = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    this.prompt.phrase.textContent = shown;
    delete this.prompt.phrase.dataset.voiceidPhrase;
    this.prompt.status.textContent = PROMPT_MESSAGE;
    this.prompt.record.textContent = 'Record';
    const controls = frame.controls ?? 'close';
    this.pressed = frame.pressed;
    const back = controls === 'close' ? null : this.prompt.showBack(controls === 'back_and_close');
    this.back = back === this.prompt.cancel ? null : back;
    const handedOverPrompt = handedOver?.querySelector(':scope > .seams-voiceid-prompt') ?? null;
    const rows = handedOverPrompt ? handedOverRows(handedOverPrompt) : null;
    if (handedOverPrompt) {
      // The card starts as the card it replaces, so the swap does not show; then its rows change.
      this.prompt.continueFrom(handedOverPrompt);
      this.prompt.record.hidden = true;
      this.autoStart = false;
    }
    this.card = new PhraseCard(
      this.prompt,
      { label: PROMPT_LABEL, sentence: shown, message: PROMPT_MESSAGE, action: 'Record' },
      rows,
    );
    this.element.append(this.prompt.element);
    this.prompt.record.addEventListener('click', this.press);
    const corner = controls === 'back' ? this.pressBack : this.pressClose;
    this.prompt.cancel.addEventListener('click', corner);
    this.back?.addEventListener('click', this.pressBack);
    this.element.addEventListener('cancel', this.cancel);
    outer.addEventListener('abort', this.cancel);
    if (handedOver) handedOver.replaceWith(this.element);
    else parent.appendChild(this.element);
    // The host sizes its frame to this surface, so the card can follow the frame (fillFrame).
    if (frame.hugged) this.element.classList.add('seams-voiceid-hugged');
    this.unmounted = frame.mounted?.(this.element);
    if (rows) this.prompt.element.focus({ preventScroll: true });
    else this.prompt.record.focus();
    if (outer.aborted) this.cancel();
  }

  record(): Promise<PhraseRecording> {
    if (this.closed) return Promise.resolve({ kind: 'cancelled' });
    this.settleChoice('replaced');
    this.recording?.resolve({ kind: 'cancelled' });
    const recording = deferred<PhraseRecording>();
    this.recording = recording;
    if (this.view) {
      this.view = null;
      void this.card.showPrompt();
    } else if (this.autoStart) {
      this.begin(recording);
    }
    this.autoStart = false;
    return recording.promise;
  }

  show(view: PhraseView): Promise<PhraseChoice> {
    if (this.closed) return Promise.resolve('closed');
    this.settleChoice('replaced');
    this.view = view;
    void this.card.show(view);
    return new Promise((resolve) => {
      this.choice = resolve;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.recorder?.abort();
    this.recording?.resolve({ kind: 'cancelled' });
    this.settleChoice('closed');
    this.unmounted?.();
    this.outer.removeEventListener('abort', this.cancel);
    this.element.removeEventListener('cancel', this.cancel);
    this.prompt.record.removeEventListener('click', this.press);
    this.prompt.cancel.removeEventListener('click', this.pressBack);
    this.prompt.cancel.removeEventListener('click', this.pressClose);
    this.back?.removeEventListener('click', this.pressBack);
    this.card.dispose();
    this.prompt.dispose();
    leaveSurface(this.element);
  }

  /** The one button records on the prompt and answers a result. */
  private readonly press = (): void => {
    if (this.view) {
      if (this.view.kind === 'result' && !this.view.action.busy) this.settleChoice('action');
      return;
    }
    if (!this.recording || this.started) return;
    this.begin(this.recording);
  };

  private begin(recording: Deferred<PhraseRecording>): void {
    this.started = true;
    this.prompt.record.disabled = true;
    this.prompt.status.textContent = this.speechDetectorReady
      ? 'Opening microphone…'
      : `Loading ${captureConfig().label}…`;
    void this.attempt(recording, this.autoStart);
  }

  private async attempt(recording: Deferred<PhraseRecording>, unpressed = false): Promise<void> {
    const recorder = new AbortController();
    this.recorder = recorder;
    try {
      const recorded = await recordVoice(recorder.signal, this.capture, {
        expectedSpeechMs: this.expectedSpeechMs,
        detector: this.detector,
      });
      if (this.recording !== recording || this.closed) {
        recorded.samples?.fill(0);
        return;
      }
      if (recorded.kind === 'insufficient_audio') {
        this.retry(voiceQualityMessage(recorded.quality));
        return;
      }
      // The person stopped speaking at the last voiced frame, before the end pause.
      const endOfSpeechAt = recorded.lastSoundAtMs ?? performance.now();
      this.started = false;
      this.recording = null;
      recording.resolve({ kind: 'recorded', samples: recorded.samples, endOfSpeechAt });
    } catch (error) {
      if (this.recording !== recording || this.closed) return;
      if (error instanceof VoiceMicrophoneInterruptedError) {
        this.retry(error.message);
        return;
      }
      // The browser wants a press first: the card is the usual prompt again.
      if (unpressed && error instanceof VoiceUserActionNeededError) {
        this.retry(PROMPT_MESSAGE, 'Record');
        return;
      }
      this.started = false;
      this.recording = null;
      recording.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private readonly detectorStarted = (): void => {
    this.speechDetectorReady = true;
  };

  /** The end of speech starts the check in place; every other capture event is the prompt's. */
  private readonly capture = (event: VoiceCaptureEvent): void => {
    if (event.kind === 'processing') this.card.beginCheck();
    else this.prompt.capture(event);
  };

  private retry(message: string, action = 'Try again'): void {
    this.started = false;
    this.prompt.record.textContent = action;
    this.prompt.ready(message);
    this.prompt.record.focus();
  }

  private settleChoice(choice: PhraseChoice): void {
    const settle = this.choice;
    this.choice = null;
    settle?.(choice);
  }

  /** A close during a check is not possible: the button is hidden while the caller works. */
  private readonly pressBack = (): void => this.pressControl('back');
  private readonly pressClose = (): void => this.pressControl('close');

  private pressControl(control: PhraseCardControl): void {
    // The check view hides the corner controls, and a press there does not end the card.
    if (this.view?.kind === 'check') return;
    this.pressed?.(control);
    this.cancel();
  }

  private readonly cancel = (): void => {
    if (this.view?.kind === 'check' && !this.outer.aborted) return;
    if (this.recording) {
      this.recorder?.abort();
      this.recording.resolve({ kind: 'cancelled' });
      this.recording = null;
      this.started = false;
    }
    this.settleChoice('closed');
    if (this.outer.aborted) this.close();
  };
}

/** A failed early load runs again when Record needs the detector, and shows its error there. */
function ignoreEarlyLoad(): void {}

/** The rows that the handed-over card shows now. */
function handedOverRows(prompt: Element): HandedOverRows {
  const read = (selector: string): string =>
    prompt.querySelector(`:scope > ${selector}`)?.textContent ?? '';
  return { label: read('h2'), message: read('.seams-voiceid-status') };
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}>;

/** A promise with its two settle functions. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
