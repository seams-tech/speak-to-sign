// Dev only (`pnpm dev`, then /card-flow-preview.html?flow=note&view=result): one state of the
// Seams Wallet voice card in the demo's dialog, for a review of the modal flow before a release.
// The real card runs in the Wallet frame; this page runs the card of the local
// packages/voice-capture build (served at /__voice-capture/), with the demo's Wallet theme and
// the views that the Wallet shows (copied from seams-wallet core/transactionFeatures/approver/
// card.ts). Nothing records for real and nothing signs.
//
// - `flow`: `note` (a community note, with the note above the sentence), `bet` (a market bet) or
//   `transaction` (a general transaction to an implicit account, whose name is 64 characters).
// - `view`: `prompt` (the card records), `checking`, `sending`, `result` (with the TEE receipt)
//   or `failure` (the words did not match).
// - `theme=dark`: Lights out.
// - `account=long`: the `transaction` caption names the full 64-character account.
// - `norecord`: do not wait for a recording (for a browser with no microphone).
// - `voice`: the voice bar is on the page, and it gets the card as the Wallet dialog gives it
//   (showCard). "Try again", "back", "minimize", "maximize" and "close" then press the card's
//   own controls through its `remote` hook. After "Try again" the card records again, and the
//   failed check shows again.
// - `play` (with `voice`): for a browser with no microphone. The page plays the speech
//   recognition (`window.__say('try again')` is one spoken sentence) and gives the card a silent
//   microphone, so a recording ends as "too brief or quiet", with "Try again" on the prompt.
// The page sets `data-flow-ready` on <html> when the view shows.

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../components/Modal';
import type { ThemeName } from '../showcase/theme';
import { showCard, useHoldVoice, type CardPress, type ShownCard } from '../voice/hold';
import { VoiceBar } from '../voice/VoiceBar';
import { cardThemeVariables } from './cardTheme';
import '../styles.css';

const BASE = '/__voice-capture/';

type Flow = 'note' | 'bet' | 'transaction';
type View = 'prompt' | 'checking' | 'sending' | 'result' | 'failure';

interface Surface {
  record(): Promise<unknown>;
  show(view: unknown): Promise<string>;
  close(): void;
}
interface CardModule {
  openPhraseCard(input: unknown): Surface;
}
interface CaptureModule {
  configureVoiceCapture(options: { assetBase: string }): void;
}

const params = new URLSearchParams(location.search);
const asked = params.get('flow');
const flow: Flow = asked === 'bet' || asked === 'transaction' ? asked : 'note';
const view = (params.get('view') ?? 'prompt') as View;
const theme: ThemeName = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

/** An implicit NEAR account: 64 hex characters with no place to break a line. */
const IMPLICIT_ACCOUNT = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520df9b1a4c7e55';

const NOTE =
  'The claim that a team won a state championship through cheating is an unverified allegation that readers cannot confirm from the text alone.';

/** What each flow says and shows: the sentence, the card's context, and its result. */
const FLOWS = {
  note: {
    sentence: 'The claim of cheating is unverified and cannot be confirmed',
    context: { label: 'Your note', text: NOTE },
    headline: 'Note posted',
    caption: '“The claim of cheating is unverified and cannot be confirmed”',
    done: 'posted',
    seconds: '25.6',
    heard: ['We heard “', { mark: 'a' }, ' claim of cheating is unverified and cannot be confirmed”'],
  },
  bet: {
    sentence: 'Bet 0.5 USDC yes on market 12',
    context: undefined,
    headline: 'Bet placed',
    caption: 'Bet 0.5 USDC yes on market 12',
    done: 'placed',
    seconds: '9.8',
    heard: ['We heard “Bet 0.5 USDC ', { mark: 'no' }, ' on market 12”'],
  },
  transaction: {
    sentence: 'Create a prediction market on this note',
    context: undefined,
    headline: 'Transaction sent',
    // The Wallet's caption, as its flow.ts writes it for this account.
    caption: params.get('account') === 'long' ? `To ${IMPLICIT_ACCOUNT}` : 'To 3e2210…20df',
    done: 'sent',
    seconds: '11.6',
    heard: ['We heard “Create a prediction market on ', { mark: 'his' }, ' note”'],
  },
} as const;

/** The six segments of the Wallet's line: the recording, the four checks, the transaction. */
type Segment = 'idle' | 'run' | 'done' | 'fail' | 'skip';

/** The views of seams-wallet approver/card.ts for this flow. */
function walletView(name: Exclude<View, 'prompt'>): unknown {
  const copy = FLOWS[flow];
  switch (name) {
    case 'checking':
      return {
        kind: 'check',
        label: 'Checking',
        caption: 'Checking what you said',
        details: [
          'ReDimNet · Intel TDX CVM on Phala',
          'Whisper large-v3 · NEAR AI Cloud',
          'JEV policy',
          'Signed by the OutLayer TEE verifier',
        ],
        segments: ['done', 'run', 'run', 'run', 'run', 'idle'] satisfies Segment[],
      };
    case 'sending':
      return {
        kind: 'check',
        label: 'Checking',
        caption: 'Sending from your account',
        details: ['Signed by your Seams Wallet · NEAR testnet'],
        segments: ['done', 'done', 'done', 'done', 'done', 'run'] satisfies Segment[],
      };
    case 'result':
      return {
        kind: 'result',
        label: '',
        headline: copy.headline,
        caption: copy.caption,
        receipt: {
          title: 'TEE receipt',
          source: 'Intel TDX · OutLayer',
          rows: [
            { label: 'Voice', value: 'matched 10d3ca…25f5' },
            { label: 'Words', value: flow === 'note' ? 'matched the summary' : 'matched the sentence' },
            ...(flow === 'note' ? [{ label: 'Summary', value: 'fits the note (JEV)' }] : []),
            { label: 'Verdict', value: 'signed by the OutLayer verifier 0.14.1' },
          ],
          link: { text: 'View TDX quote', href: 'https://testnet-api.outlayer.ai/attestations/by-call/357b87bb-c366-4327-8f09-eff79a722877' },
        },
        detail: `Checked and ${copy.done} in ${copy.seconds} s ·`,
        link: { text: 'View transaction', href: 'https://testnet.nearblocks.io/' },
        action: { label: 'Done' },
        line: 'seal',
      };
    case 'failure':
      return {
        kind: 'result',
        label: 'Nothing was sent',
        headline: 'The words did not match',
        caption: copy.heard,
        detail: 'Read the sentence again, word for word.',
        action: { label: 'Try again', retry: true },
        line: ['done', 'done', 'fail', 'skip', 'skip', 'skip'] satisfies Segment[],
      };
  }
}

