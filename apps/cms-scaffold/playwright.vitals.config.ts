import { defineConfig, devices } from "@playwright/test";
// Inherit one artifact namespace across Playwright worker restarts; stale runs cannot contaminate a measurement.
process.env.W5_VITALS_RUN_ID ??= `${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: "./e2e-vitals",
  testMatch: "vitals-w5.spec.ts",
  fullyParallel: false, forbidOnly: !!process.env.CI, retries: 0, workers: 1,
  timeout: 60_000, expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "test-results/frontend/vitals-report", open: "never" }]],
  outputDir: "test-results/frontend/vitals-artifacts",
  use: { locale: "zh-TW", timezoneId: "Asia/Taipei", colorScheme: "light", reducedMotion: "reduce",
    // Each cold context is traced explicitly by the Vitals spec; avoid two trace owners.
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, trace: "off", screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: [
  {
    "command": "cd apps/web-front && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
    "url": "http://127.0.0.1:4173",
    "reuseExistingServer": false,
    "timeout": 120000
  },
  {
    "command": "cd apps/web-back && npx vite preview --host 127.0.0.1 --port 4174 --strictPort",
    "url": "http://127.0.0.1:4174",
    "reuseExistingServer": false,
    "timeout": 120000
  },
  {
    "command": "cd apps/web-admin && npx vite preview --host 127.0.0.1 --port 4175 --strictPort",
    "url": "http://127.0.0.1:4175",
    "reuseExistingServer": false,
    "timeout": 120000
  }
],
});
