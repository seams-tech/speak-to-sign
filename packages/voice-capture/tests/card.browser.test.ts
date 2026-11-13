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
  // The status line is empty again: the sentence is the one text to read.
  await expect(card.getByText('Opening microphone…')).toHaveCount(0);
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

type MinimizeState = {
  surface: import('../src/card').PhraseSurface;
  minimized: boolean[];
  progress: unknown[];
  pressed: string[];
  result: Promise<unknown>;
};

/** Opens a card with Back, Close and Minimize, which records with no press. */
async function openWithMinimize(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${origin}/example/`);
  await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const state = window as unknown as MinimizeState;
    state.minimized = [];
    state.progress = [];
    state.pressed = [];
    state.surface = openPhraseCard({
      sentence: 'Send two NEAR to alice.testnet',
      signal: new AbortController().signal,
      detector: 'level',
      frame: {
        controls: 'back_and_close',
        pressed: (control: string) => state.pressed.push(control),
        minimized: (minimized: boolean) => state.minimized.push(minimized),
        progressed: (progress: unknown) => state.progress.push(progress),
      },
    });
    state.result = state.surface.record();
  });
}

const CHECK = {
  kind: 'check',
  label: 'Checking your voice',
  caption: 'Checking',
  details: ['Matching the sentence'],
  segments: ['done', 'run', 'idle'],
} as const;

test('Minimize sits beside Close, and stays in the check where Back and Close go', async ({ page }) => {
  await openWithMinimize(page);
  const corners = () =>
    page.evaluate(() => {
      const card = document.querySelector('.seams-voiceid-prompt')!.getBoundingClientRect();
      return [...document.querySelectorAll('.seams-voiceid-prompt > .seams-voiceid-close')].map((control) => ({
        label: control.getAttribute('aria-label'),
        path: control.querySelector('path')?.getAttribute('d') ?? null,
        right: Math.round(card.right - control.getBoundingClientRect().right),
        shown: getComputedStyle(control).visibility === 'visible',
      }));
    });
  const [back, minimize, close, ...noMore] = await corners();
  expect(noMore).toEqual([]);
  expect(back).toMatchObject({ label: 'Back', shown: true });
  expect(close).toMatchObject({ label: 'Close', shown: true });
  // A line, one button width (40 px) and a gap of 2 px in from Close.
  expect(minimize).toMatchObject({ label: 'Minimize', path: 'M6 12h12', right: close.right + 42, shown: true });

  await page.evaluate((check) => void (window as unknown as MinimizeState).surface.show(check), CHECK);
  await expect
    .poll(async () => (await corners()).map(({ label, shown }) => ({ label, shown })))
    .toEqual([
      { label: 'Back', shown: false },
      { label: 'Minimize', shown: true },
      { label: 'Close', shown: false },
    ]);
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(card.getByRole('button', { name: 'Minimize' })).toBeVisible();
});

test('Minimize tells the host and the card goes on; a result asks the host to show it again', async ({
  page,
}) => {
  await openWithMinimize(page);
  const card = page.getByRole('dialog', { name: 'Say this with your voice' });
  const state = () =>
    page.evaluate(async () => {
      const state = window as unknown as MinimizeState;
      const settled = await Promise.race([state.result, new Promise((resolve) => setTimeout(() => resolve('open'), 50))]);
      return { minimized: state.minimized, progress: state.progress, pressed: state.pressed, settled };
    });

  // While it records: the press is not Back or Close, and the recording does not end.
  await card.getByRole('button', { name: 'Minimize' }).click();
  expect(await state()).toMatchObject({ minimized: [true], pressed: [], settled: 'open' });

  // The host showed the card again, and the person hides it in the check.
  await page.evaluate((check) => void (window as unknown as MinimizeState).surface.show(check), CHECK);
  await card.getByRole('button', { name: 'Minimize' }).click();
  await page.evaluate(
    (check) => void (window as unknown as MinimizeState).surface.show({ ...check, segments: ['done', 'done', 'run'] }),
    CHECK,
  );
  expect((await state()).minimized).toEqual([true, true]);

  // The result needs the person: the card asks to show again, once.
  await page.evaluate(() => {
    const result = {
      kind: 'result',
      label: '',
      headline: 'Signed',
      caption: 'Your voice matched.',
      detail: '',
      action: { label: 'Done' },
      line: 'seal',
    } as const;
    void (window as unknown as MinimizeState).surface.show(result);
    void (window as unknown as MinimizeState).surface.show(result);
  });
  const end = await state();
  expect(end.minimized).toEqual([true, true, false]);
  expect(end.pressed).toEqual([]);
  // Each new stage once, with the parts of the check that are over.
  expect(end.progress).toEqual([
    // The card waits for a press on Record first.
    { stage: 'waiting', done: 0, total: 0 },
    { stage: 'checking', done: 1, total: 3 },
    { stage: 'checking', done: 2, total: 3 },
    { stage: 'result', done: 0, total: 0 },
  ]);
  await expect(card.getByRole('button', { name: 'Minimize' })).toBeVisible();
});

test('a host presses "Try again", Minimize, Back and Close for the person, and no other action', async ({
  page,
}) => {
  await page.goto(`${origin}/example/`);
  await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const state = window as unknown as MinimizeState & { press: (control: string) => boolean; choices: string[] };
    state.minimized = [];
    state.progress = [];
    state.pressed = [];
    state.choices = [];
    state.surface = openPhraseCard({
      sentence: 'Send two NEAR to alice.testnet',
      signal: new AbortController().signal,
      detector: 'level',
      frame: {
        controls: 'back_and_close',
        pressed: (control: string) => state.pressed.push(control),
        minimized: (minimized: boolean) => state.minimized.push(minimized),
        progressed: (progress: unknown) => state.progress.push(progress),
        remote: (press: (control: string) => boolean) => {
          state.press = press;
        },
      },
    });
    state.result = state.surface.record();
  });
  type Remote = MinimizeState & { press: (control: string) => boolean; choices: string[] };
  const press = (control: string) => page.evaluate((name) => (window as unknown as Remote).press(name), control);
  const stages = () =>
    page.evaluate(() => (window as unknown as Remote).progress.map((progress) => (progress as { stage: string }).stage));
  const show = (action: { label: string; retry?: boolean; icon?: 'passkey' }) =>
    page.evaluate((shown) => {
      const state = window as unknown as Remote;
      void state.surface
        .show({ kind: 'result', label: 'Nothing was sent', headline: 'The words did not match', caption: '', detail: '', action: shown, line: ['fail'] })
        .then((choice: string) => state.choices.push(choice));
    }, action);

  // The card waits for a press on Record, with the microphone off: `retry` is that press.
  expect(await stages()).toEqual(['waiting']);
  expect(await press('retry')).toBe(true);
  expect(await stages()).toEqual(['waiting', 'recording']);
  // While it records, the button does not start a recording.
  expect(await press('retry')).toBe(false);

  // The recording ends at the end of the speech.
  await page.evaluate(() => (window as unknown as Remote).result);
  expect(await stages()).toEqual(['waiting', 'recording', 'checking']);

  // A failed check with "Try again": the press answers it, and the next recording starts with
  // no press on Record.
  await show({ label: 'Try again', retry: true });
  expect(await press('retry')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as Remote).choices)).toEqual(['action']);
  await page.evaluate(() => {
    const state = window as unknown as Remote;
    state.result = state.surface.record();
  });
  await expect
    .poll(async () => (await stages()).slice(0, 5))
    .toEqual(['waiting', 'recording', 'checking', 'result', 'recording']);

  // Minimize, as the person's press.
  expect(await press('minimize')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Remote).minimized)).toEqual([true]);

  // No host press runs another action: "Confirm with passkey" and "Done" stay for the person.
  await show({ label: 'Confirm with passkey', icon: 'passkey' });
  expect(await press('retry')).toBe(false);
  expect(await page.evaluate(() => (window as unknown as Remote).choices)).toEqual(['action']);

  // A check has no corner control. On a result, Close ends the card and reports the press.
  await page.evaluate((check) => void (window as unknown as Remote).surface.show(check), CHECK);
  expect(await press('close')).toBe(false);
  await show({ label: 'Done' });
  expect(await press('close')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Remote).pressed)).toEqual(['close']);
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

test('the theme sets the voice line, its echoes and their widths, and today\'s look stays without it', async ({ page }) => {
  // Opens a card on a page with these CSS variables, and reads the main line and an echo line.
  const lineStyles = async (variables: Record<string, string>) => {
    await page.goto(`${origin}/example/`);
    return page.evaluate(async (variables) => {
      for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
      document.documentElement.style.setProperty('--seams-colors-textPrimary', 'rgb(15, 20, 25)');
      const module = '/browser/card.js';
      const { openPhraseCard } = await import(module);
      void openPhraseCard({ sentence: 'Send two NEAR to alice.testnet', signal: new AbortController().signal, detector: 'level' }).record();
      const style = (selector: string) => {
        const element = document.querySelector(`.seams-voiceid-ribbon ${selector}`)!;
        return { color: getComputedStyle(element).color, width: getComputedStyle(element).strokeWidth };
      };
      return { line: style('.seams-voiceid-ribbon-line'), echo: style('.seams-voiceid-ribbon-echo[data-layer="1"]'), deep: style('.seams-voiceid-ribbon-echo[data-layer="2"]') };
    }, variables);
  };
  const ink = { color: 'rgb(15, 20, 25)' };
  expect(await lineStyles({})).toEqual({ line: { ...ink, width: '1px' }, echo: { ...ink, width: '0.65px' }, deep: { ...ink, width: '0.65px' } });
  expect(
    await lineStyles({
      '--seams-colors-voiceLine': 'rgb(29, 155, 240)',
      '--seams-colors-voiceEcho': 'rgb(131, 200, 247)',
      '--seams-colors-voiceEchoDeep': 'rgb(22, 116, 180)',
      '--seams-shape-voiceLineWidth': '2px',
      '--seams-shape-voiceEchoWidth': '1.25px',
    }),
  ).toEqual({
    line: { color: 'rgb(29, 155, 240)', width: '2px' },
    echo: { color: 'rgb(131, 200, 247)', width: '1.25px' },
    deep: { color: 'rgb(22, 116, 180)', width: '1.25px' },
  });
});

test('a card with autoStart has no Record row, so it is shorter than a card that waits for a press', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    // The newest card: a closed card stays in the page while it fades out.
    const card = () => [...document.querySelectorAll<HTMLElement>('.seams-voiceid-prompt')].at(-1)!;
    const sentence = 'Send two NEAR to alice.testnet';
    const pressed = openPhraseCard({ sentence, signal: new AbortController().signal, detector: 'level' });
    const withRecord = card().getBoundingClientRect().height;
    pressed.close();
    openPhraseCard({ sentence, signal: new AbortController().signal, detector: 'level', autoStart: true });
    const auto = card();
    return {
      withRecord,
      auto: auto.getBoundingClientRect().height,
      marked: auto.hasAttribute('data-auto-start'),
      slot: getComputedStyle(auto.querySelector('.seams-voiceid-record-slot')!).display,
    };
  });
  expect(result.marked).toBe(true);
  expect(result.slot).toBe('none');
  expect(result.withRecord - result.auto).toBeGreaterThan(60);
});

test('a card with a context shows the text above the sentence, and the rows keep their order', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const card = () => [...document.querySelectorAll<HTMLElement>('.seams-voiceid-prompt')].at(-1)!;
    const text = 'The bridge is not closed. One lane closes for two weeks in March, says the city.';
    const plain = openPhraseCard({ sentence: 'One lane closes in March', signal: new AbortController().signal, detector: 'level' });
    const top = (element: Element | null) => element!.getBoundingClientRect().top;
    const plainRows = ['h2', '.seams-voiceid-phrase', '.seams-voiceid-ribbon', '.seams-voiceid-status'].map((selector) =>
      top(card().querySelector(`:scope > ${selector}`)),
    );
    const plainContext = card().querySelector('.seams-voiceid-context');
    plain.close();
    openPhraseCard({
      sentence: 'One lane closes in March',
      signal: new AbortController().signal,
      detector: 'level',
      autoStart: true,
      context: { label: 'Your note', text, sentenceLabel: 'Read this aloud to post' },
    });
    const shown = card();
    // The form: the voice line is the button, right under the sentence; the status is at the foot.
    const rows = ['.seams-voiceid-context', 'h2', '.seams-voiceid-phrase', '.seams-voiceid-ribbon', '.seams-voiceid-status'].map(
      (selector) => top(shown.querySelector(`:scope > ${selector}`)),
    );
    return {
      plainRows,
      plainContext: plainContext !== null,
      rows,
      marked: shown.hasAttribute('data-context'),
      label: shown.querySelector('.seams-voiceid-context-label')?.textContent,
      title: shown.querySelector(':scope > h2')?.textContent,
      text: shown.querySelector('.seams-voiceid-context blockquote')?.textContent,
    };
  });
  expect(result.plainContext).toBe(false);
  expect(result.marked).toBe(true);
  expect(result.label).toBe('Your note');
  expect(result.title).toBe('Read this aloud to post');
  expect(result.text).toBe('The bridge is not closed. One lane closes for two weeks in March, says the city.');
  // Each row is below the one before it, with and without a context.
  for (const rows of [result.plainRows, result.rows]) {
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]!).toBeGreaterThan(rows[i - 1]!);
  }
});

test('a result shows the seal, then its headline, details and button, and the seal takes the theme colour', async ({ page }) => {
  test.setTimeout(90_000);
  // Opens a card with these CSS variables, shows a result, and reads the seal's colour and the
  // rows' places.
  const resultCard = async (variables: Record<string, string>) => {
    await page.goto(`${origin}/example/`);
    return page.evaluate(async (variables) => {
      for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
      document.documentElement.style.setProperty('--seams-colors-textPrimary', 'rgb(15, 20, 25)');
      const module = '/browser/card.js';
      const { openPhraseCard } = await import(module);
      // The fake microphone plays the speech fixture: the card records, then shows the result.
      const surface = openPhraseCard({ sentence: 'Send two NEAR to alice.testnet', signal: new AbortController().signal, detector: 'level', autoStart: true });
      await surface.record();
      // A result resolves when the person presses its button: the test reads the card first.
      void surface.show({ kind: 'result', label: '', headline: 'Sent', caption: 'Send two NEAR to alice.testnet', detail: 'Checked and sent in 2.0 s', action: { label: 'Done' }, line: 'seal' });
      const card = document.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
      while (card.dataset.phraseView !== 'result') await new Promise((resolve) => setTimeout(resolve, 50));
      // The rows fade in and the line row glides to its place.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const top = (selector: string) => card.querySelector(`:scope > ${selector}`)!.getBoundingClientRect().top;
      const bottom = (selector: string) => card.querySelector(`:scope > ${selector}`)!.getBoundingClientRect().bottom;
      return {
        seal: getComputedStyle(card.querySelector('.seams-voiceid-status-line')!).color,
        rows: ['.seams-voiceid-status-line', '.seams-voiceid-phrase', '.seams-voiceid-status', '.seams-voiceid-record-slot'].map(top),
        below: card.getBoundingClientRect().bottom - bottom('.seams-voiceid-record-slot'),
      };
    }, variables);
  };
  expect((await resultCard({})).seal).toBe('rgb(15, 20, 25)');
  expect((await resultCard({ '--seams-colors-voiceLine': 'rgb(29, 155, 240)' })).seal).toBe('rgb(29, 155, 240)');
  const result = await resultCard({ '--seams-colors-voiceLine': 'rgb(29, 155, 240)', '--seams-colors-voiceSeal': 'rgb(0, 186, 124)' });
  expect(result.seal).toBe('rgb(0, 186, 124)');
  // Each row is below the one before it, and the button has only the card's padding under it.
  for (let i = 1; i < result.rows.length; i += 1) expect(result.rows[i]!).toBeGreaterThan(result.rows[i - 1]!);
  expect(result.below).toBeLessThan(30);
});

test('a result with a receipt shows its rows between the caption and the detail, with its link', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${origin}/example/`);
  const shown = await page.evaluate(async () => {
    document.documentElement.style.setProperty('--seams-colors-voiceSeal', 'rgb(0, 186, 124)');
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const surface = openPhraseCard({ sentence: 'Send two NEAR to alice.testnet', signal: new AbortController().signal, detector: 'level', autoStart: true });
    await surface.record();
    void surface.show({
      kind: 'result',
      label: '',
      headline: 'Note posted',
      caption: 'The claim is not confirmed',
      receipt: {
        title: 'TEE receipt',
        source: 'Intel TDX · OutLayer',
        rows: [
          { label: 'Voice', value: 'matched alice.testnet' },
          { label: 'Words', value: 'matched the summary' },
        ],
        link: { text: 'View TDX quote', href: 'https://testnet-api.outlayer.ai/attestations/by-call/1' },
      },
      detail: 'Checked and posted in 2.0 s ·',
      link: { text: 'View transaction', href: 'https://testnet.nearblocks.io/txns/abc' },
      action: { label: 'Done' },
      line: 'seal',
    });
    const card = document.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
    while (card.dataset.phraseView !== 'result') await new Promise((resolve) => setTimeout(resolve, 50));
    const status = card.querySelector('.seams-voiceid-status')!;
    const receipt = status.querySelector<HTMLElement>('.seams-voiceid-receipt')!;
    const link = receipt.querySelector('a')!;
    return {
      order: [...status.children].map((child) => child.className),
      head: receipt.querySelector('.seams-voiceid-receipt-head')!.textContent,
      labels: [...receipt.querySelectorAll('.seams-voiceid-receipt-label')].map((label) => label.textContent),
      values: [...receipt.querySelectorAll('.seams-voiceid-receipt-value')].map((value) => value.textContent),
      check: getComputedStyle(receipt.querySelector('.seams-voiceid-receipt-check')!).color,
      link: [link.textContent, link.href, link.target],
    };
  });
  expect(shown.order).toEqual(['seams-voiceid-caption', 'seams-voiceid-receipt', 'seams-voiceid-caption-detail']);
  expect(shown.head).toBe('TEE receiptIntel TDX · OutLayer');
  expect(shown.labels).toEqual(['Voice', 'Words']);
  expect(shown.values).toEqual(['matched alice.testnet', 'matched the summary']);
  expect(shown.check).toBe('rgb(0, 186, 124)');
  expect(shown.link).toEqual(['View TDX quote', 'https://testnet-api.outlayer.ai/attestations/by-call/1', '_blank']);
});

