import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

const port = Number(process.env.DIM_GATE_PERFORMANCE_PORT ?? 4175)
const browser = process.env.DIM_GATE_BROWSER_CONFIG
  ? JSON.parse(readFileSync(process.env.DIM_GATE_BROWSER_CONFIG, 'utf8')) as { executablePath: string; args: string[] }
  : undefined

export default defineConfig({
  testDir: './e2e',
  testMatch: 'm5-performance.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: 'test-results/performance',
  reporter: [['list'], ['json', { outputFile: 'test-results/performance-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}/dim-gate/`, viewport: { width: 1440, height: 900 }, launchOptions: browser },
  projects: [{ name: 'chromium-performance', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: `pnpm preview --port ${port} --strictPort`, url: `http://127.0.0.1:${port}/dim-gate/`, reuseExistingServer: false },
})
