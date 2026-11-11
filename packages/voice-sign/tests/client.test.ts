// The verifier client against a fake OutLayer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { confirmationRequest } from '@seams/voice-verdict';

import {
  callVerifier,
  callVerifierWithAttestation,
  relayToVerifier,
  VerifierCallError,
  type VerifierConfig,
  type VerifierInput,
} from '../src/client.ts';

const PAYLOAD_SHA256 = '42'.repeat(32);

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
        assert.equal(headers.get('X-Compute-Limit'), null);
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

test('the client gives the attestation URL of the call', async () => {
  const output = { kind: 'seams_voice_enrollment_v3', outcome: 'accept' };
  const reply = {
    call_id: 'c-1',
    status: 'completed',
    output,
    attestation_url: '/attestations/by-call/c-1',
    time_ms: 823,
    instructions: 24078,
    compute_cost: '1000',
  };
  const call = await callVerifierWithAttestation(
    {
      ...CONFIG,
      computeLimit: 50_000,
      fetch: fakeFetch(({ headers }) => {
        assert.equal(headers.get('X-Compute-Limit'), '50000');
        return Response.json(reply);
      }),
    },
    { op: 'enroll', owner: 'app:u', audio_wav_b64: ['a', 'b', 'c'] },
  );
  assert.deepEqual(call, {
    output,
    callId: 'c-1',
    attestationUrl: '/attestations/by-call/c-1',
    timeMs: 823,
    instructions: 24078,
    computeCost: '1000',
  });
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

test('the client takes a sealed recording in place of a plain one', async () => {
  const output = { kind: 'seams_voice_enrollment_v3', outcome: 'accept' };
  let seen: Record<string, unknown> = {};
  const fetch = fakeFetch(({ body }) => {
    seen = body.input as Record<string, unknown>;
    return Response.json({ status: 'completed', output });
  });
  await callVerifier({ ...CONFIG, fetch }, { op: 'enroll', owner: 'app:u', audio_sealed_b64: ['x', 'y', 'z'] });
  assert.deepEqual(seen, { op: 'enroll', owner: 'app:u', audio_sealed_b64: ['x', 'y', 'z'] });
  const sealed = { op: 'transcribe', owner: 'app:u', audio_sealed_b64: 'b' } satisfies VerifierInput;
  // @ts-expect-error A recording is plain or sealed, not both.
  const both = { op: 'transcribe', owner: 'app:u', audio_wav_b64: 'a', audio_sealed_b64: 'b' } satisfies VerifierInput;
  assert.ok(sealed && both);
});

test('the relay sends an input that it does not read and gives the output unchanged', async () => {
  // A Wallet input: the recording is sealed, and the request has fields that this client does not type.
  const input = {
    op: 'verify',
    owner: 'alice.testnet',
    request: { kind: 'seams_voice_spoken_request_v1', network: 'testnet', summary: 'Send five NEAR to bob' },
    contacts: ['bob.testnet'],
    audio_sealed_b64: 'c2VhbGVk',
  };
  const output = { kind: 'seams_voice_verify_output_v2', verdict_json: '{}', signature_b64: 'AA==', public_key: null, ms: { total: 1 } };
  let seen: Record<string, unknown> = {};
  const call = await relayToVerifier(
    {
      ...CONFIG,
      fetch: fakeFetch(({ headers, body }) => {
        assert.equal(headers.get('X-Payment-Key'), 'test-payment-key');
        seen = body;
        return Response.json({ status: 'completed', output, call_id: 'c-2' });
      }),
    },
    input,
  );
  assert.deepEqual(seen.input, input);
  assert.deepEqual(Object.keys(seen).sort(), ['async', 'input', 'resource_limits', 'secrets_ref', 'version_key']);
  assert.deepEqual(call.output, output);
  assert.equal(call.callId, 'c-2');
  // An error output of the verifier is no output of a known kind.
  const error = { kind: 'seams_voice_error_v1', detail: 'audio_sealed_b64 does not open' };
  await assert.rejects(
    relayToVerifier({ ...CONFIG, fetch: fakeFetch(() => Response.json({ status: 'completed', output: error })) }, input),
    (thrown: unknown) => thrown instanceof VerifierCallError && thrown.code === 'output',
  );
});
