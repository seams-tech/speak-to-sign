/**
 * The audio digest of a verdict, for a WAV that you sent.
 *
 * The verifier decodes the WAV and writes it again with a plain 44-byte header: the canonical
 * WAV. The `audio_digest` of a verdict is the SHA-256 of the canonical WAV, not of the bytes that
 * you sent. A recorder can add other chunks (`LIST`, `FLLR`) or another header, so hash the
 * canonical form. This module records nothing.
 */

const SAMPLE_RATE = 16_000;
const MAX_SAMPLES = 8 * SAMPLE_RATE;

/**
 * The canonical WAV of a 16 kHz mono PCM16 WAV of 1 sample to 8 s, as the verifier writes it.
 * It throws a `RangeError` for audio that the verifier refuses with `audio_invalid`.
 */
export function canonicalWav(wav: Uint8Array): Uint8Array<ArrayBuffer> {
  const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (wav.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new RangeError('not a WAV');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let at = 12;
  let formatOk = false;
  while (at + 8 <= wav.length) {
    const id = text(at);
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    const end = start + size;
    if (id === 'data') {
      if (!formatOk) throw new RangeError('the WAV has data before its format');
      // Some writers set a data size past the end; take what is there.
      const data = wav.subarray(start, Math.min(end, wav.length));
      const samples = Math.floor(data.length / 2);
      if (samples === 0 || samples > MAX_SAMPLES) throw new RangeError('the WAV must have 1 sample to 8 s of audio');
      const out = new Uint8Array(44 + samples * 2);
      const header = new DataView(out.buffer);
      const ascii = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
      };
      ascii(0, 'RIFF');
      header.setUint32(4, 36 + samples * 2, true);
      ascii(8, 'WAVEfmt ');
      header.setUint32(16, 16, true);
      header.setUint16(20, 1, true);
      header.setUint16(22, 1, true);
      header.setUint32(24, SAMPLE_RATE, true);
      header.setUint32(28, SAMPLE_RATE * 2, true);
      header.setUint16(32, 2, true);
      header.setUint16(34, 16, true);
      ascii(36, 'data');
      header.setUint32(40, samples * 2, true);
      out.set(data.subarray(0, samples * 2), 44);
      return out;
    }
    if (end > wav.length) throw new RangeError('the WAV has a bad chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new RangeError('the WAV has a bad format chunk');
      const tag = view.getUint16(start, true);
      // WAVE_FORMAT_EXTENSIBLE: the sub-format starts with the tag.
      const pcm = tag === 1 || (tag === 0xfffe && size >= 26 && view.getUint16(start + 24, true) === 1);
      const mono16k = view.getUint16(start + 2, true) === 1 && view.getUint32(start + 4, true) === SAMPLE_RATE;
      if (!pcm || !mono16k || view.getUint16(start + 14, true) !== 16) {
        throw new RangeError('the WAV must be 16 kHz mono PCM16');
      }
      formatOk = true;
    }
    // Chunks are padded to an even size.
    at = end + (size & 1);
  }
  throw new RangeError('the WAV has no data');
}

/** SHA-256 of the canonical WAV: the `audio_digest` of a verdict for this recording. */
export async function audioDigest(wav: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalWav(wav)));
}
