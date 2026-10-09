import { defineConfig } from "@playwright/test";

const listing = process.argv.includes("--list");
const mode = process.env.CMS_PP1_TLS_MODE;
const suite = process.env.CMS_PP1_SUITE ?? "runtime";
if (!["runtime", "accounts"].includes(suite) || (suite === "accounts" && mode !== "trusted")) {
  throw new Error("PP1_LOCAL_BROWSER_INPUT_INVALID");
}
if (!listing && (!process.env.CMS_PP1_RUN_ROOT || !process.env.CMS_PP1_CHROMIUM || !["trusted", "untrusted"].includes(mode ?? ""))) {
  throw new Error("PP1_LOCAL_BROWSER_INPUT_INVALID");
}
export default defineConfig({
  testDir: "./e2e-pp1-local",
  testMatch: suite === "accounts" ? "accounts.spec.ts" : "runtime.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "/tmp/pp1-results",
  use: {
    browserName: "chromium",
    ignoreHTTPSErrors: false,
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: process.env.CMS_PP1_CHROMIUM ? { executablePath: process.env.CMS_PP1_CHROMIUM } : {},
  },
});
