import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [{name: "chromium", use: {browserName: "chromium"}}],
  webServer: {
    command: "node e2e/serve.mjs",
    port: 4173,
    reuseExistingServer: true,
  },
});
