import { assetUrl, captureConfig } from './config';
import { createVoiceActivity, levelDetector, type SpeechDetector } from './voiceActivity';
import { endPauseMs } from './speechPause';
import { SAMPLE_RATE } from './wav';
import {
  openVoiceMicrophone,
  rememberVoiceMicrophone,
  VoiceMicrophoneInterruptedError,
  type VoiceMicrophone,
} from './microphoneInput';

/** One 32 ms frame as the recorder judged it. No capture event carries the stream. */
export type VoiceActivityEvent = Readonly<{
  kind: 'activity';
  rms: number;
  /** The speech detector and the level check both found speech. */
  speech: boolean;
  stream?: never;
}>;
export type VoiceCaptureEvent =
  | { readonly kind: 'opening'; readonly stream?: never }
  | { readonly kind: 'listening'; readonly stream?: never }
  | VoiceActivityEvent
  | { readonly kind: 'processing'; readonly stream?: never }
  | { readonly kind: 'measured'; readonly quality: VoiceCaptureQuality; readonly stream?: never };
export type VoiceCaptureObserver = (event: VoiceCaptureEvent) => void;

export type VoiceCaptureQuality = Readonly<{
  attemptId: string;
  capturedAtMs: number;
  durationMs: number;
  recordingMs: number;
  endedBy: 'pause' | 'limit' | 'stream_ended';
  voicedMs: number;
  peakFrameRms: number;
  levelThreshold: number;
  requiredVoicedMs: number;
  microphone: string;
  microphoneSelection: VoiceMicrophone['selection'];
  processing: VoiceMicrophone['processing'];
  backgroundRms: number;
  speechToBackgroundDb: number | null;
  noise: 'high' | 'normal' | 'unknown';
}>;

export type VoiceRecordingResult =
  | {
      kind: 'captured';
      samples: Float32Array;
      quality: VoiceCaptureQuality;
      /** `performance.now()` of the last voiced frame, or null when no speech was detected. */
      lastSoundAtMs: number | null;
    }
  | { kind: 'insufficient_audio'; quality: VoiceCaptureQuality; samples?: never };

export function voiceQualityMessage(quality: VoiceCaptureQuality): string {
  if (quality.noise === 'high')
    return 'Background noise is high. Move closer to the microphone and try again.';
  return `Audio too brief or quiet: ${(quality.voicedMs / 1_000).toFixed(2)} of ${(quality.requiredVoicedMs / 1_000).toFixed(2)} seconds detected.`;
}

/** Carries a typed capture rejection across the SDK's exception-based UI action boundary. */
export class InsufficientVoiceAudioError extends Error {
  constructor(readonly quality: VoiceCaptureQuality) {
    super(voiceQualityMessage(quality));
    this.name = 'InsufficientVoiceAudioError';
  }
}

const LEVEL_THRESHOLD = 0.006;
const REQUIRED_VOICED_MS = 600;
const MAX_RECORDING_MS = 8_000;
const SPEECH_START_MS = 100;
const VOICE_FRAME_MS = 32;

type SpeechActivity =
  | { kind: 'waiting'; activeMs: number }
  | { kind: 'speaking'; lastSoundAtMs: number; voicedMs: number };

type RecordedAudio = Readonly<{
  bytes: ArrayBuffer;
  recordingMs: number;
  endedBy: 'pause' | 'limit' | 'stream_ended';
  lastSoundAtMs: number | null;
}>;

export type VoiceRecordingOptions = Readonly<{
  /**
   * The voiced time of the whole expected sentence, when the caller knows the sentence
   * (`expectedSpeechMs`): after that much speech, a shorter pause ends the recording.
   */
  expectedSpeechMs?: number | null;
  /**
   * `model` (default): the speech detection model finds the speech. It needs the model and the
   * model engine from the asset folder. `level`: only the sound level counts. It needs no model,
   * and it cannot tell speech from other loud sound.
   */
  detector?: 'model' | 'level';
}>;

/** Throws unless the page is in front and the person just acted on it (a click or a key). */
export function requireVoiceUserAction(): void {
  requireVoiceForeground();
  if (!navigator.userActivation.isActive) {
    const { label, place } = captureConfig();
    throw new Error(`Open ${place} and select Record to use ${label}.`);
  }
}

/** Throws unless the page is visible and has the focus. */
export function requireVoiceForeground(): void {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) {
    const { label, place } = captureConfig();
    throw new Error(`Keep ${place} open and focused to use ${label}.`);
  }
}

