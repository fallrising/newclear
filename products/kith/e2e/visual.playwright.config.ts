import { defineConfig } from "@playwright/test";
import { isAbsolute, join } from "node:path";
import base from "./playwright.config.ts";
import { E2E_DIR } from "./harness/paths.ts";

process.env.KITH_VISUAL_GATE = "1";
const baseline = process.env.KITH_VISUAL_BASELINE_DIR ?? join(E2E_DIR, "visual-baselines");
if (!isAbsolute(baseline)) throw new Error("KITH_VISUAL_BASELINE_DIR must be absolute");
if (process.versions.node !== "24.18.0") throw new Error("visual gate requires Node 24.18.0");
export default defineConfig(base, {
  testMatch: "visual-stability.spec.ts",
  updateSnapshots: "none",
  snapshotPathTemplate: join(baseline, "{arg}{ext}"),
  expect: { timeout: 10_000, toHaveScreenshot: { animations: "disabled", caret: "hide", threshold: 0, maxDiffPixels: 0 } },
  projects: [{ name: "desktop", use: {
    browserName: "chromium", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    locale: "zh-TW", timezoneId: "Asia/Taipei", colorScheme: "light", contextOptions: { reducedMotion: "reduce", serviceWorkers: "block" },
  } }],
});
