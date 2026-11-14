// A pill in the nav of each demo page while NEAR AI or its Whisper model is down or slow. The
// verifier sends each recording to that Whisper, so a person sees why a voice check fails before
// they record. It asks GET /api/near-ai-status when the page opens, each minute while the page
// shows, and when the page shows again. The route checks NEAR AI at most once a minute.
//
// A person can close the pill. It stays closed for that warning until the page loads again; a
// different warning (for example "down" after "slow") shows again.

import { useEffect, useState } from 'react';
import { readNearAiStatus, warningOf, type NearAiStatus } from '../nearAiStatus';
import { NavWarning } from './NavWarning';

const POLL_MS = 60_000;

export function NearAiWarning() {
  const warning = warningOf(useNearAiStatus());
  /** The sentence of the warning that the person closed. */
  const [closed, setClosed] = useState<string | null>(null);
  if (!warning || warning.long === closed) return null;
  return <NavWarning long={warning.long} short={warning.short} onClose={() => setClosed(warning.long)} />;
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
