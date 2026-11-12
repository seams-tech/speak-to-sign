// A pill in the nav of each demo page while NEAR AI or its Whisper model is down or slow. The
// verifier sends each recording to that Whisper, so a person sees why a voice check fails before
// they record. It asks GET /api/near-ai-status when the page opens, each minute while the page
// shows, and when the page shows again. The route checks NEAR AI at most once a minute.
//
// A wide nav shows the sentence, a middle one the short words, and a phone the icon only: a tap
// on the icon opens the sentence under the nav (nearAiWarning.css).
//
// A person can close the pill. It stays closed for that warning until the page loads again; a
// different warning (for example "down" after "slow") shows again.

import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconX } from '@tabler/icons-react';
import { readNearAiStatus, warningOf, type NearAiStatus } from '../nearAiStatus';
import './nearAiWarning.css';

const POLL_MS = 60_000;

export function NearAiWarning() {
  const warning = warningOf(useNearAiStatus());
  const [open, setOpen] = useState(false);
  /** The sentence of the warning that the person closed. */
  const [closed, setClosed] = useState<string | null>(null);
  if (!warning || warning.long === closed) return null;
  const close = (
    <button type="button" className="nearai-warning-close" aria-label="Close this warning" onClick={() => setClosed(warning.long)}>
      <IconX size={14} stroke={2.2} aria-hidden="true" />
    </button>
  );
  return (
    <span className="nearai-warning" data-level={warning.level} data-open={open || undefined}>
      <span className="nearai-warning-pill">
        <button type="button" className="nearai-warning-words" title={warning.long} aria-expanded={open} onClick={() => setOpen(!open)}>
          <IconAlertTriangle size={15} stroke={2} aria-hidden="true" />
          <span className="nearai-warning-long" role="status">
            {warning.long}
          </span>
          <span className="nearai-warning-short" aria-hidden="true">
            {warning.short}
          </span>
        </button>
        {close}
      </span>
      <span className="nearai-warning-pop">
        <span aria-hidden="true">{warning.long}</span>
        {close}
      </span>
    </span>
  );
}

/** The last status that the route gave, or null before the first answer and when the route fails. */
function useNearAiStatus(): NearAiStatus | null {
  const [status, setStatus] = useState<NearAiStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch('/api/near-ai-status');
        const next = response.ok ? readNearAiStatus(await response.json()) : null;
        if (!stopped) setStatus(next);
      } catch {
        if (!stopped) setStatus(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return status;
}
