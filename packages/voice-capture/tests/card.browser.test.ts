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
