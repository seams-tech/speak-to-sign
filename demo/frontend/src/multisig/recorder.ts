// Records the microphone in the page and gives the verifier's WAV (src/multisig/wav.ts):
// 16 kHz mono PCM16, at most 8 s. An AudioWorklet copies the samples at the device rate; the
// page resamples them when the recording stops. The microphone settings are the ones that the
// Seams VoiceID capture uses, so the voice sounds the same as at enrollment.

import { MAX_SECONDS, wavFromSamples } from './wav';

export interface Recording {
  wav: Uint8Array;
  seconds: number;
}

export interface Recorder {
  /** Stops the recording. `done` then gives the WAV. */
  stop(): void;
  /** Stops, closes the microphone and gives nothing. */
  cancel(): void;
  /** The WAV, after `stop` or after 8 s. Rejects after `cancel`. */
  done: Promise<Recording>;
}

// Mixes the input channels to one and sends each block of 128 samples to the page.
const TAP_WORKLET = `registerProcessor('voice-tap', class extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length > 0) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / channels.length;
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
});`;

/** Starts a recording. It asks for the microphone, so call it from a click. */
export async function startRecording(onSeconds?: (seconds: number) => void): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser gives no microphone here. The page needs HTTPS or localhost.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (cause) {
    throw new Error(microphoneError(cause));
  }

  const context = new AudioContext();
  const blocks: Float32Array[] = [];
  let length = 0;
  const maxLength = MAX_SECONDS * context.sampleRate;
  let finished = false;
  let timer = 0;
  let resolve: (recording: Recording) => void = () => undefined;
  let reject: (cause: Error) => void = () => undefined;
  const done = new Promise<Recording>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  const close = () => {
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    close();
    const samples = new Float32Array(length);
    let offset = 0;
    for (const block of blocks) {
      samples.set(block, offset);
      offset += block.length;
    }
    resolve({ wav: wavFromSamples(samples, context.sampleRate), seconds: length / context.sampleRate });
  };

  try {
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = context.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(context, 'voice-tap');
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (finished) return;
      const block = event.data.subarray(0, Math.max(0, maxLength - length));
      blocks.push(block);
      length += block.length;
      onSeconds?.(length / context.sampleRate);
      if (length >= maxLength) finish();
    };
    source.connect(tap);
    // The tap writes no sound, but a node must reach the destination to run in every browser.
    tap.connect(context.destination);
    if (context.state === 'suspended') await context.resume();
  } catch (cause) {
    close();
    throw new Error(`The page could not start the recording: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  // A fallback for the automatic stop, if the worklet stops sending samples.
  timer = window.setTimeout(finish, (MAX_SECONDS + 1) * 1000);

  return {
    stop: finish,
    cancel: () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      close();
      reject(new Error('The recording was cancelled.'));
    },
    done,
  };
}

function microphoneError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser blocked the microphone. Allow the microphone for this site, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The browser found no microphone.';
  if (name === 'NotReadableError') return 'Another app is using the microphone.';
  return `The microphone did not start: ${cause instanceof Error ? cause.message : String(cause)}`;
}
