// The state of NEAR AI Cloud and of its Whisper model, for the warning in the nav of the demo
// pages (src/components/NearAiWarning.tsx). The verifier sends each recording to that Whisper,
// so when Whisper is down, every voice check fails. On 2026-11-12 Whisper failed twice: HTTP 502
// for 12 minutes, then no answer for more than 40 minutes, while the rest of NEAR AI answered.
//
// This file exports no onRequest handler, so it is not a route (see functions/api/near-ai-status.ts).

import type { NearAiStatus, ServiceState } from '../../src/nearAiStatus.ts';

export const NEAR_AI_MODELS_URL = 'https://cloud-api.near.ai/v1/models';
export const NEAR_AI_TRANSCRIPTIONS_URL = 'https://cloud-api.near.ai/v1/audio/transcriptions';
/** The model and the language that the verifier uses (crates/voice-verifier/src/config.rs). */
export const WHISPER_MODEL = 'openai/whisper-large-v3';

/** A usual answer of Whisper comes in about 1 s. After this, it is slow. */
export const SLOW_MS = 5_000;
/** After this, the check stops waiting: Whisper is down. */
export const PROBE_TIMEOUT_MS = 10_000;
/** One check serves all requests for this time, so the page views do not each pay for a transcription. */
export const CACHE_MS = 60_000;

export interface StatusCheckOptions {
  apiKey: string | undefined;
  fetch: typeof fetch;
  now: () => number;
}

/** Checks the NEAR AI gateway (the model list) and Whisper (one short silent clip) at the same time. */
export async function checkNearAi(options: StatusCheckOptions): Promise<NearAiStatus> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return { nearAi: 'unknown', whisper: 'unknown', checkedAtMs: options.now() };
  const authorization = { Authorization: `Bearer ${apiKey}` };
  const [nearAi, whisper] = await Promise.all([
    probe(options, () => options.fetch(NEAR_AI_MODELS_URL, { headers: authorization, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })),
    probe(options, () => {
      const form = new FormData();
      form.append('file', new Blob([silentWav(500)], { type: 'audio/wav' }), 'status.wav');
      form.append('model', WHISPER_MODEL);
      form.append('language', 'en');
      return options.fetch(NEAR_AI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: authorization,
        body: form,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    }),
  ]);
  return { nearAi, whisper, checkedAtMs: options.now() };
}

async function probe(options: StatusCheckOptions, call: () => Promise<Response>): Promise<ServiceState> {
  const start = options.now();
  let response: Response;
  try {
    response = await call();
  } catch {
    return 'down';
  }
  await response.body?.cancel();
  return stateOf(response.status, options.now() - start);
}

/** A 5xx answer is an outage; a 4xx answer is about this request or this key, not about the service. */
export function stateOf(status: number, elapsedMs: number): ServiceState {
  if (status >= 500) return 'down';
  if (status < 200 || status >= 300) return 'unknown';
  return elapsedMs > SLOW_MS ? 'slow' : 'up';
}

/** A 16 kHz mono PCM16 WAV of silence. 500 ms is 16,044 bytes. */
export function silentWav(durationMs: number): Uint8Array {
  const samples = Math.round((16_000 * durationMs) / 1000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/**
 * One check at a time, and one result for CACHE_MS. The cache lives in the memory of one worker,
 * so each Cloudflare location makes at most one check each minute.
 */
export function statusCache(now: () => number): (check: () => Promise<NearAiStatus>) => Promise<NearAiStatus> {
  let last: NearAiStatus | null = null;
  let running: Promise<NearAiStatus> | null = null;
  return (check) => {
    if (last && now() - last.checkedAtMs < CACHE_MS) return Promise.resolve(last);
    running ??= check()
      .then((status) => (last = status))
      .finally(() => (running = null));
    return running;
  };
}

/** The one cache of a worker: the status route and the verify route share its result. */
const shared = statusCache(Date.now);

/** The status of NEAR AI now: the cached result, or a new check. */
export function nearAiStatus(apiKey: string | undefined): Promise<NearAiStatus> {
  return shared(() => checkNearAi({ apiKey, fetch: (input, init) => fetch(input, init), now: Date.now }));
}

/** The speech-to-text services of the verifier: one worker build for each (crates/voice-verifier, "Speech-to-text service"). */
export type Transcriber = 'nearai' | 'venice';

/** A usual check takes about 1 s. A verify call waits this long for it, then takes Whisper as down. */
export const CHOICE_WAIT_MS = 3_000;

/**
 * The service for one verify call. A request can name one. With no name, NEAR AI serves the
 * call, and Venice serves it only while NEAR AI or its Whisper is down (`whisper` null: the
 * check gave no answer in time). Venice needs its own worker build; without one, NEAR AI serves.
 */
export function chooseTranscriber(options: {
  requested: Transcriber | undefined;
  hasVeniceBuild: boolean;
  status: NearAiStatus | null;
}): Transcriber | 'no_venice_build' {
  if (options.requested === 'venice') return options.hasVeniceBuild ? 'venice' : 'no_venice_build';
  if (options.requested === 'nearai' || !options.hasVeniceBuild) return 'nearai';
  const down = options.status === null || options.status.nearAi === 'down' || options.status.whisper === 'down';
  return down ? 'venice' : 'nearai';
}

/** The status for a choice: the result when it comes within CHOICE_WAIT_MS, else null. */
export function statusForChoice(apiKey: string | undefined, waitMs = CHOICE_WAIT_MS): Promise<NearAiStatus | null> {
  return Promise.race([
    nearAiStatus(apiKey).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
}
