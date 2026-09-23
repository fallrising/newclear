import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

// Reuse the production shell and complete visible Guide story on both engines.
// An unavailable engine fails visibly; the suite never silently skips a browser.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['foundation.spec.ts', 'm5-browser-smoke.spec.ts', 'w1-workspaces.spec.ts', 'w2-browser-smoke.spec.ts'],
  grep: /production demo shell guards|additional browser complete visible Guide story|W1 extra browser|W2 extra browser/,
  outputDir: 'test-results-smoke',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-smoke' }]],
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: {} } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], launchOptions: process.env.DIM_GATE_WEBKIT_EXECUTABLE ? { executablePath: process.env.DIM_GATE_WEBKIT_EXECUTABLE } : {} } },
  ],
})
