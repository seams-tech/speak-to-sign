// The confirmation encoder against the golden vectors of `crates/spoken-intent`, and the client
// against a fake OutLayer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { callVerifier, confirmationRequest, VerifierCallError, type VerifierConfig } from '../src/index.ts';

const vectors = JSON.parse(
  readFileSync(new URL('../../../crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json', import.meta.url), 'utf8'),
) as { requests: { name: string; borsh_hex: string; request_digest_hex: string }[] };

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const PAYLOAD_SHA256 = '42'.repeat(32);

// The fields of the `confirmation_*` cases of `crates/spoken-intent/tests/vectors.rs`.
const CASES = [
  { name: 'confirmation_login', owner: 'app:user-42', context: 'shop.example/login', summary: 'Log in to the example shop' },
  { name: 'confirmation_order', owner: 'app:shop.example:42', context: 'shop.example/checkout', summary: 'Pay forty dollars for two books.' },
  { name: 'confirmation_other_chain', owner: 'app:u', context: 'eip155:1/transfer', summary: 'Approve' },
];

test('a confirmation has the Borsh bytes and the digest of the golden vectors', async () => {
  for (const { name, ...fields } of CASES) {
    const vector = vectors.requests.find((item) => item.name === name);
    assert.ok(vector, name);
    const built = await confirmationRequest({ ...fields, payloadSha256: PAYLOAD_SHA256 });
    assert.equal(hex(built.borsh), vector.borsh_hex, name);
    assert.equal(hex(built.digest), vector.request_digest_hex, name);
    assert.deepEqual(built.request, {
      kind: 'confirmation',
      context: fields.context,
      payload_sha256_hex: PAYLOAD_SHA256,
      summary: fields.summary,
    });
    const fromBytes = await confirmationRequest({ ...fields, payloadSha256: new Uint8Array(32).fill(0x42) });
    assert.equal(hex(fromBytes.digest), vector.request_digest_hex);
  }
});

test('a payload is bound by its SHA-256', async () => {
  const fields = { owner: 'app:u', context: 'login', summary: 'Log in' };
  const built = await confirmationRequest({ ...fields, payload: new TextEncoder().encode('abc') });
  assert.equal(built.request.payload_sha256_hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const other = await confirmationRequest({ ...fields, payload: new TextEncoder().encode('abd') });
  assert.notEqual(hex(built.digest), hex(other.digest));
});

test('fields that the verifier refuses', async () => {
  const good = { owner: 'app:u', context: 'login', summary: 'Log in', payloadSha256: PAYLOAD_SHA256 };
  const bad = [
    { ...good, owner: 'alice.testnet' },
    { ...good, owner: 'app:' },
    { ...good, owner: 'app:User' },
    { ...good, owner: `app:${'a'.repeat(97)}` },
    { ...good, context: '' },
    { ...good, context: 'Shop' },
    { ...good, context: 'a'.repeat(65) },
    { ...good, payloadSha256: '42' },
    { ...good, payloadSha256: PAYLOAD_SHA256.toUpperCase().replace(/4/g, 'A') },
    { ...good, payloadSha256: new Uint8Array(31) },
    { ...good, payload: new Uint8Array(1) },
    { owner: 'app:u', context: 'login', summary: 'Log in' },
  ];
  for (const fields of bad) {
    await assert.rejects(confirmationRequest(fields), RangeError, JSON.stringify(fields));
  }
});

const CONFIG: VerifierConfig = {
  baseUrl: 'https://outlayer.test/',
  project: 'dev.testnet/voice-verifier',
  paymentKey: 'test-payment-key',
  versionKey: 'ab'.repeat(32),
  secretsRef: { profile: 'main', account_id: 'dev.testnet' },
};

function fakeFetch(reply: (request: { url: string; headers: Headers; body: Record<string, unknown> }) => Response) {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    reply({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })) as typeof fetch;
}

test('the client sends the input with the payment key in a header', async () => {
  const output = { kind: 'seams_voice_verify_output_v2', verdict_json: '{}', signature_b64: 'AA==', selected: 1 };
  const built = await confirmationRequest({ owner: 'app:u', context: 'login', summary: 'Log in', payloadSha256: PAYLOAD_SHA256 });
  let seen: Record<string, unknown> = {};
  const result = await callVerifier(
    {
      ...CONFIG,
      fetch: fakeFetch(({ url, headers, body }) => {
        assert.equal(url, 'https://outlayer.test/call/dev.testnet/voice-verifier');
        assert.equal(headers.get('X-Payment-Key'), 'test-payment-key');
        seen = body;
        return Response.json({ status: 'completed', output });
      }),
    },
    { op: 'verify', owner: built.owner, request: built.request, contacts: [], audio_wav_b64: 'UklGRg==' },
  );
  assert.deepEqual(result, output);
  assert.equal(seen.async, false);
  assert.equal(seen.version_key, CONFIG.versionKey);
  assert.deepEqual(seen.secrets_ref, CONFIG.secretsRef);
  assert.equal((seen.input as { op: string }).op, 'verify');
  // The payment key is in no part of the body.
  assert.ok(!JSON.stringify(seen).includes('test-payment-key'));
});

test('the client reports a call that gave no verifier output', async () => {
  const input = { op: 'enroll' as const, owner: 'app:u', audio_wav_b64: ['a', 'b', 'c'] };
  const replies: [Response, VerifierCallError['code']][] = [
    [new Response('no', { status: 402 }), 'http'],
    [new Response('not json'), 'output'],
    [Response.json({ status: 'failed', output: null }), 'output'],
    [Response.json({ error: 'fuel' }), 'output'],
    [Response.json({ status: 'completed', output: { kind: 'seams_voice_error_v1' } }), 'output'],
  ];
  for (const [reply, code] of replies) {
    await assert.rejects(
      callVerifier({ ...CONFIG, fetch: fakeFetch(() => reply) }, input),
      (error: unknown) => error instanceof VerifierCallError && error.code === code,
    );
  }
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(callVerifier({ ...CONFIG, fetch: down }, input), (error: unknown) => error instanceof VerifierCallError && error.code === 'network');
  await assert.rejects(callVerifier({ ...CONFIG, baseUrl: 'http://outlayer.test' }, input), RangeError);
  await assert.rejects(callVerifier({ ...CONFIG, project: 'nope' }, input), RangeError);
});
