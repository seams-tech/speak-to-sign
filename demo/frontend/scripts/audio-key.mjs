// Prints the voice verifier's audio key for VITE_VOICE_AUDIO_KEY, after a check of its signature.
//
//   node --env-file=.dev.vars scripts/audio-key.mjs ed25519:<the verdict key that the contract pins>
//
// It runs the verifier's `audio_key` op through OutLayer with the VOICE_OUTLAYER_* settings of the
// verify route (functions/api/voice-verify.ts), so the answer comes from the same project, version
// and secrets profile. The verifier signs the audio key with its verdict key. This script prints
// the key only if that signature passes for the verdict key on the command line. Take that key
// from the contract, not from this answer.
//
// The payment key goes only into the X-Payment-Key header. It is never printed.

import { readAudioKeyOutput } from '../../../packages/wallet-voice-sign/src/audioEnvelope.ts';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The 32 bytes of `ed25519:<base58>`, or null. */
function readVerdictKey(text) {
  const match = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(text ?? '');
  if (!match) return null;
  let value = 0n;
  for (const char of match[1]) value = value * 58n + BigInt(BASE58.indexOf(char));
  const hex = value.toString(16).padStart(64, '0');
  return hex.length === 64 ? Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16)) : null;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const verdictKey = readVerdictKey(process.argv[2]);
if (!verdictKey) fail('give the verdict key as ed25519:<base58>');

const names = ['BASE_URL', 'PROJECT', 'VERSION_KEY', 'PAYMENT_KEY', 'SECRETS_PROFILE', 'SECRETS_ACCOUNT_ID'];
const [baseUrl, project, versionKey, paymentKey, profile, accountId] = names.map((name) => {
  const value = (process.env[`VOICE_OUTLAYER_${name}`] ?? '').trim();
  if (value === '') fail(`VOICE_OUTLAYER_${name} is not set`);
  return value;
});

const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/call/${project}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Payment-Key': paymentKey },
  body: JSON.stringify({
    input: { op: 'audio_key' },
    async: false,
    version_key: versionKey,
    secrets_ref: { profile, account_id: accountId },
    resource_limits: { max_instructions: 1_000_000_000, max_memory_mb: 128, max_execution_seconds: 15 },
  }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) fail(`OutLayer answered ${response.status}`);
const reply = await response.json();
const output = typeof reply.output === 'string' ? JSON.parse(reply.output) : reply.output;
if (output?.outcome !== 'accept') fail(`the verifier refused: ${output?.reason ?? 'no output'} ${output?.detail ?? ''}`);

const audioKey = await readAudioKeyOutput(output, verdictKey);
if (!audioKey) fail(`the verdict key ${process.argv[2]} did not sign this audio key (the verifier signed with ${output.public_key})`);
console.log(`VITE_VOICE_AUDIO_KEY=${Buffer.from(audioKey).toString('base64')}`);
