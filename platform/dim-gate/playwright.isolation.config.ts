import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

const browser = process.env.DIM_GATE_BROWSER_CONFIG
  ? JSON.parse(readFileSync(process.env.DIM_GATE_BROWSER_CONFIG, 'utf8')) as { executablePath: string; args: string[] }
  : undefined

export default defineConfig({
  testDir: './e2e',
  testMatch: 'm5-isolation.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: 'test-results/isolation',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/isolation', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4176/dim-gate/', launchOptions: browser, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium-isolation', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node scripts/isolation-server.mjs dist/isolation-demo 4176', url: 'http://127.0.0.1:4176/dim-gate/', reuseExistingServer: false },
    { command: 'node scripts/isolation-server.mjs dist/isolation-live 4177', url: 'http://127.0.0.1:4177/dim-gate/', reuseExistingServer: false },
  ],
})
