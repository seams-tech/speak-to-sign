// The voice bar at the foot of the timeline. With the microphone on, the visitor says what the
// page must do: "show me controversial posts", "add a community note to this one", "bet one
// dollar on no on the second note". The words show while the visitor speaks, on one line after
// the sentences before them (Transcript.tsx). Each new piece of the sentence goes to the
// classifier (classify.ts), so the page moves before the sentence ends.
//
// A command that shows a tab or goes to a named post runs on an unfinished sentence. "Next
// post" and a command that opens a signing step (a note, a rating, a bet, a market) wait for
// the end of the sentence. The signature itself is the
// spoken request in the Seams Wallet, and the bar does not listen while a dialog is open or
// while the tab is out of view.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import { classify } from './classify';
import type { Screen, VoiceCommand } from './command';
import { useVoiceHeld } from './hold';
import { canListen, deviceSpeech, installDeviceSpeech, listen, type DeviceSpeech, type ListenMode } from './listen';
import { MAX_SAID, Transcript, type SaidSentence } from './Transcript';
import './voice.css';

/** An unfinished sentence goes to the classifier after this pause in the stream of words. */
const INTERIM_PAUSE_MS = 180;

/** Each finished sentence of the line has its own id, for React. */
let saidSeq = 0;

/**
 * The words of the commands. With Chrome's on-device model, Chrome prefers these words over
 * words that sound the same. The names of the authors on the screen come with them.
 */
