// The "say it" step of a bet. The bettor sees the sentence of the bet, records it, and the voice
// verifier checks the voice and the words. An accepted recording gives the verdict that the
// contract needs for the bet. A refusal says why, and the bettor records again.

import { useEffect, useRef, useState } from 'react';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { startRecording, type Recorder } from '../multisig/recorder';
import type { BetVerdict, BetVoice, MarketSource, Side } from './types';

/** The spoken bet of `source`, when its contract takes a bet only with a verdict. Null if not. */
export function useBetVoice(source: MarketSource): BetVoice | null {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    let current = true;
    setRequired(false);
    source.voice?.required().then(
      (value) => current && setRequired(value),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [source]);
  return required ? (source.voice ?? null) : null;
}

type Phase = { state: 'idle' } | { state: 'recording'; seconds: number } | { state: 'checking' };

export function SayBet({
  voice,
  account,
  bet,
  disabled = false,
  onVerdict,
  onCancel,
}: {
  voice: BetVoice;
  account: string;
  bet: { marketId: number; side: Side; amount: bigint };
  disabled?: boolean;
  /** The verifier accepted the recording. */
  onVerdict: (verdict: BetVerdict) => void;
  /** With it, the step shows "Cancel". */
  onCancel?: () => void;
}) {
  const recorder = useRef<Recorder | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [problem, setProblem] = useState<{ text: string; heard?: string } | null>(null);
  useEffect(() => () => recorder.current?.cancel(), []);

  const record = async () => {
    setProblem(null);
    let wav: Uint8Array;
    try {
      const started = await startRecording((seconds) => setPhase({ state: 'recording', seconds }));
      recorder.current = started;
      setPhase({ state: 'recording', seconds: 0 });
      wav = (await started.done).wav;
    } catch (cause) {
      recorder.current = null;
      setPhase({ state: 'idle' });
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== 'The recording was cancelled.') setProblem({ text: message });
      return;
    }
    recorder.current = null;
    setPhase({ state: 'checking' });
    const check = await voice.check(account, bet, wav);
    setPhase({ state: 'idle' });
    if (check.kind === 'accepted') onVerdict({ verdictJson: check.verdictJson, signatureB64: check.signatureB64 });
    else setProblem({ text: check.reason, heard: check.kind === 'refused' ? check.heard : undefined });
  };

  return (
    <div className="nm-saybet">
      <div className="nm-say">
        <span className="nm-muted">
          <IconMicrophone size={14} stroke={2} aria-hidden="true" /> Say this to bet
        </span>
        <b>“{voice.sentence(bet)}”</b>
      </div>
      <div className="nm-saybet-row">
        {phase.state === 'recording' ? (
          <button type="button" className="btn btn-dark nm-saybet-btn nm-saybet-stop" onClick={() => recorder.current?.stop()}>
            <IconPlayerStopFilled size={14} aria-hidden="true" /> Stop · {phase.seconds.toFixed(1)} s
          </button>
        ) : (
          <button type="button" className="btn btn-dark nm-saybet-btn" onClick={() => void record()} disabled={disabled || phase.state === 'checking'}>
            {phase.state === 'checking' ? (
              <>
                <span className="spinner" aria-hidden="true" /> Checking your voice…
              </>
            ) : (
              <>
                <IconMicrophone size={16} stroke={2} aria-hidden="true" /> {problem ? 'Record again' : 'Record'}
              </>
            )}
          </button>
        )}
        {onCancel && phase.state === 'idle' && (
          <button type="button" className="link-btn nm-small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {problem && (
        <p className="nm-error" role="alert">
          {problem.text}
          {problem.heard && <> Heard: “{problem.heard}”.</>}
        </p>
      )}
    </div>
  );
}
