// The live transcript of the microphone, from the browser's own speech recognition (the Web
// Speech API). It gives the words while the visitor still speaks. Chrome and Safari have it;
// Firefox does not. The browser sends the audio to its speech service, so this path is for
// commands only: a signature uses the Seams Wallet's recording and the attested verifier.

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
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  const scope = globalThis as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionClass() !== null;
}

export interface Listener {
  stop(): void;
}

/** Errors that a restart does not fix: the visitor or the browser said no. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network']);

/**
 * Listens until `stop`. `onWords` hears the words of the sentence so far; `final` is true once,
 * at the end of each sentence. The browser ends a recognition after some silence, so it starts
 * again by itself. `onStopped` hears why it cannot go on. Call it from a click.
 */
export function listen(handlers: { onWords(text: string, final: boolean): void; onStopped(reason: string): void }): Listener {
  const Class = recognitionClass();
  if (!Class) {
    handlers.onStopped('unsupported');
    return { stop: () => undefined };
  }
  let stopped = false;
  let current: Recognition | null = null;
  const start = () => {
    const recognition = new Class();
    current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
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
      if (stopped || !FATAL.has(event.error)) return;
      stopped = true;
      handlers.onStopped(event.error);
    };
    recognition.onend = () => {
      if (!stopped) start();
    };
    try {
      recognition.start();
    } catch {
      stopped = true;
      handlers.onStopped('start-failed');
    }
  };
  start();
  return {
    stop() {
      stopped = true;
      current?.abort();
    },
  };
}
