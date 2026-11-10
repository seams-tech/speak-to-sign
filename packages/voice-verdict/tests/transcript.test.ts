// The shared signed transcripts that `crates/voice-verifier/tests/signed_transcript_vector.rs` writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkTranscript, checkVerdict } from '../src/index.ts';

interface Case {
  name: string;
  owner: string;
  audio_digest: string;
  text: string | null;
  transcript_json: string;
  signature_b64: string;
}
const file = JSON.parse(
  readFileSync(new URL('../../../crates/voice-verifier/testdata/signed_transcript_v1.json', import.meta.url), 'utf8'),
) as { public_key: string; expires_at_ms: number; transcripts: Case[] };

function input(name: string) {
  const item = file.transcripts.find((entry) => entry.name === name);
  assert.ok(item, name);
  return {
    item,
    check: { transcriptJson: item.transcript_json, signatureB64: item.signature_b64, publicKey: file.public_key, nowMs: file.expires_at_ms },
  };
}

test('an accepted transcript gives the owner and the text', async () => {
  for (const name of ['accept', 'accept_near_owner']) {
    const { item, check } = input(name);
    const result = await checkTranscript({ ...check, owner: item.owner, audioDigest: item.audio_digest });
    assert.ok(result.ok, name);
    assert.equal(result.transcript.text, item.text);
    assert.equal(result.transcript.owner, item.owner);
  }
});

test('a transcript of another owner, another recording or another time', async () => {
  const { check } = input('accept');
  const code = async (change: object) => {
    const result = await checkTranscript({ ...check, ...change });
    return result.ok ? 'ok' : result.refusal.code;
  };
  assert.equal(await code({ owner: 'app:user-43' }), 'owner_mismatch');
  assert.equal(await code({ audioDigest: new Uint8Array(32) }), 'audio_mismatch');
  assert.equal(await code({ nowMs: file.expires_at_ms + 1 }), 'expired');
  assert.equal(await code({ nowMs: undefined }), 'expired');
  assert.equal(await code({ transcriptJson: check.transcriptJson.replace('two', 'ten') }), 'bad_signature');
  assert.equal(await code({ signatureB64: 'AAAA' }), 'bad_signature_encoding');
  assert.equal(await code({ publicKey: 'nope' }), 'bad_public_key');
});

test('a refused transcript has the reason and no text', async () => {
  const { check } = input('refuse_speaker');
  const result = await checkTranscript(check);
  assert.ok(!result.ok);
  assert.equal(result.refusal.code, 'refused');
  assert.equal(result.refusal.code === 'refused' && result.refusal.reason, 'speaker');
  assert.equal(result.refusal.code === 'refused' && result.refusal.transcript.text, null);
});

test('a transcript is not a verdict, and a verdict is not a transcript', async () => {
  const { check } = input('accept');
  // The same key signs both kinds, with another prefix for each.
  const asVerdict = await checkVerdict({
    verdictJson: check.transcriptJson,
    signatureB64: check.signatureB64,
    publicKey: file.public_key,
    nowMs: 0,
  });
  assert.equal(!asVerdict.ok && asVerdict.refusal.code, 'bad_signature');
  const verdicts = JSON.parse(
    readFileSync(new URL('../../../crates/voice-verifier/testdata/signed_verdict_v2.json', import.meta.url), 'utf8'),
  ) as { public_key: string; verdicts: { verdict_json: string; signature_b64: string }[] };
  assert.equal(verdicts.public_key, file.public_key);
  const asTranscript = await checkTranscript({
    transcriptJson: verdicts.verdicts[0]!.verdict_json,
    signatureB64: verdicts.verdicts[0]!.signature_b64,
    publicKey: file.public_key,
    nowMs: 0,
  });
  assert.equal(!asTranscript.ok && asTranscript.refusal.code, 'bad_signature');
});
