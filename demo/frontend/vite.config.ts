import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEMO_DIR = import.meta.dirname;
const LIVE_API_ORIGIN = 'https://speak-to-sign.pages.dev';

// Makes .env.local from .env.example when missing, so `pnpm dev` works after `git clone`.
if (!existsSync(path.join(DEMO_DIR, '.env.local')) && existsSync(path.join(DEMO_DIR, '.env.example'))) {
  copyFileSync(path.join(DEMO_DIR, '.env.example'), path.join(DEMO_DIR, '.env.local'));
}

/** True when `.dev.vars` exists and holds at least one `KEY=VALUE` line. */
function hasDevVars(file: string): boolean {
  if (!existsSync(file)) return false;
  return /^[^#\s=]+=\S+/m.test(readFileSync(file, 'utf8'));
}

const apiTarget =
  process.env.VITE_API_TARGET?.trim() ||
  (hasDevVars(path.join(DEMO_DIR, '.dev.vars')) ? 'http://localhost:8788' : LIVE_API_ORIGIN);

// Two pages: Community Notes at / (index.html) and the spoken multisig at /multisig/
// (multisig/index.html). `pnpm dev` serves both with hot reload. With `.dev.vars`, `/api/*` goes
// to the local Pages Function on port 8788; without `.dev.vars`, it goes to the live demo API.
export default defineConfig({
  plugins: [react(), localVoiceCapture()],
  build: {
    // The Seams Wallet SDK is most of the bundle (about 240 kB gzip).
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        notes: path.resolve(DEMO_DIR, 'index.html'),
        multisig: path.resolve(DEMO_DIR, 'multisig/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        // The function refuses other origins. In dev the page and the
        // function have different origins, so the proxy drops the Origin header.
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        },
      },
    },
  },
});

/** The local build of the voice card, for the dev preview of a card that the Wallet has not shipped. */
const VOICE_CAPTURE_DIST = path.resolve(import.meta.dirname, '../../packages/voice-capture/dist');
const VOICE_CAPTURE_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

/**
 * Dev only: serves packages/voice-capture/dist at /__voice-capture/, for
 * /card-minimize-preview.html (src/dev/minimizePreview.tsx). The build has no such path.
 */
function localVoiceCapture(): Plugin {
  return {
    name: 'local-voice-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__voice-capture', (request, response, next) => {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
        const file = path.join(VOICE_CAPTURE_DIST, path.normalize(pathname));
        if (!file.startsWith(VOICE_CAPTURE_DIST + path.sep)) return next();
        readFile(file).then(
          (bytes) => {
            response.setHeader('Content-Type', VOICE_CAPTURE_TYPES[path.extname(file)] ?? 'application/octet-stream');
            response.end(bytes);
          },
          () => next(),
        );
      });
    },
  };
}
