// The server side against a fake verifier that signs as the real one does, with a test key.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { audioDigest, confirmationRequest, TRANSCRIPT_DOMAIN, VERDICT_DOMAIN } from '@seams/voice-verdict';

import { createSpeakToSign, type Action, type SpeakToSignConfig } from '../src/server.ts';

/** A test key. Never use it outside tests. */
const SEED_HEX = '2a'.repeat(32);
const PUBLIC_KEY = 'ed25519:2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ';
const NOW = 1_762_700_000_000;
const OWNER = 'app:user-42';

const ACTIONS: Action[] = [
  { context: 'shop.example/order', summary: 'Pay forty dollars for two books', payload: new TextEncoder().encode('order 1') },
  { context: 'shop.example/order', summary: 'Cancel my order', payload: new TextEncoder().encode('cancel 1') },
];

/** A plain WAV of `samples` samples. Each count is another recording. */
function wav(samples: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

async function sign(domain: string, text: string): Promise<string> {
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED_HEX, 'hex')]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const message = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(domain + text));
  return Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, key, message)).toString('base64');
}

interface Fake {
  /** The index of the request that the "user said", or `null` for other words. */
  said: number | null;
  /** The fake reports this index as `selected`. Default: `said`. */
  reportSelected?: number;
  /** The fake signs the verdict for the request at this index. Default: `said`. */
  signFor?: number;
  speaker?: boolean;
  attestationUrl?: string | null;
  calls: Record<string, unknown>[];
}

function fakeVerifier(fake: Fake): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)).input as Record<string, any>;
    fake.calls.push(input);
    const reply = (output: unknown) =>
      Response.json({ call_id: 'c-1', status: 'completed', output, ...(fake.attestationUrl ? { attestation_url: fake.attestationUrl } : {}) });
    if (input.op === 'enroll') {
      return reply({
        kind: 'seams_voice_enrollment_v3',
        verifier: 'test',
        owner: input.owner,
        outcome: fake.speaker === false ? 'refuse' : 'accept',
        reason: fake.speaker === false ? 'speaker' : null,
        agreement_milli: 801,
        audio_digests: [],
        enrollment_digest: null,
        template_epoch: fake.speaker === false ? null : 1,
        verifier_public_key: PUBLIC_KEY,
        ms: {},
        detail: null,
      });
    }
    const recording = Buffer.from(await audioDigest(new Uint8Array(Buffer.from(input.audio_wav_b64, 'base64')))).toString('base64url');
    if (input.op === 'transcribe') {
      const transcript = JSON.stringify({
        kind: 'seams_voice_signed_transcript_v1',
        verifier: 'test',
        owner: input.owner,
        audio_digest: recording,
        outcome: fake.speaker === false ? 'refuse' : 'accept',
        reason: fake.speaker === false ? 'speaker' : null,
        expires_at_ms: NOW + 120_000,
        speaker_score_milli: 700,
        text: fake.speaker === false ? null : 'book a table for two',
      });
      return reply({
        kind: 'seams_voice_transcript_output_v1',
        transcript_json: transcript,
        signature_b64: await sign(TRANSCRIPT_DOMAIN, transcript),
        public_key: PUBLIC_KEY,
        ms: {},
        detail: null,
      });
    }
    const requests: Record<string, string>[] = input.op === 'select' ? input.requests : [input.request];
    const index = fake.signFor ?? fake.said;
    const accepted = fake.speaker !== false && index !== null;
    let digest: string | null = null;
    if (accepted) {
      const request = requests[index]!;
      const built = await confirmationRequest({
        owner: input.owner,
        context: request.context!,
        summary: request.summary!,
        payloadSha256: request.payload_sha256_hex!,
      });
      digest = Buffer.from(built.digest).toString('base64url');
    }
    const verdict = JSON.stringify({
      kind: 'seams_voice_signed_verdict_v2',
      renderer: 'spoken-intent/1',
      verifier: 'test',
      request_digest: digest,
      spoken_text_digest: null,
      audio_digest: recording,
      outcome: accepted ? 'accept' : 'refuse',
      reason: accepted ? null : fake.speaker === false ? 'speaker' : 'words',
      policy_rule: null,
      expires_at_ms: NOW + 120_000,
      speaker_score_milli: 700,
      word_margin_milli: null,
      heard: fake.speaker === false ? null : accepted ? requests[index!]!.summary!.toLowerCase() : 'something else',
    });
    const selected = fake.reportSelected ?? (accepted && input.op === 'select' ? index : undefined);
    return reply({
      kind: 'seams_voice_verify_output_v2',
      verdict_json: verdict,
      signature_b64: await sign(VERDICT_DOMAIN, verdict),
      public_key: PUBLIC_KEY,
      policy_text: null,
      ms: {},
      detail: null,
      ...(selected === undefined ? {} : { selected }),
    });
  }) as typeof fetch;
}

function server(fake: Fake, extra: Partial<SpeakToSignConfig> = {}) {
  return createSpeakToSign({
    verifier: {
      baseUrl: 'https://outlayer.test',
      project: 'dev.testnet/voice-verifier',
      paymentKey: 'test-payment-key',
      secretsRef: { profile: 'main', account_id: 'dev.testnet' },
      fetch: fakeVerifier(fake),
    },
    verifierPublicKey: PUBLIC_KEY,
    now: () => NOW,
    ...extra,
  });
}

