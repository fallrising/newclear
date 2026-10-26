/** Paired review runtime. Root launches it only inside the approved isolated namespace. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { allowedTransport, routeKind, safeReason, closeOwned, bounded, createInterruption, acquireOwned } from './runtime-guards.mjs';
export const baseURL = 'http://127.0.0.1:1420';
export const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 834, height: 1112 }, { name: 'mobile', width: 390, height: 844 }];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function listenerAbsent() {
  return new Promise((resolveResult) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 1420 });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolveResult(false); });
    socket.once('timeout', () => { socket.destroy(); resolveResult(false); });
    socket.once('error', (error) => { socket.destroy(); resolveResult(error.code === 'ECONNREFUSED'); });
  });
}
export async function ownedOutput(component, id) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('REVIEW_INVALID_RUN_ID');
  const parent = join(component, 'fe-review/runs');
  const info = await lstat(parent);
  if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid()) throw new Error('REVIEW_OUTPUT_OWNERSHIP');
  const output = join(parent, id);
  await mkdir(output, { mode: 0o700 }); // Existing runs are immutable; EEXIST fails before starting anything.
  await mkdir(join(output, 'screenshots'), { mode: 0o700 });
  await mkdir(join(output, '.state'), { mode: 0o700 });
  return output;
}
export async function guardedContext(browser, options, preload, fixtureOptions) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const health = { blockedHttp: 0, blockedWebSocket: 0, pageErrors: 0, console: [], failedRequests: [], responses: [] };
  await context.route('**/*', async (route) => {
    if (allowedTransport(route.request().url())) await route.continue();
    else { health.blockedHttp++; await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', (route) => {
    if (allowedTransport(route.url(), true)) route.connectToServer();
    else { health.blockedWebSocket++; route.close({ code: 1008, reason: 'Review origin refusal' }); }
  });
  if (preload) await context.addInitScript(preload, fixtureOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(6000); page.setDefaultNavigationTimeout(10000);
  page.on('pageerror', () => health.pageErrors++);
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) health.console.push({ type: message.type(), route: routeKind(message.location().url) });
  });
  page.on('requestfailed', (request) => health.failedRequests.push({ method: request.method(), route: routeKind(request.url()) }));
  page.on('response', (response) => { if (response.status() >= 400) health.responses.push({ status: response.status(), method: response.request().method(), route: routeKind(response.url()) }); });
  return { context, page, health };
}
export async function capture({ page, output, id, response, health, AxeBuilder }) {
  assert.equal(page.url(), `${baseURL}/`, 'REVIEW_FINAL_URL');
  assert.equal(response?.status(), 200, 'REVIEW_HTTP_STATUS');
  const geometry = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  const axe = await new AxeBuilder({ page }).analyze();
  const png = await page.screenshot({ path: join(output, 'screenshots', `${id}.png`), fullPage: true });
  const safeAxe = (items) => items.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }));
  return { id, url: `${baseURL}/`, finalUrl: page.url(), status: response.status(), geometry, health: structuredClone(health), axe: { version: axe.testEngine.version, violations: safeAxe(axe.violations), incomplete: safeAxe(axe.incomplete) }, screenshot: `screenshots/${id}.png`, sha256: sha256(png), bytes: png.length };
}
export async function runOwned({ component, unit, sourceFiles, execute }) {
  if (process.env.TAURI_DEV_HOST) throw new Error('REVIEW_EXTERNAL_DEV_HOST');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--run') throw new Error('REVIEW_ARGUMENTS');
  const output = await ownedOutput(component, args[1]);
  const receipt = { schema: 1, unit, synthetic: true, status: 'partial', stage: 'PRECHECK', started: new Date().toISOString(), sourceHashes: {}, tools: { node: process.version }, captures: [], steps: [], cleanup: { browserClosed: false, serverClosed: false, listenerAbsent: false }, limits: ['Web simulation only', 'Native/real vault/PTY/AI/Mac not verified', 'Full Round3 not accepted'] };
  let server, browser;
  const contexts = new Set();
  const interruption = createInterruption();
  const signal = (name) => {
    interruption.request(name);
    // Interrupt existing browser work, but final cleanup is never cached here.
    // Resources created after this signal remain owned and are closed in finally.
    if (browser) void bounded(() => browser.close()).catch(() => undefined);
  };
  const onTerm = () => signal('SIGTERM'), onInt = () => signal('SIGINT');
  let cleanupPromise;
  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const resources = [...contexts].map((context, i) => ({ name: `context${i}`, close: () => context.close() }));
      if (browser) resources.push({ name: 'browserClosed', close: () => browser.close() });
      if (server) resources.push({ name: 'serverClosed', close: () => server.close() });
      const results = await closeOwned(resources);
      receipt.cleanup = { ...results, browserClosed: browser ? results.browserClosed : true, serverClosed: server ? results.serverClosed : true, listenerAbsent: await listenerAbsent() };
      return Object.values(receipt.cleanup).every(Boolean);
    })();
    return cleanupPromise;
  }
  process.once('SIGTERM', onTerm); process.once('SIGINT', onInt);
  try {
    assert.equal(await listenerAbsent(), true, 'REVIEW_PORT_OCCUPIED');
    for (const path of sourceFiles) receipt.sourceHashes[path] = sha256(await readFile(join(component, path)));
    if (!process.env.REVIEW_MODULES || !process.env.REVIEW_BROWSER) throw new Error('REVIEW_TOOLING_REQUIRED');
    const require = createRequire(join(resolve(process.env.REVIEW_MODULES), '../package.json'));
    const { chromium } = require('playwright');
    const AxeBuilder = require('@axe-core/playwright').default;
    receipt.tools.playwright = require('playwright/package.json').version;
    receipt.stage = 'SERVER';
    const { createServer } = await import(pathToFileURL(join(component, 'node_modules/vite/dist/node/index.js')));
    // Flowshot keeps its original runner-loaded config. Only Loom Vite5 uses the hash-pinned equivalent.
    let reviewConfig = {};
    if (unit === 'loom') {
      const { loadReviewViteConfig, originalConfigSha256 } = await import(pathToFileURL(join(component, 'fe-review/vite-review-config.mjs')));
      reviewConfig = await loadReviewViteConfig(component);
      receipt.viteOriginalConfigSha256 = originalConfigSha256;
    }
    await acquireOwned(() => createServer({ root: component, configFile: join(component, 'vite.config.ts'), ...(unit === 'flowshot' ? { configLoader: 'runner' } : {}), ...reviewConfig, cacheDir: join(output, '.state/vite'), logLevel: 'silent', server: { ...reviewConfig.server, host: '127.0.0.1', port: 1420, strictPort: true } }), (value) => { server = value; }, interruption);
    await server.listen(); interruption.check();
    receipt.stage = 'BROWSER';
    await acquireOwned(() => chromium.launch({ executablePath: process.env.REVIEW_BROWSER, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }), (value) => { browser = value; }, interruption);
    receipt.tools.browser = browser.version();
    const open = async (options, preload, fixtureOptions) => { const owned = await guardedContext(browser, options, preload, fixtureOptions); contexts.add(owned.context); return owned; };
    const close = async ({ context }) => { await context.close(); contexts.delete(context); };
    await execute({ browser, open, close, output, receipt, AxeBuilder });
    interruption.check();
    receipt.status = receipt.diagnosticOnly ? 'diagnostic-passed' : 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.failure = { stage: receipt.stage, reason: safeReason(error), site: error?.stack?.match(/(?:run-review|ui-steps|preload|browser-runtime|runtime-guards)\.mjs:\d+:\d+/)?.[0] ?? null };
    if (unit === 'loom') {
      // This task has only synthetic content. Details stay in ignored 0700 state, never public JSON.
      await writeFile(join(output, '.state/failure-diagnostic.json'), JSON.stringify({ name: error?.name, message: String(error?.message ?? '').slice(0, 8000), stack: String(error?.stack ?? '').slice(0, 12000) }, null, 2), { mode: 0o600 }).catch(() => undefined);
      const active = [...contexts].at(-1)?.pages().at(-1);
      if (active) receipt.failure.fixture = await active.evaluate(() => window.__LOOM_REVIEW__?.snapshot() ?? null).catch(() => null);
    }
  }
  finally {
    if (!(await cleanup())) { receipt.status = 'failed'; receipt.cleanupFailure = true; }
    if (interruption.signal) { receipt.status = 'failed'; receipt.signal = interruption.signal; }
    receipt.ended = new Date().toISOString();
    await writeFile(join(output, 'capture.json'), JSON.stringify(receipt, null, 2) + '\n');
    await writeFile(join(output, 'REPORT.md'), `# ${unit} R2 runtime\n\nStatus: ${receipt.status}. Captures: ${receipt.captures.length}. See capture.json for actual stages, findings and cleanup.\n\nSynthetic browser evidence only; not native or full Round3 acceptance.\n`);
    process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
  }
  process.exitCode = ['passed', 'diagnostic-passed'].includes(receipt.status) ? 0 : interruption.signal === 'SIGTERM' ? 143 : 1;
  return receipt;
}
