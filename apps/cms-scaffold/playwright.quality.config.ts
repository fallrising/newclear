import { defineConfig, devices } from "@playwright/test";
process.env.W5_QUALITY_RUN_ID ??= `${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: "./e2e-quality",
  testMatch: ["axe-w5.spec.ts", "visual-w5.spec.ts", "hardening-w5.spec.ts"],
  updateSnapshots: "none",
  fullyParallel: false, forbidOnly: !!process.env.CI, retries: 0, workers: 1,
  timeout: 60_000, expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "test-results/frontend/quality-report", open: "never" }]],
  outputDir: "test-results/frontend/quality-artifacts",
  use: { locale: "zh-TW", timezoneId: "Asia/Taipei", colorScheme: "light", reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  webServer: [
  {
    "command": "cd apps/web-front && npx vite --mode mock --host 127.0.0.1 --port 5173 --strictPort",
    "url": "http://127.0.0.1:5173",
    "reuseExistingServer": false,
    "timeout": 120000
  },
  {
    "command": "cd apps/web-back && npx vite --mode mock --host 127.0.0.1 --port 5174 --strictPort",
    "url": "http://127.0.0.1:5174",
    "reuseExistingServer": false,
    "timeout": 120000
  },
  {
    "command": "cd apps/web-admin && npx vite --mode mock --host 127.0.0.1 --port 5175 --strictPort",
    "url": "http://127.0.0.1:5175",
    "reuseExistingServer": false,
    "timeout": 120000
  }
],
});
