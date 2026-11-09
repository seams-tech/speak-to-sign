import type { ReactNode } from 'react';
import { IconAlertCircle, IconBan, IconCheck, IconMicrophone, IconPlugConnectedX, IconX } from '@tabler/icons-react';
import type { SignResult } from '../signer/notesSigner';
import { TxLink } from './bits';

export type SignPhase = { state: 'idle' } | { state: 'pending' } | { state: 'done'; result: SignResult };

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

/** The voice part of a modal: the button, the wait, and the result card. */
export function SpeakStep(props: SpeakStepProps) {
  const { phase } = props;

  if (phase.state === 'idle') {
    return (
      <div className="speak">
        <button type="button" className="speak-btn" disabled={props.disabled} onClick={props.onStart}>
          <span className="mic" aria-hidden="true">
            <IconMicrophone size={22} stroke={1.8} />
          </span>
          <span className="speak-text">
            <b>{props.buttonLabel}</b>
            <span className="muted">{props.disabled && props.disabledHint ? props.disabledHint : props.hint}</span>
          </span>
        </button>
      </div>
    );
  }

  if (phase.state === 'pending') {
    return (
      <div className="speak" role="status" aria-live="polite">
        <div className="speak-wait">
          <span className="mic mic-live" aria-hidden="true">
            <IconMicrophone size={22} stroke={1.8} />
          </span>
          <span className="speak-text">
            <b>Listening in Seams Wallet</b>
            <span className="muted">
              Say: <q className="say">{props.sentence}</q>
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="speak" aria-live="polite">
      <ResultCard {...props} result={phase.result} />
    </div>
  );
}

function ResultCard({ result, sentence, accountId, wordsLine, signedLine, nothingLine, onRetry, onDone }: SpeakStepProps & { result: SignResult }) {
  if (result.kind === 'sent') {
    return (
      <Card>
        <q className="card-quote">{sentence}</q>
        <Check>Voice matched {accountId ?? 'the account owner'}</Check>
        <Check>{wordsLine}</Check>
        <div className="card-foot">
          <Check>
            {signedLine} · <TxLink hash={result.transactionHash} />
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
    cancelled: { icon: <IconBan size={16} stroke={2} />, title: 'You cancelled' },
    unavailable: { icon: <IconPlugConnectedX size={16} stroke={2} />, title: 'Speak-to-Sign is not available' },
  };
  const { icon, title } = view[result.kind];
  const reason =
    result.kind === 'refused'
      ? result.reason
      : result.kind === 'unavailable'
        ? `${result.reason} Check the Speak-to-Sign setup steps.`
        : 'Nothing was signed.';

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
          <IconAlertCircle size={14} stroke={1.8} aria-hidden="true" /> {nothingLine}
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
