import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// One page: Community Notes at / (index.html). `pnpm dev` serves it with hot reload. `/api/*`
// goes to the Pages Function that `pnpm dev:api` runs with wrangler on port 8788.
export default defineConfig({
  plugins: [react(), localVoiceCapture()],
  build: {
    // The Seams Wallet SDK is most of the bundle (about 240 kB gzip).
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        // The function refuses other origins. In dev the page and the
        // function have different ports, so the proxy drops the Origin header.
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