const WITH_VOICE = params.has('voice');

if (WITH_VOICE && params.has('play')) playMicrophone();

/** A speech recognition that hears what `__say` gives it, and a microphone with no sound. */
function playMicrophone(): void {
  type Played = { onresult: ((event: unknown) => void) | null; onaudiostart: (() => void) | null };
  let listening: Played | null = null;
  class PlayedRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onaudiostart: (() => void) | null = null;
    onend: (() => void) | null = null;
    start(): void {
      listening = this;
      setTimeout(() => this.onaudiostart?.(), 0);
    }
    abort(): void {
      if (listening === this) listening = null;
    }
  }
  const scope = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown; __say: (text: string) => void };
  scope.SpeechRecognition = PlayedRecognition;
  scope.webkitSpeechRecognition = PlayedRecognition;
  scope.__say = (text) => listening?.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
  const silence = async (): Promise<MediaStream> => {
    const context = new AudioContext();
    const out = context.createMediaStreamDestination();
    context.createGain().connect(out);
    return out.stream;
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: silence, enumerateDevices: async () => [], addEventListener: () => undefined, removeEventListener: () => undefined } });
}

function Preview() {
  const host = useRef<HTMLDivElement>(null);
  // The card's state for the voice bar, as WalletDialog keeps it for the Wallet's card.
  const [stage, setStage] = useState<ShownCard['stage'] | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  // The card shows the failed check, with its "Try again".
  const [failed, setFailed] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const press = useRef<((control: CardPress) => boolean) | null>(null);
  useHoldVoice(WITH_VOICE && stage === 'recording' ? 'recording' : null);
  useEffect(() => {
    if (!WITH_VOICE || stage === null || pressed !== null) return undefined;
    showCard({
      stage,
      canRetry: stage === 'waiting' || failed,
      restore: minimized ? () => setMinimized(false) : null,
      press: (control) => void press.current?.(control),
    });
    return () => showCard(null);
  }, [stage, minimized, pressed, failed]);
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const stop = new AbortController();
    void (async () => {
      const [{ openPhraseCard }, { configureVoiceCapture }] = (await Promise.all([
        import(/* @vite-ignore */ `${BASE}browser/card.js`),
        import(/* @vite-ignore */ `${BASE}browser/index.js`),
      ])) as [CardModule, CaptureModule];
      if (stop.signal.aborted) return;
      configureVoiceCapture({ assetBase: `${BASE}assets/` });
      const copy = FLOWS[flow];
      // As the Wallet opens it in the demo's dialog: it records at once, with Back, Close and
      // Minimize, and the note above the sentence for a note.
      const surface = openPhraseCard({
        sentence: copy.sentence,
        signal: stop.signal,
        detector: 'level',
        // With `norecord` and a view, no recording runs under the view.
        autoStart: view === 'prompt' || !params.has('norecord'),
        ...(copy.context ? { context: copy.context } : {}),
        frame: {
          parent,
          controls: 'back_and_close',
          minimized: (hidden: boolean) => setMinimized(hidden),
          progressed: (progress: { stage: ShownCard['stage'] }) => setStage(progress.stage),
          pressed: (control: string) => setPressed(control),
          remote: (run: (control: CardPress) => boolean) => {
            press.current = run;
          },
        },
      });
      const recorded = surface.record();
      if (view === 'prompt') {
        document.documentElement.dataset.flowReady = 'true';
        return;
      }
      // `norecord`: a browser with no microphone (a headless check) shows the view at once.
      if (!params.has('norecord')) await recorded;
      else void recorded.catch(() => undefined);
      document.documentElement.dataset.flowReady = 'true';
      // As the Wallet does: "Try again" on a failed check records again, then the check shows.
      for (;;) {
        setFailed(view === 'failure');
        const choice = await surface.show(walletView(view));
        setFailed(false);
        if (choice !== 'action' || view !== 'failure' || stop.signal.aborted) return;
        await surface.record();
      }
    })();
    return () => stop.abort();
  }, []);
  return (
    // Bare, as on the site: there the dialog takes the size of the Wallet's card and has no
    // surface of its own while the card shows (WalletDialog, `pinned`), so the card is the only layer.
    <Modal labelledBy="flow-title" onClose={() => undefined} locked bare>
      <h2 id="flow-title" className="sr-only">
        Voice card
      </h2>
      <div
        ref={host}
        className="card-preview-host"
        style={{ ...cardThemeVariables(theme), padding: '8px 0', visibility: minimized ? 'hidden' : undefined }}
        data-theme={theme}
      />
      {pressed !== null && <p className="muted small">The card ended: the person pressed {pressed}.</p>}
      {WITH_VOICE && <VoiceBar on={voiceOn} onToggle={setVoiceOn} screen={() => ({ posts: [], focusedPostId: null })} onCommand={() => null} onTarget={() => undefined} />}
    </Modal>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
