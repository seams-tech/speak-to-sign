// Dev only (`pnpm dev`, then /card-wait-preview.html): the wait between a press on the voice
// button and the Wallet's card, in the real WalletDialog with the real voice button. A script
// plays the Wallet: the card has a size after `wait` ms (default 2500, the time of a note's
// summary), stays for `stay` ms (default 3000), then ends as cancelled. Nothing records and nothing signs; the card
// itself is not drawn, only the dialog's step under it.
//
// `?fail`: the first card shows a failed check and waits, as the Wallet's card does with "The
// words did not match". "Try again" by voice (pressTryAgain of src/voice/hold.ts) then sends the
// request again: the second card runs as above. <html data-sends> has the number of sends.

import { StrictMode, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpeakStep, type SignPhase } from '../components/SpeakStep';
import { WalletDialog } from '../components/WalletDialog';
import { inVoiceCard } from '../signer/voiceCard';
import '../styles.css';

const params = new URLSearchParams(location.search);
const WAIT_MS = Number(params.get('wait') ?? '2500');
const STAY_MS = Number(params.get('stay') ?? '3000');
const FAIL_FIRST = params.has('fail');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sends = 0;

function Preview() {
  const titleId = useId();
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });
  const start = async () => {
    setPhase({ state: 'pending' });
    await inVoiceCard(async ({ presentation: card }) => {
      sends += 1;
      document.documentElement.dataset.sends = String(sends);
      await sleep(WAIT_MS);
      card?.onEnter?.({ width: 480, height: 520 });
      await sleep(400);
      card?.onReady?.();
      if (FAIL_FIRST && sends === 1) {
        // The failed check: the card shows its result, and the request waits for "Try again".
        card?.onProgress?.({ stage: 'result', done: 0, total: 0 });
        await new Promise<never>(() => undefined);
      }
      await sleep(STAY_MS);
      card?.onExit?.({ kind: 'cancelled' });
    });
    setPhase({ state: 'idle' });
  };
  return (
    <WalletDialog titleId={titleId} onClose={() => undefined} locked={phase.state !== 'idle'}>
      <header className="dialog-head">
        <h2 id={titleId}>Write a Community Note</h2>
      </header>
      <div className="dialog-body">
        <label className="wn-label muted small">Your note on @Reuters</label>
        <textarea className="wn-note" rows={5} readOnly value="The post quotes a speech at COP31 that cannot be verified without the transcript." />
      </div>
      <footer className="dialog-foot">
        <SpeakStep
          phase={phase}
          buttonLabel="Sign the note with your voice"
          hint="You read a short summary of the note aloud."
          disabled={false}
          nothingTitle="Nothing was posted"
          onStart={() => void start()}
          onRetry={() => setPhase({ state: 'idle' })}
        />
      </footer>
    </WalletDialog>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
