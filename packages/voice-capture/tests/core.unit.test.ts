// The pure parts of the capture core: the speech time of a sentence, the WAV bytes and the
// asset URLs.

import { expect, test } from '@playwright/test';
import { assetUrl, configureVoiceCapture } from '../src/config';
import { endPauseMs, expectedSpeechMs } from '../src/speechPause';
import { levelDetector } from '../src/voiceActivity';
import { MAX_SAMPLES, pcm16Wav, SAMPLE_RATE } from '../src/wav';

test('a sentence counts digits, dots and dashes as spoken words', () => {
  // "send zero point zero one near to seams dash v one dot testnet": 13 words.
  expect(expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet')).toBe(13 * 200);
  expect(expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet.')).toBe(13 * 200);
  expect(expectedSpeechMs('This note is helpful')).toBe(4 * 200);
  expect(expectedSpeechMs('  ')).toBe(0);
});

test('a short pause ends a recording only after the whole sentence was voiced', () => {
  const sentence = expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet');
  // A pause inside the sentence keeps the long pause.
  expect(endPauseMs(sentence - 32, sentence)).toBe(1_500);
  expect(endPauseMs(sentence, sentence)).toBe(800);
  // Without a known sentence, the long pause stays.
  expect(endPauseMs(10_000, null)).toBe(1_500);
});

test('the WAV is 16 kHz mono PCM16 with a 44-byte header and at most 8 s', () => {
  const wav = pcm16Wav(Float32Array.of(0, 1, -1, 0.5, 2, -2));
  const view = new DataView(wav.buffer);
  expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe('WAVEfmt ');
  expect(view.getUint32(4, true)).toBe(36 + 12);
  expect([view.getUint16(20, true), view.getUint16(22, true)]).toEqual([1, 1]);
  expect([view.getUint32(24, true), view.getUint32(28, true)]).toEqual([SAMPLE_RATE, 32_000]);
  expect([view.getUint16(32, true), view.getUint16(34, true)]).toEqual([2, 16]);
  expect(new TextDecoder().decode(wav.subarray(36, 40))).toBe('data');
  expect(view.getUint32(40, true)).toBe(12);
  // Full scale is clamped: 1 is 32767, -1 is -32768, and louder samples do not wrap.
  const samples = [0, 1, 2, 3, 4, 5].map((index) => view.getInt16(44 + index * 2, true));
  expect(samples).toEqual([0, 32_767, -32_768, 16_384, 32_767, -32_768]);
  expect(pcm16Wav(new Float32Array(MAX_SAMPLES + 100)).length).toBe(44 + MAX_SAMPLES * 2);
});

test('an asset URL needs the folder from configureVoiceCapture', () => {
  expect(() => assetUrl('silero-vad.onnx')).toThrow('Call configureVoiceCapture');
  configureVoiceCapture({ assetBase: 'https://app.example/voice' });
  expect(assetUrl('silero-vad.onnx').href).toBe('https://app.example/voice/silero-vad.onnx');
  configureVoiceCapture({ assetBase: new URL('https://cdn.example/a/b/') });
  expect(assetUrl('voice-activity-worklet.js').href).toBe(
    'https://cdn.example/a/b/voice-activity-worklet.js',
  );
});

test('the level detector needs no model: every frame counts as speech', async () => {
  expect(await levelDetector.probability(new Float32Array(512))).toBe(1);
  levelDetector.clear();
});