function cancelled(): Error {
  return new Error(`${captureConfig().label} recording was cancelled.`);
}

function detectorOf(options: VoiceRecordingOptions): () => Promise<SpeechDetector> {
  return options.detector === 'level' ? async () => levelDetector : createVoiceActivity;
}

/**
 * Records one utterance at 16 kHz. The recording ends after a pause, or after 8 s. A recording
 * with less than 0.6 s of speech is `insufficient_audio`. The samples hold the speech with 0.2 s
 * of margin on each side.
 */
export async function recordVoice(
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  options: VoiceRecordingOptions = {},
): Promise<VoiceRecordingResult> {
  const expectedSpeechMs = options.expectedSpeechMs ?? null;
  const createDetector = detectorOf(options);
  if (signal.aborted) throw cancelled();
  const attemptId = crypto.randomUUID();
  onCapture({ kind: 'opening' });
  const microphone = await openVoiceMicrophone(signal);
  const { stream } = microphone;
  try {
    if (signal.aborted) throw cancelled();
    const recording = new VoiceRecording(
      stream,
      signal,
      onCapture,
      expectedSpeechMs,
      createDetector,
    );
    const clip = await recording.result.finally(onCapture.bind(null, { kind: 'processing' }));
    if (signal.aborted) throw cancelled();
    const decoder = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(clip.bytes);
    const renderer = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    try {
      const rendered = await renderer.startRendering();
      try {
        if (signal.aborted) throw cancelled();
        const samples = rendered.getChannelData(0);
        const measurement = await measureAudio(samples, signal, await createDetector());
        const quality: VoiceCaptureQuality = {
          attemptId,
          capturedAtMs: Date.now(),
          durationMs: rendered.duration * 1_000,
          recordingMs: clip.recordingMs,
          endedBy: clip.endedBy,
          voicedMs: measurement.voicedMs,
          peakFrameRms: measurement.peakFrameRms,
          levelThreshold: LEVEL_THRESHOLD,
          requiredVoicedMs: REQUIRED_VOICED_MS,
          microphone: microphone.label,
          microphoneSelection: microphone.selection,
          processing: microphone.processing,
          backgroundRms: measurement.backgroundRms,
          speechToBackgroundDb: measurement.speechToBackgroundDb,
          noise: measurement.noise,
        };
        onCapture({ kind: 'measured', quality });
        if (measurement.kind === 'insufficient_audio') {
          return { kind: 'insufficient_audio', quality };
        }
        const speech = samples.slice(
          Math.max(0, measurement.first - 3_200),
          Math.min(samples.length, measurement.last + 3_200),
        );
        await rememberVoiceMicrophone(microphone);
        if (signal.aborted) {
          speech.fill(0);
          signal.throwIfAborted();
        }
        return { kind: 'captured', samples: speech, quality, lastSoundAtMs: clip.lastSoundAtMs };
      } finally {
        wipeAudioBuffer(rendered);
      }
    } finally {
      wipeAudioBuffer(decoded);
    }
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

class VoiceRecording {
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly completion = deferred<RecordedAudio>();
  private startedAtMs = performance.now();
  private ended: Omit<RecordedAudio, 'bytes'> | null = null;
  private activity: SpeechActivity = { kind: 'waiting', activeMs: 0 };
  private audioContext: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private detector: SpeechDetector | null = null;
  private pending: Promise<void> = Promise.resolve();
  private queuedFrames = 0;
  private closed = false;
  readonly result = this.completion.promise;

  constructor(
    private readonly stream: MediaStream,
    private readonly signal: AbortSignal,
    private readonly onCapture: VoiceCaptureObserver,
    private readonly expectedSpeechMs: number | null,
    private readonly createDetector: () => Promise<SpeechDetector>,
  ) {
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener('dataavailable', this.data);
    this.recorder.addEventListener('stop', this.stopped);
    this.recorder.addEventListener('error', this.failed);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', this.interrupted);
      track.addEventListener('mute', this.interrupted);
    }
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.timer = setTimeout(this.startupFailed, MAX_RECORDING_MS);
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      await this.startPauseDetection();
      this.signal.throwIfAborted();
      this.startedAtMs = performance.now();
      if (this.closed) return;
      this.recorder.start();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(this.stop.bind(this, 'limit'), MAX_RECORDING_MS);
      this.onCapture({ kind: 'listening' });
    } catch (error) {
      this.cleanup();
      this.completion.reject(
        error instanceof Error ? error : new Error('Speech detection could not start.'),
      );
    }
  }

  private readonly data = (event: BlobEvent): void => {
    this.chunks.push(event.data);
  };
  private readonly stop = (endedBy: RecordedAudio['endedBy']): void => {
    if (this.recorder.state === 'inactive') return;
    this.ended = {
      endedBy,
      recordingMs: performance.now() - this.startedAtMs,
      lastSoundAtMs: this.activity.kind === 'speaking' ? this.activity.lastSoundAtMs : null,
    };
    this.recorder.stop();
    this.stopTracks();
  };
  private readonly cancelled = (): void => {
    if (this.recorder.state === 'inactive') {
      this.cleanup();
      this.completion.reject(cancelled());
      return;
    }
    this.stop('stream_ended');
  };
  private readonly startupFailed = (): void => {
    this.cleanup();
    this.completion.reject(new Error('Speech detection startup timed out. Please try again.'));
  };
  private readonly detectorFailed = (error: unknown): void => {
    this.cleanup();
    this.completion.reject(error instanceof Error ? error : new Error('Speech detection failed.'));
  };
  private readonly failed = (): void => {
    this.cleanup();
    this.completion.reject(
      new Error(`${captureConfig().label} could not record this microphone.`),
    );
  };
  private readonly interrupted = (): void => {
    this.cleanup();
    this.completion.reject(new VoiceMicrophoneInterruptedError());
  };
  private readonly stopped = (): void => {
    const end = this.ended;
    this.cleanup();
    if (this.signal.aborted) {
      this.completion.reject(cancelled());
      return;
    }
    if (end === null) {
      this.completion.reject(new VoiceMicrophoneInterruptedError());
      return;
    }
    void new Blob(this.chunks, { type: this.recorder.mimeType })
      .arrayBuffer()
      .then(this.complete.bind(this, end), this.completion.reject.bind(this.completion));
  };
  private readonly complete = (end: Omit<RecordedAudio, 'bytes'>, bytes: ArrayBuffer): void => {
    if (this.signal.aborted) {
      this.completion.reject(cancelled());
      return;
    }
    this.completion.resolve({ bytes, ...end });
  };

  private async startPauseDetection(): Promise<void> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.audioContext = context;
    const resumed = context.resume();
    this.detector = await this.createDetector();
    this.signal.throwIfAborted();
    if (context.sampleRate !== SAMPLE_RATE)
      throw new Error('Speech detection requires 16 kHz audio.');
    await context.audioWorklet.addModule(assetUrl('voice-activity-worklet.js'));
    this.signal.throwIfAborted();
    const worklet = new AudioWorkletNode(context, 'voice-activity-frames');
    this.worklet = worklet;
    worklet.port.onmessage = this.receiveFrame;
    context.createMediaStreamSource(this.stream).connect(worklet);
    worklet.connect(context.destination);
    await resumed;
  }

  private readonly receiveFrame = (event: MessageEvent<unknown>): void => {
    if (!(event.data instanceof Float32Array) || event.data.length !== 512) {
      this.failed();
      return;
    }
    if (this.closed || this.recorder.state !== 'recording') {
      event.data.fill(0);
      return;
    }
    if (++this.queuedFrames > 32) {
      event.data.fill(0);
      this.failed();
      return;
    }
    this.pending = this.pending
      .then(this.processFrame.bind(this, event.data))
      .catch(this.detectorFailed);
  };

  private async processFrame(frame: Float32Array): Promise<void> {
    const detector = this.detector;
    try {
      if (this.closed || !detector) return;
      const probability = await detector.probability(frame);
      if (this.closed) {
        detector.clear();
        return;
      }
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      const rms = Math.sqrt(energy / frame.length);
      const speech = probability >= 0.5 && rms >= LEVEL_THRESHOLD;
      this.updateActivity(speech);
      this.onCapture({ kind: 'activity', rms, speech });
    } finally {
      frame.fill(0);
      this.queuedFrames -= 1;
    }
  }

  private updateActivity(audible: boolean): void {
    const now = performance.now();
    switch (this.activity.kind) {
      case 'waiting': {
        const activeMs = audible ? this.activity.activeMs + VOICE_FRAME_MS : 0;
        this.activity =
          activeMs >= SPEECH_START_MS
            ? { kind: 'speaking', lastSoundAtMs: now, voicedMs: activeMs }
            : { kind: 'waiting', activeMs };
        return;
      }
      case 'speaking': {
        const { lastSoundAtMs, voicedMs } = this.activity;
        if (audible) {
          this.activity = {
            kind: 'speaking',
            lastSoundAtMs: now,
            voicedMs: voicedMs + VOICE_FRAME_MS,
          };
          return;
        }
        if (now - lastSoundAtMs >= endPauseMs(voicedMs, this.expectedSpeechMs)) this.stop('pause');
        return;
      }
      default:
        return assertNeverActivity(this.activity);
    }
  }

  private readonly stopPauseDetection = (): void => {
    this.closed = true;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
      this.worklet.disconnect();
    }
    this.worklet = null;
    this.detector?.clear();
    this.detector = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context) void context.close().catch(ignoreClosedContext);
  };

  private stopTracks(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }
  private cleanup(): void {
    for (const track of this.stream.getAudioTracks()) {
      track.removeEventListener('ended', this.interrupted);
      track.removeEventListener('mute', this.interrupted);
    }
    this.stopPauseDetection();
    this.stopTracks();
    if (this.timer !== null) clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.cancelled);
    this.recorder.removeEventListener('dataavailable', this.data);
    this.recorder.removeEventListener('stop', this.stopped);
    this.recorder.removeEventListener('error', this.failed);
  }
}

