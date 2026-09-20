import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Optional local Chromium bundle when the standard Playwright CDN is unreachable.
const browser = process.env.DIM_GATE_BROWSER_CONFIG
  ? JSON.parse(readFileSync(process.env.DIM_GATE_BROWSER_CONFIG, 'utf8')) as { executablePath: string; args: string[] }
  : undefined

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173/dim-gate/', launchOptions: browser, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173/dim-gate/', reuseExistingServer: false },
})
