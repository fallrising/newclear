import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertLoopback, temporaryDirectory, validateIsolation } from './launch.mjs';
import { ACCOUNTS } from '../e2e/fixtures/accounts.ts';
import { loginViaUi, sendViaComposer } from '../e2e/fixtures/actors.ts';
import { createProviderViaApi } from '../e2e/fixtures/console.ts';
import { readObservedSecrets, recordObservedSecret, redactText, scanText } from '../e2e/harness/redact.ts';

validateIsolation();
const reviewDir = dirname(fileURLToPath(import.meta.url));
const current = join(reviewDir, 'runs', '.state', 'current');
if (!existsSync(join(reviewDir, 'runs', '.state', 'launcher.lock'))) throw new Error('start this review launcher first');
const meta = JSON.parse(readFileSync(join(current, 'context.json'), 'utf8'));
const baseUrl = assertLoopback(meta.baseUrl);
assertLoopback(meta.apiOrigin); assertLoopback(meta.fakeProviderUrl);
process.env.KITH_E2E_FAKE_PROVIDER_URL = meta.fakeProviderUrl;
process.env.KITH_E2E_SECRET_FILE = join(current, 'observed.secrets');
const require = createRequire(join(reviewDir, '..', 'e2e', 'package.json'));
const { chromium, expect } = require('@playwright/test');
const output = temporaryDirectory(meta.runDir, 'screenshots');
const browser = await chromium.launch();
const results = [];
let context;
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 834, height: 1112 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const scheme of ['light', 'dark']) {
      context = await browser.newContext({ baseURL: baseUrl, viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, locale: 'zh-TW' });
      const consoleErrors = [], pageErrors = [], failedRequests = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== baseUrl) { failedRequests.push('blocked external origin'); await route.abort(); }
        else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) consoleErrors.push(redactText(message.text())); });
      page.on('pageerror', (error) => pageErrors.push(redactText(error.message)));
      page.on('response', (response) => { if (response.status() >= 400) failedRequests.push(`${response.request().method()} ${new URL(response.url()).pathname} HTTP ${response.status()}`); });
      page.on('requestfailed', (request) => failedRequests.push(redactText(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`)));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'ethernet' });
      const capture = async (id, details = {}) => {
        await page.evaluate(() => document.fonts.ready);
        const secrets = readObservedSecrets();
        if (await page.locator('input[type="password"]').evaluateAll((inputs) => inputs.some((input) => input.value !== ''))) throw new Error('capture rejected: nonempty password input');
        const text = await page.locator('body').innerText();
        if (scanText(text, secrets).length) throw new Error('capture rejected: sensitive text visible');
        const screenshot = `web__${id}__${viewport.name}__${scheme}.png`;
        await page.screenshot({ path: join(output, screenshot), fullPage: true });
        results.push({ id, viewport: viewport.name, scheme, url: page.url(), screenshot, consoleErrors: consoleErrors.splice(0), pageErrors: pageErrors.splice(0), failedRequests: failedRequests.splice(0), horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), ...details });
      };
      const api = { async call(method, path, body) {
        const headers = {};
        if (method !== 'GET') {
          const response = await page.request.get('/api/csrf');
          expect(response.ok()).toBeTruthy();
          headers['X-CSRF-Token'] = (await response.json()).csrf;
        }
        const response = await page.request.fetch(path, { method, headers, ...(body === undefined ? {} : { data: body }) });
        return { status: response.status(), json: await response.json() };
      } };
      await page.goto('/login');
      await expect(page.getByTestId('login-handle')).toBeVisible();
      await capture('01-login');
      await loginViaUi(page, ACCOUNTS.ada);
      for (const cookie of await context.cookies()) recordObservedSecret(cookie.value);
      await capture('02-home');
      await page.goto('/r/lobby');
      await expect(page.getByTestId('timeline')).toBeVisible();
      await expect(page.getByTestId('room-connection')).toHaveCount(0);
      const label = `FE ${viewport.name} ${scheme}`;
      await sendViaComposer(page, label);
      const row = page.getByTestId('message-row').filter({ hasText: label });
      await expect(row).toBeVisible();
      await capture('03-message');
      const providerId = await createProviderViaApi(api, { name: label, format: 'openai_chat' });
      expect((await api.call('PUT', '/api/agents/m-grok/runtime', { runtime: 'hosted', quota_class: 'api_key', connection_id: providerId, model: 'fake-chat', stream: true })).status).toBe(200);
      expect((await api.call('PATCH', '/api/rooms/room-lobby/members/m-grok/attention', { mode: 'mention', cooldown_ms: 0 })).status).toBe(200);
      const reply = `Synthetic stream ${viewport.name} ${scheme}`;
      await sendViaComposer(page, `@grok [[fake:text=${encodeURIComponent(reply)};chunks=8;chunk_ms=400]]`);
      await expect(page.getByTestId('reply-draft')).toBeVisible({ timeout: 30000 });
      await capture('04-streaming');
      await expect(page.getByTestId('message-body').filter({ hasText: reply })).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('reply-draft')).toHaveCount(0);
      await capture('05-complete');
      await row.hover();
      await row.getByTestId('message-actions').click();
      await page.getByTestId('message-action-thread').click();
      await expect(page.getByTestId('thread-panel')).toBeVisible();
      await page.getByTestId('thread-composer-input').fill(`Thread ${label}`);
      await page.getByTestId('thread-composer-input').press('Enter');
      await expect(page.getByTestId('thread-replies')).toContainText(`Thread ${label}`);
      await capture('06-thread');
      await page.goto('/r/long-history');
      const timeline = page.getByTestId('timeline');
      await expect(timeline).toBeVisible();
      const before = await timeline.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight }));
      await timeline.evaluate((el) => { el.scrollTop = 0; });
      // Wait for observable older history; no sleep used as a correctness assertion.
      await expect.poll(() => timeline.evaluate((el) => el.scrollHeight)).toBeGreaterThan(before.height);
      await timeline.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await capture('07-history', { scrollBefore: before, scrollAfter: await timeline.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight })) });
      for (const [id, path, ready] of [['agents', '/console/agents', 'agents-list'], ['agent', '/console/agents/m-grok', 'agent-overview'], ['agent-new', '/console/agents/new', 'agent-create-handle'], ['providers', '/console/providers', 'providers-list'], ['provider', `/console/providers/${providerId}`, 'provider-name'], ['provider-new', '/console/providers/new', 'provider-name'], ['people', '/console/people', 'people-list'], ['rooms', '/console/rooms', 'console-rooms-list']]) {
        const response = await page.goto(path);
        expect(response.status()).toBe(200);
        await expect(page.getByTestId(ready)).toBeVisible();
        await capture('08-' + id);
      }
      await page.goto('/r/lobby');
      await expect(page.getByTestId('timeline')).toBeVisible();
      await context.setOffline(true);
      const offline = page.getByTestId('composer-offline');
      const observed = await expect(offline).toBeVisible({ timeout: 5000 }).then(() => true, () => false);
      await capture('09-offline', { offline: observed ? 'observed' : 'n/a: existing UI did not expose offline indicator at capture' });
      await context.setOffline(false);
      await context.close(); context = undefined;
    }
  }
} catch (error) {
  results.push({ error: redactText(error instanceof Error ? error.message : String(error)) });
  process.exitCode = 1;
} finally {
  await context?.close(); await browser.close();
  const serialized = JSON.stringify({ runId: meta.runId, browser: meta.chromium, axe: 'not installed; not claimed', results }, null, 2);
  if (scanText(serialized, readObservedSecrets()).length) throw new Error('refusing to write sensitive flow output');
  writeFileSync(join(meta.runDir, 'flows.json'), serialized + '\n');
  console.log(JSON.stringify({ runId: meta.runId, captures: results.filter((r) => r.screenshot).length, passed: !process.exitCode }));
}
