import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Seams project of this example must allow the page origin,
// http://localhost:5280, so the port is fixed. It is away from the usual
// Vite ports, which the Spoken Notes demo in demo/ uses.
export default defineConfig({
  plugins: [react()],
  // The Seams Wallet SDK is most of the bundle.
  build: { chunkSizeWarningLimit: 1000 },
  server: { port: 5280, strictPort: true },
  preview: { port: 5280, strictPort: true },
});
