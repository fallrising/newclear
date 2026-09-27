#!/usr/bin/env node
// Headless screenshot + browser-health capture for an fe-review targets.json.
//
// Usage (from the repository root):
//   node docs/fe-review/capture.mjs <component>/fe-review/targets.json [options]
//
// Options:
//   --app <name>        only capture this app (default: every app)
//   --page <id>         only capture this page id (repeatable)
//   --out <dir>         run directory (default: <fe-review>/runs/<YYYY-MM-DD_HHMM>)
//   --start             spawn app.start and wait for app.ready before capturing
//   --no-axe            skip axe-core even if @axe-core/playwright is resolvable
//   --dry-run           print the capture plan and exit without launching a browser
//
// Playwright resolution: `playwright` or `@playwright/test`, searched from this
// script, the current directory, and each app's cwd. Set PLAYWRIGHT_MODULE to an
// absolute module path to override. Chromium honours PLAYWRIGHT_BROWSERS_PATH,
// or CHROMIUM_EXECUTABLE for an explicit executable.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

function parseArgs(argv) {
  const args = { targets: null, app: null, pages: [], out: null, start: false, axe: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") args.app = argv[++i];
    else if (a === "--page") args.pages.push(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--start") args.start = true;
    else if (a === "--no-axe") args.axe = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (!args.targets) args.targets = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!args.targets) throw new Error("missing targets.json path");
  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function resolveFrom(dirs, names) {
  for (const dir of dirs) {
    const req = createRequire(path.join(path.resolve(dir), "noop.js"));
    for (const name of names) {
      try {
        return req.resolve(name);
      } catch {}
    }
  }
  return null;
}

async function loadModule(dirs, names, envVar) {
  const explicit = envVar && process.env[envVar];
  const resolved = explicit || resolveFrom(dirs, names);
  if (!resolved) return null;
  const mod = await import(pathToFileURL(resolved).href);
  return mod.default && !mod.chromium ? mod.default : mod;
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startApp(app) {
  const child = spawn(app.start, {
    cwd: path.resolve(app.cwd || "."),
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...(app.env || {}) },
    detached: true,
  });
  return () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function captureApp({ browser, app, targets, args, outDir, AxeBuilder }) {
  const viewports = targets.viewports || DEFAULT_VIEWPORTS;
  const schemes = targets.colorSchemes || ["light"];
  const pages = (app.pages || []).filter((p) => !args.pages.length || args.pages.includes(p.id));
  const results = [];
  for (const pg of pages) {
    for (const vp of viewports) {
      for (const scheme of schemes) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: scheme,
          locale: targets.locale || "zh-TW",
          storageState: app.storageState ? path.resolve(app.storageState) : undefined,
        });
        const page = await context.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        const failedRequests = [];
        page.on("console", (m) => {
          if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`[${m.type()}] ${m.text()}`);
        });
        page.on("pageerror", (e) => pageErrors.push(String(e)));
        page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`));
        page.on("response", (r) => {
          if (r.status() >= 400) failedRequests.push(`${r.request().method()} ${r.url()} HTTP ${r.status()}`);
        });
        const url = new URL(pg.path, app.baseUrl).href;
        const file = `${slug(app.name)}__${slug(pg.id)}__${vp.name}__${scheme}.png`;
        const record = { app: app.name, page: pg.id, url, viewport: vp.name, colorScheme: scheme, screenshot: `screenshots/${file}` };
        const started = Date.now();
        try {
          const res = await page.goto(url, { waitUntil: pg.waitUntil || "networkidle", timeout: pg.timeoutMs || 30000 });
          record.status = res?.status() ?? null;
          if (pg.waitFor) await page.waitForSelector(pg.waitFor, { timeout: pg.timeoutMs || 30000 });
          if (pg.settleMs) await page.waitForTimeout(pg.settleMs);
          record.loadMs = Date.now() - started;
          record.title = await page.title();
          record.horizontalOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          await page.screenshot({ path: path.join(outDir, "screenshots", file), fullPage: pg.fullPage !== false });
          if (AxeBuilder && args.axe && vp.name === viewports[0].name && scheme === schemes[0]) {
            const axe = await new AxeBuilder({ page }).analyze();
            record.axeViolations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
          }
        } catch (e) {
          record.error = String(e);
        }
        record.consoleErrors = consoleErrors;
        record.pageErrors = pageErrors;
        record.failedRequests = failedRequests;
        results.push(record);
        await context.close();
        process.stdout.write(`${record.error ? "FAIL" : "ok  "} ${app.name} ${pg.id} ${vp.name} ${scheme}\n`);
      }
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetsPath = path.resolve(args.targets);
  const targets = JSON.parse(readFileSync(targetsPath, "utf8"));
  const apps = (targets.apps || []).filter((a) => a.kind !== "terminal" && (!args.app || a.name === args.app));
  const outDir = path.resolve(args.out || path.join(path.dirname(targetsPath), "runs", stamp()));

  if (args.dryRun) {
    for (const app of apps) {
      console.log(`${app.name}: ${app.baseUrl} (${(app.pages || []).length} pages) start=${JSON.stringify(app.start)}`);
      for (const p of app.pages || []) console.log(`  - ${p.id}: ${p.path}`);
    }
    console.log(`out: ${outDir}`);
    return;
  }

  const searchDirs = [path.dirname(new URL(import.meta.url).pathname), process.cwd(), ...apps.map((a) => a.cwd || ".")];
  const pw = await loadModule(searchDirs, ["playwright", "@playwright/test"], "PLAYWRIGHT_MODULE");
  if (!pw) throw new Error("playwright not resolvable; install it (npm i --no-save playwright) or set PLAYWRIGHT_MODULE");
  const axeMod = args.axe ? await loadModule(searchDirs, ["@axe-core/playwright"], "AXE_PLAYWRIGHT_MODULE") : null;
  const AxeBuilder = axeMod ? axeMod.AxeBuilder || axeMod.default || axeMod : null;

  mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  });
  const manifest = { project: targets.project, targets: path.relative(process.cwd(), targetsPath), startedAt: new Date().toISOString(), axe: Boolean(AxeBuilder), results: [] };
  try {
    for (const app of apps) {
      let stop = null;
      try {
        if (args.start && app.start) {
          stop = startApp(app);
          await waitForUrl(new URL(app.ready || "/", app.baseUrl).href, app.readyTimeoutMs || 120000);
        }
        manifest.results.push(...(await captureApp({ browser, app, targets, args, outDir, AxeBuilder })));
      } catch (e) {
        manifest.results.push({ app: app.name, error: String(e) });
        process.stdout.write(`FAIL ${app.name}: ${e}\n`);
      } finally {
        if (stop) stop();
      }
    }
  } finally {
    await browser.close();
    manifest.finishedAt = new Date().toISOString();
    writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`wrote ${path.relative(process.cwd(), outDir)}/capture.json`);
  if (manifest.results.some((r) => r.error)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
