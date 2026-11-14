import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const APP_DIR = import.meta.dirname;
const LIVE_API_ORIGIN = 'https://speak-to-sign.pages.dev';

if (!existsSync(path.join(APP_DIR, '.env.local')) && existsSync(path.join(APP_DIR, '.env.example'))) {
  copyFileSync(path.join(APP_DIR, '.env.example'), path.join(APP_DIR, '.env.local'));
}

const apiTarget = process.env.VITE_API_TARGET?.trim() || LIVE_API_ORIGIN;

// Vite serves on port 5280, and Caddy (`pnpm pay` or `pnpm dev:https`) exposes it at
// https://localhost:5443 so passkeys work in the Seams Wallet iframe. `/api/*` goes to the live
// demo faucet when no local API target is set.
export default defineConfig({
  plugins: [react()],
  // The Seams Wallet SDK is most of the bundle.
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5280,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        },
      },
    },
  },
  preview: { port: 5280, strictPort: true },
});
