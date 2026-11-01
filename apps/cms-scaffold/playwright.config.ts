import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["front.spec.ts", "back.spec.ts", "admin.spec.ts"],
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/frontend/real-results.json" }]],
  outputDir: process.env.CMS_E2E_ARTIFACT_DIR || "test-results/frontend/real-artifacts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    // Auth headers in trace archives would bypass the runner's text-log redaction.
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
