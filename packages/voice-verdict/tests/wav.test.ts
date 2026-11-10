// The canonical WAV against the verifier's rules (`crates/voice-verifier/src/audio.rs`).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { audioDigest, canonicalWav } from '../src/index.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** The verifier's 44-byte header for `samples` samples, then the samples. */
function plain(samples: number[]): Uint8Array {
  const header = Buffer.from('52494646' + '00000000' + '57415645666d7420' + '10000000' + '0100' + '0100' + '803e0000' + '007d0000' + '0200' + '1000' + '64617461' + '00000000', 'hex');
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.writeUInt32LE(samples.length * 2, 40);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  return new Uint8Array(Buffer.concat([header, data]));
}

test('a plain WAV is its own canonical WAV', async () => {
  const wav = plain([1, -2, 32_767, -32_768]);
  assert.equal(hex(canonicalWav(wav)), hex(wav));
  assert.equal(hex(await audioDigest(wav)), createHash('sha256').update(wav).digest('hex'));
});

test('other chunks and another header give the same canonical WAV', async () => {
  const wav = plain([1, -2, 3]);
  // A LIST chunk of an odd size (padded) before the data, as ffmpeg and macOS `say` write one.
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc\0')]);
  const withList = new Uint8Array(Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]));
  assert.equal(hex(canonicalWav(withList)), hex(wav));
  assert.equal(hex(await audioDigest(withList)), hex(await audioDigest(wav)));
  // A data size past the end, and a view into a larger buffer.
  const long = Uint8Array.from(wav);
  new DataView(long.buffer).setUint32(40, 1_000, true);
  assert.equal(hex(canonicalWav(long)), hex(wav));
  const padded = new Uint8Array(wav.length + 10);
  padded.set(wav, 5);
  assert.equal(hex(canonicalWav(padded.subarray(5, 5 + wav.length))), hex(wav));
});

test('audio that the verifier refuses', () => {
  const wav = plain([1, 2]);
  const change = (edit: (bytes: Uint8Array, view: DataView) => void) => {
    const copy = Uint8Array.from(wav);
    edit(copy, new DataView(copy.buffer));
    return copy;
  };
  const bad = [
    new Uint8Array(4),
    change((bytes) => bytes.set([0x58], 0)),
    change((_, view) => view.setUint16(22, 2, true)), // stereo
    change((_, view) => view.setUint32(24, 44_100, true)),
    change((_, view) => view.setUint16(34, 8, true)),
    change((_, view) => view.setUint16(20, 3, true)), // float
    plain([]),
    plain(new Array(8 * 16_000 + 1).fill(0)),
    wav.subarray(0, 36),
  ];
  for (const bytes of bad) assert.throws(() => canonicalWav(bytes), RangeError);
});
