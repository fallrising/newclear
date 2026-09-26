import { defineConfig, devices } from "@playwright/test";

// `npm run e2e:mock`: the three apps in `vite --mode mock` (MSW in the browser). No backend, no JDK.
const app = (workspace: string, port: number) => ({
  command: `npm run dev:mock -w ${workspace}`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
});

export default defineConfig({
  testDir: "./e2e-mock",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/e2e-mock",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Sandboxes with a preinstalled Chromium set PLAYWRIGHT_CHROMIUM_EXECUTABLE; CI installs the pinned browser.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: [app("@cms/web-front", 5173), app("@cms/web-back", 5174), app("@cms/web-admin", 5175)],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