test('a result that is taller than its frame does not scroll the frame', async ({ page }) => {
  test.setTimeout(60_000);
  // The Wallet frame grows to the result one moment after the result shows. Until then the
  // result is taller than the frame, and the frame's document can scroll. A short window is
  // such a frame.
  await page.setViewportSize({ width: 520, height: 300 });
  await page.goto(`${origin}/example/`);
  const scrolled = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const surface = openPhraseCard({ sentence: 'Send two NEAR to alice.testnet', signal: new AbortController().signal, detector: 'level', autoStart: true });
    await surface.record();
    window.scrollTo(0, 0);
    const before = window.scrollY;
    void surface.show({
      kind: 'result',
      label: '',
      headline: 'Note posted',
      caption: 'The claim is not confirmed',
      receipt: {
        title: 'TEE receipt',
        source: 'Intel TDX · OutLayer',
        rows: [
          { label: 'Voice', value: 'matched alice.testnet' },
          { label: 'Words', value: 'matched the summary' },
          { label: 'Summary', value: 'fits the note (JEV)' },
          { label: 'Verdict', value: 'signed by the OutLayer verifier 0.14.1' },
        ],
        link: { text: 'View TDX quote', href: 'https://testnet-api.outlayer.ai/attestations/by-call/1' },
      },
      detail: 'Checked and posted in 2.0 s ·',
      action: { label: 'Done' },
      line: 'seal',
    });
    const card = document.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
    while (card.dataset.phraseView !== 'result') await new Promise((resolve) => setTimeout(resolve, 50));
    // The focus of the action comes after the rows change.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      before,
      after: window.scrollY,
      taller: document.documentElement.scrollHeight > window.innerHeight,
      focused: document.activeElement === card.querySelector('.seams-voiceid-primary'),
    };
  });
  expect(scrolled.taller).toBe(true);
  expect(scrolled.focused).toBe(true);
  // Before, the focus of "Done" scrolled the frame, so the card's top was cut off.
  expect(scrolled).toMatchObject({ before: 0, after: 0 });
});

