import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconAlertCircle, IconBan, IconCheck, IconCoins, IconMicrophone, IconPlugConnectedX, IconUser, IconX } from '@tabler/icons-react';
import { shortAccount } from '../config';
import type { DemoState, PrepareStep } from '../demoContext';
import type { NotesSigner, SignResult } from '../signer/notesSigner';
import { TxLink } from './bits';
import { Morph } from './Morph';

/** `preparing`: a step before the voice runs first (sign in, set up the voice, testnet funds). */
export type SignPhase =
  | { state: 'idle' }
  | { state: 'preparing'; step: PrepareStep }
  | { state: 'pending' }
  /** `title`: in place of the result's usual title, for a step before the voice that failed. */
  | { state: 'done'; result: SignResult; title?: string };

/** After a voice action worked, its dialog shows the result this long, then closes by itself. */
const AUTO_CLOSE_MS = 2400;

/** The title of the result card when a step before the voice failed. */
const FAILED_STEP_TITLE: Record<PrepareStep, string> = {
  signin: 'Not signed in',
  voice: 'Your voice is not set up',
  funds: 'No testnet NEAR for gas',
};

/**
 * One press of a voice button: the steps that are still missing (sign in, set up the voice,
 * testnet NEAR for gas), then the voice signs. The phase follows each step. The result, or null
 * when a step did not end.
 */
export async function runVoiceAction(
  prepare: DemoState['prepare'],
  signedIn: boolean,
  setPhase: (phase: SignPhase) => void,
  sign: (signer: NotesSigner) => Promise<SignResult>,
): Promise<SignResult | null> {
  setPhase(signedIn ? { state: 'pending' } : { state: 'preparing', step: 'signin' });
  const ready = await prepare({ voice: true, funds: 'gas' }, (step) => setPhase({ state: 'preparing', step }));
  if (!ready.ok) {
    setPhase(
      ready.reason
        ? { state: 'done', result: { kind: 'unavailable', reason: ready.reason }, title: FAILED_STEP_TITLE[ready.step ?? 'funds'] }
        : { state: 'idle' },
    );
    return null;
  }
  setPhase({ state: 'pending' });
  let result: SignResult;
  try {
    result = await sign(ready.signer);
  } catch (cause) {
    result = { kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'The signer failed.' };
  }
  setPhase({ state: 'done', result });
  return result;
}

/** The line under a voice button: what one press does for this visitor. */
export function speakHint(signedIn: boolean, voiceSetUp: boolean, readyHint: string): string {
  if (!signedIn) return 'You sign in first, then you speak.';
  if (!voiceSetUp) return 'First you set up your voice, once. Then you speak.';
  return readyHint;
}

/** Calls `close` a moment after `active` turns on, so a result shows, then goes by itself. */
export function useAutoClose(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => closeRef.current(), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
}

/** What the visitor does in each step before the voice. */
const PREPARE_VIEW: Record<PrepareStep, { icon: ReactNode; title: string; text: string }> = {
  signin: {
    icon: <IconUser size={22} stroke={1.8} />,
    title: 'Sign in to Seams Wallet',
    text: 'Use your passkey, or create a wallet. Then you speak.',
  },
  voice: {
    icon: <IconMicrophone size={22} stroke={1.8} />,
    title: 'Set up your voice',
    text: 'Read the three phrases in the Seams Wallet card. You do this once.',
  },
  funds: {
    icon: <IconCoins size={22} stroke={1.8} />,
    title: 'Getting testnet NEAR for gas',
    text: 'The faucet sends a new account 0.2 NEAR and 2 USDC.',
  },
};

interface SpeakStepProps {
  phase: SignPhase;
  /** The words that the owner says. */
  sentence: string;
  buttonLabel: string;
  hint: string;
  disabled: boolean;
  disabledHint?: string;
  accountId: string | undefined;
  /** For example "Words matched the summary". */
  wordsLine: string;
  /** For example "Note signed and submitted". */
  signedLine: string;
  /** For example "Nothing was posted." */
  nothingLine: string;
  onStart: () => void;
  onRetry: () => void;
  onDone: () => void;
}

/**
 * The voice part of a modal: the button, then the result card. The button stays one button for
 * the steps before the voice and the wait for the Wallet card: only its words and icon change.
 * The result card fades in after it, and the dialog changes its size with it.
 */
export function SpeakStep(props: SpeakStepProps) {
  const { phase } = props;
  return (
    <Morph view={phase.state === 'done' ? `done-${phase.result.kind}` : 'button'}>
      {phase.state === 'done' ? (
        <div className="speak" aria-live="polite">
          <ResultCard {...props} result={phase.result} title={phase.title} />
        </div>
      ) : (
        <SpeakButton {...props} phase={phase} />
      )}
    </Morph>
  );
}

