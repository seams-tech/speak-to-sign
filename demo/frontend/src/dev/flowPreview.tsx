// Dev only (`pnpm dev`, then /card-flow-preview.html?flow=note&view=result): one state of the
// Seams Wallet voice card in the demo's dialog, for a review of the modal flow before a release.
// The real card runs in the Wallet frame; this page runs the card of the local
// packages/voice-capture build (served at /__voice-capture/), with the demo's Wallet theme and
// the views that the Wallet shows (copied from seams-wallet core/transactionFeatures/approver/
// card.ts). Nothing records for real and nothing signs.
//
// - `flow`: `note` (a community note, with the note above the sentence) or `bet` (a market bet).
// - `view`: `prompt` (the card records), `checking`, `sending`, `result` (with the TEE receipt)
//   or `failure` (the words did not match).
// - `theme=dark`: Lights out.
// The page sets `data-flow-ready` on <html> when the view shows.

import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../components/Modal';
import type { ThemeName } from '../showcase/theme';
import { cardThemeVariables } from './cardTheme';
import '../styles.css';

const BASE = '/__voice-capture/';

type Flow = 'note' | 'bet';
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
const flow: Flow = params.get('flow') === 'bet' ? 'bet' : 'note';
const view = (params.get('view') ?? 'prompt') as View;
const theme: ThemeName = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

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
        action: { label: 'Try again' },
        line: ['done', 'done', 'fail', 'skip', 'skip', 'skip'] satisfies Segment[],
      };
  }
}

function Preview() {
  const host = useRef<HTMLDivElement>(null);
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
        autoStart: true,
        ...(copy.context ? { context: copy.context } : {}),
        frame: { parent, controls: 'back_and_close', minimized: () => undefined, progressed: () => undefined },
      });
      const recorded = surface.record();
      if (view === 'prompt') {
        document.documentElement.dataset.flowReady = 'true';
        return;
      }
      await recorded;
      void surface.show(walletView(view));
      document.documentElement.dataset.flowReady = 'true';
    })();
    return () => stop.abort();
  }, []);
  return (
    <Modal labelledBy="flow-title" onClose={() => undefined} locked>
      <h2 id="flow-title" className="sr-only">
        Voice card
      </h2>
      <div ref={host} className="card-preview-host" style={{ ...cardThemeVariables(theme), padding: '8px 0' }} data-theme={theme} />
    </Modal>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
