/**
 * Audio for the verifier, with no Seams Wallet: the canonical WAV, the energy gate of the
 * verifier, and a microphone recorder for a browser.
 *
 * The verifier takes a 16 kHz mono PCM16 WAV of at most 8 s. `encodeWav`, `energyGate` and
 * `audioDigest` run in any runtime. `recordClip` needs a browser.
 */

/** The sample rate of the verifier. */
export const SAMPLE_RATE = 16_000;
/** The verifier refuses more than 8 s. */
export const MAX_SAMPLES = 8 * SAMPLE_RATE;

// The energy gate of `crates/voice-verifier/src/config.rs`.
const GATE_FRAME = 512;
const GATE_LEVEL_RMS = 0.006;
const GATE_MIN_VOICED_MS = 600;
const GATE_MAX_CLIPPED_PERMILLE = 10;

/**
 * The canonical WAV of the verifier: a 44-byte header, then the samples. The audio digest of a
 * verdict is the SHA-256 of these bytes.
 */
export function encodeWav(pcm: Int16Array): Uint8Array<ArrayBuffer> {
  const dataLength = pcm.length * 2;
  const wav = new Uint8Array(44 + dataLength);
  const view = new DataView(wav.buffer);
  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) wav[at + index] = text.charCodeAt(index);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataLength, true);
  pcm.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return wav;
}

/** Samples in [-1, 1] as PCM16. A value outside the range is clipped. */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]!));
    pcm[index] = Math.round(value < 0 ? value * 32_768 : value * 32_767);
  }
  return pcm;
}

export interface GateReport {
  /** The time of the frames at or above the level, in ms. */
  voicedMs: number;
  /** The share of the samples at full scale, in thousandths. */
  clippedPermille: number;
  /** `false`: the verifier refuses this audio with the reason `quality`. */
  passes: boolean;
}

/**
 * The energy gate of the verifier: at least 600 ms of frames with an RMS of 0.006 or more, and at
 * most 1% of the samples at full scale. Run it before the upload: the verifier marks a recording
 * as used even if it then refuses it.
 */
export function energyGate(pcm: Int16Array): GateReport {
  let voicedSamples = 0;
  for (let start = 0; start < pcm.length; start += GATE_FRAME) {
    const frame = pcm.subarray(start, start + GATE_FRAME);
    // `Math.fround` keeps the sum in 32-bit floats, as the verifier computes it.
    let energy = 0;
    for (const sample of frame) {
      const value = Math.fround(sample / 32_768);
      energy = Math.fround(energy + Math.fround(value * value));
    }
    if (Math.fround(Math.sqrt(Math.fround(energy / frame.length))) >= Math.fround(GATE_LEVEL_RMS)) {
      voicedSamples += frame.length;
    }
  }
  let clipped = 0;
  for (const sample of pcm) if (sample === 32_767 || sample === -32_768) clipped += 1;
  const voicedMs = Math.floor((voicedSamples * 1_000) / SAMPLE_RATE);
  const clippedPermille = pcm.length === 0 ? 0 : Math.floor((clipped * 1_000) / pcm.length);
  return {
    voicedMs,
    clippedPermille,
    passes: voicedMs >= GATE_MIN_VOICED_MS && clippedPermille <= GATE_MAX_CLIPPED_PERMILLE,
  };
}

/** SHA-256 of a canonical WAV: the `audio_digest` of its verdict. Pass it to `checkVerdict`. */
export async function audioDigest(wav: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(wav)));
}

/** Standard base64, for `audio_wav_b64` of the verifier input. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export interface Clip {
  /** 16 kHz mono samples. */
  pcm: Int16Array;
  /** The canonical WAV. */
  wav: Uint8Array<ArrayBuffer>;
  gate: GateReport;
}

/** A recording in progress. */
export interface Recording {
  /** Stops the recording and gives the clip. */
  stop(): Promise<Clip>;
  /** Stops the recording and releases the microphone, with no clip. */
  cancel(): void;
}

/**
 * Starts a recording from the microphone, in a browser. The browser asks the person for the
 * microphone. The recording stops at `stop()`, or by itself after `maxMs` (at most 8,000).
 *
 * The clip is resampled to 16 kHz mono. Each call gives new audio: the verifier refuses a
 * recording that it saw before.
 */
export async function recordClip(options: { maxMs?: number } = {}): Promise<Recording> {
  const maxMs = Math.min(options.maxMs ?? 8_000, 8_000);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const end = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const timer = setTimeout(end, maxMs);
  recorder.start();
  return {
    async stop() {
      clearTimeout(timer);
      end();
      await stopped;
      release();
      const encoded = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      const pcm = await decodeTo16k(encoded);
      return { pcm, wav: encodeWav(pcm), gate: energyGate(pcm) };
    },
    cancel() {
      clearTimeout(timer);
      end();
      release();
    },
  };
}

/** Decodes recorded audio and resamples it to 16 kHz mono, at most 8 s. */
async function decodeTo16k(encoded: ArrayBuffer): Promise<Int16Array> {
  const decoder = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(encoded);
  } finally {
    await decoder.close();
  }
  const length = Math.min(Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), MAX_SAMPLES);
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return toPcm16(rendered.getChannelData(0));
}
