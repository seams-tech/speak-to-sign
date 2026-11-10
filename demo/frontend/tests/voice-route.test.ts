// The verify input of the page: sealed to the audio key, or a plain WAV without one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIO_KEY, readAudioKey, verifyInput } from '../src/voiceRoute.ts';

const REQUEST = { kind: 'market_bet', market_id: 9 };
const WAV = Uint8Array.from({ length: 100 }, (_, index) => index);
// RFC 7748, section 6.1: Alice's public key.
const KEY_B64 = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString('base64');

test('an audio key is the base64 of 32 bytes', () => {
  assert.equal(readAudioKey(KEY_B64)?.length, 32);
  assert.equal(readAudioKey(` ${KEY_B64}\n`)?.length, 32);
  for (const text of [undefined, '', 'AAAA', 'not base64!']) assert.equal(readAudioKey(text), null);
  // A build without VITE_VOICE_AUDIO_KEY has no key.
  assert.equal(AUDIO_KEY, null);
});

test('without an audio key the recording goes as a plain WAV', async () => {
  const input = await verifyInput('owner.testnet', REQUEST, WAV, null);
  assert.deepEqual(input, {
    op: 'verify',
    owner: 'owner.testnet',
    request: REQUEST,
    contacts: [],
    audio_wav_b64: Buffer.from(WAV).toString('base64'),
  });
});

test('with an audio key the recording goes sealed, and never plain', async () => {
  const input = await verifyInput('owner.testnet', REQUEST, WAV, readAudioKey(KEY_B64));
  assert.deepEqual(Object.keys(input), ['op', 'owner', 'request', 'contacts', 'audio_sealed_b64']);
  const sealed = Buffer.from(String(input.audio_sealed_b64), 'base64');
  // The encapsulated key, the clip and the tag.
  assert.equal(sealed.length, 32 + WAV.length + 16);
  assert.equal(sealed.includes(Buffer.from(WAV.subarray(0, 16))), false);
});
