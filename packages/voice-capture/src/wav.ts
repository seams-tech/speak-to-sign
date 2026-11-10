export const SAMPLE_RATE = 16_000;
/** The Speak-to-Sign verifier refuses audio longer than 8 s. */
export const MAX_SAMPLES = 8 * SAMPLE_RATE;

/**
 * 16 kHz mono PCM16 with the plain 44-byte header that the Speak-to-Sign verifier writes for its
 * canonical WAV, so the SHA-256 of these bytes is the audio digest of a verdict. Samples after
 * 8 s are left out.
 */
export function pcm16Wav(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const count = Math.min(samples.length, MAX_SAMPLES);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  writeAscii(bytes, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1)
    bytes[offset + index] = text.charCodeAt(index);
}
