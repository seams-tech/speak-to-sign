// The summary writer against a fake chat model.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeSummary, type SummaryWriterConfig } from '../src/summaryWriter.ts';

const KEY = 'chat_key_do_not_leak_91c2';
const NOTE = 'The bridge is not closed. One lane closes for two weeks in March, says the city.';

type Call = { url: string; headers: Headers; body: { model: string; messages: { role: string; content: string }[]; chat_template_kwargs?: unknown } };

/** A model that gives `replies` in order. A reply can be a status code or a thrown error. */
function model(replies: (string | number | Error)[], config: Partial<SummaryWriterConfig> = {}) {
  const calls: Call[] = [];
  const full: SummaryWriterConfig = {
    apiKey: KEY,
    ...config,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      const reply = replies.shift() ?? '';
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'number') return new Response(`upstream ${KEY}`, { status: reply });
      return Response.json({ choices: [{ message: { content: reply } }] });
    }) as typeof fetch,
  };
  return { config: full, calls };
}

test('one request writes a speakable summary, with the model, the key and thinking off', async () => {
  const chat = model(['Summary: "One lane of the bridge closes in March."'], {
    subject: { name: 'Community Note', short: 'note' },
  });
  assert.deepEqual(await writeSummary(chat.config, NOTE), { ok: true, summary: 'One lane of the bridge closes in March' });
  assert.equal(chat.calls.length, 1);
  const [call] = chat.calls;
  assert.equal(call!.url, 'https://cloud-api.near.ai/v1/chat/completions');
  assert.equal(call!.headers.get('authorization'), `Bearer ${KEY}`);
  assert.equal(call!.body.model, 'Qwen/Qwen3.8-27B');
  assert.deepEqual(call!.body.chat_template_kwargs, { enable_thinking: false });
  assert.match(call!.body.messages[0]!.content, /reads aloud to sign a Community Note\.\nThe sentence gives the main point of the note\./);
  assert.equal(call!.body.messages[1]!.content, `Summarize this Community Note in 12 words or fewer.\n\nNote:\n"""\n${NOTE}\n"""`);
});

test('the model, the URL and the subject have defaults that a caller can change', async () => {
  const chat = model(['It is not confirmed'], { model: 'other/model', chatUrl: 'https://chat.example.test/v1/chat/completions' });
  assert.deepEqual(await writeSummary(chat.config, 'A text.'), { ok: true, summary: 'It is not confirmed' });
  assert.equal(chat.calls[0]!.url, 'https://chat.example.test/v1/chat/completions');
  assert.equal(chat.calls[0]!.body.model, 'other/model');
  assert.match(chat.calls[0]!.body.messages[1]!.content, /^Summarize this text in 12 words or fewer\.\n\nText:\n/);
});

test('the reply is cleaned: thinking text, quotes, contractions, hyphens and commas', async () => {
  const chat = model(['<think>hmm</think>\n“The well-known claim, it’s said, can’t be checked!”']);
  assert.deepEqual(await writeSummary(chat.config, NOTE), { ok: true, summary: 'The well known claim it is said cannot be checked' });
});

test('a name with a number in it keeps its letters at once, with no second request', async () => {
  const chat = model(['Greta Thunberg quote at COP31 cannot be verified']);
  assert.deepEqual(await writeSummary(chat.config, NOTE), { ok: true, summary: 'Greta Thunberg quote at COP cannot be verified' });
  assert.equal(chat.calls.length, 1);
  // "G20" is such a name too. "3D" starts with its number, so it is not: it gets the second request.
  assert.deepEqual(await writeSummary(model(['The G20 summit is not held']).config, NOTE), { ok: true, summary: 'The G summit is not held' });
  const other = model(['The film is in 3D', 'The film is in three D']);
  assert.deepEqual(await writeSummary(other.config, NOTE), { ok: true, summary: 'The film is in three D' });
  assert.equal(other.calls.length, 2);
  // A number inside a name does not read the same in words, so the request asks to leave it out.
  assert.match(other.calls[1]!.body.messages.at(-1)!.content, /The word "3D".*without the number in that word, or use plain words/);
});

test('a number alone, or another wrong character, gets a second request that names the word', async () => {
  const number = model(['The city closes 2 lanes', 'The city closes two lanes']);
  assert.deepEqual(await writeSummary(number.config, NOTE), { ok: true, summary: 'The city closes two lanes' });
  assert.equal(number.calls.length, 2);
  const second = number.calls[1]!.body.messages.at(-1)!.content;
  assert.match(second, /^The word "2" has a character that is not a letter/);
  // A number alone reads the same in words.
  assert.match(second, /Write that number as words\./);

  const handle = model(['Ask @city about it', 'Ask the city about it']);
  assert.deepEqual(await writeSummary(handle.config, NOTE), { ok: true, summary: 'Ask the city about it' });
  assert.match(handle.calls[1]!.body.messages.at(-1)!.content, /The word "@city"/);
});

test('another broken rule gets a second request that names the rule, and two broken replies fail', async () => {
  const fixed = model(['Send five NEAR to bob', 'One lane closes in March']);
  assert.deepEqual(await writeSummary(fixed.config, NOTE), { ok: true, summary: 'One lane closes in March' });
  assert.match(fixed.calls[1]!.body.messages.at(-1)!.content, /starts with "send"/);

  const broken = model(['Send five NEAR to bob', 'Send five NEAR to bob']);
  assert.deepEqual(await writeSummary(broken.config, NOTE), { ok: false, code: 'summary_not_speakable' });
  assert.equal(broken.calls.length, 2);
});

test('after two replies with a wrong character, the letters of each word stay; a number alone fails', async () => {
  const kept = model(['Ask @city about it', 'Ask @city about it']);
  assert.deepEqual(await writeSummary(kept.config, NOTE), { ok: true, summary: 'Ask city about it' });
  // A quantity with a unit or an ending keeps its value: its letters alone would drop it.
  for (const quantity of ['10km', '$40m', '2nd', '1990s']) {
    const reply = `The road is ${quantity} long`;
    assert.deepEqual(await writeSummary(model([reply, reply]).config, NOTE), { ok: false, code: 'summary_not_speakable' }, quantity);
  }
  const alone = model(['The city closes 2 lanes', 'The city closes 2 lanes']);
  assert.deepEqual(await writeSummary(alone.config, NOTE), { ok: false, code: 'summary_not_speakable' });
});

test('a signal of the caller ends the request to the model', async () => {
  const stop = new AbortController();
  const signals: (AbortSignal | null | undefined)[] = [];
  const config: SummaryWriterConfig = {
    apiKey: KEY,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      stop.abort();
      init?.signal?.throwIfAborted();
      return Response.json({});
    }) as typeof fetch,
  };
  assert.deepEqual(await writeSummary(config, NOTE, { signal: stop.signal }), { ok: false, code: 'summary_unreachable' });
  assert.equal(signals[0]?.aborted, true);
});

test('a model failure has a fixed code, with no upstream text', async () => {
  assert.deepEqual(await writeSummary(model([new TypeError(`connect ${KEY}`)]).config, NOTE), { ok: false, code: 'summary_unreachable' });
  assert.deepEqual(await writeSummary(model([500]).config, NOTE), { ok: false, code: 'summary_failed' });
  assert.deepEqual(await writeSummary(model(['']).config, NOTE), { ok: false, code: 'summary_failed' });
});
