import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages: the Speak-to-Sign page at / and the Community Notes demo at /notes/.
// `pnpm dev` serves them with hot reload. `/api/*` goes to the Pages
// Function that `pnpm dev:api` runs with wrangler on port 8788.
export default defineConfig({
  plugins: [react()],
  // The Seams Wallet SDK is most of the bundle (about 240 kB gzip).
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        notes: fileURLToPath(new URL('./notes/index.html', import.meta.url)),
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
