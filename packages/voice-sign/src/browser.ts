/**
 * The browser side of Speak-to-Sign for an application with no wallet: record one sentence and
 * get the WAV that the verifier takes. The recording is `@seams/voice-capture`.
 *
 * Send the WAV to your own server. The server calls the verifier (`@seams/voice-sign/server`):
 * the payment key must not reach the browser.
 */
import {
  configureVoiceCapture,
  expectedSpeechMs,
  pcm16Wav,
  recordVoice,
  voiceQualityMessage,
  type VoiceCaptureConfig,
  type VoiceCaptureObserver,
} from '@seams/voice-capture';

export type { VoiceCaptureConfig, VoiceCaptureObserver };

/** Sets where the asset files of `@seams/voice-capture` are. Call it once, before a recording. */
export function configureSpeakToSign(config: VoiceCaptureConfig): void {
  configureVoiceCapture(config);
}

export type SentenceRecording =
  | {
      kind: 'recorded';
      /** A 16 kHz mono PCM16 WAV of at most 8 s, with the plain header of the verifier. */
      wav: Uint8Array<ArrayBuffer>;
      /** The WAV as standard base64, for a JSON body. */
      wavBase64: string;
    }
  /** Less than 0.6 s of speech, or too much noise. `message` is a sentence for the person. */
  | { kind: 'insufficient_audio'; message: string };

export interface RecordSentenceOptions {
  /** Ends the recording and stops the microphone. The promise then rejects. */
  signal?: AbortSignal;
  /** The events of the recording, for a level display. */
  onEvent?: VoiceCaptureObserver;
  /**
   * `model` (default): a speech detection model finds the speech (a download of about 16.6 MB,
   * one time). `level`: only the sound level counts, with no download.
   */
  detector?: 'model' | 'level';
}

/**
 * Records one spoken sentence. Call it from a click or a key press. The browser asks the person
 * for the microphone. The recording ends at a pause after the speech, or after 8 s.
 *
 * Give the sentence that the person will say, so that the recording ends soon after it. For a
 * recording with no known sentence (`transcribe`), give `null`.
 */
export async function recordSentence(sentence: string | null, options: RecordSentenceOptions = {}): Promise<SentenceRecording> {
  const result = await recordVoice(options.signal ?? new AbortController().signal, options.onEvent ?? (() => {}), {
    expectedSpeechMs: sentence === null ? null : expectedSpeechMs(sentence),
    ...(options.detector === undefined ? {} : { detector: options.detector }),
  });
  if (result.kind !== 'captured') return { kind: 'insufficient_audio', message: voiceQualityMessage(result.quality) };
  const wav = pcm16Wav(result.samples);
  // The caller owns the samples. Overwrite them: the WAV holds the audio now.
  result.samples.fill(0);
  return { kind: 'recorded', wav, wavBase64: base64(wav) };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
