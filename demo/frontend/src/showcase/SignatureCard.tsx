// The card in the hero of the Community Notes page: the notes app's own "Write a Community Note"
// dialog, as it goes through one voice signature. It uses the dialog's own classes
// (src/styles.css), so it is the same component to the eye. The note types itself in, then the
// sentence; the voice button is pressed; the wallet listens, the verifier checks the voice and
// the words, and the note is signed. It plays as a loop over three posts of the timeline. The
// card keeps one size through every step. With reduced motion it shows the signed note and does
// not move. Nothing in it takes a click: the real dialog opens from a post.

import { useEffect, useState } from 'react';
import { IconCheck, IconMicrophone, IconX } from '@tabler/icons-react';

interface Sample {
  handle: string;
  note: string;
  say: string;
}

const SAMPLES: Sample[] = [
  {
    handle: 'MySportsUpdate',
    note: 'The two lists cover different spans: 2 games for Chase and 5 games for Jefferson. So the totals do not compare the players fairly.',
    say: 'these numbers compare two games with five games',
  },
  {
    handle: 'TheresaCampagna',
    note: 'The post says that James Gunn was fired and links only a commentary video. It gives no statement from the studio.',
    say: 'this firing claim has no statement from the studio',
  },
  {
    handle: 'TJWalkerRadio',
    note: 'This is one person’s report of what other people said about crowd noise. It names no game and no recording.',
    say: 'this is hearsay about crowd noise with no proof',
  },
];

/** The steps of one loop. `note` and `say` type the two texts in; their time follows the text. */
const STEPS = ['note', 'say', 'ready', 'press', 'listen', 'voice', 'words', 'signed'] as const;
type Step = (typeof STEPS)[number];
const STEP_MS: Record<Exclude<Step, 'note' | 'say'>, number> = { ready: 900, press: 420, listen: 2_100, voice: 700, words: 700, signed: 2_900 };
const NOTE_TYPE_MS = 1_000;
const TICK_MS = 16;
const SAY_STEP_MS = 26;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SignatureCard() {
  const [still] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>(still ? 'signed' : 'note');
  // How many letters of the text of the current step show.
  const [shown, setShown] = useState(0);
  const sample = SAMPLES[index] ?? SAMPLES[0]!;

  useEffect(() => {
    if (still) return;
    if (step === 'note' || step === 'say') {
      const length = [...(step === 'note' ? sample.note : sample.say)].length;
      if (shown >= length) {
        setShown(0);
        setStep(step === 'note' ? 'say' : 'ready');
        return;
      }
      const stride = step === 'note' ? Math.max(1, Math.ceil(length / (NOTE_TYPE_MS / TICK_MS))) : 1;
      const timer = window.setTimeout(() => setShown(Math.min(length, shown + stride)), step === 'note' ? TICK_MS : SAY_STEP_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      if (step === 'signed') {
        setIndex((current) => (current + 1) % SAMPLES.length);
        setShown(0);
        setStep('note');
      } else {
        setStep(STEPS[STEPS.indexOf(step) + 1] ?? 'signed');
      }
    }, STEP_MS[step]);
    return () => window.clearTimeout(timer);
  }, [step, shown, still, sample]);

  const at = STEPS.indexOf(step);
  const note = step === 'note' ? [...sample.note].slice(0, shown).join('') : sample.note;
  const say = step === 'note' ? '' : step === 'say' ? sample.say.slice(0, shown) : sample.say;
  const checking = step === 'voice' || step === 'words';
  const foot =
    step === 'note'
      ? { title: 'Read it aloud to post', hint: 'Filling in the note…' }
      : step === 'say'
        ? { title: 'Read it aloud to post', hint: 'Filling in the sentence…' }
        : step === 'ready' || step === 'press'
          ? { title: 'Read it aloud to post', hint: 'Your voice signs the note. No confirm tap.' }
          : step === 'listen'
            ? { title: 'Listening…', hint: `Say: “${sample.say}”` }
            : checking
              ? { title: 'Checking the voice and the words', hint: step === 'voice' ? 'Voice is yours…' : 'Voice is yours. Words match…' }
              : { title: 'Note signed and submitted', hint: 'Voice is yours. Words match. No confirm tap.' };

  return (
    // The loop is decoration: a screen reader gets one fixed sentence.
    <div
      className="dialog ss-wn"
      data-step={step}
      role="img"
      aria-label="Example of the notes app: a Community Note and the short sentence to read aloud. You press the voice button and say the sentence. The verifier hears that the voice is yours and that the words match, and your wallet signs the note."
    >
      <div className="ss-wn-inner" aria-hidden="true">
        <header className="dialog-head">
          <span className="icon-btn">
            <IconX size={20} />
          </span>
          <h2>Write a Community Note</h2>
        </header>
        <div className="dialog-body">
          <span className="wn-label muted small">Your note on @{sample.handle}</span>
          <div className={`wn-note ss-wn-note ${step === 'note' ? 'summary-typing' : ''}`}>
            {/* The lines are cut at the box's inner edge, so no half line shows in its padding. */}
            <span className="ss-wn-lines">
              {note}
              {step === 'note' && <span className="ss-wn-caret" />}
            </span>
          </div>
          <span className="q q-block">Read this aloud to post</span>
          <div className={`input summary-input ss-wn-say ${step === 'say' ? 'summary-typing' : ''}`}>
            <span className="ss-wn-lines">
              {say}
              {step === 'say' && <span className="ss-wn-caret" />}
            </span>
          </div>
        </div>
        <footer className="dialog-foot ss-wn-foot">
          <div className="speak-wait">
            <span className={`mic ${step === 'listen' ? 'mic-live' : ''} ${at < 2 ? 'ss-wn-mic-off' : ''} ${step === 'signed' ? 'ss-wn-mic-done' : ''}`}>
              {step === 'signed' ? <IconCheck size={22} stroke={2.6} /> : <IconMicrophone size={22} stroke={1.8} />}
            </span>
            <span className="speak-text">
              <b key={foot.title} className="ss-wn-title">
                {foot.title}
              </b>
              <span className="muted ss-wn-hint">{foot.hint}</span>
            </span>
            {step === 'listen' && (
              <span className="ss-wn-wave">
                {[7, 14, 20, 11, 17, 8, 15].map((height, bar) => (
                  <i key={bar} style={{ height, animationDelay: `${bar * 90}ms` }} />
                ))}
              </span>
            )}
            {checking && <span className="spinner" />}
          </div>
        </footer>
      </div>
    </div>
  );
}
