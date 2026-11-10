import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages, one per example: Community Notes at / (index.html) and the voice multisig at
// /multisig/ (multisig/index.html). The example opens in a window on its page (#/notes,
// #/multisig). `pnpm dev` serves both with hot reload. `/api/*` goes to the Pages Function
// that `pnpm dev:api` runs with wrangler on port 8788.
export default defineConfig({
  plugins: [react()],
  build: {
    // The Seams Wallet SDK is most of the bundle (about 240 kB gzip).
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        notes: fileURLToPath(new URL('./index.html', import.meta.url)),
        multisig: fileURLToPath(new URL('./multisig/index.html', import.meta.url)),
      },
    },
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