/** The voice button, in each phase before the result: what to do, a step before the voice, or the wait. */
function SpeakButton(props: SpeakStepProps & { phase: Exclude<SignPhase, { state: 'done' }> }) {
  const { phase } = props;
  const step = phase.state === 'preparing' ? PREPARE_VIEW[phase.step] : null;
  const live = phase.state === 'pending';
  const busy = phase.state !== 'idle';
  // The key of the words and icon: new ones fade in when it changes.
  const swap = phase.state === 'preparing' ? `preparing-${phase.step}` : phase.state;

  const title = step ? step.title : live ? 'Speak in the Seams Wallet card' : props.buttonLabel;
  const text = step ? (
    step.text
  ) : live ? (
    <>
      Click Record, then say: <q className="say">{props.sentence}</q>
    </>
  ) : props.disabled && props.disabledHint ? (
    props.disabledHint
  ) : (
    props.hint
  );
  // Read out when the button turns to a step or the wait. The button keeps the focus.
  const status = step ? `${step.title}. ${step.text}` : live ? `Speak in the Seams Wallet card. Click Record, then say: ${props.sentence}` : '';

  return (
    <div className="speak">
      <button
        type="button"
        className={busy ? 'speak-btn speak-busy' : 'speak-btn'}
        disabled={!busy && props.disabled}
        aria-disabled={busy || undefined}
        onClick={busy ? undefined : props.onStart}
      >
        <span key={`mic-${swap}`} className={`mic${live ? ' mic-live' : ''}${busy ? ' speak-swap' : ''}`} aria-hidden="true">
          {step ? step.icon : <IconMicrophone size={22} stroke={1.8} />}
        </span>
        <span key={`text-${swap}`} className={busy ? 'speak-text speak-swap' : 'speak-text'}>
          <b>{title}</b>
          <span className="muted">{text}</span>
        </span>
        {step && <span className="spinner" aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}

function ResultCard({
  result,
  title: customTitle,
  sentence,
  accountId,
  wordsLine,
  signedLine,
  nothingLine,
  onRetry,
  onDone,
}: SpeakStepProps & { result: SignResult; title?: string }) {
  if (result.kind === 'sent') {
    const seconds = result.endOfSpeechToReceiptMs === undefined ? null : (result.endOfSpeechToReceiptMs / 1000).toFixed(1);
    return (
      <Card>
        <q className="card-quote">{sentence}</q>
        <Check>Biometric CAPTCHA: voice matched {accountId ? shortAccount(accountId) : 'the account owner'}</Check>
        <Check>{wordsLine}</Check>
        {result.approval === 'voice_and_passkey' && <Check>A policy rule asked for your passkey too</Check>}
        <div className="card-foot">
          <Check>
            {signedLine}
            {seconds && ` ${seconds} s after you spoke`} · <TxLink hash={result.transactionHash} />
          </Check>
          <button type="button" className="btn btn-dark btn-sm" onClick={onDone} autoFocus>
            Done
          </button>
        </div>
      </Card>
    );
  }

  const view: Record<Exclude<SignResult['kind'], 'sent'>, { icon: ReactNode; title: string }> = {
    refused: { icon: <IconX size={16} stroke={2.4} />, title: 'Not signed' },
    cancelled: { icon: <IconBan size={16} stroke={2} />, title: 'You left the Wallet card' },
    unavailable: { icon: <IconPlugConnectedX size={16} stroke={2} />, title: 'Speak-to-Sign is not available' },
  };
  const { icon } = view[result.kind];
  const title = customTitle ?? view[result.kind].title;
  const reason = result.kind === 'cancelled' ? 'Nothing was signed.' : result.reason;

  return (
    <Card tone={result.kind === 'refused' ? 'bad' : 'neutral'}>
      <div className="card-title" role="alert">
        <span className={`card-icon card-icon-${result.kind}`} aria-hidden="true">
          {icon}
        </span>
        <b>{title}</b>
      </div>
      <p className="card-reason">{reason}</p>
      <div className="card-foot">
        <span className="muted small">
          {result.kind !== 'unavailable' && (
            <>
              <IconAlertCircle size={14} stroke={1.8} aria-hidden="true" /> {nothingLine}
            </>
          )}
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry} autoFocus>
          Try again
        </button>
      </div>
    </Card>
  );
}

function Card({ children, tone = 'good' }: { children: ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className={`seams-card seams-card-${tone}`}>
      <div className="muted small seams-card-head">
        <IconMicrophone size={14} stroke={1.8} aria-hidden="true" /> Seams · Speak-to-Sign
      </div>
      {children}
    </div>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <div className="check">
      <IconCheck size={16} stroke={2.4} className="check-icon" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
