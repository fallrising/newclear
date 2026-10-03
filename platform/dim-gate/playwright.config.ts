import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Optional local Chromium bundle when the standard Playwright CDN is unreachable.
const browser = process.env.DIM_GATE_BROWSER_CONFIG
  ? JSON.parse(readFileSync(process.env.DIM_GATE_BROWSER_CONFIG, 'utf8')) as { executablePath: string; args: string[] }
  : undefined

const testPort = Number(process.env.DIM_GATE_TEST_PORT ?? 4173)
const testBase = `http://127.0.0.1:${testPort}/dim-gate/`

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/m5-isolation.spec.ts', '**/m5-performance*.ts', '**/m5-browser-smoke.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: testBase, launchOptions: browser, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `pnpm preview --port ${testPort} --strictPort`, url: testBase, reuseExistingServer: false },
})
