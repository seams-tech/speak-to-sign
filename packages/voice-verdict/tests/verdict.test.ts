// The shared vectors: the signed verdicts that `crates/voice-verifier/tests/signed_vector.rs`
// writes, and the request vectors of `crates/spoken-intent`. The test key is for tests only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkVerdict, parsePublicKey, parseVerdict, requestDigest, verdictMessage } from '../src/index.ts';

interface SignedCase {
  name: string;
  outcome: string;
  policy_rule: string | null;
  request_borsh_hex: string;
  request_digest: string;
  audio_digest: string;
  expires_at_ms: number;
  verdict_json: string;
  message_sha256_hex: string;
  signature_b64: string;
}

const crates = new URL('../../../crates/', import.meta.url);
const signed = JSON.parse(
  readFileSync(new URL('voice-verifier/testdata/signed_verdict_v2.json', crates), 'utf8'),
) as { public_key: string; public_key_hex: string; test_seed_hex: string; verdicts: SignedCase[] };
const requests = JSON.parse(
  readFileSync(new URL('spoken-intent/fixtures/spoken_intent_vectors_v1.json', crates), 'utf8'),
) as { requests: { name: string; borsh_hex: string; request_digest_hex: string }[] };

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const unhex = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'hex'));

function vector(name: string): SignedCase {
  const found = signed.verdicts.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

/** The check input of a vector, at a time before its expiry. */
function input(item: SignedCase) {
  return {
    verdictJson: item.verdict_json,
    signatureB64: item.signature_b64,
    publicKey: signed.public_key,
    nowMs: item.expires_at_ms - 1,
  };
}

/** Signs a verdict text with the test key of the vector file. */
async function sign(verdictJson: string): Promise<string> {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signed.test_seed_hex, 'hex'),
  ]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, await verdictMessage(verdictJson));
  return Buffer.from(signature).toString('base64');
}

/** A check of a verdict text that the test key signs here. */
async function checkSigned(verdictJson: string, nowMs = 0) {
  return checkVerdict({ verdictJson, signatureB64: await sign(verdictJson), publicKey: signed.public_key, nowMs });
}

test('the signed message of each vector', async () => {
  assert.equal(signed.verdicts.length, 2);
  for (const item of signed.verdicts) {
    assert.equal(hex(await verdictMessage(item.verdict_json)), item.message_sha256_hex, item.name);
  }
});

test('the accept vector passes with each form of the key and of the digest', async () => {
  const item = vector('accept');
  const digestBytes = await requestDigest(unhex(item.request_borsh_hex));
  for (const publicKey of [signed.public_key, signed.public_key_hex, unhex(signed.public_key_hex)]) {
    for (const digest of [item.request_digest, hex(digestBytes), digestBytes]) {
      const result = await checkVerdict({ ...input(item), publicKey, requestDigest: digest, audioDigest: item.audio_digest });
      assert.ok(result.ok);
      assert.equal(result.verdict.outcome, 'accept');
      assert.equal(result.verdict.heard, 'send two near to alice dot testnet');
      assert.equal(result.verdict.speaker_score_milli, 655);
    }
  }
});

test('the request digest of the vector is the digest of its Borsh bytes', async () => {
  for (const item of signed.verdicts) {
    const digest = await requestDigest(unhex(item.request_borsh_hex));
    assert.equal(Buffer.from(digest).toString('base64url'), item.request_digest, item.name);
  }
});

test('the request digest of every spoken-intent vector', async () => {
  // Tag 1 (a multisig approval) has its own digest, of the commitment and not of the proposal.
  const plain = requests.requests.filter((item) => !item.borsh_hex.startsWith('01'));
  assert.ok(plain.length >= 27);
  assert.ok(plain.length < requests.requests.length);
  for (const item of plain) {
    assert.equal(hex(await requestDigest(unhex(item.borsh_hex))), item.request_digest_hex, item.name);
  }
  await assert.rejects(requestDigest(unhex(requests.requests.find((item) => item.borsh_hex.startsWith('01'))!.borsh_hex)));
  await assert.rejects(requestDigest(new Uint8Array(0)));
});

test('a step-up verdict passes only on request', async () => {
  const item = vector('step_up');
  const result = await checkVerdict(input(item));
  assert.ok(!result.ok);
  assert.equal(result.refusal.code, 'step_up');
  assert.equal(result.refusal.code === 'step_up' && result.refusal.policyRule, 'stub_voice_amount_above_10_near');
  const allowed = await checkVerdict({ ...input(item), acceptStepUp: true, requestDigest: item.request_digest });
  assert.ok(allowed.ok);
  assert.equal(allowed.verdict.policy_rule, item.policy_rule);
});

