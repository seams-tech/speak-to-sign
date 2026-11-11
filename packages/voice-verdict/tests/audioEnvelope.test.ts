// The sealed-audio envelope against the verifier's shared vector
// (crates/voice-verifier/testdata/sealed_audio_v1.json), which the verifier's own tests write and
// open. The same key material must give the same bytes on both sides.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readAudioKeyOutput, sealAudio } from '../src/index.ts';

const VECTOR = JSON.parse(
  readFileSync(new URL('../../../crates/voice-verifier/testdata/sealed_audio_v1.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const field = (name: string) => {
  const value = VECTOR[name];
  if (value === undefined) throw new Error(`vector has no ${name}`);
  return value;
};
const audioKey = fromHex(field('audio_public_key_hex'));
const wav = fromHex(field('plaintext_hex'));

test('seals the vector clip to the vector bytes', async () => {
  const sealed = await sealAudio(audioKey, 'verify', field('owner'), wav, fromHex(field('ephemeral_ikm_hex')));
  assert.equal(toHex(sealed), field('sealed_hex'));
});

test('a new seal has a new ephemeral key and the size of the clip plus 48 bytes', async () => {
  const [first, second] = await Promise.all([
    sealAudio(audioKey, 'verify', field('owner'), wav),
    sealAudio(audioKey, 'verify', field('owner'), wav),
  ]);
  assert.equal(first.length, wav.length + 48);
  assert.notEqual(toHex(first.subarray(0, 32)), toHex(second.subarray(0, 32)));
});

test('the operation and the owner change the tag', async () => {
  const ikm = fromHex(field('ephemeral_ikm_hex'));
  const tag = async (op: 'verify' | 'enroll', owner: string) =>
    toHex((await sealAudio(audioKey, op, owner, wav, ikm)).subarray(-16));
  const base = await tag('verify', field('owner'));
  assert.equal(base, field('sealed_hex').slice(-32));
  assert.notEqual(await tag('enroll', field('owner')), base);
  assert.notEqual(await tag('verify', 'other.testnet'), base);
});

test('refuses an audio key of another length', async () => {
  await assert.rejects(sealAudio(new Uint8Array(31), 'verify', 'o.testnet', new Uint8Array(4)), /32 bytes/);
});

test('reads an audio_key output only with the signature of the verdict key', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const verdictKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  // The verifier signs SHA-256(domain || audio key); the vector holds that message.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, fromHex(field('audio_key_message_hex'))),
  );
  const output = {
    kind: 'seams_voice_audio_key_v1',
    verifier: '0.12.0',
    outcome: 'accept',
    reason: null,
    audio_public_key_b64: Buffer.from(audioKey).toString('base64'),
    signature_b64: Buffer.from(signature).toString('base64'),
    public_key: 'ed25519:unused',
    detail: null,
  };
  assert.equal(toHex((await readAudioKeyOutput(output, verdictKey)) ?? new Uint8Array()), toHex(audioKey));

  const otherKey = new Uint8Array(32).fill(7);
  const swapped = { ...output, audio_public_key_b64: Buffer.from(otherKey).toString('base64') };
  assert.equal(await readAudioKeyOutput(swapped, verdictKey), null);
  assert.equal(await readAudioKeyOutput(output, otherKey), null);
  assert.equal(await readAudioKeyOutput({ ...output, outcome: 'refuse' }, verdictKey), null);
  assert.equal(await readAudioKeyOutput({ ...output, kind: 'seams_voice_error_v1' }, verdictKey), null);
  assert.equal(await readAudioKeyOutput(null, verdictKey), null);
});
