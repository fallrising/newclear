#!/usr/bin/env node
// Supplemental M2 loaded-page/final-URL proof. No screenshots or product writes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { verifyObservation } from './route-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');
const targets = JSON.parse(readFileSync(path.join(here, 'targets.json'), 'utf8'));
const out = path.resolve(process.argv[2] || path.join(here, 'runs/round2-routes'));
if (!out.startsWith(path.join(here, 'runs/round2-'))) throw new Error('REVIEW_OUTPUT_SCOPE');
mkdirSync(out, { recursive: true });
const receipt = { startedAt: new Date().toISOString(), node: process.version, playwright: require('playwright/package.json').version, chromium: null, results: [], cleanup: [], sourceHashes: {} };
for (const name of ['targets.json', 'verify-routes.mjs', 'route-guard.mjs']) receipt.sourceHashes[name] = createHash('sha256').update(readFileSync(path.join(here, name))).digest('hex');
let browser;
let owned;
let interrupted = false;
let exitCode = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function save() { writeFileSync(path.join(out, 'routes.json'), JSON.stringify(receipt, null, 2)+'\n'); }
function signalOwned(signal) {
  if (!owned?.pid) return;
  try { process.kill(-owned.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw new Error('REVIEW_SIGNAL'); }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  interrupted = true;
  exitCode = signal === 'SIGTERM' ? 143 : 130;
  signalOwned('SIGTERM');
  void browser?.close().catch(() => {});
});
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = (value) => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(500, () => finish(true)); // unknown is not proven closed
    socket.on('connect', () => finish(true));
    socket.on('error', (error) => finish(error.code !== 'ECONNREFUSED'));
  });
}
async function stop(app) {
  const child = owned;
  const port = Number(new URL(app.baseUrl).port);
  signalOwned('SIGTERM');
  for (let i=0;i<30 && child.exitCode === null && child.signalCode === null;i++) await pause(100);
  signalOwned('SIGKILL'); // also reaches descendants if npm exited first
  for (let i=0;i<20 && child.exitCode === null && child.signalCode === null;i++) await pause(100);
  let closed = false;
  for (let i=0;i<20;i++) { if (!(await portOpen(port))) { closed = true; break; } await pause(100); }
  const waited = child.exitCode !== null || child.signalCode !== null;
  receipt.cleanup.push({ app: app.name, childExited: waited, childExitCode: child.exitCode, childSignal: child.signalCode, listenerAbsent: closed });
  owned = null;
  if (!waited || !closed) throw new Error('REVIEW_CLEANUP');
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  receipt.chromium = browser.version();
  for (const app of targets.apps) {
    if (interrupted) throw new Error('REVIEW_INTERRUPTED');
    if (await portOpen(Number(new URL(app.baseUrl).port))) throw new Error('REVIEW_PORT_OCCUPIED');
    owned = spawn('npm', ['run', 'dev:mock', '--', '--host', '127.0.0.1', '--strictPort'], { cwd: path.join(repo, app.cwd), detached: true, stdio: 'ignore' });
    owned.on('error', () => { receipt.serverSpawnFailed = true; });
    try {
      let ready = false;
      for (let i=0;i<120;i++) {
        if (interrupted || receipt.serverSpawnFailed || owned.exitCode !== null || owned.signalCode !== null) throw new Error('REVIEW_SERVER_EXIT');
        try { const response = await fetch(app.baseUrl, { signal: AbortSignal.timeout(1000), redirect: 'manual' }); if (response.status === 200) { ready = true; break; } } catch {}
        await pause(250);
      }
      if (!ready) throw new Error('REVIEW_READY_TIMEOUT');
      for (const target of app.pages) {
        if (interrupted) throw new Error('REVIEW_INTERRUPTED');
        const record = { app: app.name, page: target.id, route: target.review.route, status: null, finalURLMatches: false, identityMatches: false, loaded: false, pageErrors: 0, consoleErrors: 0, failedRequests: 0, passed: false };
        receipt.results.push(record);
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: targets.locale, colorScheme: 'light' });
        try {
          const page = await context.newPage();
          page.on('pageerror', () => record.pageErrors++);
          page.on('console', (message) => { if (message.type() === 'error') record.consoleErrors++; });
          page.on('requestfailed', () => record.failedRequests++);
          const response = await page.goto(new URL(target.path, app.baseUrl).href, { waitUntil: 'networkidle', timeout: 30000 });
          record.status = response?.status() ?? null;
          for (const [index, selector] of target.review.loaded.entries()) {
            record.loadingSelectorIndex = index;
            await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });
          }
          delete record.loadingSelectorIndex;
          record.loaded = true;
          const identity = await page.evaluate(() => sessionStorage.getItem('cms-mock:user'));
          record.finalURLMatches = page.url() === new URL(target.review.finalPath, app.baseUrl).href;
          record.identityMatches = identity === target.review.identity;
          verifyObservation({ ...target.review, baseUrl: app.baseUrl }, { finalUrl: page.url(), status: record.status, identity, loaded: record.loaded, pageErrors: record.pageErrors });
          record.passed = true;
          process.stdout.write(`PASS ${app.name}/${target.id}\n`);
        } catch (error) {
          record.error = /^REVIEW_[A-Z_]+$/.test(error.message) ? error.message : (error.name === 'TimeoutError' ? 'REVIEW_TIMEOUT' : 'REVIEW_BROWSER');
          throw new Error(record.error);
        } finally {
          try { await context.close(); } catch { record.contextCloseFailed = true; throw new Error('REVIEW_CONTEXT_CLOSE'); } finally { save(); }
        }
      }
    } finally { await stop(app); }
  }
  receipt.passed = receipt.results.length === 51 && receipt.results.every((r) => r.passed);
  if (!receipt.passed) throw new Error('REVIEW_COUNT');
} catch (error) {
  receipt.passed = false;
  receipt.error = /^REVIEW_[A-Z_]+$/.test(error.message) ? error.message : 'REVIEW_FAILED';
  exitCode ||= 1;
} finally {
  try { if (browser) await browser.close(); } catch { receipt.browserCloseFailed = true; exitCode ||= 1; }
  receipt.finishedAt = new Date().toISOString();
  receipt.cleanupPassed = receipt.cleanup.length > 0 && receipt.cleanup.every((r) => r.childExited && r.listenerAbsent) && !receipt.browserCloseFailed;
  save();
}
process.exitCode = exitCode;
