import {defineConfig} from "@playwright/test";

// Real-stack journey: run against `KEEP_STACK=1 make e2e` with `pnpm e2e:stack`.
export default defineConfig({
  testDir: "./e2e-stack",
  timeout: 30_000,
  reporter: "line",
  use: {
    baseURL: process.env.OJBQUAY_WEB_URL ?? "http://127.0.0.1:28088",
    viewport: {width: 1280, height: 800},
    trace: "retain-on-failure",
  },
  projects: [{name: "chromium", use: {browserName: "chromium"}}],
});