test('an expired verdict', async () => {
  const item = vector('accept');
  assert.ok((await checkVerdict({ ...input(item), nowMs: item.expires_at_ms })).ok);
  const late = await checkVerdict({ ...input(item), nowMs: item.expires_at_ms + 1 });
  assert.ok(!late.ok);
  assert.deepEqual({ ...late.refusal, verdict: undefined }, {
    code: 'expired',
    expiresAtMs: item.expires_at_ms,
    verdict: undefined,
  });
  // The default clock is after the fixed expiry of the vectors.
  const now = await checkVerdict({ ...input(item), nowMs: undefined });
  assert.equal(!now.ok && now.refusal.code, 'expired');
});

test('a verdict for another request or another recording', async () => {
  const accept = vector('accept');
  const other = vector('step_up');
  const request = await checkVerdict({ ...input(accept), requestDigest: other.request_digest });
  assert.equal(!request.ok && request.refusal.code, 'request_mismatch');
  const badForm = await checkVerdict({ ...input(accept), requestDigest: 'not a digest' });
  assert.equal(!badForm.ok && badForm.refusal.code, 'request_mismatch');
  const audio = await checkVerdict({ ...input(accept), audioDigest: new Uint8Array(32) });
  assert.equal(!audio.ok && audio.refusal.code, 'audio_mismatch');
});

test('a bad signature', async () => {
  const accept = vector('accept');
  const other = vector('step_up');
  const cases = [
    { ...input(accept), signatureB64: other.signature_b64 },
    { ...input(accept), verdictJson: accept.verdict_json.replace('"accept"', '"accept" ') },
    { ...input(accept), verdictJson: accept.verdict_json.replace('two near', 'ten near') },
    { ...input(accept), publicKey: new Uint8Array(32).fill(1) },
    // Bytes that are not a point of the curve.
    { ...input(accept), publicKey: new Uint8Array(32).fill(0xff) },
  ];
  for (const item of cases) {
    const result = await checkVerdict(item);
    assert.equal(!result.ok && result.refusal.code, 'bad_signature');
  }
});

test('a bad key or signature text', async () => {
  const accept = vector('accept');
  for (const publicKey of ['', 'ed25519:', 'ed25519:0OIl', signed.public_key.slice(0, -1), 'secp256k1:abc', new Uint8Array(31)]) {
    const result = await checkVerdict({ ...input(accept), publicKey });
    assert.equal(!result.ok && result.refusal.code, 'bad_public_key', String(publicKey));
  }
  for (const signatureB64 of ['', 'AAAA', '!!!!', accept.signature_b64.slice(4), accept.signature_b64.replace('+', '-')]) {
    const result = await checkVerdict({ ...input(accept), signatureB64 });
    assert.equal(!result.ok && result.refusal.code, 'bad_signature_encoding', signatureB64);
  }
  assert.equal(parsePublicKey(signed.public_key)?.length, 32);
});

test('a signed refusal gives the reason of the verifier', async () => {
  const verdict = { ...JSON.parse(vector('accept').verdict_json), outcome: 'refuse', reason: 'words' };
  const result = await checkSigned(JSON.stringify(verdict));
  assert.ok(!result.ok);
  assert.equal(result.refusal.code, 'refused');
  assert.equal(result.refusal.code === 'refused' && result.refusal.reason, 'words');
});

test('a signed text of another kind or shape', async () => {
  const good = JSON.parse(vector('accept').verdict_json) as Record<string, unknown>;
  const kind = await checkSigned(JSON.stringify({ ...good, kind: 'seams_voice_signed_verdict_v1' }));
  assert.equal(!kind.ok && kind.refusal.code, 'wrong_kind');

  const { heard: _heard, ...missing } = good;
  const shapes = [
    'not json',
    '[]',
    'null',
    JSON.stringify(missing),
    JSON.stringify({ ...good, extra: 1 }),
    JSON.stringify({ ...good, outcome: 'maybe' }),
    JSON.stringify({ ...good, expires_at_ms: '1762700120000' }),
    JSON.stringify({ ...good, expires_at_ms: 1.5 }),
    JSON.stringify({ ...good, request_digest: 'AAAA' }),
    JSON.stringify({ ...good, speaker_score_milli: 'high' }),
  ];
  for (const text of shapes) {
    const result = await checkSigned(text);
    assert.equal(!result.ok && result.refusal.code, 'malformed', text);
  }
  // A refusal before the request was known has no digest. It reads, and no digest matches it.
  const early = { ...good, outcome: 'refuse', reason: 'unsupported', request_digest: null };
  assert.ok('verdict' in parseVerdict(JSON.stringify(early)));
  const noDigest = await checkSigned(JSON.stringify({ ...good, request_digest: null }));
  assert.ok(noDigest.ok);
  const wanted = await checkVerdict({
    verdictJson: JSON.stringify({ ...good, request_digest: null }),
    signatureB64: await sign(JSON.stringify({ ...good, request_digest: null })),
    publicKey: signed.public_key,
    nowMs: 0,
    requestDigest: vector('accept').request_digest,
  });
  assert.equal(!wanted.ok && wanted.refusal.code, 'request_mismatch');
});
