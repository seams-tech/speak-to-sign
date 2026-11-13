// The voice bar at the foot of the timeline. With the microphone on, the visitor says what the
// page must do: "show me controversial posts", "add a community note to this one", "bet one
// dollar on no on the second note". The words show while the visitor speaks, on one line after
// the sentences before them (Transcript.tsx). Each new piece of the sentence goes to the
// classifier (classify.ts), so the page moves before the sentence ends.
//
// A command that shows a tab or goes to a named post runs on an unfinished sentence. "Next
// post" and a command that opens a signing step (a note, a rating, a bet, a market) wait for
// the end of the sentence. The signature itself is the spoken request in the Seams Wallet. While
// a dialog is open, the bar hears only "close"; while a recording runs and while the tab is out
// of view, it does not listen (src/voice/hold.ts).
//
// Two sentences are for the bar itself, with or without a dialog: "what can I say?" shows the
// list of the commands above the bar, and "stop listening" turns the bar off.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import { classify } from './classify';
import { helpRequest, stopRequest, type Screen, type VoiceCommand } from './command';
import { transactionUrl } from '../config';
import { closeNewestDialog, closeRequest, NEW_TAB_STOPPED, openInNewTab, pressTryAgain, retryRequest, useShownTransaction, useVoiceHold, viewTransactionRequest } from './hold';
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
  'scroll down a little bit',
  'view transaction',
  'try again',
  'done',
  'show more',
  'show less',
  'read the note',
  'scroll to the top',
  'click the transaction link',
  'scroll up a little bit',
  'this post',
  'controversial',
  'open markets',
  'decided',
  'settled',
  'fresh',
  'for you',
  'close',
  'close the modal',
  'close the dialog',
  'what can I say',
  'help',
  'show my bets',
  'stop listening',
  'close this post',
  'cancel',
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

/** The bar's line while a dialog is open. */
const CLOSE_HINT = 'A dialog is open. Say "close" to close it.';
const RESULT_HINT = 'Say "view transaction", or "done".';

