// The record button of the multisig page: Record, then Stop (or the automatic stop at 8 s).
// It gives the WAV to `onRecorded`. While the parent checks or signs, `busy` names the step.

import { useEffect, useRef, useState } from 'react';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { startRecording, type Recorder } from '../voice/recorder';
import { MAX_SECONDS } from '../voice/wav';

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
  /** The microphone is opening: nothing records yet. */
  const [starting, setStarting] = useState(false);

  useEffect(() => () => recorder.current?.cancel(), []);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const started = await startRecording((value) => setSeconds(value));
      recorder.current = started;
      setStarting(false);
      setSeconds(0);
      const recording = await started.done;
      recorder.current = null;
      setSeconds(null);
      onRecorded(recording.wav);
    } catch (cause) {
      recorder.current = null;
      setStarting(false);
      setSeconds(null);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== 'The recording was cancelled.') setError(message);
    }
  };

  const recording = seconds !== null;
  return (
    <div className="ms-rec">
      {recording ? (
        <button type="button" className="ms-btn ms-btn-stop" onClick={() => recorder.current?.stop()}>
          <IconPlayerStopFilled size={14} aria-hidden="true" /> Stop
        </button>
      ) : (
        <button type="button" className="ms-btn" onClick={() => void start()} disabled={disabled || busy !== null || starting}>
          <IconMicrophone size={16} stroke={2} aria-hidden="true" /> {busy ?? label}
        </button>
      )}
      {starting && (
        <span className="ms-rec-time" role="status">
          Opening the microphone… wait
        </span>
      )}
      {recording && (
        <span className="ms-rec-time" role="status">
          {/* The microphone records from here: words said before this show are lost. */}
          <b className="ms-rec-now">Speak now</b>
          <span className="ms-rec-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (seconds / MAX_SECONDS) * 100)}%` }} />
          </span>
          {seconds.toFixed(1)} s of {MAX_SECONDS} s
        </span>
      )}
      {error && (
        <p className="ms-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
