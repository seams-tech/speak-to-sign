// The pill that stands for a minimized Wallet voice card. The card and its dialog are out of
// sight while the check and the transaction go on; the pill shows where they are, and a click
// on it brings both back. The Wallet brings the card back by itself when it needs the person
// (the result, or another try), and the pill then goes.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { WalletStepProgress } from '@seams/wallet/react';

const STAGE_TEXT: Record<WalletStepProgress['stage'], string> = {
  recording: 'Listening…',
  checking: 'Checking your voice…',
  result: 'Done',
};

export function CardPill({ progress, onOpen }: { progress: WalletStepProgress | null; onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  // The card had the focus, and its dialog is inert now: the focus moves to the pill.
  useEffect(() => button.current?.focus({ preventScroll: true }), []);
  const stage = progress?.stage ?? 'recording';
  const text = STAGE_TEXT[stage];
  // The part of the check that is over: all of it on a result. Without parts (a recording, a
  // check that just began), the bar moves to and fro.
  const share =
    stage === 'result' ? 1 : progress && progress.total > 0 ? Math.max(progress.done / progress.total, 0.08) : null;
  const parts = progress && progress.total > 0 ? `, ${progress.done} of ${progress.total} checks done` : '';
  return createPortal(
    <div className="card-pill-region">
      <button ref={button} type="button" className="card-pill" data-stage={stage} onClick={onOpen} aria-label={`Show the voice card. ${text}${parts}`}>
        <span className="card-pill-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="card-pill-text" aria-hidden="true">
          {text}
        </span>
        <span className="card-pill-bar" aria-hidden="true" data-indeterminate={share === null || undefined}>
          <span style={share === null ? undefined : { width: `${share * 100}%` }} />
        </span>
      </button>
      <span className="sr-only" role="status">
        {text}
      </span>
    </div>,
    document.body,
  );
}