test('a caption with a word of 64 characters breaks inside the card, and no row leaves the card', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${origin}/example/`);
  const shown = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const surface = openPhraseCard({ sentence: 'Create a prediction market on this note', signal: new AbortController().signal, detector: 'level', autoStart: true });
    await surface.record();
    void surface.show({
      kind: 'result',
      label: '',
      headline: 'Transaction sent',
      // An implicit NEAR account has no place to break a line.
      caption: 'To 3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520df9b1a4c7e55',
      receipt: {
        title: 'TEE receipt',
        source: 'Intel TDX · OutLayer',
        rows: [{ label: 'Verdict', value: 'signed by the OutLayer verifier 0.14.1' }],
        link: { text: 'View TDX quote', href: 'https://testnet-api.outlayer.ai/attestations/by-call/1' },
      },
      detail: 'Checked and sent in 11.6 s ·',
      link: { text: 'View transaction', href: 'https://testnet.nearblocks.io/txns/abc' },
      action: { label: 'Done' },
      line: 'seal',
    });
    const card = document.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
    while (card.dataset.phraseView !== 'result') await new Promise((resolve) => setTimeout(resolve, 50));
    const frame = card.getBoundingClientRect();
    const outside = (selector: string) => {
      const box = card.querySelector(selector)!.getBoundingClientRect();
      return Math.max(0, Math.round(box.right - frame.right), Math.round(frame.left - box.left));
    };
    const caption = card.querySelector<HTMLElement>('.seams-voiceid-caption')!;
    return {
      card: Math.round(frame.width),
      outside: ['.seams-voiceid-caption', '.seams-voiceid-receipt', '.seams-voiceid-receipt-source', '.seams-voiceid-primary'].map(outside),
      captionLines: Math.round(caption.getBoundingClientRect().height / parseFloat(getComputedStyle(caption).lineHeight)),
    };
  });
  // Before, the grid column grew to the width of the account, and the receipt and the button
  // were about 97 px wider than the card.
  expect(shown.outside).toEqual([0, 0, 0, 0]);
  expect(shown.captionLines).toBeGreaterThan(1);
});

test('a form card shows the Record button in place of the voice line until it records', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const card = () => [...document.querySelectorAll<HTMLElement>('.seams-voiceid-prompt')].at(-1)!;
    openPhraseCard({
      sentence: 'One lane closes in March',
      signal: new AbortController().signal,
      detector: 'level',
      context: { label: 'Your note', text: 'One lane closes for two weeks in March.' },
    });
    const shown = card();
    const visible = (selector: string) => getComputedStyle(shown.querySelector(`:scope > ${selector}`)!).visibility;
    const record = shown.querySelector<HTMLElement>('.seams-voiceid-primary')!;
    return { line: visible('.seams-voiceid-ribbon'), record: !record.hidden && record.getBoundingClientRect().height > 0 };
  });
  expect(result).toEqual({ line: 'hidden', record: true });
});

test('the voice line draws sine wave lines by default, and pixels by prop or by the theme', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const card = () => [...document.querySelectorAll<HTMLElement>('.seams-voiceid-prompt')].at(-1)!;
    const open = (options: Record<string, unknown>) => {
      openPhraseCard({ sentence: 'One lane closes in March', signal: new AbortController().signal, detector: 'level', ...options });
      const shown = card();
      const pixels = shown.querySelector('.seams-voiceid-ribbon-pixels');
      return {
        style: shown.dataset.voiceLine ?? 'wave',
        dots: shown.querySelectorAll('.seams-voiceid-ribbon-pixel').length,
        shown: pixels?.getAttribute('opacity') ?? null,
        middle: [...shown.querySelectorAll('.seams-voiceid-ribbon-pixel[data-band="0"]')].filter((dot) => dot.getAttribute('opacity') === '1').length,
      };
    };
    const plain = open({});
    const byProp = open({ voiceLine: 'pixels' });
    document.body.style.setProperty('--seams-shape-voiceLine', 'pixels');
    const byTheme = open({});
    const propWins = open({ voiceLine: 'wave' });
    document.body.style.removeProperty('--seams-shape-voiceLine');
    return { plain, byProp, byTheme, propWins };
  });
  expect(result.plain).toEqual({ style: 'wave', dots: 0, shown: null, middle: 0 });
  // 44 columns of 9 dots; at rest, each column shows its middle dot.
  expect(result.byProp).toEqual({ style: 'pixels', dots: 396, shown: '1', middle: 44 });
  expect(result.byTheme).toEqual(result.byProp);
  expect(result.propWins.style).toBe('wave');
});

test('the colors prop sets the card colours, over the page, and leaves out keys that the card does not read', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    document.body.style.setProperty('--seams-colors-buttonBackground', 'rgb(0, 0, 255)');
    openPhraseCard({
      sentence: 'One lane closes in March',
      signal: new AbortController().signal,
      detector: 'level',
      autoStart: true,
      context: { label: 'Your note', text: 'One lane closes for two weeks in March.' },
      colors: { buttonBackground: 'rgb(255, 0, 0)', voiceFill: 'rgb(0, 128, 0)', notACardColour: 'red' },
    });
    const surface = [...document.querySelectorAll<HTMLElement>('.seams-voiceid-activation-surface')].at(-1)!;
    const shown = surface.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
    document.body.style.removeProperty('--seams-colors-buttonBackground');
    return {
      button: getComputedStyle(shown.querySelector('.seams-voiceid-ribbon')!).backgroundColor,
      fill: getComputedStyle(shown.querySelector('.seams-voiceid-phrase')!).backgroundColor,
      unknown: surface.style.getPropertyValue('--seams-colors-notACardColour'),
    };
  });
  expect(result).toEqual({ button: 'rgb(255, 0, 0)', fill: 'rgb(0, 128, 0)', unknown: '' });
});

test('the theme value voiceBeam none turns the Beam off, and a palette name keeps it', async ({ page }) => {
  await page.goto(`${origin}/example/`);
  const result = await page.evaluate(async () => {
    const module = '/browser/card.js';
    const { openPhraseCard } = await import(module);
    const glow = async (beam: string) => {
      document.body.style.setProperty('--seams-colors-voiceBeam', beam);
      openPhraseCard({ sentence: 'Bet one USDC yes on market nine', signal: new AbortController().signal, detector: 'level' });
      // The card reads the theme once it is in the page.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const card = [...document.querySelectorAll<HTMLElement>('.seams-voiceid-prompt')].at(-1)!;
      const element = card.querySelector<HTMLElement>('.seams-voiceid-glow')!;
      return { hidden: element.hidden, display: getComputedStyle(element).display, drawn: element.childElementCount > 0 };
    };
    const off = await glow('none');
    const on = await glow('mono');
    document.body.style.removeProperty('--seams-colors-voiceBeam');
    return { off, on };
  });
  expect(result.off).toEqual({ hidden: true, display: 'none', drawn: false });
  expect(result.on).toMatchObject({ hidden: false, drawn: true });
});

test('a form card ends its check in the microphone circle with a tick, and a plain card keeps the seal', async ({ page }) => {
  test.setTimeout(90_000);
  // Records with the fake microphone, shows a sealed result, and reads how the check's line ended.
  const sealed = async (context: boolean) => {
    await page.goto(`${origin}/example/`);
    return page.evaluate(async (context) => {
      const module = '/browser/card.js';
      const { openPhraseCard } = await import(module);
      const surface = openPhraseCard({
        sentence: 'Send two NEAR to alice.testnet',
        signal: new AbortController().signal,
        detector: 'level',
        autoStart: true,
        ...(context ? { context: { label: 'Your note', text: 'The bridge is not closed.' } } : {}),
      });
      await surface.record();
      // A result resolves when the person presses its button: the test reads the card first.
      void surface.show({ kind: 'result', label: '', headline: 'Sent', caption: 'Sent', detail: 'Checked', action: { label: 'Done' }, line: 'seal' });
      const card = document.querySelector<HTMLElement>('.seams-voiceid-prompt')!;
      while (card.dataset.phraseView !== 'result') await new Promise((resolve) => setTimeout(resolve, 50));
      const line = card.querySelector<SVGElement>('.seams-voiceid-status-line')!;
      const tick = card.querySelector<SVGPathElement>('.seams-voiceid-line-icon-check > path');
      const microphone = card.querySelector<SVGElement>('.seams-voiceid-line-icon-microphone');
      return {
        seal: line.dataset.seal ?? null,
        tickOffset: tick ? Number(getComputedStyle(tick).strokeDashoffset.replace('px', '')) : null,
        microphoneOpacity: microphone ? getComputedStyle(microphone).opacity : null,
      };
    }, context);
  };
  expect(await sealed(true)).toEqual({ seal: 'icon', tickOffset: 0, microphoneOpacity: '0' });
  expect(await sealed(false)).toEqual({ seal: '', tickOffset: null, microphoneOpacity: null });
});
