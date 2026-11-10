// The record button of the multisig screen: Record, then Stop (or the automatic stop at 8 s).
// It gives the WAV to `onRecorded`. While the parent checks or signs, `busy` names the step.

import { useEffect, useRef, useState } from 'react';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { startRecording, type Recorder } from './recorder';
import { MAX_SECONDS } from './wav';

export function VoiceRecorder({
  disabled = false,
  busy = null,
  label = 'Record',
  onRecorded,
}: {
  disabled?: boolean;
  /** The step that runs after the recording, for example "Checking your voice…". */
  busy?: string | null;
  label?: string;
  onRecorded: (wav: Uint8Array) => void;
}) {
  const recorder = useRef<Recorder | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => recorder.current?.cancel(), []);

  const start = async () => {
    setError(null);
    try {
      const started = await startRecording((value) => setSeconds(value));
      recorder.current = started;
      setSeconds(0);
      const recording = await started.done;
      recorder.current = null;
      setSeconds(null);
      onRecorded(recording.wav);
    } catch (cause) {
      recorder.current = null;
      setSeconds(null);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== 'The recording was cancelled.') setError(message);
    }
  };

  const recording = seconds !== null;
  return (
    <div className="lms-rec">
      {recording ? (
        <button type="button" className="sf-btn lms-btn lms-btn-stop" onClick={() => recorder.current?.stop()}>
          <IconPlayerStopFilled size={14} aria-hidden="true" /> Stop
        </button>
      ) : (
        <button type="button" className="sf-btn lms-btn" onClick={() => void start()} disabled={disabled || busy !== null}>
          <IconMicrophone size={16} stroke={2} aria-hidden="true" /> {busy ?? label}
        </button>
      )}
      {recording && (
        <span className="lms-rec-time" role="status">
          <span className="lms-rec-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (seconds / MAX_SECONDS) * 100)}%` }} />
          </span>
          {seconds.toFixed(1)} s of {MAX_SECONDS} s
        </span>
      )}
      {error && (
        <p className="lms-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
