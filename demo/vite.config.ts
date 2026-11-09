import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `pnpm dev` serves the page with hot reload. `/api/*` goes to the Pages
// Function that `pnpm dev:api` runs with wrangler on port 8788.
export default defineConfig({
  plugins: [react()],
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
