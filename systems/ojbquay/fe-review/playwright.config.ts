import {createRequire} from "node:module";
const require = createRequire(new URL("../console-web/package.json", import.meta.url));
const {defineConfig} = require("@playwright/test");

export default defineConfig({
  testDir: ".",
  testMatch: "states.spec.ts",
  timeout: 180_000,
  expect: {timeout: 10_000},
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  retries: 0,
  reporter: [["json", {outputFile: "/state/playwright-result.json"}]],
  outputDir: "/state/playwright-artifacts",
  use: {baseURL: "http://127.0.0.1:5173", locale: "en-US", colorScheme: "light", trace: "off", screenshot: "off", video: "off"},
  projects: [{name: "chromium", use: {browserName: "chromium"}}],
});
