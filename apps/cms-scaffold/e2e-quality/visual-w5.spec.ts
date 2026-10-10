import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pages, states } from "./pages";
import { openCase, prepares, settle } from "./helpers";

export function assertUpdateAuthorized(argv: readonly string[], env: NodeJS.ProcessEnv): void {
  if (argv.some(arg => /^--update-snapshots(?:=|$)/.test(arg) || arg === "-u") && env.CMS_UPDATE_VISUAL_BASELINES !== "1") {
    const error = new Error("Visual baseline update requires CMS_UPDATE_VISUAL_BASELINES=1");
    process.exitCode = 2; throw error;
  }
}
export function snapshotName(id: string, viewport: string): string {
  if (!/^[a-z0-9-]+$/.test(id) || !["desktop-1280x800", "mobile-390x844"].includes(viewport)) throw new Error("Invalid W5 snapshot id or viewport");
  return `${id}-${viewport}.png`;
}
try { assertUpdateAuthorized(process.argv, process.env); } catch (error) { console.error(String(error)); process.exit(2); }
const baselineDir = "e2e-quality/visual-w5.spec.ts-snapshots";
const count = pages.filter(c => c.desktop).length + pages.filter(c => c.mobile).length + states.filter(s => s.visual).length;
if (count !== 70) throw new Error(`Expected exactly 70 visual cases, received ${count}`);
const expectedNames = [
  ...pages.flatMap(c => [snapshotName(c.id, "desktop-1280x800"), ...(c.mobile ? [snapshotName(c.id, "mobile-390x844")] : [])]),
  ...states.filter(s => s.visual).map(s => snapshotName(s.id, s.prepare === "frontMobileMenu" ? "mobile-390x844" : "desktop-1280x800")),
].map(name => name.replace(/\.png$/, "-chromium-linux.png")).sort();
const resultDir = `test-results/frontend/visual-cases/${process.env.W5_QUALITY_RUN_ID}`;
const expectedTitles = [
  ...pages.flatMap(c => [`W5 visual ${c.id} desktop-1280x800`, ...(c.mobile ? [`W5 visual ${c.id} mobile-390x844`] : [])]),
  ...states.filter(s => s.visual).map(s => `W5 visual ${s.id} state`),
].sort();
let failed = false;
let initial = false;
let chromium: string | null = null;
// Keep date-driven UI identical across canonical authoring and later comparison days.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-09-20T01:00:00Z")); });
test.beforeAll(async ({ browser }) => {
  chromium = browser.version();
  mkdirSync(resultDir, { recursive: true });
  const existing = existsSync(baselineDir) ? readdirSync(baselineDir).filter(f => f.endsWith(".png")).sort() : [];
  initial = existing.length === 0;
  if (initial && process.env.CMS_UPDATE_VISUAL_BASELINES !== "1") { process.exitCode = 2; throw new Error("Initial baseline authoring requires CMS_UPDATE_VISUAL_BASELINES=1 on canonical ubuntu-24.04 CI"); }
  if (!initial) expect(existing).toEqual(expectedNames);
  expect(process.platform).toBe("linux");
  if (process.env.CMS_UPDATE_VISUAL_BASELINES === "1") {
    expect(initial, "This milestone only authorizes initial baseline creation; existing PNGs must be compared").toBe(true);
    expect(process.env.CI, "Initial authoring must run in canonical CI").toBe("true");
    const os = readFileSync("/etc/os-release", "utf8");
    expect(os).toMatch(/^ID=ubuntu$/m); expect(os).toMatch(/^VERSION_ID="24\.04"$/m);
  }
  for (const font of ["Noto Sans TC", "Noto Serif TC"]) {
    const resolved = execFileSync("fc-match", ["-f", "%{family}", font], { encoding: "utf8" });
    expect(resolved, `${font} must resolve to the intended Traditional Chinese face`).toMatch(new RegExp(font.replace(" TC", "(?: CJK)? TC")));
  }
});
// Playwright requires fixture destructuring even when only TestInfo is needed.
// eslint-disable-next-line no-empty-pattern
test.afterEach(({}, info) => {
  if (info.status !== info.expectedStatus) failed = true;
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(`${resultDir}/${createHash("sha256").update(info.title).digest("hex")}.json`, JSON.stringify({ title: info.title, passed: info.status === "passed" }));
});
test.afterAll(() => {
  mkdirSync("test-results/frontend", { recursive: true });
  const files = existsSync(baselineDir) ? readdirSync(baselineDir).filter(f => f.endsWith(".png")).sort() : [];
  const results = existsSync(resultDir) ? readdirSync(resultDir).map(file => JSON.parse(readFileSync(`${resultDir}/${file}`, "utf8")) as { title: string; passed: boolean }) : [];
  const coverageComplete = JSON.stringify(files) === JSON.stringify(expectedNames) && JSON.stringify(results.map(r => r.title).sort()) === JSON.stringify(expectedTitles);
  const complete = coverageComplete && results.every(r => r.passed);
  if (!coverageComplete) writeFileSync("test-results/frontend/visual-incomplete.json", JSON.stringify({ result: "failed", expected: 70, completed: results, baselineFiles: files }, null, 2));
  const hashManifest = "test-results/frontend/visual-hashes.sha256";
  writeFileSync(hashManifest, files.map(file => `${createHash("sha256").update(readFileSync(`${baselineDir}/${file}`)).digest("hex")}  ${baselineDir}/${file}`).join("\n") + "\n");
  if (!coverageComplete) return;
  const measuredAt = new Date().toISOString();
  writeFileSync("test-results/frontend/visual.json", JSON.stringify({ schemaVersion: 1, measuredAt, gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), node: process.version, chromium, command: "test:visual", artifact: "test-results/frontend/visual.json", result: !failed && complete ? "passed" : "failed", recordId: `W5-VISUAL-${measuredAt.slice(0, 10).replaceAll("-", "")}-01`, os: readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? process.platform, desktopCases: 52, mobileCases: 15, stateCases: 3, threshold: 0.2, maxDiffPixelRatio: 0.001, hashManifest, authorization: process.env.CMS_UPDATE_VISUAL_BASELINES === "1" ? (initial ? "W5 initial canonical CI authoring; owner A–D approved 2026-10-05" : "CMS_UPDATE_VISUAL_BASELINES=1; requires UX owner authorization in PR") : "comparison only", notes: "Noto TC font aliases resolve to TC face; exact 70 expected baselines" }, null, 2));
});
for (const c of pages) for (const viewport of ["desktop", ...(c.mobile ? ["mobile"] : [])] as ("desktop" | "mobile")[]) {
  const dimensions = viewport === "desktop" ? "desktop-1280x800" : "mobile-390x844";
  test(`W5 visual ${c.id} ${dimensions}`, async ({ page }) => {
    await openCase(page, c, viewport);
    await expect(page).toHaveScreenshot(snapshotName(c.id, dimensions), { animations: "disabled", caret: "hide", scale: "css", threshold: 0.2, maxDiffPixelRatio: 0.001 });
  });
}
for (const state of states.filter(s => s.visual)) test(`W5 visual ${state.id} state`, async ({ page }) => {
  await openCase(page, pages.find(c => c.id === state.pageId)!, "desktop");
  await prepares[state.prepare](page); await settle(page);
  await expect(page).toHaveScreenshot(snapshotName(state.id, state.prepare === "frontMobileMenu" ? "mobile-390x844" : "desktop-1280x800"), { animations: "disabled", caret: "hide", scale: "css", threshold: 0.2, maxDiffPixelRatio: 0.001 });
});
