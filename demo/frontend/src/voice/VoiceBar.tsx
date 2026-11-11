// The voice bar at the foot of the timeline. With the microphone on, the visitor says what the
// page must do: "show me controversial posts", "add a community note to this one", "bet one
// dollar on no on the second note". The words show while the visitor speaks. Each new piece of
// the sentence goes to the classifier (classify.ts), so the page moves before the sentence ends.
//
// A command that shows a tab or goes to a named post runs on an unfinished sentence. "Next
// post" and a command that opens a signing step (a note, a rating, a bet, a market) wait for
// the end of the sentence. The signature itself is the
// spoken request in the Seams Wallet, and the bar does not listen while a dialog is open.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import { classify } from './classify';
import type { Screen, VoiceCommand } from './command';
import { useVoiceHeld } from './hold';
import { canListen, listen } from './listen';
import './voice.css';

/** An unfinished sentence goes to the classifier after this pause in the stream of words. */
const INTERIM_PAUSE_MS = 180;
/** How long a finished sentence stays in the bar. */
const CLEAR_MS = 3_500;

/** The shortcut as the visitor's keyboard shows it. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';

const STOP_REASONS: Record<string, string> = {
  unsupported: 'This browser has no speech recognition. Type the command.',
  'not-allowed': 'The microphone is not allowed for this page. Type the command.',
  'service-not-allowed': 'The speech service of this browser is not allowed. Type the command.',
  'audio-capture': 'No microphone was found. Type the command.',
  network: 'The speech service of this browser did not answer. Type the command.',
};

interface Status {
  text: string;
  /** The classifier's time, and who answered. */
  detail?: string;
  isProblem: boolean;
}