/** What "what can I say?" shows: the sentences of the page, and the sentences for an open dialog. */
const PAGE_HELP = [
  'Show me controversial posts',
  'Next post · Previous post',
  'Scroll to the second post',
  'Scroll down a little bit',
  'Scroll to the top',
  'Show more · Show less',
  'Add a community note to this one',
  'Rate this note helpful',
  'Open a market on this note',
  'Bet one dollar on no',
  'View transaction',
  'Show my bets',
  'Stop listening',
];
const DIALOG_HELP = ['Close · Done', 'Try again', 'View transaction', 'Stop listening'];

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
  const hold = useVoiceHold();
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const shownTransaction = useShownTransaction();
  const transactionRef = useRef(shownTransaction);
  transactionRef.current = shownTransaction;
  const visible = useTabVisible();
  /** The finished sentences, oldest first, and the sentence that the visitor says now. */
  const [said, setSaid] = useState<SaidSentence[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  /** How long the last sentence took to classify, and who classified it (shown on hover). */
  const [timing, setTiming] = useState<{ ms: number; by: string } | null>(null);
  /** Where the words come from now, and the state of Chrome's on-device model. */
  const [mode, setMode] = useState<ListenMode | null>(null);
  const [device, setDevice] = useState<DeviceSpeech | null>(null);
  /** A new value starts the listener again: after the model is installed. */
  const [restart, setRestart] = useState(0);
  /** Why the microphone cannot listen. The bar then takes typed commands. */
  const [stopReason, setStopReason] = useState<string | null>(() => (canListen() ? null : 'unsupported'));
  const [typed, setTyped] = useState('');
  /** True while the list of the commands shows: from "what can I say?" to the next sentence. */
  const [help, setHelp] = useState(false);

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
    // A sentence for the bar itself, with or without a dialog. It waits for its end, and goes to no classifier.
    const asksHelp = helpRequest(text);
    if (asksHelp || stopRequest(text)) {
      if (!final) return;
      request.current?.abort();
      setTiming(null);
      setStatus(null);
      if (asksHelp) setHelp(true);
      else toggleRef.current();
      return;
    }
    // The list of the commands goes with the next sentence.
    if (final) setHelp(false);
    // A dialog is open: only "close" counts, and the words go to no classifier.
    if (holdRef.current !== null) {
      if (!final) return;
      // The page's own rule, with no classifier: no time to show.
      setTiming(null);
      if (viewTransactionRequest(text)) {
        const hash = transactionRef.current;
        if (hash === null) setStatus({ text: 'This dialog shows no transaction.', isProblem: true });
        else setStatus(openInNewTab(transactionUrl(hash)) ? null : { text: NEW_TAB_STOPPED, isProblem: true });
        return;
      }
      if (retryRequest(text)) {
        setStatus(pressTryAgain() ? null : { text: 'This dialog has no "Try again" now.', isProblem: true });
        return;
      }
      if (!closeRequest(text)) setStatus({ text: transactionRef.current === null ? CLOSE_HINT : RESULT_HINT, isProblem: false });
      else if (closeNewestDialog()) setStatus(null);
      else setStatus({ text: 'The dialog cannot close while the Wallet works. Say "close" on its result.', isProblem: true });
      return;
    }
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
      const timed = { ms: result.ms, by: result.by === 'jev' ? 'JEV' : 'word rules' };
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

  // A dialog that opens or closes, or a recording, makes the last sentence's line old, and the list too.
  useEffect(() => {
    setStatus(null);
    setHelp(false);
  }, [hold]);

  // A tab that comes back into view tries again: the tab that held the speech service can be gone.
  useEffect(() => {
    if (visible) setStopReason((reason) => (reason === 'busy' ? null : reason));
  }, [visible]);

  const listening = on && hold !== 'recording' && visible && stopReason === null;
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
    setHelp(false);
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

  const hint =
    hold === 'recording'
      ? 'Paused while the Wallet listens.'
      : stopReason !== null
        ? (STOP_REASONS[stopReason] ?? 'The microphone stopped. Type the command.')
        : hold === 'dialog'
          ? shownTransaction === null
            ? CLOSE_HINT
            : RESULT_HINT
          : 'Say: "show me controversial posts", or "what can I say?".';

  // The hint goes under the typed field, and under the words while a hold is on. With no words,
  // the line of words shows it.
  const showHint = (stopReason !== null && hold === null) || (hold !== null && (said.length > 0 || live !== null));

  return (
    <div className={on ? 'voice-bar voice-bar-on' : 'voice-bar'} role="region" aria-label="Voice commands">
      {on && help && (
        <div className="voice-help" role="status">
          <p className="voice-help-title">You can say</p>
          <ul className="voice-help-list">
            {(hold === 'dialog' ? DIALOG_HELP : PAGE_HELP).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className={listening ? 'voice-mic voice-mic-live' : 'voice-mic'}
        aria-pressed={on}
        aria-label={on ? 'Turn voice commands off' : 'Turn voice commands on'}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${on ? 'Turn voice commands off' : 'Turn voice commands on'} (${SHORTCUT})`}
        onClick={toggle}
      >
        {on ? <IconMicrophone size={24} stroke={1.9} aria-hidden="true" /> : <IconMicrophoneOff size={24} stroke={1.9} aria-hidden="true" />}
      </button>
      {on ? (
        <div className="voice-main">
          {stopReason !== null && hold === null ? (
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
            {status ? status.text : showHint && <span className="voice-hint">{hint}</span>}
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
        <span
          className="voice-timing"
          title={`${timing.by}, ${mode === 'device' ? 'speech on this device, with the command words' : "the browser's speech service"}`}
        >
          {timing.ms} ms
        </span>
      )}
    </div>
  );
}
