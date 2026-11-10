// The card in the banner of the Community Notes page: one voice signature as it happens. The
// owner says a sentence, the verifier checks the voice and the words, and the wallet signs the
// one call. It plays as a loop over real requests of the notes app. With reduced motion it shows
// the finished signature and does not move.

import { useEffect, useState } from 'react';
import { IconCheck, IconMicrophone, IconSignature } from '@tabler/icons-react';

interface Signature {
  say: string;
  call: string;
}

const SIGNATURES: Signature[] = [
  { say: 'this note is helpful', call: 'rate_note({ note_id: 2, rating: "helpful" })' },
  { say: 'this post is engagement bait and its photo claim has no proof', call: 'add_note({ post_id: 1, text, summary })' },
  { say: 'this note is not helpful', call: 'rate_note({ note_id: 5, rating: "not_helpful" })' },
];

/** How long each phase shows: the owner speaks, the voice passes, the words pass, the call is signed. */
const PHASE_MS = [1_900, 650, 650, 2_600] as const;
const LAST_PHASE = PHASE_MS.length - 1;
const BARS = [8, 16, 22, 12, 18, 9, 20, 14, 6, 17, 11, 19, 8, 13];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SignatureCard() {
  const [still] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState(still ? LAST_PHASE : 0);

  useEffect(() => {
    if (still) return;
    const timer = window.setTimeout(() => {
      if (phase === LAST_PHASE) {
        setIndex((current) => (current + 1) % SIGNATURES.length);
        setPhase(0);
      } else {
        setPhase(phase + 1);
      }
    }, PHASE_MS[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, still]);

  const signature = SIGNATURES[index] ?? SIGNATURES[0]!;
  const speaking = phase === 0;
  return (
    // The loop is decoration: a screen reader gets one fixed sentence.
    <div className="ss-sig" role="img" aria-label="Example: you say “this note is helpful”. The verifier hears that the voice is yours and that the words match. Your wallet signs that one call.">
      <div className="ss-sig-say" aria-hidden="true">
        <span className={`ss-sig-mic ${speaking ? 'ss-sig-mic-on' : ''}`}>
          <IconMicrophone size={18} stroke={1.9} />
        </span>
        <span className="ss-sig-words" key={index}>
          “{signature.say}”
        </span>
      </div>
      <div className={`ss-sig-wave ${speaking ? 'ss-sig-wave-on' : ''}`} aria-hidden="true">
        {BARS.map((height, bar) => (
          <span key={bar} style={{ height, animationDelay: `${(bar % 5) * 90}ms` }} />
        ))}
      </div>
      <div className="ss-sig-checks" aria-hidden="true">
        <span className={`ss-sig-chip ${phase >= 1 ? 'ss-sig-chip-ok' : ''}`}>
          <IconCheck size={13} stroke={2.6} /> Voice is yours
        </span>
        <span className={`ss-sig-chip ${phase >= 2 ? 'ss-sig-chip-ok' : ''}`}>
          <IconCheck size={13} stroke={2.6} /> Words match
        </span>
        <span className={`ss-sig-chip ${phase >= 3 ? 'ss-sig-chip-signed' : ''}`}>
          <IconSignature size={14} stroke={2} /> Signed
        </span>
      </div>
      <code className={`ss-sig-call ${phase >= 3 ? 'ss-sig-call-on' : ''}`} aria-hidden="true">
        {signature.call}
      </code>
    </div>
  );
}
