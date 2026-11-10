import path from 'node:path';
import { defineConfig } from '@playwright/test';

const speech = path.resolve(import.meta.dirname, '../voice-capture/tests/fixtures/speech-then-silence.wav');
const PORT = 8795;

// The example application of this repository (`examples/voice-confirm`) in Chromium, with a fake
// microphone that plays a speech fixture, and with the example's fake verifier. It runs the
// browser entry point, the capture library and the server entry point together. Build the three
// packages first.
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.browser.test.ts',
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
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
  webServer: {
    command: 'node ../../examples/voice-confirm/server.mjs',
    env: { FAKE_VERIFIER: '1', PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/actions`,
    reuseExistingServer: false,
  },
});
