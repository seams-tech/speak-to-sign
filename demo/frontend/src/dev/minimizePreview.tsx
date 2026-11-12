// Dev only (`pnpm dev`, then /card-minimize-preview.html): the voice card's Minimize in the
// demo's dialog, before the Wallet ships it. The real card runs in the Wallet frame; this page
// runs the card of the local packages/voice-capture build (served at /__voice-capture/ by the
// dev server) in the page, in the demo's Modal, with the demo's Wallet theme and the pill of
// WalletDialog. A script plays the check and the result, so nothing records and nothing signs.
// `?theme=dark` shows Lights out.

import { StrictMode, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { WalletStepProgress } from '@seams/wallet/react';
import { CardPill } from '../components/CardPill';
import { Modal } from '../components/Modal';
import { WALLET_THEMES } from '../seams/walletTheme';
import type { ThemeName } from '../showcase/theme';
import '../styles.css';

const BASE = '/__voice-capture/';
const SENTENCE = 'this claim needs a source';
const NOTE = 'The photo is from 2019, not from this week. The original post is linked below.';
const CHECK_PARTS = 5;
const STEP_MS = 1_400;
/** The time that the prompt shows before the scripted check starts. */
const PROMPT_MS = 3_000;

type Stage = 'recording' | 'checking' | 'result';
type Segment = 'idle' | 'run' | 'done';

/** The parts of the card's API that this page uses. */
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

const theme: ThemeName = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

/** The Wallet theme as the CSS variables that the card reads. */
function themeVariables(): CSSProperties {
  const { colors = {}, shape = {} } = WALLET_THEMES[theme] as { colors?: object; shape?: object };
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) variables[`--seams-colors-${name}`] = String(value);
  for (const [name, value] of Object.entries(shape)) variables[`--seams-shape-${name}`] = String(value);
  return variables as CSSProperties;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

function segments(done: number): Segment[] {
  return Array.from({ length: CHECK_PARTS }, (_, index) => (index < done ? 'done' : index === done ? 'run' : 'idle'));
}

function Preview() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [progress, setProgress] = useState<WalletStepProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((lines) => [...lines, line]);
  return (
    <main style={{ maxWidth: 600, margin: '40px auto', padding: '0 16px', fontFamily: 'var(--font)', color: 'var(--ink)' }}>
      <h1 style={{ fontSize: 20 }}>Voice card: Minimize</h1>
      <p style={{ color: 'var(--muted)' }}>
        Write a note by voice. Press Minimize (the line beside Close) while the card listens, checks or shows the
        result. The pill shows the progress; a click on it opens the card again. The result opens it by itself.
      </p>
      <button type="button" className="btn btn-dark" onClick={() => setOpen(true)} disabled={open}>
        Write a note by voice
      </button>
      <ol aria-label="Events" style={{ color: 'var(--muted)', fontSize: 13 }}>
        {log.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
      {/* Page content under the pill, so the page shows that it scrolls and takes clicks. */}
      <div style={{ height: 1200 }} />
      {open && (
        <Modal labelledBy="preview-title" onClose={() => setOpen(false)} locked minimized={minimized}>
          <h2 id="preview-title" className="sr-only">
            Say the sentence in the voice card
          </h2>
          <PreviewCard
            onMinimized={(value) => {
              setMinimized(value);
              note(value ? 'minimized' : 'the card asked to show again');
            }}
            onProgress={(next) => {
              setProgress(next);
              note(`stage: ${next.stage}${next.total ? ` ${next.done}/${next.total}` : ''}`);
            }}
            onEnd={(how) => {
              note(`ended: ${how}`);
              setMinimized(false);
              setProgress(null);
              setOpen(false);
            }}
          />
        </Modal>
      )}
      {open && minimized && (
        <CardPill
          progress={progress}
          onOpen={() => {
            setMinimized(false);
            note('restored from the pill');
          }}
        />
      )}
    </main>
  );
}

function PreviewCard({
  onMinimized,
  onProgress,
  onEnd,
}: {
  onMinimized: (minimized: boolean) => void;
  onProgress: (progress: WalletStepProgress) => void;
  onEnd: (how: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const events = useRef({ onMinimized, onProgress, onEnd });
  events.current = { onMinimized, onProgress, onEnd };

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
      const surface = openPhraseCard({
        sentence: SENTENCE,
        signal: stop.signal,
        detector: 'level',
        context: { label: 'Your note on @alice', text: NOTE, sentenceLabel: 'Read this aloud to post' },
        frame: {
          parent,
          controls: 'back_and_close',
          minimized: (value: boolean) => events.current.onMinimized(value),
          progressed: (progress: { stage: Stage; done: number; total: number }) => events.current.onProgress(progress),
        },
      });
      // A press on Back or Close ends the recording as cancelled.
      void surface.record().then((recording) => {
        if ((recording as { kind?: string }).kind === 'cancelled' && !stop.signal.aborted) {
          stop.abort();
          surface.close();
          events.current.onEnd('Back or Close');
        }
      });
      events.current.onProgress({ stage: 'recording', done: 0, total: 0 });
      try {
        await sleep(PROMPT_MS, stop.signal);
        for (let done = 0; done < CHECK_PARTS; done += 1) {
          void surface.show({
            kind: 'check',
            label: 'Checking your voice',
            caption: 'Checking the recording',
            details: ['Matching your voice', 'Checking the summary against the note', 'Sending the note'],
            segments: segments(done),
          });
          await sleep(STEP_MS, stop.signal);
        }
        const choice = await surface.show({
          kind: 'result',
          label: '',
          headline: 'Note posted',
          caption: 'Your voice matched, and the note is on chain.',
          detail: '',
          action: { label: 'Done' },
          line: 'seal',
        });
        stop.abort();
        surface.close();
        events.current.onEnd(choice === 'action' ? 'Done' : 'closed');
      } catch {
        surface.close();
      }
    })();
    return () => stop.abort();
  }, []);

  return <div ref={host} className="card-preview-host" style={{ ...themeVariables(), padding: '8px 0' }} data-theme={theme} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
