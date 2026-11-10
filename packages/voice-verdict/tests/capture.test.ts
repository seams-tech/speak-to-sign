// The WAV writer and the energy gate against the verifier's rules
// (`crates/voice-verifier/src/audio.rs`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { audioDigest, encodeWav, energyGate, toBase64, toPcm16 } from '../src/capture.ts';

/** The `tone` of the verifier's tests: `ms` of a sine at `amplitude`. */
function tone(ms: number, amplitude: number): Int16Array {
  const pcm = new Int16Array((ms * 16_000) / 1_000);
  for (let index = 0; index < pcm.length; index += 1) {
    pcm[index] = Math.trunc(Math.fround(Math.fround(Math.sin(Math.fround(index * Math.fround(0.1)))) * amplitude) * 32_767);
  }
  return pcm;
}

test('the canonical WAV has the 44-byte header of the verifier', async () => {
  const wav = encodeWav(Int16Array.of(1, -2, 32_767, -32_768));
  assert.equal(
    Buffer.from(wav).toString('hex'),
    '524946462c00000057415645666d7420' + '1000000001000100803e0000007d0000' + '0200100064617461080000000100feffff7f0080',
  );
  assert.equal(encodeWav(new Int16Array(0)).length, 44);
  assert.equal((await audioDigest(wav)).length, 32);
  assert.equal(toBase64(Uint8Array.of(0x52, 0x49, 0x46, 0x46)), 'UklGRg==');
  // A long clip does not overflow the call stack.
  assert.equal(toBase64(new Uint8Array(300_000)).length, 400_000);
});

test('float samples become PCM16', () => {
  assert.deepEqual(Array.from(toPcm16(Float32Array.of(0, 1, -1, 2, -2, 0.5))), [0, 32_767, -32_768, 32_767, -32_768, 16_384]);
});

test('the energy gate', () => {
  // 600 ms of voiced frames pass. Frames are 512 samples, so 608 ms are 19 frames.
  assert.equal(energyGate(tone(1_000, 0.1)).passes, true);
  assert.equal(energyGate(tone(1_000, 0.1)).voicedMs, 1_000);
  assert.equal(energyGate(tone(500, 0.1)).passes, false);
  // Silence, and a level below the threshold.
  assert.deepEqual(energyGate(new Int16Array(16_000)), { voicedMs: 0, clippedPermille: 0, passes: false });
  assert.equal(energyGate(tone(1_000, 0.001)).passes, false);
  // More than 1% of the samples at full scale.
  const clipped = tone(1_000, 0.1);
  clipped.fill(32_767, 0, 200);
  assert.equal(energyGate(clipped).clippedPermille, 12);
  assert.equal(energyGate(clipped).passes, false);
  clipped.fill(0, 50, 200);
  assert.equal(energyGate(clipped).passes, true);
  assert.deepEqual(energyGate(new Int16Array(0)), { voicedMs: 0, clippedPermille: 0, passes: false });
});
