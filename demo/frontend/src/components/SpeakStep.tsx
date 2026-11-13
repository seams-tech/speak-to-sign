import { useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconBan, IconCoins, IconMicrophone, IconPlugConnectedX, IconUser, IconX } from '@tabler/icons-react';
import type { DemoState, PrepareStep } from '../demoContext';
import type { NotesSigner, SignResult } from '../signer/notesSigner';
import { Morph } from './Morph';
import { CardWaitContext } from './WalletDialog';

/** `preparing`: a step before the voice runs first (sign in, set up the voice, testnet funds). */
export type SignPhase =
  | { state: 'idle' }
  | { state: 'preparing'; step: PrepareStep }
  | { state: 'pending' }
  /** `title`: in place of the result's usual title, for a step before the voice that failed. */
  | { state: 'done'; result: SignResult; title?: string };

/**
 * A dialog that a voice command opened shows its ready button this long before the Wallet card
 * takes its place, so the visitor sees what the command will sign.
 */
const AUTO_START_PAUSE_MS = 1000;

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

/**
 * Calls `start` once, a moment after `ready` turns on, when a voice command opened the dialog
 * (`enabled`). Make `ready` false when the visitor starts by hand: the pause then ends with no
 * second start. A dialog that closes during the pause starts nothing.
 */
export function useAutoStart(enabled: boolean, ready: boolean, start: () => void) {
  const startRef = useRef(start);
  useLayoutEffect(() => {
    startRef.current = start;
  });
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || !ready || started.current) return;
    const timer = window.setTimeout(() => {
      started.current = true;
      startRef.current();
    }, AUTO_START_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, ready]);
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
  /** The words that the owner says. Absent when the Wallet card shows them (a note's summary). */
  sentence?: string;
  buttonLabel: string;
  hint: string;
  disabled: boolean;
  disabledHint?: string;
  /** The title when nothing was signed, for example "Nothing was posted". */
  nothingTitle: string;
  onStart: () => void;
  onRetry: () => void;
}

/**
 * The voice part of a modal: the button, then a result card when nothing was signed. The button
 * stays one button for the steps before the voice and the wait for the Wallet card: only its
 * words and icon change. A signed request has no card here: the Wallet card showed its result
 * and receipt, and the dialog closes. The result card fades in after the button, and the dialog
 * changes its size with it.
 */
export function SpeakStep(props: SpeakStepProps) {
  const { phase } = props;
  const failed = phase.state === 'done' && phase.result.kind !== 'sent' ? phase.result : null;
  return (
    <Morph view={failed ? `done-${failed.kind}` : 'button'}>
      {failed ? (
        <div className="speak" aria-live="polite">
          <ResultCard {...props} result={failed} title={phase.state === 'done' ? phase.title : undefined} />
        </div>
      ) : (
        // A sent request keeps the button, busy, while the dialog closes.
        <SpeakButton {...props} phase={phase.state === 'done' ? { state: 'pending' } : phase} />
      )}
    </Morph>
  );
}

/** The voice button, in each phase before the result: what to do, a step before the voice, or the wait. */
function SpeakButton(props: SpeakStepProps & { phase: Exclude<SignPhase, { state: 'done' }> }) {
  const { phase } = props;
  const step = phase.state === 'preparing' ? PREPARE_VIEW[phase.step] : null;
  // The request is with the Wallet. Until its card is on the screen, the button says so.
  const cardWait = useContext(CardWaitContext);
  const waiting = phase.state === 'pending' && cardWait;
  const live = phase.state === 'pending' && !cardWait;
  const busy = phase.state !== 'idle';
  // The key of the words and icon: new ones fade in when it changes.
  const swap = phase.state === 'preparing' ? `preparing-${phase.step}` : waiting ? 'waiting' : phase.state;

  const waitText = props.sentence ? 'One moment.' : 'It writes the short sentence that you read aloud.';
  const title = step
    ? step.title
    : waiting
      ? 'Opening the Seams Wallet card'
      : live
        ? 'Speak in the Seams Wallet card'
        : props.buttonLabel;
  const text = step ? (
    step.text
  ) : waiting ? (
    waitText
  ) : live ? (
    props.sentence ? (
      <>
        Click Record, then say: <q className="say">{props.sentence}</q>
      </>
    ) : (
      'Read the sentence on the card aloud.'
    )
  ) : props.disabled && props.disabledHint ? (
    props.disabledHint
  ) : (
    props.hint
  );
  // Read out when the button turns to a step or the wait. The button keeps the focus.
  const say = props.sentence ? `Click Record, then say: ${props.sentence}` : 'Read the sentence on the card aloud.';
  const status = step
    ? `${step.title}. ${step.text}`
    : waiting
      ? `Opening the Seams Wallet card. ${waitText}`
      : live
        ? `Speak in the Seams Wallet card. ${say}`
        : '';

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
        {(step || waiting) && <span className="spinner" aria-hidden="true" />}
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
  nothingTitle,
  onRetry,
}: SpeakStepProps & { result: Exclude<SignResult, { kind: 'sent' }>; title?: string }) {
  // A voice action that signed nothing: the shape of the voice button, with what happened, why,
  // and "Try again" in place of the button.
  const icon = {
    refused: <IconX size={20} stroke={2.4} />,
    cancelled: <IconBan size={20} stroke={2} />,
    unavailable: <IconPlugConnectedX size={20} stroke={2} />,
  }[result.kind];
  const reason = result.kind === 'cancelled' ? 'You closed the Wallet window.' : result.reason;

  return (
    <div className={`speak-fail speak-fail-${result.kind}`} role="alert">
      <span className="speak-fail-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="speak-text">
        <b>{customTitle ?? nothingTitle}</b>
        <span className="muted">{reason}</span>
      </span>
      <button type="button" className="btn btn-outline btn-sm" onClick={onRetry} autoFocus>
        Try again
      </button>
    </div>
  );
}

