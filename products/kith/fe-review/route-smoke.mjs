// Focused M3 check: each configured route must end at that URL with loaded content.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertLoopback, validateIsolation } from './launch.mjs';
import { readObservedSecrets, redactText, scanText } from '../e2e/harness/redact.ts';

validateIsolation();
const reviewDir = dirname(fileURLToPath(import.meta.url));
const state = join(reviewDir, 'runs', '.state');
if (!existsSync(join(state, 'launcher.lock'))) throw new Error('requires the owned review launcher');
const meta = JSON.parse(readFileSync(join(state, 'current', 'context.json'), 'utf8'));
const baseUrl = assertLoopback(meta.baseUrl);
process.env.KITH_E2E_SECRET_FILE = join(state, 'current', 'observed.secrets');
const targets = JSON.parse(readFileSync(join(reviewDir, 'targets.json'), 'utf8'));
const require = createRequire(join(reviewDir, '..', 'e2e', 'package.json'));
const { chromium, expect } = require('@playwright/test');
const ready = {
  login: '[data-testid="login-handle"]', home: '[data-testid="home-empty"]',
  'room-lobby': '[data-testid="timeline"]', 'room-long-history': '[data-testid="timeline"]',
  'room-quiet': '[data-testid="timeline"]', 'room-ada-private': '[data-testid="timeline"]',
  settings: '[data-testid="settings-profile-form"]', 'console-rooms': '[data-testid="console-rooms-list"]',
  'console-agents': '[data-testid="agents-list"]', 'console-agent-grok': '[data-testid="agent-overview"]',
  'console-agent-new': '[data-testid="agent-create-handle"]', 'console-people': '[data-testid="people-list"]',
  'console-providers': '[data-testid="providers-empty"], [data-testid="providers-list"]',
  'console-provider-new': '[data-testid="provider-name"]', 'not-found': '[data-testid="not-found"]',
};
const output = join(meta.runDir, 'route-smoke.json');
if (existsSync(output)) throw new Error('route smoke evidence already exists; use fresh state');
const browser = await chromium.launch();
const results = [];
let context;
try {
  for (const app of targets.apps) {
    expect(assertLoopback(app.baseUrl)).toBe(baseUrl);
    for (const route of app.pages) {
      if (!ready[route.id]) throw new Error(`no loaded-content contract for ${route.id}`);
      context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 900 }, locale: 'zh-TW', ...(app.storageState ? { storageState: resolve(app.storageState) } : {}) });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'ethernet' });
      const requestedURL = new URL(route.path, baseUrl).href;
      const response = await page.goto(requestedURL, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      await expect(page.locator(ready[route.id])).toBeVisible();
      await expect(page).toHaveURL(requestedURL);
      if (app.storageState) {
        await expect(page.getByTestId('app-shell')).toBeVisible();
        await expect(page.getByTestId('login-handle')).toHaveCount(0);
      }
      if (route.id.startsWith('room-')) {
        const names = { 'room-lobby': 'Lobby', 'room-long-history': '長歷史 Long history', 'room-quiet': '安靜的房間 Quiet', 'room-ada-private': "Ada 的筆記 Ada's notes" };
        await expect(page.getByTestId('room-title')).toHaveText(names[route.id]);
        await expect(page.getByTestId('room-not-found')).toHaveCount(0);
      }
      results.push({ app: app.name, id: route.id, requestedURL, finalURL: page.url(), status: response.status(), loadedSelector: ready[route.id], loaded: true, authenticated: Boolean(app.storageState) });
      await context.close(); context = undefined;
    }
  }
  expect(results).toHaveLength(15);
} catch (error) {
  results.push({ error: redactText(error instanceof Error ? error.message : String(error)) });
  process.exitCode = 1;
} finally {
  await context?.close(); await browser.close();
  const text = JSON.stringify({ runId: meta.runId, browser: meta.chromium, results }, null, 2);
  if (scanText(text, readObservedSecrets()).length) throw new Error('refusing sensitive route evidence');
  writeFileSync(output, text + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ routes: results.filter((r) => r.loaded).length, passed: !process.exitCode }));
}
