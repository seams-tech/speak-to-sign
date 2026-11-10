// Unit tests of the spoken bet's page side (src/market/spokenBet.ts): the sentence, which must
// be the verifier's own display text, and the reading of the verifier's answer.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readVerifyOutput, spokenAmount, spokenBetSentence } from '../src/market/spokenBet.ts';

const USDC = 1_000_000n;

test('the sentence is the display text of the MarketBet request (crates/spoken-intent/tests/bet.rs)', () => {
  assert.equal(spokenBetSentence({ marketId: 9, side: 'yes', amount: USDC / 2n }), 'Bet 0.5 USDC yes on market 9');
  assert.equal(spokenBetSentence({ marketId: 12, side: 'no', amount: USDC }), 'Bet 1 USDC no on market 12');
  assert.equal(spokenBetSentence({ marketId: 9, side: 'yes', amount: USDC / 10n }), 'Bet 0.1 USDC yes on market 9');
  assert.equal(spokenBetSentence({ marketId: 1001, side: 'no', amount: 1_250_750_000n }), 'Bet 1,250.75 USDC no on market 1001');
});

test('an amount has a spoken form only as a whole number of cents', () => {
  assert.deepEqual([10_000n, 50_000n, 1_050_000n, 1_000_000_000_000n].map(spokenAmount), ['0.01', '0.05', '1.05', '1,000,000']);
  for (const units of [0n, -10_000n, 1n, 500_001n, 1_000_000_010_000n]) assert.equal(spokenAmount(units), null);
});

test('readVerifyOutput gives the verdict only for an accept with a signature', () => {
  const verdict = (fields: object) => JSON.stringify({ kind: 'seams_voice_signed_verdict_v2', ...fields });
  const output = (verdict_json: string, signature_b64: string | null = 'c2ln') => ({ kind: 'seams_voice_verify_output_v2', verdict_json, signature_b64 });
  const accept = verdict({ outcome: 'accept' });
  assert.deepEqual(readVerifyOutput(output(accept)), { kind: 'accepted', verdictJson: accept, signatureB64: 'c2ln' });
  assert.equal(readVerifyOutput(output(accept, null)).kind, 'unavailable');
  assert.deepEqual(readVerifyOutput(output(verdict({ outcome: 'refuse', reason: 'words', heard: 'bet five usdc yes on market nine' }))), {
    kind: 'refused',
    reason: 'The words did not match the bet.',
    heard: 'bet five usdc yes on market nine',
  });
  assert.equal(readVerifyOutput(output(verdict({ outcome: 'refuse', reason: 'speaker' }))).kind, 'refused');
  // A step-up is not an accept: the contract takes only an accept.
  assert.equal(readVerifyOutput(output(verdict({ outcome: 'step_up' }))).kind, 'refused');
  assert.equal(readVerifyOutput({ kind: 'seams_voice_error_v1', reason: 'unsupported' }).kind, 'refused');
  assert.equal(readVerifyOutput({ kind: 'other' }).kind, 'unavailable');
  assert.equal(readVerifyOutput(output('not json')).kind, 'unavailable');
});
