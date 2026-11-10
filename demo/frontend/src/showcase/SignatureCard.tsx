// The card in the hero of the Community Notes page: one voice signature as it happens, in the
// look of the real Seams Wallet voice card (the same card as WalletVoiceCard in frame.tsx). The
// owner says the sentence, the verifier checks the voice and the words, and the wallet signs
// the one call. It plays as a loop over real requests of the notes app. The card keeps one
// size through every step. With reduced motion it shows the finished signature and does not
// move.

import { useEffect, useState } from 'react';
import { IconCheck, IconLock, IconMicrophone, IconPlayerRecordFilled } from '@tabler/icons-react';
import { Waveform } from './frame';

interface Signature {
  say: string;
  /** What the wallet signs, as the contract call. */
  call: string;
}

const SIGNATURES: Signature[] = [
  { say: 'this note is helpful', call: 'rate_note({ note_id: 2, rating: "helpful" })' },
  { say: 'this post gives numbers with no source', call: 'add_note({ post_id, text, summary })' },
  { say: 'this note is not helpful', call: 'rate_note({ note_id: 5, rating: "not_helpful" })' },
];

/** The steps of one signature, and how long each shows. */
const PHASES = ['listening', 'voice', 'words', 'signed'] as const;
type Phase = (typeof PHASES)[number];
const PHASE_MS: Record<Phase, number> = { listening: 2_200, voice: 750, words: 750, signed: 2_800 };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SignatureCard() {
  const [still] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(still ? PHASES.length - 1 : 0);
  const phase = PHASES[step] ?? 'signed';

  useEffect(() => {
    if (still) return;
    const timer = window.setTimeout(() => {
      if (step === PHASES.length - 1) {
        setIndex((current) => (current + 1) % SIGNATURES.length);
        setStep(0);
      } else {
        setStep(step + 1);
      }
    }, PHASE_MS[phase]);
    return () => window.clearTimeout(timer);
  }, [step, phase, still]);

  const signature = SIGNATURES[index] ?? SIGNATURES[0]!;
  const listening = phase === 'listening';
  const signed = phase === 'signed';
  return (
    // The loop is decoration: a screen reader gets one fixed sentence.
    <div
      className="sw-card ss-sig"
      data-phase={phase}
      role="img"
      aria-label="Example of the Seams Wallet voice card: you say “this note is helpful”. The verifier hears that the voice is yours and that the words match. Your wallet signs that one call."
    >
      <div className="sw-origin" aria-hidden="true">
        <IconLock size={12} stroke={2} />
        sign.seams.sh
      </div>
      <div className="sw-title" aria-hidden="true">
        <span className="sw-mic">
          <IconMicrophone size={17} stroke={2} />
        </span>
        <span>
          <b>Say this to sign</b>
          <span className="sw-sub">Speak-to-Sign · VoiceID</span>
        </span>
      </div>
      <p className="sw-say ss-sig-say" aria-hidden="true">
        <span key={index} className="ss-sig-words">
          “{signature.say}”
        </span>
      </p>
      <div className="ss-sig-wave" aria-hidden="true">
        <Waveform small />
      </div>
      <ul className="ss-sig-checks" aria-hidden="true">
        <li className={step >= 1 ? 'ss-sig-check ss-sig-check-ok' : 'ss-sig-check'}>
          <span className="ss-sig-dot">
            <IconCheck size={11} stroke={3.4} />
          </span>
          Voice is yours
        </li>
        <li className={step >= 2 ? 'ss-sig-check ss-sig-check-ok' : 'ss-sig-check'}>
          <span className="ss-sig-dot">
            <IconCheck size={11} stroke={3.4} />
          </span>
          Words match
        </li>
      </ul>
      {/* One bar, three states: it records, it checks, it has signed. */}
      <div className="sw-btn ss-sig-bar" aria-hidden="true">
        {listening && (
          <span className="ss-sig-state">
            <IconPlayerRecordFilled size={13} className="ss-sig-rec" /> Recording
          </span>
        )}
        {(phase === 'voice' || phase === 'words') && (
          <span className="ss-sig-state">
            <span className="ss-sig-spin" /> Checking the voice and the words
          </span>
        )}
        {signed && (
          <span className="ss-sig-state">
            <IconCheck size={15} stroke={3} /> Signed
          </span>
        )}
      </div>
      <code className="ss-sig-call" aria-hidden="true">
        {signature.call}
      </code>
      <p className="sw-foot" aria-hidden="true">
        Secured by <b>seams</b>
      </p>
    </div>
  );
}