export function VoiceBar({
  on,
  onToggle,
  screen,
  onCommand,
  onTarget,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  /** The screen at this moment, for the classifier. */
  screen: () => Screen;
  /** Runs a command. The result is the line that the bar shows; `ok: false` is a problem. */
  onCommand: (command: VoiceCommand) => { ok: boolean; text: string };
  /** An unfinished sentence asks for a note or a bet on this post: show the post, and wait. */
  onTarget: (postId: number) => void;
}) {
  const held = useVoiceHeld();
  const [words, setWords] = useState<{ text: string; final: boolean } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  /** Why the microphone cannot listen. The bar then takes typed commands. */
  const [stopReason, setStopReason] = useState<string | null>(() => (canListen() ? null : 'unsupported'));
  const [typed, setTyped] = useState('');

  const screenRef = useRef(screen);
  const onCommandRef = useRef(onCommand);
  const onTargetRef = useRef(onTarget);
  useEffect(() => {
    screenRef.current = screen;
    onCommandRef.current = onCommand;
    onTargetRef.current = onTarget;
  });

  // One sentence at a time: a newer piece of it replaces the request of an older piece.
  const request = useRef<AbortController | null>(null);
  const interimTimer = useRef(0);
  const clearTimer = useRef(0);
  /** The command that the sentence ran already, so that its next piece does not run it again. */
  const ran = useRef<string | null>(null);
  /** The post that the sentence showed already. */
  const shown = useRef<number | null>(null);

  const hear = useRef((text: string, final: boolean) => {
    window.clearTimeout(interimTimer.current);
    window.clearTimeout(clearTimer.current);
    setWords({ text, final });
    const run = async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      let result;
      try {
        result = await classify(text, screenRef.current(), controller.signal);
      } catch {
        return; // A newer piece of the sentence took over.
      }
      if (controller.signal.aborted) return;
      const { command } = result;
      // For a look at what the speech service wrote, and what the page made of it.
      if (final) console.debug('[voice]', JSON.stringify(text), command);
      const detail = `${result.by === 'jev' ? 'JEV' : 'word rules'} · ${result.ms} ms`;
      if (command.kind === 'none') {
        // The words stay in the line, so the visitor sees what the speech service wrote.
        if (final) setStatus({ text: `No command in “${text}”.`, detail, isProblem: false });
      } else if (final || command.kind === 'show' || command.kind === 'go') {
        const key = JSON.stringify(command, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
        if (ran.current !== key) {
          ran.current = key;
          const outcome = onCommandRef.current(command);
          setStatus({ text: outcome.text, detail, isProblem: !outcome.ok });
        }
      } else if ('postId' in command && shown.current !== command.postId) {
        // The page shows the post of a note or a bet at once. The signing step waits for the end.
        shown.current = command.postId;
        onTargetRef.current(command.postId);
      }
      if (final) {
        ran.current = null;
        shown.current = null;
      }
    };
    if (final) {
      void run();
      clearTimer.current = window.setTimeout(() => setWords(null), CLEAR_MS);
    } else interimTimer.current = window.setTimeout(() => void run(), INTERIM_PAUSE_MS);
  });

  const listening = on && !held && stopReason === null;
  useEffect(() => {
    if (!listening) return;
    const listener = listen({
      onWords: (text, final) => hear.current(text, final),
      onStopped: setStopReason,
    });
    return () => {
      listener.stop();
      window.clearTimeout(interimTimer.current);
      request.current?.abort();
    };
  }, [listening]);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);

  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (text === '') return;
    setTyped('');
    hear.current(text, true);
  };

  // A sentence stays in the bar while its dialog is open, so the visitor sees what the page heard.
  const heldWith = useRef(false);
  useEffect(() => {
    if (held) {
      heldWith.current = true;
      window.clearTimeout(clearTimer.current);
    } else if (heldWith.current) {
      heldWith.current = false;
      setWords(null);
    }
  }, [held]);

  const toggle = () => {
    if (!on && canListen()) setStopReason(null);
    setStatus(null);
    setWords(null);
    onToggle(!on);
  };
  // Cmd+K (Ctrl+K on Windows and Linux) turns the bar on and off. A key press counts as the
  // visitor's own action, so the browser lets the microphone start.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hint = held
    ? 'Paused while the dialog is open.'
    : stopReason !== null
      ? (STOP_REASONS[stopReason] ?? 'The microphone stopped. Type the command.')
      : 'Say: "show me controversial posts".';

  return (
    <div className={on ? 'voice-bar voice-bar-on' : 'voice-bar'} role="region" aria-label="Voice commands">
      <button
        type="button"
        className={listening ? 'voice-mic voice-mic-live' : 'voice-mic'}
        aria-pressed={on}
        aria-label={on ? 'Turn voice commands off' : 'Turn voice commands on'}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${on ? 'Turn voice commands off' : 'Turn voice commands on'} (${SHORTCUT})`}
        onClick={toggle}
      >
        {on ? <IconMicrophone size={20} stroke={1.9} aria-hidden="true" /> : <IconMicrophoneOff size={20} stroke={1.9} aria-hidden="true" />}
      </button>
      {on ? (
        <div className="voice-main">
          {stopReason !== null && !held ? (
            <form className="voice-typed" onSubmit={submitTyped}>
              <input
                className="voice-input"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type a command, then press Enter"
                aria-label="Command"
                autoComplete="off"
              />
            </form>
          ) : (
            <p className={words?.final === false ? 'voice-words voice-words-live' : 'voice-words'} aria-live="off">
              {words ? <span>{words.text}</span> : <span className="voice-hint">{hint}</span>}
            </p>
          )}
          <p className={status?.isProblem ? 'voice-status voice-status-problem' : 'voice-status'} role="status">
            {status ? (
              <>
                {status.text}
                {status.detail && <span className="voice-detail"> {status.detail}</span>}
              </>
            ) : (
              stopReason !== null && !held && <span className="voice-hint">{hint}</span>
            )}
          </p>
        </div>
      ) : (
        <span className="voice-off">
          Voice commands <kbd className="voice-key">{SHORTCUT}</kbd>
        </span>
      )}
    </div>
  );
}
