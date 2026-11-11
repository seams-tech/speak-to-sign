// The live transcript of the microphone, from the browser's own speech recognition (the Web
// Speech API). It gives the words while the visitor still speaks. Chrome and Safari have it;
// Firefox does not. This path is for commands only: a signature uses the Seams Wallet's
// recording and the attested verifier.
//
// Two modes. With Chrome's on-device model for English installed (`deviceSpeech`), the audio
// stays on the device, and the listener gives Chrome the words of the commands and the names on
// the screen (`phrases`), so that "bet no on" is not heard as "but knowing". Chrome takes such a
// word list only on the device: its speech service answers `phrases-not-supported`. Without the
// model, the browser sends the audio to its speech service, with no word list.

const LANG = 'en-US';
/** How much a command word counts over a word that sounds the same. Chrome takes 0 to 10. */
const PHRASE_BOOST = 3;

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onaudiostart: (() => void) | null;
  onend: (() => void) | null;
  /** Chrome: recognize on the device. */
  processLocally?: boolean;
  /** Chrome: the words to prefer, as `SpeechRecognitionPhrase` objects. */
  phrases?: unknown[];
  start(): void;
  abort(): void;
}
/** The state of the on-device model for English, as Chrome's `SpeechRecognition.available` says. */
export type DeviceSpeech = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type RecognitionClass = (new () => Recognition) & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<DeviceSpeech>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};
type PhraseClass = new (phrase: string, boost: number) => unknown;

function recognitionClass(): RecognitionClass | null {
  const scope = globalThis as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionClass() !== null;
}

/** The on-device model for English, or null when the browser has no on-device recognition. */
export async function deviceSpeech(): Promise<DeviceSpeech | null> {
  const Class = recognitionClass();
  if (typeof Class?.available !== 'function') return null;
  try {
    return await Class.available({ langs: [LANG], processLocally: true });
  } catch {
    return null;
  }
}

/** Asks Chrome to download its on-device model for English. True when it is installed. */
export async function installDeviceSpeech(): Promise<boolean> {
  const Class = recognitionClass();
  if (typeof Class?.install !== 'function') return false;
  try {
    return await Class.install({ langs: [LANG], processLocally: true });
  } catch {
    return false;
  }
}

/** Where the words come from: Chrome's on-device model, or the browser's speech service. */
export type ListenMode = 'device' | 'server';

export interface Listener {
  stop(): void;
}

/** Errors that a restart does not fix: the visitor or the browser said no. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network']);

/**
 * A recognition that ends before it gets audio did not listen. Chrome does this when another tab
 * holds its speech service: each new recognition stops the other one. The listener then waits
 * longer before each new start, and after this many ends in a row it stops with 'busy'.
 */
const MAX_DEAF_ENDS = 6;
const FIRST_RETRY_MS = 200;
/** After this many ends with no audio on the device, the listener goes back to the speech service. */
const MAX_DEVICE_DEAF_ENDS = 3;

/**
 * Listens until `stop`. `onWords` hears the words of the sentence so far; `final` is true once,
 * at the end of each sentence. The browser ends a recognition after some silence, so it starts
 * again by itself, with the `phrases` of that moment. `onMode` hears where the words come from,
 * and `onStopped` hears why it cannot go on. Call it from a click, and only in the visible tab:
 * two tabs that listen stop each other.
 */
export function listen(handlers: {
  onWords(text: string, final: boolean): void;
  onStopped(reason: string): void;
  onMode?(mode: ListenMode): void;
  /** The words to prefer, on the device only. */
  phrases?: () => string[];
}): Listener {
  const Class = recognitionClass();
  if (!Class) {
    handlers.onStopped('unsupported');
    return { stop: () => undefined };
  }
  const Phrase = (globalThis as { SpeechRecognitionPhrase?: PhraseClass }).SpeechRecognitionPhrase;
  let stopped = false;
  let current: Recognition | null = null;
  let deafEnds = 0;
  let retry = 0;
  let mode: ListenMode = 'server';
  let usePhrases = Phrase !== undefined && handlers.phrases !== undefined;
  const start = () => {
    const recognition = new Class();
    current = recognition;
    let heard = false;
    recognition.onaudiostart = () => {
      heard = true;
      deafEnds = 0;
    };
    recognition.lang = LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    if (mode === 'device') {
      recognition.processLocally = true;
      if (usePhrases && Phrase && handlers.phrases) {
        try {
          recognition.phrases = [...new Set(handlers.phrases())].map((phrase) => new Phrase(phrase, PHRASE_BOOST));
        } catch {
          usePhrases = false;
        }
      }
    }
    recognition.onresult = (event) => {
      if (stopped) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (text !== '') handlers.onWords(text, true);
          interim = '';
        } else interim = `${interim} ${text}`.trim();
      }
      if (interim !== '') handlers.onWords(interim, false);
    };
    recognition.onerror = (event) => {
      if (stopped) return;
      // A refused word list or an on-device model that cannot run: go on without it.
      if (event.error === 'phrases-not-supported') {
        usePhrases = false;
        return;
      }
      if (mode === 'device' && event.error === 'language-not-supported') {
        mode = 'server';
        handlers.onMode?.(mode);
        return;
      }
      if (!FATAL.has(event.error)) return;
      stopped = true;
      handlers.onStopped(event.error);
    };
    recognition.onend = () => {
      if (stopped) return;
      if (heard) {
        start();
        return;
      }
      deafEnds += 1;
      // The on-device model may not run here: the speech service can still work.
      if (mode === 'device' && deafEnds >= MAX_DEVICE_DEAF_ENDS) {
        mode = 'server';
        deafEnds = 0;
        handlers.onMode?.(mode);
      }
      if (deafEnds >= MAX_DEAF_ENDS) {
        stopped = true;
        handlers.onStopped('busy');
        return;
      }
      retry = window.setTimeout(start, FIRST_RETRY_MS * 2 ** (deafEnds - 1));
    };
    try {
      recognition.start();
    } catch {
      stopped = true;
      handlers.onStopped('start-failed');
    }
  };
  // The on-device model, if it is installed. The first recognition waits for the answer.
  void deviceSpeech().then((state) => {
    if (stopped) return;
    mode = state === 'available' ? 'device' : 'server';
    handlers.onMode?.(mode);
    start();
  });
  return {
    stop() {
      stopped = true;
      window.clearTimeout(retry);
      current?.abort();
    },
  };
}
