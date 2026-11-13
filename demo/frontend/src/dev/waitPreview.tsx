// Dev only (`pnpm dev`, then /card-wait-preview.html): the wait between a press on the voice
// button and the Wallet's card, in the real WalletDialog with the real voice button. A script
// plays the Wallet: the card has a size after `wait` ms (default 2500, the time of a note's
// summary), stays for `stay` ms (default 3000), then ends as cancelled. Nothing records and nothing signs; the card
// itself is not drawn, only the dialog's step under it.

import { StrictMode, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpeakStep, type SignPhase } from '../components/SpeakStep';
import { WalletDialog } from '../components/WalletDialog';
import { inVoiceCard } from '../signer/voiceCard';
import '../styles.css';

const params = new URLSearchParams(location.search);
const WAIT_MS = Number(params.get('wait') ?? '2500');
const STAY_MS = Number(params.get('stay') ?? '3000');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function Preview() {
  const titleId = useId();
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });
  const start = async () => {
    setPhase({ state: 'pending' });
    await inVoiceCard(async ({ presentation: card }) => {
      await sleep(WAIT_MS);
      card?.onEnter?.({ width: 480, height: 520 });
      await sleep(400);
      card?.onReady?.();
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
