// The summary source: one request for each text, kept for a time.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSummarySource, type SummaryResult } from '../src/summary.ts';

function source(options: { lifeMs?: number; maxEntries?: number } = {}) {
  let nowMs = 1_000;
  const asked: string[] = [];
  const stopped: string[] = [];
  const waiting = new Map<string, (result: SummaryResult) => void>();
  const summaries = createSummarySource({
    ...options,
    now: () => nowMs,
    write: (text, signal) => {
      asked.push(text);
      signal.addEventListener('abort', () => stopped.push(text));
      return new Promise((resolve) => waiting.set(text, resolve));
    },
  });
  return {
    summaries,
    asked,
    stopped,
    answer: (text: string, result: SummaryResult = { ok: true, summary: `summary of ${text}` }) => waiting.get(text)?.(result),
    advance: (ms: number) => void (nowMs += ms),
  };
}

test('prepare starts the request, and get finds it in flight and then kept', async () => {
  const page = source();
  page.summaries.prepare('note one');
  page.summaries.prepare('note one');
  const first = page.summaries.get('note one');
  assert.deepEqual(page.asked, ['note one']);
  page.answer('note one');
  assert.deepEqual(await first, { ok: true, summary: 'summary of note one' });
  // Kept: the next try reads the same sentence, with no request.
  assert.deepEqual(await page.summaries.get('note one'), { ok: true, summary: 'summary of note one' });
  assert.deepEqual(page.asked, ['note one']);
});

test('another text has its own summary, and a kept one ends after its life', async () => {
  const page = source({ lifeMs: 60_000 });
  const one = page.summaries.get('note one');
  page.answer('note one');
  await one;
  const changed = page.summaries.get('note one, changed');
  page.answer('note one, changed');
  assert.deepEqual(await changed, { ok: true, summary: 'summary of note one, changed' });
  page.advance(59_000);
  await page.summaries.get('note one');
  assert.deepEqual(page.asked, ['note one', 'note one, changed']);
  page.advance(2_000);
  void page.summaries.get('note one');
  assert.deepEqual(page.asked, ['note one', 'note one, changed', 'note one']);
});

test('a failure is not kept, and a write that throws is a failure', async () => {
  const page = source();
  const failed = page.summaries.get('note');
  page.answer('note', { ok: false, code: 'summary_failed' });
  assert.deepEqual(await failed, { ok: false, code: 'summary_failed' });
  const again = page.summaries.get('note');
  assert.deepEqual(page.asked, ['note', 'note']);
  page.answer('note');
  assert.deepEqual(await again, { ok: true, summary: 'summary of note' });

  const throwing = createSummarySource({ write: () => Promise.reject(new TypeError('no network')) });
  throwing.prepare('note');
  assert.deepEqual(await throwing.get('note'), { ok: false, code: 'summary_unreachable' });
});

test('an aborted get ends only its own wait', async () => {
  const page = source();
  const stop = new AbortController();
  const waited = page.summaries.get('note', stop.signal);
  stop.abort(new Error('closed'));
  await assert.rejects(waited, /closed/);
  assert.deepEqual(page.stopped, []);
  const other = page.summaries.get('note');
  page.answer('note');
  assert.deepEqual(await other, { ok: true, summary: 'summary of note' });
  assert.deepEqual(page.asked, ['note']);
  await assert.rejects(page.summaries.get('note', stop.signal), /closed/);
});

test('the source keeps at most maxEntries texts, and forget ends a request', async () => {
  const page = source({ maxEntries: 2 });
  page.summaries.prepare('a');
  page.summaries.prepare('b');
  page.summaries.prepare('c');
  // The oldest one went, and its request stopped.
  assert.deepEqual(page.stopped, ['a']);
  page.summaries.prepare('b');
  page.summaries.prepare('a');
  // "b" was kept, so only "a" asked again; "a" is the third text, so "b", now the oldest, went.
  assert.deepEqual(page.asked, ['a', 'b', 'c', 'a']);
  assert.deepEqual(page.stopped, ['a', 'b']);
  page.summaries.forget('c');
  page.summaries.forget();
  assert.deepEqual(page.stopped, ['a', 'b', 'c', 'a']);
  page.summaries.prepare('c');
  assert.equal(page.asked.at(-1), 'c');
});