type NoiseMeasurement = Readonly<{
  backgroundRms: number;
  speechToBackgroundDb: number | null;
  noise: 'high' | 'normal' | 'unknown';
}>;
type AudioMeasurement = NoiseMeasurement &
  (
    | { kind: 'captured'; first: number; last: number; voicedMs: number; peakFrameRms: number }
    | {
        kind: 'insufficient_audio';
        voicedMs: number;
        peakFrameRms: number;
        first?: never;
        last?: never;
      }
  );

async function measureAudio(
  samples: Float32Array,
  signal: AbortSignal,
  detector: SpeechDetector,
): Promise<AudioMeasurement> {
  let first = -1;
  let last = 0;
  let voicedSamples = 0;
  let peakFrameRms = 0;
  let backgroundEnergy = 0;
  let backgroundSamples = 0;
  let speechEnergy = 0;
  const frame = new Float32Array(512);
  try {
    for (let offset = 0; offset < samples.length; offset += frame.length) {
      signal.throwIfAborted();
      frame.fill(0);
      const count = Math.min(frame.length, samples.length - offset);
      frame.set(samples.subarray(offset, offset + count));
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      const rms = Math.sqrt(energy / count);
      peakFrameRms = Math.max(peakFrameRms, rms);
      const speech = (await detector.probability(frame)) >= 0.5 && rms >= LEVEL_THRESHOLD;
      if (!speech) {
        backgroundEnergy += energy;
        backgroundSamples += count;
        continue;
      }
      if (first < 0) first = offset;
      last = offset + count;
      voicedSamples += count;
      speechEnergy += energy;
    }
  } finally {
    frame.fill(0);
    detector.clear();
  }
  const backgroundRms = Math.sqrt(backgroundEnergy / Math.max(1, backgroundSamples));
  const speechRms = Math.sqrt(speechEnergy / Math.max(1, voicedSamples));
  const speechToBackgroundDb =
    voicedSamples && backgroundSamples
      ? 20 * Math.log10(Math.max(speechRms, 1e-8) / Math.max(backgroundRms, 1e-8))
      : null;
  const noise: NoiseMeasurement = {
    backgroundRms,
    speechToBackgroundDb,
    noise:
      backgroundRms >= LEVEL_THRESHOLD &&
      (speechToBackgroundDb === null || speechToBackgroundDb < 10)
        ? 'high'
        : backgroundSamples
          ? 'normal'
          : 'unknown',
  };
  const voicedMs = (voicedSamples / SAMPLE_RATE) * 1_000;
  if (first < 0 || voicedMs < REQUIRED_VOICED_MS)
    return { kind: 'insufficient_audio', voicedMs, peakFrameRms, ...noise };
  return { kind: 'captured', first, last, voicedMs, peakFrameRms, ...noise };
}

function wipeAudioBuffer(buffer: AudioBuffer): void {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    buffer.getChannelData(channel).fill(0);
  }
}

function ignoreClosedContext(): void {}

/** A promise with its two settle functions. */
function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function assertNeverActivity(activity: never): never {
  throw new Error(`Unexpected speech activity: ${String(activity)}`);
}
