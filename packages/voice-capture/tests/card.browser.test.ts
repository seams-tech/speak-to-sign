// The phrase card and the example page in a real browser, with the built package alone.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const DIST = path.resolve(import.meta.dirname, '../dist');
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

let origin = '';
let close = (): void => {};

test.beforeAll(async () => {
  const server = createServer((request, response) => void serve(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The test server has no port.');
  origin = `http://localhost:${address.port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

test.afterAll(() => close());

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';
  response.setHeader('Cache-Control', 'no-store');
  try {
    const bytes = await readFile(path.join(DIST, pathname));
    response.setHeader('Content-Type', TYPES[path.extname(pathname)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

test('the example records one sentence on the phrase card and shows the result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${origin}/example/`);
  await page.getByLabel('Record with no model download').check();
  await page.getByRole('button', { name: 'Record one sentence' }).click();

  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(card.getByRole('heading', { name: 'Say this sentence' })).toBeVisible();
  await expect(card.getByText('Send two NEAR to alice.testnet.')).toBeVisible();
  await card.getByRole('button', { name: 'Record' }).click();

  // The fake microphone plays the speech fixture; the card then shows the caller's views.
  await expect(card.getByText('Recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('#log')).toHaveText(/^One sentence: \d\.\d s, \d+ bytes\.$/);
  expect(errors).toEqual([]);
  // The detector `level` loads no model, and the page loads nothing outside the package.
  expect(requests.filter((pathname) => /\.(onnx|wasm)$/.test(pathname))).toEqual([]);
  expect(requests.every((pathname) => /^\/(example|browser|assets)\//.test(pathname))).toBe(true);
});

test('the example records three enrollment phrases, one card after another', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  await page.getByLabel('Record with no model download').check();
  await page.getByRole('button', { name: 'Record three enrollment phrases' }).click();
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  for (const phrase of [
    'My voice is my signature for this wallet.',
    'I send money only when I say so.',
    'Please learn how I sound today.',
  ]) {
    await expect(card.getByText(phrase)).toBeVisible();
    await card.getByRole('button', { name: 'Record' }).click();
    await expect(card.getByText('Recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Done' }).click();
  }
  await expect(card).toHaveCount(0);
  const lines = (await page.locator('#log').innerText()).split('\n');
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toMatch(/": \d\.\d s, \d+ bytes\.$/);
});

test('the phrase card with the speech model records, and Cancel ends a new recording', async ({
  page,
}) => {
  await page.goto(`${origin}/example/`);
  await page.getByRole('button', { name: 'Record one sentence' }).click();
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  await card.getByRole('button', { name: 'Record' }).click();
  await expect(card.getByText('Recorded', { exact: true })).toBeVisible({ timeout: 40_000 });
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#log')).toHaveText(/^One sentence:/);
  // The closed card leaves with a short animation.
  await expect(card).toHaveCount(0);

  await page.getByRole('button', { name: 'Record one sentence' }).click();
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#log')).toHaveText('The recording was cancelled.');
  await expect(card).toHaveCount(0);
});

test('a card with autoStart records with no press on Record', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  await page.getByLabel('Record with no model download').check();
  await page.getByLabel('Start the recording with no press on Record').check();
  await page.getByRole('button', { name: 'Record one sentence' }).click();
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(card.getByText('Recorded', { exact: true })).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#log')).toHaveText(/^One sentence:/);
});

test('a card with autoStart keeps its Record button when the browser waits for a press', async ({
  page,
}) => {
  // A browser that waits for a press keeps the audio context suspended, with no error.
  await page.addInitScript(() => {
    AudioContext.prototype.resume = () => new Promise<void>(() => {});
    Object.defineProperty(AudioContext.prototype, 'state', { get: () => 'suspended' });
  });
  await page.goto(`${origin}/example/`);
  await page.getByLabel('Record with no model download').check();
  await page.getByLabel('Start the recording with no press on Record').check();
  await page.getByRole('button', { name: 'Record one sentence' }).click();
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(card.getByText('Opening microphone…')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Record' })).toBeEnabled({ timeout: 10_000 });
  await expect(card.getByText('Read it naturally, then pause.')).toBeVisible();
});

type Corner = { label: string | null; path: string | null; left: number; right: number };

/** Opens a card with the given corner controls and returns them, in document order. */
async function openWithControls(
  page: import('@playwright/test').Page,
  controls?: 'close' | 'back' | 'back_and_close',
): Promise<Corner[]> {
  await page.goto(`${origin}/example/`);
  return page.evaluate(async (controls) => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const state = window as unknown as { pressed: string[]; result: Promise<unknown> };
    state.pressed = [];
    const surface = openPhraseCard({
      sentence: 'Send two NEAR to alice.testnet',
      signal: new AbortController().signal,
      detector: 'level',
      frame: { controls, pressed: (control: string) => state.pressed.push(control) },
    });
    state.result = surface.record();
    const card = document.querySelector('.seams-voiceid-prompt')!.getBoundingClientRect();
    return [...document.querySelectorAll('.seams-voiceid-prompt > .seams-voiceid-close')].map(
      (control) => {
        const box = control.getBoundingClientRect();
        return {
          label: control.getAttribute('aria-label'),
          path: control.querySelector('path')?.getAttribute('d') ?? null,
          left: box.left - card.left,
          right: card.right - box.right,
        };
      },
    );
  }, controls);
}

test('the card shows Close, Back in its place, or Back and Close', async ({ page }) => {
  const [cancel, ...noMore] = await openWithControls(page);
  expect(noMore).toEqual([]);
  expect(cancel).toMatchObject({ label: 'Cancel', path: 'M6 6l12 12M18 6L6 18' });
  expect(cancel.right).toBeLessThan(cancel.left);

  const [back, ...none] = await openWithControls(page, 'back');
  expect(none).toEqual([]);
  expect(back).toMatchObject({ label: 'Back', path: 'm15 18-6-6 6-6' });
  // Back is in the leading corner, as far from the edge as Cancel is from its own.
  expect(back.left).toBeCloseTo(cancel.right, 0);

  const both = await openWithControls(page, 'back_and_close');
  expect(both).toEqual([
    { ...back, label: 'Back' },
    { ...cancel, label: 'Close' },
  ]);
});

test('Back and Close each end the card and report which one the person pressed', async ({
  page,
}) => {
  for (const control of ['Back', 'Close'] as const) {
    await openWithControls(page, 'back_and_close');
    const card = page.getByRole('dialog', { name: 'Say this with your voice' });
    await card.getByRole('button', { name: control, exact: true }).click();
    const outcome = await page.evaluate(async () => {
      const state = window as unknown as { pressed: string[]; result: Promise<unknown> };
      return { pressed: state.pressed, result: await state.result };
    });
    expect(outcome).toEqual({ pressed: [control.toLowerCase()], result: { kind: 'cancelled' } });
  }
  // The host's cancel (Escape in its dialog) ends the card too, with no press.
  await openWithControls(page, 'back_and_close');
  await page.evaluate(() =>
    document.querySelector('.seams-voiceid-activation-surface')!.dispatchEvent(new Event('cancel')),
  );
  const escaped = await page.evaluate(async () => {
    const state = window as unknown as { pressed: string[]; result: Promise<unknown> };
    return { pressed: state.pressed, result: await state.result };
  });
  expect(escaped).toEqual({ pressed: [], result: { kind: 'cancelled' } });
});

test('Record has the theme button colours, and the ink colours without them', async ({ page }) => {
  // Opens a card on a page with these CSS variables, and reads the colours of Record.
  const recordColours = async (variables: Record<string, string>) => {
    await page.goto(`${origin}/example/`);
    return page.evaluate(async (variables) => {
      for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
      const module = '/browser/card.js';
      const { openPhraseCard } = await import(module);
      void openPhraseCard({ sentence: 'Send two NEAR to alice.testnet', signal: new AbortController().signal, detector: 'level' }).record();
      const style = getComputedStyle(document.querySelector('.seams-voiceid-prompt .seams-voiceid-primary')!);
      return { background: style.backgroundColor, color: style.color };
    }, variables);
  };
  const ink = { '--seams-colors-textPrimary': 'rgb(15, 20, 25)', '--seams-colors-colorBackground': 'rgb(255, 255, 255)' };
  expect(await recordColours(ink)).toEqual({ background: 'rgb(15, 20, 25)', color: 'rgb(255, 255, 255)' });
  expect(
    await recordColours({ ...ink, '--seams-colors-buttonBackground': 'rgb(29, 155, 240)', '--seams-colors-textButton': 'rgb(255, 255, 255)' }),
  ).toEqual({ background: 'rgb(29, 155, 240)', color: 'rgb(255, 255, 255)' });
});