const COMMAND_PHRASES = [
  'bet',
  'bet yes',
  'bet no',
  'bet no on this post',
  'yes',
  'no',
  'dollar',
  'cents',
  'USDC',
  'community note',
  'write a community note',
  'add a community note',
  'note',
  'market',
  'open a market',
  'prediction market',
  'rate',
  'helpful',
  'somewhat helpful',
  'not helpful',
  'next post',
  'previous post',
  'go back',
  'scroll to',
  'this post',
  'controversial',
  'open markets',
  'decided',
  'fresh',
];
/** A name that Chrome can take as a phrase. */
const SAYABLE_NAME = /^[\p{L}\p{N}' .-]{2,40}$/u;

/** The shortcut as the visitor's keyboard shows it. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';

const STOP_REASONS: Record<string, string> = {
  unsupported: 'This browser has no speech recognition. Type the command.',
  'not-allowed': 'The microphone is not allowed for this page. Type the command.',
  'service-not-allowed': 'The speech service of this browser is not allowed. Type the command.',
  'audio-capture': 'No microphone was found. Type the command.',
  network: 'The speech service of this browser did not answer. Type the command.',
  busy: 'Another tab or app uses the speech service. Close it, then turn voice commands off and on.',
};

/** True while the visitor can see this tab. Only the visible tab listens: two tabs stop each other. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** A line under the words: a command that could not run, or a sentence with no command. */
interface Status {
  text: string;
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
  /** Runs a command. The result is the problem that the bar shows, or null when it ran. */
  onCommand: (command: VoiceCommand) => string | null;
  /** An unfinished sentence asks for a note or a bet on this post: show the post, and wait. */
  onTarget: (postId: number) => void;
}) {
  const held = useVoiceHeld();
  const visible = useTabVisible();
  /** The finished sentences, oldest first, and the sentence that the visitor says now. */
  const [said, setSaid] = useState<SaidSentence[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  /** Who classified the last sentence, and how long it took: "JEV · 359 ms". */
  const [timing, setTiming] = useState<string | null>(null);
  /** Where the words come from now, and the state of Chrome's on-device model. */
  const [mode, setMode] = useState<ListenMode | null>(null);
  const [device, setDevice] = useState<DeviceSpeech | null>(null);
  /** A new value starts the listener again: after the model is installed. */
  const [restart, setRestart] = useState(0);
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
  /** The command that the sentence ran already, so that its next piece does not run it again. */
  const ran = useRef<string | null>(null);
  /** The post that the sentence showed already. */
  const shown = useRef<number | null>(null);
  /** A sentence is on its way: its first words came, and its end did not. */
  const speaking = useRef(false);

  const hear = useRef((text: string, final: boolean) => {
    window.clearTimeout(interimTimer.current);
    // A new sentence: the line about the last one goes.
    if (!speaking.current) setStatus(null);
    speaking.current = !final;
    if (final) {
      setSaid((before) => [...before, { id: (saidSeq += 1), text }].slice(-MAX_SAID));
      setLive(null);
    } else setLive(text);
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
      const timed = `${result.by === 'jev' ? 'JEV' : 'word rules'} · ${result.ms} ms`;
      if (command.kind === 'none') {
        // The words stay in the line, so the visitor sees what the speech service wrote.
        if (final) {
          setTiming(timed);
          setStatus({ text: 'No command in that sentence.', isProblem: false });
        }
      } else if (final || command.kind === 'show' || command.kind === 'go') {
        const key = JSON.stringify(command, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
        if (ran.current !== key) {
          ran.current = key;
          // A command that ran needs no words: the page shows what it did.
          const problem = onCommandRef.current(command);
          setTiming(timed);
          setStatus(problem === null ? null : { text: problem, isProblem: true });
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
    if (final) void run();
    else interimTimer.current = window.setTimeout(() => void run(), INTERIM_PAUSE_MS);
  });

  // A tab that comes back into view tries again: the tab that held the speech service can be gone.
  useEffect(() => {
    if (visible) setStopReason((reason) => (reason === 'busy' ? null : reason));
  }, [visible]);

  const listening = on && !held && visible && stopReason === null;
  useEffect(() => {
    if (!listening) return;
    const listener = listen({
      onWords: (text, final) => hear.current(text, final),
      onStopped: setStopReason,
      onMode: setMode,
      phrases: () => [...COMMAND_PHRASES, ...screenRef.current().posts.map((post) => post.author.trim()).filter((name) => SAYABLE_NAME.test(name))],
    });
    return () => {
      listener.stop();
      window.clearTimeout(interimTimer.current);
      request.current?.abort();
    };
  }, [listening, restart]);

  // Chrome's on-device model: with it, the bar can give Chrome the words of the commands.
  useEffect(() => {
    if (!on) return;
    let current = true;
    void deviceSpeech().then((state) => {
      if (current) setDevice(state);
    });
    return () => {
      current = false;
    };
  }, [on]);
  const install = async () => {
    setDevice('downloading');
    if (await installDeviceSpeech()) {
      setDevice('available');
      setRestart((count) => count + 1);
    } else {
      setDevice('downloadable');
      setStatus({ text: 'Chrome did not install its speech model. The bar goes on with the speech service.', isProblem: true });
    }
  };

  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (text === '') return;
    setTyped('');
    hear.current(text, true);
  };

  const toggle = () => {
    if (!on && canListen()) setStopReason(null);
    setStatus(null);
    setTiming(null);
    setSaid([]);
    setLive(null);
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
            <Transcript said={said} live={live} caret={listening} hint={hint} />
          )}
          {/* Always in the document, so a screen reader hears a new problem; empty, it takes no room. */}
          <p className={status?.isProblem ? 'voice-status voice-status-problem' : 'voice-status'} role="status">
            {status ? status.text : stopReason !== null && !held && <span className="voice-hint">{hint}</span>}
          </p>
          {!status && listening && mode === 'server' && (device === 'downloadable' || device === 'downloading') && (
            <button type="button" className="voice-offer" onClick={() => void install()} disabled={device === 'downloading'}>
              {device === 'downloading' ? 'Chrome downloads its speech model…' : 'Hear commands better: use speech on this device (one download)'}
            </button>
          )}
        </div>
      ) : (
        <span className="voice-off">
          Voice commands <kbd className="voice-key">{SHORTCUT}</kbd>
        </span>
      )}
      {on && timing && (
        <span className="voice-timing" title={mode === 'device' ? 'Speech on this device, with the command words' : "The browser's speech service"}>
          {mode === 'device' ? `On device · ${timing}` : timing}
        </span>
      )}
    </div>
  );
}
