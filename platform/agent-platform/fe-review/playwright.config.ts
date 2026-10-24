import { defineConfig } from "../web/node_modules/@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "flows.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: [["line"]],
  outputDir: "runs/.state/playwright",
  use: {
    baseURL: "http://127.0.0.1:18600",
    browserName: "chromium",
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
