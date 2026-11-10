// The shared signed results of `detect` that `crates/voice-verifier/tests/signed_intent_vector.rs` writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkIntent, checkTranscript, checkVerdict, intentsDigest, intentsJson, type IntentSpec } from '../src/index.ts';

const file = JSON.parse(
  readFileSync(new URL('../../../crates/voice-verifier/testdata/signed_intent_v1.json', import.meta.url), 'utf8'),
) as {
  public_key: string;
  expires_at_ms: number;
  owner: string;
  intents: IntentSpec[];
  intents_json: string;
  intents_digest: string;
  results: { name: string; intent_json: string; signature_b64: string }[];
};

function input(name: string) {
  const item = file.results.find((entry) => entry.name === name);
  assert.ok(item, name);
  return { intentJson: item.intent_json, signatureB64: item.signature_b64, publicKey: file.public_key, nowMs: file.expires_at_ms };
}

test('the intent list has the canonical JSON and the digest of the verifier', async () => {
  assert.equal(intentsJson(file.intents), file.intents_json);
  // The order of the slots in your list does not matter, and `slots` can be absent.
  const unordered: IntentSpec[] = [
    { name: 'book_table', description: 'Book a table at a restaurant', slots: { time: 'text', people: 'number' } },
    { name: 'cancel_booking', description: 'Cancel a booking' },
  ];
  assert.equal(intentsJson(unordered), file.intents_json);
  assert.equal(Buffer.from(await intentsDigest(file.intents)).toString('base64url'), file.intents_digest);
});

test('a result with an intent and its slots', async () => {
  const result = await checkIntent({ ...input('intent_with_slots'), intents: file.intents, owner: file.owner, audioDigest: new Uint8Array(32).fill(7) });
  assert.ok(result.ok);
  assert.equal(result.result.intent, 'book_table');
  assert.deepEqual(result.result.slots, { people: 2, time: 'eight tonight' });
  assert.equal(result.result.text, 'book a table for two at eight tonight');
  assert.equal(result.result.model, 'Qwen/Qwen3.8-27B');
});

test('a result with no intent is an accept with no slots', async () => {
  const result = await checkIntent({ ...input('no_intent'), intents: file.intents });
  assert.ok(result.ok);
  assert.equal(result.result.intent, null);
  assert.equal(result.result.slots, null);
});

test('refused results give the reason', async () => {
  for (const [name, reason] of [['refuse_speaker', 'speaker'], ['refuse_detector', 'detector_unavailable']] as const) {
    const result = await checkIntent(input(name));
    assert.ok(!result.ok);
    assert.equal(result.refusal.code === 'refused' && result.refusal.reason, reason);
  }
});

test('a result for another list, owner, recording or time', async () => {
  const good = input('intent_with_slots');
  const code = async (change: object) => {
    const result = await checkIntent({ ...good, ...change });
    return result.ok ? 'ok' : result.refusal.code;
  };
  const otherList: IntentSpec[] = [{ name: 'book_table', description: 'Book a table', slots: { people: 'number', time: 'text' } }];
  assert.equal(await code({ intents: otherList }), 'intents_mismatch');
  assert.equal(await code({ intents: file.intents.slice(0, 1) }), 'intents_mismatch');
  assert.equal(await code({ owner: 'app:user-43' }), 'owner_mismatch');
  assert.equal(await code({ audioDigest: new Uint8Array(32) }), 'audio_mismatch');
  assert.equal(await code({ nowMs: file.expires_at_ms + 1 }), 'expired');
  assert.equal(await code({ intentJson: good.intentJson.replace('"people":2', '"people":9') }), 'bad_signature');
});

test('an intent result is not a verdict and not a transcript', async () => {
  const good = input('intent_with_slots');
  const verdict = await checkVerdict({ verdictJson: good.intentJson, signatureB64: good.signatureB64, publicKey: file.public_key, nowMs: 0 });
  assert.equal(!verdict.ok && verdict.refusal.code, 'bad_signature');
  const transcript = await checkTranscript({ transcriptJson: good.intentJson, signatureB64: good.signatureB64, publicKey: file.public_key, nowMs: 0 });
  assert.equal(!transcript.ok && transcript.refusal.code, 'bad_signature');
});
