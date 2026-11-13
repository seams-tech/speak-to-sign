// The pill that stands for a minimized Wallet voice card. The card and its dialog are out of
// sight while the check and the transaction go on; the pill shows where they are. Its main part
// and Maximize bring both back, and Close ends the card and its dialog, as the card's own Close
// does. The Wallet brings the card back by itself when it needs the person (the result, or
// another try), and the pill then goes.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowsMaximize, IconX } from '@tabler/icons-react';
import type { WalletStepProgress } from '@seams/wallet/react';
import { BrandMark } from './BrandMark';

const STAGE_TEXT: Record<WalletStepProgress['stage'], string> = {
  waiting: 'Waiting for you…',
  recording: 'Listening…',
  checking: 'Checking what you said…',
  result: 'Done',
};

export function CardPill({
  progress,
  onOpen,
  onClose,
}: {
  progress: WalletStepProgress | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const open = useRef<HTMLButtonElement>(null);
  // The card had the focus, and its dialog is inert now: the focus moves to the pill.
  useEffect(() => open.current?.focus({ preventScroll: true }), []);
  const stage = progress?.stage ?? 'recording';
  const text = STAGE_TEXT[stage];
  // The card hides its own Close while the Wallet checks and signs, so the pill does too.
  const closable = stage !== 'checking';
  // The part of the check that is over: all of it on a result. Without parts (a recording, a
  // check that just began), the bar moves to and fro.
  const share =
    stage === 'result' ? 1 : progress && progress.total > 0 ? Math.max(progress.done / progress.total, 0.08) : null;
  const parts = progress && progress.total > 0 ? `, ${progress.done} of ${progress.total} checks done` : '';
  return createPortal(
    <div className="card-pill-region">
      <div className="card-pill" data-stage={stage}>
        <button ref={open} type="button" className="card-pill-open" onClick={onOpen} aria-label={`Show the voice card. ${text}${parts}`}>
          <span className="card-pill-icon" aria-hidden="true">
            <BrandMark size={22} />
          </span>
          <span className="card-pill-text" aria-hidden="true">
            {text}
          </span>
        </button>
        <span className="card-pill-actions">
          <button type="button" className="card-pill-action" onClick={onOpen} aria-label="Maximize the voice card" title="Maximize">
            <IconArrowsMaximize size={16} stroke={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="card-pill-action"
            onClick={onClose}
            disabled={!closable}
            aria-label="Close the voice card"
            title={closable ? 'Close' : 'The Wallet is checking and signing. Close when it is done.'}
          >
            <IconX size={16} stroke={2} aria-hidden="true" />
          </button>
        </span>
        <span className="card-pill-bar" aria-hidden="true" data-indeterminate={share === null || undefined}>
          <span style={share === null ? undefined : { width: `${share * 100}%` }} />
        </span>
      </div>
      <span className="sr-only" role="status">
        {text}
      </span>
    </div>,
    document.body,
  );
}
