import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installVitalsRoutes, type VitalsTargetId } from "./routes";

type Target = { id: VitalsTargetId; surface: "front" | "back" | "admin"; url: string; metric: "lcp-cls" | "cls" };
type VitalSample = { surface: "front" | "back" | "admin"; url: string; run: number; lcpMs: number | null; cls: number };
const targets: Target[] = [
  { id: "front-album", surface: "front", url: "http://127.0.0.1:4173/album", metric: "lcp-cls" },
  { id: "front-clinic", surface: "front", url: "http://127.0.0.1:4173/clinic", metric: "lcp-cls" },
  { id: "front-projects", surface: "front", url: "http://127.0.0.1:4173/projects", metric: "lcp-cls" },
  { id: "back-home", surface: "back", url: "http://127.0.0.1:4174/", metric: "cls" },
  { id: "admin-home", surface: "admin", url: "http://127.0.0.1:4175/", metric: "cls" },
];
const sampleDir = `test-results/frontend/vitals-routes/${process.env.W5_VITALS_RUN_ID}`;
const samples: VitalSample[] = [];
let failed = false;

async function installObservers(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const state = { lcpMs: null as number | null, cls: 0, supported: false, lcpElement: "", shifts: [] as unknown[] };
    Object.assign(window, { __W5_VITALS__: state });
    const supported = PerformanceObserver.supportedEntryTypes;
    if (!supported.includes("largest-contentful-paint") || !supported.includes("layout-shift")) return;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.lcpMs = entry.startTime;
        const element = (entry as PerformanceEntry & { element?: Element }).element;
        state.lcpElement = element?.outerHTML.slice(0, 500) ?? "";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number; sources?: { node?: Element }[] })[]) {
        if (!entry.hadRecentInput) { state.cls += entry.value; state.shifts.push({ value: entry.value, nodes: entry.sources?.map(s => s.node?.outerHTML.slice(0, 300)) }); }
      }
    }).observe({ type: "layout-shift", buffered: true });
    state.supported = true;
  });
}
async function throttle(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    return session;
  } catch (error) { await session.detach(); throw error; }
}
async function measure(browser: Browser, target: Target, run: number): Promise<VitalSample> {
  const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei", colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  let session: CDPSession | undefined;
  const label = `${target.id}-${run === 0 ? "warmup" : run}`;
  mkdirSync(sampleDir, { recursive: true });
  let errorMessage = "";
  let routeLog: Awaited<ReturnType<typeof installVitalsRoutes>> | undefined;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    routeLog = await installVitalsRoutes(context, target.id);
    await installObservers(context);
    const page = await context.newPage();
    session = await throttle(page);
    await page.goto(target.url, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("query-loading")).toHaveCount(0);
    await expect(page.getByTestId("index-row-loading")).toHaveCount(0);
    await page.evaluate(async () => { await document.fonts.ready; });
    await expect.poll(() => page.locator("img:visible").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    await page.waitForTimeout(5000);
    routeLog.assertComplete();
    expect(context.serviceWorkers()).toHaveLength(0);
    const vitals = await page.evaluate(() => (window as unknown as { __W5_VITALS__: { supported: boolean; lcpMs: number | null; cls: number; lcpElement: string; shifts: unknown[] } }).__W5_VITALS__);
    expect(vitals.supported).toBe(true);
    assertThreshold(vitals.cls, Number.MAX_VALUE, `${label} CLS validity`);
    assertThreshold(vitals.lcpMs, Number.MAX_VALUE, `${label} LCP validity`);
    writeFileSync(`${sampleDir}/${label}.json`, JSON.stringify({ target: target.id, run, hits: routeLog.hits, ...vitals }, null, 2));
    return { surface: target.surface, url: target.url, run, lcpMs: target.metric === "cls" ? null : vitals.lcpMs, cls: vitals.cls };
  } catch (error) { errorMessage = String(error); throw error; }
  finally {
    if (errorMessage) { writeFileSync(`${sampleDir}/${label}-failed.json`, JSON.stringify({ target: target.id, run, hits: routeLog?.hits ?? [], error: errorMessage }, null, 2)); await context.tracing.stop({ path: `${sampleDir}/${label}-trace.zip` }); }
    else await context.tracing.stop({ path: `${sampleDir}/${label}-trace.zip` });
    try { await session?.detach(); } finally { await context.close(); }
  }
}
function median(values: number[]): number {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error("Cannot take median of missing/nonfinite samples");
  const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)];
}
function assertThreshold(actual: number | null, limit: number, label: string): void {
  if (actual === null || !Number.isFinite(actual) || actual < 0 || actual > limit) throw new Error(`${label}: ${actual} exceeds ${limit} or is invalid`);
}
function assertVitals(values: VitalSample[], target: Target): void {
  if (values.length !== 5 || new Set(values.map(v => v.run)).size !== 5 || values.some(v => v.url !== target.url || v.surface !== target.surface)) throw new Error(`${target.id}: exactly 5 matching recorded runs required`);
  for (const sample of values) assertThreshold(sample.cls, Number.MAX_VALUE, "CLS validity");
  const clsLimit = target.surface === "front" ? 0.05 : 0.1;
  assertThreshold(median(values.map(v => v.cls)), clsLimit, `${target.id} median CLS`);
  assertThreshold(Math.max(...values.map(v => v.cls)), clsLimit, `${target.id} max CLS`);
  if (target.metric === "lcp-cls") {
    for (const sample of values) assertThreshold(sample.lcpMs, Number.MAX_VALUE, "LCP validity");
    const lcp = values.map(v => v.lcpMs!);
    assertThreshold(median(lcp), 2500, `${target.id} median LCP`);
    assertThreshold(Math.max(...lcp), 3125, `${target.id} max LCP`);
  }
}
async function writeVitals(values: VitalSample[]): Promise<void> {
  const measuredAt = new Date().toISOString();
  const date = measuredAt.slice(0, 10).replaceAll("-", "");
  const summaries = targets.map((target, index) => {
    const recorded = values.filter(v => v.url === target.url);
    const lcp = recorded.map(v => v.lcpMs!);
    return { recordId: `W5-VITALS-${date}-${String(index + 1).padStart(2, "0")}`, surface: target.surface, url: target.url, viewport: "1280x800", networkCpu: "150ms/1.6Mbps/750Kbps/4x", runs: 5,
      medianLcpMs: target.metric === "cls" ? null : median(lcp), maxLcpMs: target.metric === "cls" ? null : Math.max(...lcp), medianCls: median(recorded.map(v => v.cls)), maxCls: Math.max(...recorded.map(v => v.cls)), limits: target.metric === "cls" ? "CLS median/max <= 0.1" : "LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05", routeLog: sampleDir, notes: "normal production dist; strict route interception; one warm-up per target" };
  });
  writeFileSync("test-results/frontend/vitals.json", JSON.stringify({ schemaVersion: 1, measuredAt, gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), node: process.version, chromium: test.info().project.name, command: "measure:vitals", artifact: "test-results/frontend/vitals.json", result: failed ? "failed" : "passed", samples: values, summaries }, null, 2));
}

