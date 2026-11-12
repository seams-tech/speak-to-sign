// Unit tests of the NEAR AI status: the check behind GET /api/near-ai-status, its cache, and the
// warning that the nav shows. Run with `pnpm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CACHE_MS,
  NEAR_AI_MODELS_URL,
  NEAR_AI_TRANSCRIPTIONS_URL,
  SLOW_MS,
  WHISPER_MODEL,
  checkNearAi,
  silentWav,
  stateOf,
  statusCache,
} from '../functions/lib/nearAiStatus.ts';
import { readNearAiStatus, warningOf, type NearAiStatus } from '../src/nearAiStatus.ts';

const T0 = 1_794_500_000_000;

test('an answer is up, slow after 5 s, down for 5xx, and unknown for 4xx', () => {
  assert.equal(stateOf(200, 900), 'up');
  assert.equal(stateOf(200, SLOW_MS + 1), 'slow');
  assert.equal(stateOf(502, 100), 'down');
  assert.equal(stateOf(401, 100), 'unknown');
  assert.equal(stateOf(429, 100), 'unknown');
});

test('the silent clip is a 16 kHz mono PCM16 WAV', () => {
  const wav = silentWav(500);
  assert.equal(wav.length, 16_044);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 16_000);
  assert.ok(wav.slice(44).every((byte) => byte === 0));
});

test('the check asks the model list and Whisper with the key', async () => {
  const calls: { url: string; auth: string | null; model: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization'), model: body instanceof FormData ? body.get('model') : null });
    return new Response(String(input) === NEAR_AI_MODELS_URL ? '{"data":[]}' : '', { status: String(input) === NEAR_AI_MODELS_URL ? 200 : 502 });
  }) as typeof globalThis.fetch;
  const status = await checkNearAi({ apiKey: ' key ', fetch, now: () => T0 });
  assert.deepEqual(status, { nearAi: 'up', whisper: 'down', checkedAtMs: T0 });
  assert.deepEqual(calls.map((call) => call.url).sort(), [NEAR_AI_MODELS_URL, NEAR_AI_TRANSCRIPTIONS_URL].sort());
  assert.ok(calls.every((call) => call.auth === 'Bearer key'));
  assert.equal(calls.find((call) => call.url === NEAR_AI_TRANSCRIPTIONS_URL)?.model, WHISPER_MODEL);
});

test('a call that throws (a timeout) is down; no key is unknown and calls nothing', async () => {
  const failing = (async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  }) as typeof globalThis.fetch;
  assert.deepEqual(await checkNearAi({ apiKey: 'key', fetch: failing, now: () => T0 }), { nearAi: 'down', whisper: 'down', checkedAtMs: T0 });
  const unused = (async () => assert.fail('no call without a key')) as typeof globalThis.fetch;
  assert.deepEqual(await checkNearAi({ apiKey: undefined, fetch: unused, now: () => T0 }), { nearAi: 'unknown', whisper: 'unknown', checkedAtMs: T0 });
});

test('the cache makes one check for requests at the same time and for one minute', async () => {
  let now = T0;
  let checks = 0;
  const cached = statusCache(() => now);
  const check = async (): Promise<NearAiStatus> => ({ nearAi: 'up', whisper: 'up', checkedAtMs: (checks++, now) });
  await Promise.all([cached(check), cached(check)]);
  assert.equal(checks, 1);
  now += CACHE_MS - 1;
  await cached(check);
  assert.equal(checks, 1);
  now += 1;
  await cached(check);
  assert.equal(checks, 2);
});

test('the page reads the status and warns for NEAR AI down, Whisper down or Whisper slow', () => {
  const status = (nearAi: string, whisper: string) => readNearAiStatus({ nearAi, whisper, checkedAtMs: T0 });
  assert.equal(readNearAiStatus({ nearAi: 'up', whisper: 'broken', checkedAtMs: T0 }), null);
  assert.equal(readNearAiStatus(null), null);
  assert.equal(warningOf(status('up', 'up')), null);
  assert.equal(warningOf(status('unknown', 'unknown')), null);
  assert.equal(warningOf(status('slow', 'up')), null);
  assert.equal(warningOf(status('down', 'down'))?.short, 'NEAR AI is down');
  assert.equal(warningOf(status('up', 'down'))?.short, 'Speech-to-text is down');
  assert.equal(warningOf(status('up', 'slow'))?.level, 'slow');
});
