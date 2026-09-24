import { defineConfig } from "@playwright/test";
import { ensureRunEnv } from "./harness/run-env.ts";

const run = ensureRunEnv();
const includeProbe = process.env.KITH_E2E_PROBE === "1";

export default defineConfig({
  testDir: "specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: `${run.runDir}/test-output`,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  grepInvert: includeProbe ? undefined : /@probe/,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${run.runDir}/report`, open: "never" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
      },
    },
    {
      name: "mobile",
      grep: /@mobile/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        locale: "en-US",
        timezoneId: "Asia/Taipei",
      },
    },
  ],
});
