// The audio that the verifier takes: one 16 kHz mono PCM16 WAV of at most 8 s
// (crates/voice-verifier: SAMPLE_RATE and MAX_SAMPLES). Pure functions, so a unit test can
// check them without a browser.

export const WAV_SAMPLE_RATE = 16_000;
export const MAX_SECONDS = 8;
export const MAX_SAMPLES = MAX_SECONDS * WAV_SAMPLE_RATE;
const HEADER_BYTES = 44;

/**
 * Resamples mono samples to 16 kHz. To go down, each output sample is the mean of the input
 * samples in its time window, which also filters out most of the sound above 8 kHz. To go up,
 * it interpolates between the two nearest input samples.
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (!(inputRate > 0)) throw new Error('The input sample rate must be above zero.');
  if (inputRate === WAV_SAMPLE_RATE) return input.slice();
  const ratio = inputRate / WAV_SAMPLE_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  if (ratio > 1) {
    for (let index = 0; index < length; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let source = start; source < end; source += 1) sum += input[source] ?? 0;
      output[index] = sum / (end - start);
    }
    return output;
  }
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const weight = position - left;
    output[index] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight;
  }
  return output;
}

/** Float samples (-1 to 1) to PCM16. Values outside the range are clipped. */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return pcm;
}

/** A RIFF WAV: a 44-byte header, then the PCM16 samples (little-endian), mono, 16 kHz. */
export function encodeWav(pcm: Int16Array): Uint8Array {
  const dataBytes = pcm.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < pcm.length; index += 1) view.setInt16(HEADER_BYTES + index * 2, pcm[index] ?? 0, true);
  return bytes;
}

/** The verifier's WAV from mono samples at any rate: resampled, cut to 8 s and encoded. */
export function wavFromSamples(samples: Float32Array, inputRate: number): Uint8Array {
  return encodeWav(toPcm16(resampleTo16k(samples, inputRate).subarray(0, MAX_SAMPLES)));
}

/** Standard base64 (the verifier's `audio_wav_b64`). */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
