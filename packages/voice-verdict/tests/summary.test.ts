// The rules of a spoken summary, as the verifier's spoken-intent crate has them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_SUMMARY_BYTES, MAX_SUMMARY_WORDS, summaryRefusal } from '../src/summary.ts';

test('a speakable summary has 1 to 12 words of letters, with a comma or an end mark allowed', () => {
  for (const text of [
    'Approve',
    'One lane closes in March',
    'The claim, as stated, is not confirmed.',
    'Is the bridge closed?',
    'one two three four five six seven eight nine ten eleven twelve',
  ]) {
    assert.equal(summaryRefusal(text), null, text);
  }
});

test('each broken rule has its own reason', () => {
  const cases: Array<[string, ReturnType<typeof summaryRefusal>]> = [
    ['', 'empty'],
    ['a'.repeat(MAX_SUMMARY_BYTES + 1), 'too_long'],
    [Array.from({ length: MAX_SUMMARY_WORDS + 1 }, () => 'word').join(' '), 'too_many_words'],
    ['The speech at COP31 is not confirmed', 'character'],
    ['Two  spaces', 'character'],
    ['It is not confirmed..', 'character'],
    ["Don't trust it", 'character'],
    ['Café is closed', 'character'],
    ['Send five NEAR to bob', 'transfer_verb'],
    ['sent, as stated', 'transfer_verb'],
  ];
  for (const [text, reason] of cases) assert.equal(summaryRefusal(text), reason, text);
  // "Sender" is another word.
  assert.equal(summaryRefusal('Sender of the post is unknown'), null);
});
