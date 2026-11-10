import { BrowserInferenceModel } from './inference';
import type { InferenceSession } from 'onnxruntime-web';

export const voiceActivityModel = new BrowserInferenceModel({
  fileName: 'silero-vad.onnx',
  sha256: '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f',
  bytes: 2_327_524,
  label: 'Speech detection',
});

/** Judges 32 ms frames of 16 kHz audio. `clear` ends one stream of frames. */
export type SpeechDetector = Readonly<{
  /** The probability from 0 to 1 that the 512-sample frame holds speech. */
  probability(frame: Float32Array): Promise<number>;
  clear(): void;
}>;

/** The speech detection model. It downloads the model and the model engine on first use. */
export async function createVoiceActivity(): Promise<SpeechDetector> {
  return new VoiceActivity(await voiceActivityModel.prepare(), await import('onnxruntime-web/wasm'));
}

/**
 * A detector with no model and no download: every frame counts as speech, so only the level
 * check of the recorder decides. It cannot tell speech from other loud sound.
 */
export const levelDetector: SpeechDetector = {
  probability: async () => 1,
  clear: () => {},
};

class VoiceActivity {
  private readonly state = new Float32Array(256);
  private readonly context = new Float32Array(64);

  constructor(
    private readonly session: InferenceSession,
    private readonly ort: typeof import('onnxruntime-web/wasm'),
  ) {}

  async probability(frame: Float32Array): Promise<number> {
    if (frame.length !== 512) throw new Error('Speech detection requires a 512-sample frame.');
    const samples = new Float32Array(576);
    samples.set(this.context);
    samples.set(frame, 64);
    const input = new this.ort.Tensor('float32', samples, [1, 576]);
    const state = new this.ort.Tensor('float32', this.state, [2, 1, 128]);
    const sr = new this.ort.Tensor('int64', BigInt64Array.of(16000n), []);
    try {
      const outputs = await this.session.run({ input, state, sr });
      try {
        const probability = outputs.output?.data;
        const nextState = outputs.stateN?.data;
        if (
          !(probability instanceof Float32Array) ||
          probability.length !== 1 ||
          !Number.isFinite(probability[0]) ||
          probability[0] < 0 ||
          probability[0] > 1 ||
          !(nextState instanceof Float32Array) ||
          nextState.length !== 256
        )
          throw new Error('Speech detection returned an invalid result.');
        this.state.set(nextState);
        this.context.set(frame.subarray(448));
        return probability[0];
      } finally {
        for (const output of Object.values(outputs)) output.dispose();
      }
    } finally {
      input.dispose();
      state.dispose();
      sr.dispose();
      samples.fill(0);
    }
  }

  clear(): void {
    this.state.fill(0);
    this.context.fill(0);
  }
}
