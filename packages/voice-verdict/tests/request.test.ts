// The confirmation encoder against the golden vectors of `crates/spoken-intent`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { confirmationRequest } from '../src/index.ts';

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
