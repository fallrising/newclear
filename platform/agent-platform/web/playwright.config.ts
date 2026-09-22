import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:18600', browserName: 'chromium' },
  webServer: {
    command: `${process.env.PYTHON ?? '../.venv/bin/python'} ../scripts/browser-fixture.py serve`,
    url: 'http://127.0.0.1:18600/api/v1/session',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