// Executable pure contracts run during discovery, before any preview server is started.
expect(() => assertThreshold(2, 1, "contract")).toThrow();
expect(() => assertThreshold(null, 1, "contract")).toThrow();
expect(() => assertThreshold(NaN, 1, "contract")).toThrow();
assertThreshold(1, 1, "equality contract");
const contractSamples = Array.from({ length: 5 }, (_, i) => ({ surface: "front" as const, url: targets[0].url, run: i + 1, lcpMs: 2500, cls: 0.05 }));
assertVitals(contractSamples, targets[0]);
expect(() => assertVitals(contractSamples.slice(0, 4), targets[0])).toThrow();
expect(() => assertVitals(contractSamples.map((v, i) => ({ ...v, lcpMs: i === 4 ? 3126 : 1 })), targets[0])).toThrow();
expect(() => assertVitals(contractSamples.map((v, i) => ({ ...v, cls: i === 4 ? 0.051 : 0 })), targets[0])).toThrow();

test.beforeAll(() => {
  mkdirSync(sampleDir, { recursive: true });
  samples.splice(0, samples.length, ...readdirSync(sampleDir).filter(file => file.endsWith("-sample.json")).map(file => JSON.parse(readFileSync(`${sampleDir}/${file}`, "utf8"))));
  for (const surface of ["front", "back", "admin"]) {
    const root = `apps/web-${surface}/dist`;
    for (const file of [...readdirSync(root).filter(f => f.endsWith(".html")).map(f => join(root, f)), ...readdirSync(`${root}/assets`).filter(f => f.endsWith(".js")).map(f => join(root, "assets", f))]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/mockServiceWorker|setupWorker|mockUser/);
    }
    const config = readFileSync(`apps/web-${surface}/vite.config.ts`, "utf8");
    expect(config).not.toMatch(/outDir\s*:/);
  }
  for (const target of targets) expect(new URL(target.url).search).toBe("");
});
// Playwright requires fixture destructuring even when only TestInfo is needed.
// eslint-disable-next-line no-empty-pattern
test.afterEach(({}, info) => { if (info.status !== info.expectedStatus) failed = true; });
test.afterAll(async ({ browser }) => {
  if (failed) writeFileSync(`${sampleDir}/failed`, "failed\n");
  const persisted = readdirSync(sampleDir).filter(file => file.endsWith("-sample.json")).map(file => JSON.parse(readFileSync(`${sampleDir}/${file}`, "utf8")));
  if (persisted.length === 25) {
    failed ||= readdirSync(sampleDir).includes("failed");
    for (const target of targets) { try { assertVitals(persisted.filter(v => v.url === target.url), target); } catch { failed = true; } }
    await writeVitals(persisted); const file = JSON.parse(readFileSync("test-results/frontend/vitals.json", "utf8")); file.chromium = browser.version(); writeFileSync("test-results/frontend/vitals.json", JSON.stringify(file, null, 2)); }
  else writeFileSync("test-results/frontend/vitals-incomplete.json", JSON.stringify({ result: "failed", samples: persisted, expected: 25 }, null, 2));
});
for (const target of targets) test.describe(target.id, () => {
  test.beforeAll(async ({ browser }) => { await measure(browser, target, 0); });
  for (let run = 1; run <= 5; run++) test(`W5 Vitals ${target.id} cold run ${run}`, async ({ browser }, info) => {
    const sample = await measure(browser, target, run); samples.push(sample);
    writeFileSync(`${sampleDir}/${target.id}-${run}-sample.json`, JSON.stringify(sample));
    await info.attach("vitals", { body: JSON.stringify(sample), contentType: "application/json" });
    const recorded = samples.filter(v => v.url === target.url);
    if (recorded.length === 5) assertVitals(recorded, target);
  });
});
