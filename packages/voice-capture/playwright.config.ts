import path from 'node:path';
import { defineConfig } from '@playwright/test';

const speech = path.resolve(import.meta.dirname, 'tests/fixtures/speech-then-silence.wav');

// `node` runs the pure functions with no browser. `chromium` records from a fake microphone
// that plays the speech fixture, with the built package (run `pnpm build` first).
export default defineConfig({
  testDir: 'tests',
  reporter: 'line',
  projects: [
    { name: 'node', testMatch: '*.unit.test.ts' },
    {
      name: 'chromium',
      testMatch: '*.browser.test.ts',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${speech}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});
