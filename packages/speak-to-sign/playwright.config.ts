import { defineConfig } from '@playwright/test';

// The tests run the host plugin in Node against a fake Wallet core. They open no browser.
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.test.ts',
  fullyParallel: true,
  reporter: 'line',
});