test('enroll sends three recordings and gives the key to pin', async () => {
  const fake: Fake = { said: null, calls: [] };
  const enrolled = await server(fake).enroll({ owner: OWNER, recordings: [wav(10), wav(11), Buffer.from(wav(12)).toString('base64')] });
  assert.deepEqual(enrolled, { ok: true, templateEpoch: 1, agreementMilli: 801, verifierPublicKey: PUBLIC_KEY });
  assert.equal(fake.calls[0]!.op, 'enroll');
  assert.equal((fake.calls[0]!.audio_wav_b64 as string[]).length, 3);
  assert.equal('authorization' in fake.calls[0]!, false);

  const refused = await server({ said: null, speaker: false, calls: [] }).enroll({ owner: OWNER, recordings: [wav(10), wav(11), wav(12)] });
  assert.deepEqual(refused, { ok: false, reason: 'speaker', detail: null });
  // Two recordings, or bytes that are not a WAV, make no call.
  const none: Fake = { said: null, calls: [] };
  assert.equal((await server(none).enroll({ owner: OWNER, recordings: [wav(10), wav(11)] })).ok, false);
  assert.equal((await server(none).enroll({ owner: OWNER, recordings: [wav(10), wav(11), new Uint8Array(50)] })).ok, false);
  assert.equal(none.calls.length, 0);
});

test('confirm passes only for the request and the recording of this call, one time', async () => {
  const fake: Fake = { said: 0, calls: [] };
  const app = server(fake);
  const confirmed = await app.confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(20) });
  assert.ok(confirmed.ok);
  assert.equal(confirmed.heard, 'pay forty dollars for two books');
  assert.equal(fake.calls[0]!.op, 'verify');
  // The same verdict again (a replay of the reply) confirms nothing.
  const again = await app.confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(20) });
  assert.deepEqual(again, { ok: false, reason: 'verdict_reused', heard: 'pay forty dollars for two books' });

  // Other words, and another voice.
  const words = await server({ said: null, calls: [] }).confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(21) });
  assert.deepEqual(words, { ok: false, reason: 'words', heard: 'something else' });
  const voice = await server({ said: 0, speaker: false, calls: [] }).confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(22) });
  assert.deepEqual(voice, { ok: false, reason: 'speaker', heard: null });
  // Another pinned key.
  const otherKey = await server({ said: 0, calls: [] }, { verifierPublicKey: `ed25519:${'1'.repeat(32)}` }).confirm({
    owner: OWNER,
    action: ACTIONS[0]!,
    recording: wav(23),
  });
  assert.equal(!otherKey.ok && otherKey.reason, 'bad_signature');
  // An expired verdict.
  const late = await server({ said: 0, calls: [] }, { now: () => NOW + 120_001 }).confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(24) });
  assert.equal(!late.ok && late.reason, 'expired');
  const bad = await server({ said: 0, calls: [] }).confirm({ owner: OWNER, action: ACTIONS[0]!, recording: 'not base64!' });
  assert.equal(!bad.ok && bad.reason, 'bad_audio');
});

test('select gives the index that the signed verdict is for', async () => {
  const fake: Fake = { said: 1, calls: [] };
  const selected = await server(fake).select({ owner: OWNER, actions: ACTIONS, recording: wav(30) });
  assert.ok(selected.ok);
  assert.equal(selected.index, 1);
  assert.equal(selected.heard, 'cancel my order');
  assert.equal((fake.calls[0]!.requests as unknown[]).length, 2);

  // `selected` is not signed: a reply that names another index than its verdict is refused.
  const lie = await server({ said: 1, reportSelected: 0, calls: [] }).select({ owner: OWNER, actions: ACTIONS, recording: wav(31) });
  assert.equal(!lie.ok && lie.reason, 'request_mismatch');
  const outOfRange = await server({ said: 1, reportSelected: 7, calls: [] }).select({ owner: OWNER, actions: ACTIONS, recording: wav(32) });
  assert.equal(!outOfRange.ok && outOfRange.reason, 'request_mismatch');
  const none = await server({ said: null, calls: [] }).select({ owner: OWNER, actions: ACTIONS, recording: wav(33) });
  assert.deepEqual(none, { ok: false, reason: 'words', heard: 'something else' });
});

test('transcribe gives the signed text of this owner', async () => {
  const heard = await server({ said: null, calls: [] }).transcribe({ owner: OWNER, recording: wav(40) });
  assert.deepEqual(heard, { ok: true, text: 'book a table for two' });
  const voice = await server({ said: null, speaker: false, calls: [] }).transcribe({ owner: OWNER, recording: wav(41) });
  assert.deepEqual(voice, { ok: false, reason: 'speaker', heard: null });
});

test('with the attestation setting, a call with no quote confirms nothing', async () => {
  const settings = { attestation: { acceptedWasmHashes: ['ab'.repeat(32)] } };
  const missing = await server({ said: 0, calls: [] }, settings).confirm({ owner: OWNER, action: ACTIONS[0]!, recording: wav(50) });
  assert.deepEqual(missing, { ok: false, reason: 'attestation_missing', heard: 'pay forty dollars for two books' });
  // The fake has no attestation record to serve.
  const wrong = await server({ said: 0, attestationUrl: '/attestations/by-call/c-1', calls: [] }, settings).confirm({
    owner: OWNER,
    action: ACTIONS[0]!,
    recording: wav(51),
  });
  assert.equal(!wrong.ok && wrong.reason, 'attestation_unavailable');
});
