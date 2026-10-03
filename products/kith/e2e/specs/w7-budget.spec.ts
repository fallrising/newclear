import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note, saveFile, shot } from "../harness/evidence.ts";
import { WEB_DIST_DIR } from "../harness/paths.ts";

// E2E-W7-02 (docs/v2/milestones/W7.md §5.3, §7.2).

const BUDGET_BYTES = 250 * 1024; // Q-31
const CONSOLE_MARKER = "console-nav-agents"; // W4 §5.4 data-testid; lives only in the console chunk

type Budget = {
  initial_js: { path: string; bytes: number; gzip_bytes: number }[];
  initial_js_gzip_total: number;
  initial_js_budget: 256000;
  console_marker_in_initial: boolean;
  console_chunks: string[];
  room_open_ms: number[];
  room_open_p95_ms: number;
  dom_rows_max: number;
  long_tasks: { count: number; max_ms: number };
};

/** Same-origin /assets/*.js paths the page requests, in order of first response. */
function collectJs(page: Page, origin: string): string[] {
  const seen: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js") && !seen.includes(url.pathname)) {
      seen.push(url.pathname);
    }
  });
  return seen;
}

function distFile(pathname: string): Buffer {
  return readFileSync(join(WEB_DIST_DIR, pathname.slice(1)));
}

/** zlib default level; equals the "gzip:" column vite prints (W7 §10). */
function gzipBytes(pathname: string): number {
  return gzipSync(distFile(pathname)).length;
}

function containsMarker(pathname: string): boolean {
  return distFile(pathname).includes(CONSOLE_MARKER);
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

test(
  "E2E-W7-02 the production build stays within the performance budget",
  { tag: ["@W7"] },
  async ({ page, api, browser, recorder }, info) => {
    test.skip(process.env.E2E_WEB === "dev", "budget needs the production build");
    test.skip(info.project.name !== "desktop", "desktop only");
    test.setTimeout(180_000);

    // 1. Authenticate, then read the newest seq so a cold context can wait for the same row.
    await loginViaUi(page, ACCOUNTS.ada);
    const listed = await api.call("GET", "/api/rooms/room-long/messages?order=desc&limit=1");
    expect(listed.status).toBe(200);
    const latest = (listed.json as { messages: { seq: number }[] }).messages.at(-1)?.seq;
    if (typeof latest !== "number") throw new Error("room-long has no messages");
    const state = await page.context().storageState();

    const origin = process.env.KITH_E2E_BASE_URL;
    if (!origin) throw new Error("KITH_E2E_BASE_URL is not set");
    const ctx = await browser.newContext({
      baseURL: origin,
      storageState: state,
      viewport: { width: 1280, height: 800 },
      locale: "zh-TW",
    });
    let budget: Budget | undefined;
    try {
      const cold = await ctx.newPage();
      recorder.watch(cold, "budget");
      await cold.addInitScript(() => {
        const target = window as unknown as { __kithLongTasks: number[] };
        target.__kithLongTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) target.__kithLongTasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      });
      const js = collectJs(cold, origin);
      await cold.goto("/r/long-history");
      await expect(cold.locator(`[data-seq="${latest}"]`)).toBeVisible();
      await cold.waitForLoadState("networkidle");

      // 2. First-load JS, measured from the files the browser actually requested.
      const initial = [...js];
      const initialJs = initial.map((path) => ({ path, bytes: distFile(path).length, gzip_bytes: gzipBytes(path) }));
      const total = initialJs.reduce((sum, file) => sum + file.gzip_bytes, 0);
      const consoleMarkerInInitial = initial.some((path) => containsMarker(path));
      const domCounts: number[] = [await cold.getByTestId("message-row").count()];
      budget = {
        initial_js: initialJs,
        initial_js_gzip_total: total,
        initial_js_budget: 256000,
        console_marker_in_initial: consoleMarkerInInitial,
        console_chunks: [],
        room_open_ms: [],
        room_open_p95_ms: 0,
        dom_rows_max: Math.max(...domCounts),
        long_tasks: { count: 0, max_ms: 0 },
      };
      note(info, `initial JS gzip ${total} bytes in ${initial.length} files`);
      await shot(cold, info, "01-room-cold");
      expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
      expect(consoleMarkerInInitial, "console_marker_in_initial === false").toBe(false);

      // 3. Virtualized rows stay within the DOM cap. Long tasks are recorded only.
      for (let i = 0; i < 10; i += 1) {
        await cold.getByTestId("timeline").evaluate((el) => el.scrollBy(0, -2000));
        await cold.waitForTimeout(300);
        domCounts.push(await cold.getByTestId("message-row").count());
      }
      for (const count of domCounts) expect(count).toBeLessThanOrEqual(100);
      const longTasks = await cold.evaluate(() => {
        const raw = (window as unknown as { __kithLongTasks?: unknown }).__kithLongTasks;
        return Array.isArray(raw) ? raw.filter((entry): entry is number => typeof entry === "number") : [];
      });
      budget.dom_rows_max = Math.max(...domCounts);
      budget.long_tasks = {
        count: longTasks.length,
        max_ms: longTasks.length === 0 ? 0 : Math.max(...longTasks),
      };

      // 4. In-app navigation must load the console chunk; it is not in the first response set.
      const before = js.length;
      await cold.evaluate(() => {
        history.pushState(null, "", "/console/agents");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(cold.getByTestId("console-nav-agents")).toBeVisible();
      const consoleChunks = js.slice(before);
      expect(consoleChunks.length).toBeGreaterThan(0);
      expect(consoleChunks.some((path) => containsMarker(path))).toBe(true);
      note(info, `console loaded lazily: ${consoleChunks.join(" ")}`);
      await shot(cold, info, "02-console-lazy");
      budget.console_chunks = consoleChunks;

      // 5. One warmup, then 20 cold document loads. p95 includes Playwright round-trip.
      const samples: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        const started = Date.now();
        await cold.goto("/r/long-history", { waitUntil: "commit" });
        await cold.locator(`[data-seq="${latest}"]`).waitFor({ state: "visible", timeout: 10_000 });
        const elapsed = Date.now() - started;
        if (i > 0) samples.push(elapsed);
      }
      const roomOpenP95 = p95(samples);
      budget.room_open_ms = samples;
      budget.room_open_p95_ms = roomOpenP95;
      note(info, `room open p95 ${roomOpenP95} ms over 20 cold navigations`);
      expect(roomOpenP95).toBeLessThan(600);
    } finally {
      // Step 6. Written even when step 2 fails, so the card can record initial_js_gzip_total.
      if (budget) saveFile(info, "budget.json", JSON.stringify(budget, null, 2));
      await ctx.close();
    }
  },
);
