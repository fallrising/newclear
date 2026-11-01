import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      chromiumSandbox: true,
      ...(process.env.SIGNALHUB_CHROMIUM ? { executablePath: process.env.SIGNALHUB_CHROMIUM } : {}),
    },
    screenshot: 'only-on-failure',
  },
});
