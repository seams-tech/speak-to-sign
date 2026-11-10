// The sealed-audio envelope against the verifier's shared vector
// (crates/voice-verifier/testdata/sealed_audio_v1.json), which the verifier's own tests write and
// open. The same key material must give the same bytes on both sides.

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readAudioKeyOutput, sealAudio, sealAudioFromIkm, sealedBase64 } from '../src/audioEnvelope';

const VECTOR = JSON.parse(
  readFileSync(new URL('../../../crates/voice-verifier/testdata/sealed_audio_v1.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const field = (name: string) => {
  const value = VECTOR[name];
  if (value === undefined) throw new Error(`vector has no ${name}`);
  return value;
};

test('seals the vector clip to the vector bytes', async () => {
  const sealed = await sealAudioFromIkm(
    fromHex(field('ephemeral_ikm_hex')),
    fromHex(field('audio_public_key_hex')),
    'verify',
    field('owner'),
    fromHex(field('plaintext_hex')),
  );
  expect(toHex(sealed)).toBe(field('sealed_hex'));
});

test('a new seal has a new ephemeral key and the size of the clip plus 48 bytes', async () => {
  const audioKey = fromHex(field('audio_public_key_hex'));
  const wav = fromHex(field('plaintext_hex'));
  const [first, second] = await Promise.all([
    sealAudio(audioKey, 'verify', field('owner'), wav),
    sealAudio(audioKey, 'verify', field('owner'), wav),
  ]);
  expect(first.length).toBe(wav.length + 48);
  expect(toHex(first.subarray(0, 32))).not.toBe(toHex(second.subarray(0, 32)));
  expect(sealedBase64(first)).toBe(Buffer.from(first).toString('base64'));
});

test('refuses an audio key of another length', async () => {
  await expect(sealAudio(new Uint8Array(31), 'verify', 'o.testnet', new Uint8Array(4))).rejects.toThrow('32 bytes');
});

test('reads an audio_key output only with the signature of the verdict key', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const verdictKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const audioKey = fromHex(field('audio_public_key_hex'));
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
  expect(toHex((await readAudioKeyOutput(output, verdictKey)) ?? new Uint8Array())).toBe(toHex(audioKey));

  const otherKey = new Uint8Array(32).fill(7);
  const swapped = { ...output, audio_public_key_b64: Buffer.from(otherKey).toString('base64') };
  expect(await readAudioKeyOutput(swapped, verdictKey)).toBeNull();
  expect(await readAudioKeyOutput(output, otherKey)).toBeNull();
  expect(await readAudioKeyOutput({ ...output, outcome: 'refuse' }, verdictKey)).toBeNull();
  expect(await readAudioKeyOutput({ ...output, kind: 'seams_voice_error_v1' }, verdictKey)).toBeNull();
  expect(await readAudioKeyOutput(null, verdictKey)).toBeNull();
});
