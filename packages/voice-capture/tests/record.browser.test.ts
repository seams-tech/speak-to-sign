// Records from a fake microphone in a real browser, with the built package alone: no wallet
// and no other @seams package is on the page.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const DIST = path.resolve(import.meta.dirname, '../dist');
const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

let origin = '';
let close = (): void => {};

test.beforeAll(async () => {
  const server = createServer((request, response) => void serve(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The test server has no port.');
  // The microphone needs a secure context: localhost is one.
  origin = `http://localhost:${address.port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

test.afterAll(() => close());

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><title>voice-capture</title></html>');
    return;
  }
  try {
    const bytes = await readFile(path.join(DIST, pathname));
    response.setHeader('Content-Type', TYPES[path.extname(pathname)] ?? 'text/plain');
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

type Recorded = Readonly<{
  kind: string;
  seconds: number;
  endedBy: string;
  voicedMs: number;
  events: string[];
  wavBytes: number;
  wavHeader: string;
}>;

/** The built single-file package. A variable keeps the type checker from resolving the URL. */
const MODULE = '/browser/voice-capture.js';

/** Records one utterance on the page and returns plain facts about it. */
async function record(page: Page, detector: 'model' | 'level'): Promise<Recorded> {
  return await page.evaluate(async ([detector, module]) => {
    const capture = await import(module);
    capture.configureVoiceCapture({ assetBase: '/assets/' });
    const events: string[] = [];
    const result = await capture.recordVoice(
      new AbortController().signal,
      (event: { kind: string }) => {
        if (events.at(-1) !== event.kind) events.push(event.kind);
      },
      { detector, expectedSpeechMs: capture.expectedSpeechMs('Send two NEAR to alice.testnet') },
    );
    const wav = result.kind === 'captured' ? capture.pcm16Wav(result.samples) : new Uint8Array();
    return {
      kind: result.kind,
      seconds: result.kind === 'captured' ? result.samples.length / capture.SAMPLE_RATE : 0,
      endedBy: result.quality.endedBy,
      voicedMs: result.quality.voicedMs,
      events,
      wavBytes: wav.length,
      wavHeader: new TextDecoder().decode(wav.subarray(0, 4)),
    };
  }, [detector, MODULE] as const);
}

test('the speech detection model records a sentence and stops at the pause', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(origin);
  const recorded = await record(page, 'model');
  expect(recorded.kind).toBe('captured');
  expect(recorded.endedBy).toBe('pause');
  // The fixture says "send two near to alice dot testnet": about 2 s of speech.
  expect(recorded.voicedMs).toBeGreaterThan(1_000);
  expect(recorded.seconds).toBeGreaterThan(1.2);
  expect(recorded.seconds).toBeLessThan(4);
  expect(recorded.events).toEqual(['opening', 'listening', 'activity', 'processing', 'measured']);
  expect(recorded.wavHeader).toBe('RIFF');
  expect(recorded.wavBytes).toBe(44 + Math.round(recorded.seconds * 16_000) * 2);
  // The page loaded only this package and its assets.
  expect(requests).toContain('/assets/silero-vad.onnx');
  expect(requests).toContain('/assets/ort-wasm-simd-threaded.wasm');
  expect(requests.every((pathname) => /^\/($|browser\/|assets\/)/.test(pathname))).toBe(true);
});

test('the level detector records with no model download', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(origin);
  const recorded = await record(page, 'level');
  expect(recorded.kind).toBe('captured');
  expect(recorded.endedBy).toBe('pause');
  expect(recorded.voicedMs).toBeGreaterThan(1_000);
  // The browser does not report the audio worklet file as a page request.
  expect(requests).toEqual(['/', '/browser/voice-capture.js']);
});

test('a cancelled recording rejects and stops the microphone', async ({ page }) => {
  await page.goto(origin);
  const message = await page.evaluate(async (module) => {
    const capture = await import(module);
    capture.configureVoiceCapture({ assetBase: '/assets/', label: 'Demo voice' });
    const controller = new AbortController();
    const pending = capture.recordVoice(controller.signal, () => {}, { detector: 'level' });
    setTimeout(() => controller.abort(), 300);
    return await pending.then(
      () => 'recorded',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  }, MODULE);
  expect(message).toBe('Demo voice recording was cancelled.');
});
