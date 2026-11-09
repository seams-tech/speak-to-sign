import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One page: the Speak-to-Sign page at /. Its examples open in a window on the same page
// (#/notes, #/merge, #/multisig). `pnpm dev` serves it with hot reload. `/api/*` goes to the
// Pages Function that `pnpm dev:api` runs with wrangler on port 8788.
export default defineConfig({
  plugins: [react()],
  // The Seams Wallet SDK is most of the bundle (about 240 kB gzip).
  build: {
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
