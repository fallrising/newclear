import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {claimState, requireOrigin} from './isolation.mjs';

const root = process.cwd();
const component = resolve(root, 'products/goku');
const web = join(component, 'web');
const state = process.env.FE_REVIEW_STATE_DIR;
const origin = requireOrigin(process.env.FE_REVIEW_ORIGIN || 'http://127.0.0.1:5173', 5173);
const api = requireOrigin('http://127.0.0.1:3001', 3001);
const editOnly = process.env.FE_REVIEW_EDIT_ONLY === '1';
const runId = new Date().toISOString().replaceAll(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8);
const out = join(component, 'fe-review/runs', runId);
const sha = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safe = error => String(error).replaceAll(root, '<checkout>').replaceAll(state || '<unset>', '<private-state>');
const evidence = {schema: 1, runId, status: 'running', versions: {node: process.version}, steps: [], screenshots: [], axe: [], health: [], requests: [], imageObservations: [], cleanup: [], sourceHashes: {}};
const sourceNames = ['web/src/store/bookmarkStore.ts', 'web/src/components/BookmarkCard.tsx', 'web/src/components/BookmarkGrid.tsx', 'web/src/components/Sidebar.tsx', 'fe-review/serve-web.mjs', 'fe-review/verify-browser.mjs', 'fe-review/isolation.mjs', 'fe-review/targets.json'];
for (const name of sourceNames) evidence.sourceHashes[name] = sha(await readFile(join(component, name)));
await claimState(state, runId);
await mkdir(join(out, 'screenshots'), {recursive: true});
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2563eb"/></svg>';
const fixture = {
  bookmarks: ['Alpha', 'Beta'].map((name, index) => ({
    id: `review-${index + 1}`, title: `Synthetic ${name}`, url: `${origin}/review-${index + 1}`,
    description: 'A locally generated bookmark for the bounded frontend review.',
    tags: [], notes: [], category: {id: '1', name: 'Work', icon: 'briefcase'},
    createdAt: 1700000000000, updatedAt: 1700000000000, favicon: `${origin}/review.svg`,
  })),
};
await writeFile(join(state, 'db.json'), JSON.stringify(fixture, null, 2) + '\n');
const children = [];
const rawRequests = [];
let faviconCdp;
let mock, vite, browser;
let phase = 'normal';
function start(name, command, args, cwd = web, env = {}) {
  const proc = spawn(command, args, {cwd, env: {...process.env, ...env}, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const entry = {name, proc, text: '', stopped: false};
  proc.stdout.on('data', data => entry.text += data);
  proc.stderr.on('data', data => entry.text += data);
  entry.done = new Promise((resolve, reject) => {
    proc.once('error', reject);
    proc.once('close', (code, signal) => resolve({code, signal}));
  });
  void entry.done.catch(() => {});
  children.push(entry);
  return entry;
}
async function bound(promise, ms) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('owned process deadline')), ms);})]);}
  finally {clearTimeout(timer);}
}
async function absent(address) {
  for (let i = 0; i < 100; i++) {
    try {await fetch(address, {signal: AbortSignal.timeout(500)});}
    catch (error) {if (error.cause?.code === 'ECONNREFUSED') return;}
    await sleep(50);
  }
  throw Error('owned listener remains');
}
async function stop(entry, address) {
  if (!entry || entry.stopped) return;
  if (entry.proc.exitCode === null && entry.proc.signalCode === null) process.kill(-entry.proc.pid, 'SIGTERM');
  let exit;
  try {exit = await bound(entry.done, 10000);}
  catch (error) {process.kill(-entry.proc.pid, 'SIGKILL'); await bound(entry.done, 3000); throw error;}
  await writeFile(join(state, `${entry.name}.log`), entry.text);
  assert(exit.code === 0 || exit.signal === 'SIGTERM');
  if (address) await absent(address);
  if (entry.name === 'vite') assert(entry.text.includes('REVIEW_VITE_CLOSED'));
  entry.stopped = true;
  evidence.cleanup.push({name: entry.name, ...exit, listenerAbsent: Boolean(address)});
}
async function ready(address, check) {
  for (let i = 0; i < 100; i++) {
    try {const response = await fetch(address); if (response.ok && await check(response)) return;}
    catch {}
    await sleep(100);
  }
  throw Error('owned service not ready');
}
function startMock(name) {
  return start(name, process.execPath, [join(web, 'node_modules/json-server/lib/cli/bin.js'), '--watch', join(state, 'db.json'), '--routes', 'mock/routes.json', '--host', '127.0.0.1', '--port', '3001', '--quiet']);
}
async function screenshot(page, name) {
  const file = `screenshots/${name}.png`;
  await page.screenshot({path: join(out, file), fullPage: true});
  const metrics = await page.evaluate(() => ({viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth}));
  evidence.screenshots.push({name, file, sha256: sha(await readFile(join(out, file))), metrics});
}
async function waitFor(page, predicate, value) {await page.waitForFunction(predicate, value, {timeout: 10000});}
async function card(page, title) {return page.locator('.group.relative').filter({has: page.getByRole('link', {name: title, exact: true})});}
try {
  mock = startMock('mock-initial');
  await ready(api + '/api/bookmarks', async response => (await response.json()).length === 2);
  vite = start('vite', process.execPath, [join(component, 'fe-review/serve-web.mjs')], web, {VITE_API_URL: api + '/api'});
  await ready(origin, async response => (await response.text()).includes('id="root"'));
  const fixtureImage = await fetch(origin + '/review.svg');
  assert.equal(fixtureImage.status, 200);
  assert.equal(fixtureImage.headers.get('content-type'), 'image/svg+xml');
  assert.equal(await fixtureImage.text(), svg);
  evidence.steps.push({name: 'local-image-response', status: 200, contentType: 'image/svg+xml', sha256: sha(svg)});
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  const axeModule = await import(pathToFileURL(process.env.AXE_PLAYWRIGHT_MODULE));
  const AxeBuilder = axeModule.AxeBuilder || axeModule.default?.default || axeModule.default;
  browser = await pw.chromium.launch({headless: true});
  evidence.versions.browser = browser.version();
  if (!editOnly) {
  for (const viewport of [{width: 1440, height: 900}, {width: 834, height: 1112}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, colorScheme: 'light', locale: 'en-US'});
    try {
      const page = await context.newPage();
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (![origin, api].includes(url.origin)) {evidence.health.push({kind: 'unexpected-origin', origin: url.origin, phase}); return route.abort();}
        return route.continue();
      });
      page.on('pageerror', error => evidence.health.push({kind: 'pageerror', error: error.message, phase}));
      const response = await page.goto(origin);
      assert.equal(response.status(), 200);
      await page.getByRole('link', {name: 'Synthetic Alpha', exact: true}).waitFor();
      assert.equal(page.url(), origin + '/');
      await waitFor(page, () => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      if (process.env.FE_REVIEW_SKIP_AXE !== '1') {
      const scan = await new AxeBuilder({page}).analyze();
      evidence.axe.push({width: viewport.width, violations: scan.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length})), incomplete: scan.incomplete.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length}))});
      assert(!scan.violations.some(v => v.id === 'button-name'));
      }
      evidence.steps.push({name: 'loaded-home', width: viewport.width, title: 'Synthetic Alpha', status: response.status(), url: page.url()});
    } finally {await context.close();}
  }
  for (const args of [['--dry-run'], ['--out', out]]) {
    const child = start('shared-' + (args[0] === '--dry-run' ? 'dryrun' : 'capture'), process.execPath, ['docs/fe-review/capture.mjs', 'products/goku/fe-review/targets.json', ...args], root);
    const exit = await bound(child.done, 90000);
    await writeFile(join(state, `${child.name}.log`), child.text);
    assert.equal(exit.code, 0); child.stopped = true;
  }
  const shared = JSON.parse(await readFile(join(out, 'capture.json')));
  assert.equal(shared.results.length, 3);
  for (const item of shared.results) {assert.equal(item.status, 200); assert.equal(item.horizontalOverflow, false); assert.deepEqual(item.pageErrors, []); assert.deepEqual(item.failedRequests, []); assert(!item.error);}
  evidence.steps.push({name: 'shared-capture', records: 3, fixtureAppIcon: '/vite.svg', faviconOrigin: origin});
  }
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, colorScheme: 'light', locale: 'en-US'});
  try {
    let controlled = null;
    if (!editOnly) await context.route('**/*', route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.href === 'http://127.0.0.1/favicon.ico') {
        evidence.steps.push({name: 'local-edited-url-favicon-fixture'});
        return route.fulfill({contentType: 'image/svg+xml', body: svg});
      }
      if (![origin, api].includes(url.origin)) {evidence.health.push({kind: 'unexpected-origin', origin: url.origin, phase}); return route.abort();}
      if (controlled && request.method() === controlled && url.pathname.startsWith('/api/bookmarks/')) return route.fulfill({status: 500, json: {error: 'synthetic controlled mutation failure'}});
      return route.continue();
    });
    const page = await context.newPage();
    if (editOnly) {
      faviconCdp = await context.newCDPSession(page);
      const faviconIds = new Set();
      evidence.faviconCdp = [];
      await faviconCdp.send('Network.enable');
      faviconCdp.on('Network.requestWillBeSent', event => {
        if (event.request.url !== 'http://127.0.0.1/favicon.ico') return;
        faviconIds.add(event.requestId);
        evidence.faviconCdp.push({event: 'request', url: event.request.url, type: event.type});
      });
      faviconCdp.on('Network.responseReceived', event => {
        if (faviconIds.has(event.requestId)) evidence.faviconCdp.push({event: 'response', status: event.response.status, mimeType: event.response.mimeType, type: event.type});
      });
      faviconCdp.on('Network.loadingFailed', event => {
        if (faviconIds.has(event.requestId)) evidence.faviconCdp.push({event: 'failed', errorText: event.errorText, blockedReason: event.blockedReason, corsErrorStatus: event.corsErrorStatus, type: event.type});
      });
      faviconCdp.on('Fetch.requestPaused', async event => {
        try {
          assert.equal(event.request.url, 'http://127.0.0.1/favicon.ico');
          assert.equal(event.request.method, 'GET');
          await faviconCdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: 'image/svg+xml'}], body: Buffer.from(svg).toString('base64')});
          evidence.steps.push({name: 'exact-local-favicon-cdp-fixture', status: 200, sha256: sha(svg)});
        } catch (error) {
          evidence.health.push({kind: 'fixture-protocol-error', error: safe(error), phase});
        }
      });
      await faviconCdp.send('Fetch.enable', {patterns: [{urlPattern: 'http://127.0.0.1/favicon.ico', requestStage: 'Request'}]});
    }
    page.on('pageerror', error => evidence.health.push({kind: 'pageerror', error: error.message, phase}));
    page.on('request', request => {
      const url = new URL(request.url());
      const item = {method: request.method(), origin: url.origin, path: url.pathname, phase};
      rawRequests.push(item);
      if (url.pathname.startsWith('/api/') || url.pathname.endsWith('favicon.ico') || url.pathname === '/review.svg') evidence.requests.push(item);
      if (![origin, api].includes(url.origin) && url.href !== 'http://127.0.0.1/favicon.ico') evidence.health.push({kind: 'unexpected-origin', origin: url.origin, phase});
    });
    page.on('console', message => {if (['error', 'warning'].includes(message.type())) evidence.health.push({kind: 'console', type: message.type(), message: safe(message.text()), phase});});
    page.on('response', response => {if (response.status() >= 400) evidence.health.push({kind: 'http', status: response.status(), path: new URL(response.url()).pathname, phase});});
    page.on('requestfailed', request => evidence.health.push({kind: 'requestfailed', path: new URL(request.url()).pathname, phase}));
    await page.goto(origin);
    await page.getByRole('link', {name: 'Synthetic Alpha', exact: true}).waitFor();
    await page.mouse.move(1400, 850);
    // Tab from the document, without programmatically focusing an invisible action.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Edit bookmark')) break;
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit bookmark');
    await waitFor(page, () => getComputedStyle(document.activeElement.parentElement).opacity === '1');
    const focus = await page.evaluate(() => ({name: document.activeElement.getAttribute('aria-label'), type: document.activeElement.getAttribute('type'), outline: getComputedStyle(document.activeElement).outlineStyle, focusVisible: document.activeElement.matches(':focus-visible')}));
    assert.equal(focus.type, 'button'); assert.equal(focus.focusVisible, true); assert.notEqual(focus.outline, 'none');
    await screenshot(page, 'card-keyboard-focus'); evidence.steps.push({name: 'card-keyboard-focus', ...focus});
    await page.keyboard.press('Enter');
    await page.getByLabel('Title', {exact: true}).fill('Edited synthetic Alpha');
    const editedUrl = origin + (editOnly ? '/changed-review' : '/review-1');
    await page.getByLabel('URL', {exact: true}).fill(editedUrl);
    await page.getByRole('button', {name: 'Save Changes', exact: true}).click();
    await page.getByRole('link', {name: 'Edited synthetic Alpha', exact: true}).waitFor();
    const saved = await (await fetch(api + '/api/bookmarks/review-1')).json();
    assert.equal(saved.title, 'Edited synthetic Alpha'); assert.equal(saved.url, editedUrl);
    try {await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0), null, {timeout: 5000});}
    catch {evidence.steps.push({name: 'image-decode-wait', status: 'timed-out', timeoutMs: 5000});}
    const images = await page.evaluate(() => [...document.images].map(image => ({src: image.getAttribute('src'), currentSrc: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth})));
    evidence.imageObservations.push({phase: 'after-real-url-edit', apiFavicon: saved.favicon, images});
    await screenshot(page, 'real-edited');
    assert.equal(saved.favicon, editOnly ? 'http://127.0.0.1/favicon.ico' : origin + '/review.svg');
    assert(images.every(image => image.naturalWidth > 0), 'edited favicon must decode');
    if (editOnly) {
      assert(evidence.steps.some(item => item.name === 'exact-local-favicon-cdp-fixture'));
      assert(evidence.faviconCdp.some(item => item.event === 'response' && item.status === 200 && item.mimeType === 'image/svg+xml'));
      assert(!evidence.faviconCdp.some(item => item.event === 'failed'));
    }
    evidence.steps.push({name: 'real-update-readback', id: saved.id, title: saved.title});
    if (!editOnly) {
    await page.goto(origin);
    await page.getByRole('link', {name: 'Edited synthetic Alpha', exact: true}).waitFor();
    await page.mouse.move(1400, 850);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Edit category Work')) break;
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit category Work');
    assert.notEqual(await page.getByRole('button', {name: 'Edit category Work', exact: true}).evaluate(e => getComputedStyle(e.parentElement).display), 'none');
    await screenshot(page, 'sidebar-keyboard-focus'); evidence.steps.push({name: 'sidebar-keyboard-actions-visible'});
    phase = 'controlled-update'; controlled = 'PUT';
    await (await card(page, 'Edited synthetic Alpha')).getByRole('button', {name: 'Edit bookmark'}).click();
    await page.getByLabel('Title', {exact: true}).fill('Rejected synthetic title');
    await page.getByRole('button', {name: 'Save Changes'}).click();
    await page.getByRole('alert').filter({hasText: 'Unable to save bookmark'}).waitFor();
    assert.equal((await (await fetch(api + '/api/bookmarks/review-1')).json()).title, 'Edited synthetic Alpha');
    await screenshot(page, 'controlled-update-error');
    controlled = null; await page.getByRole('button', {name: 'Retry', exact: true}).click(); await page.getByRole('alert').waitFor({state: 'detached'});
    evidence.steps.push({name: 'controlled-update-failure-retains-data-and-retry-clears'});
    phase = 'controlled-delete'; controlled = 'DELETE';
    await (await card(page, 'Synthetic Beta')).getByRole('button', {name: 'Delete bookmark'}).click();
    await page.getByRole('alert').filter({hasText: 'Unable to delete bookmark'}).waitFor();
    assert.equal((await fetch(api + '/api/bookmarks/review-2')).status, 200); await screenshot(page, 'controlled-delete-error');
    controlled = null; phase = 'normal';
    // The failed click kept focus on Beta's Delete. Leave and re-enter by
    // keyboard with the mouse away, then activate the real deletion by Enter.
    await page.mouse.move(1400, 850);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit bookmark');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Delete bookmark');
    await waitFor(page, () => getComputedStyle(document.activeElement.parentElement).opacity === '1');
    const deleteFocus = await page.evaluate(() => ({name: document.activeElement.getAttribute('aria-label'), type: document.activeElement.getAttribute('type'), outline: getComputedStyle(document.activeElement).outlineStyle, focusVisible: document.activeElement.matches(':focus-visible')}));
    assert.equal(deleteFocus.type, 'button'); assert.equal(deleteFocus.focusVisible, true); assert.notEqual(deleteFocus.outline, 'none');
    await screenshot(page, 'delete-keyboard-focus'); evidence.steps.push({name: 'delete-keyboard-focus', ...deleteFocus});
    await page.keyboard.press('Enter');
    await page.getByRole('link', {name: 'Synthetic Beta', exact: true}).waitFor({state: 'detached'});
    await page.getByRole('alert').waitFor({state: 'detached'});
    assert.equal((await (await fetch(api + '/api/bookmarks')).json()).length, 1);
    evidence.steps.push({name: 'real-delete-clears-error-and-persists'});
    phase = 'actual-mock-outage'; await stop(mock, api); await page.reload();
    await page.getByRole('alert').filter({hasText: 'Unable to load bookmarks'}).waitFor();
    assert.equal(await page.getByText('No bookmarks found', {exact: true}).count(), 0);
    await screenshot(page, 'actual-api-outage');
    mock = startMock('mock-restarted'); await ready(api + '/api/bookmarks', async response => (await response.json()).length === 1);
    phase = 'recovery'; await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.getByRole('link', {name: 'Edited synthetic Alpha', exact: true}).waitFor(); await page.getByRole('alert').waitFor({state: 'detached'});
    await screenshot(page, 'actual-retry-recovery'); evidence.steps.push({name: 'owned-api-stop-restart-retry', persistedRecords: 1});
    await (await card(page, 'Edited synthetic Alpha')).getByRole('button', {name: 'Delete bookmark'}).click();
    await page.getByText('No bookmarks found', {exact: true}).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0); assert.deepEqual(await (await fetch(api + '/api/bookmarks')).json(), []);
    await screenshot(page, 'real-empty'); evidence.steps.push({name: 'actual-empty-distinct-from-error'});
    }
  } finally {await context.close();}
  assert(!evidence.health.some(item => ['unexpected-origin', 'pageerror', 'fixture-protocol-error'].includes(item.kind)));
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = safe(error); process.exitCode = 1;
} finally {
  if (browser) {try {await browser.close();} catch (error) {evidence.status = 'failed'; evidence.cleanup.push({name: 'browser', error: safe(error)});}}
  for (const child of [...children].reverse()) {
    try {await stop(child, child === vite ? origin : child.name.startsWith('mock-') ? api : null);}
    catch (error) {evidence.status = 'failed'; evidence.cleanup.push({name: child.name, error: safe(error)});}
  }
  if (evidence.status !== 'passed') process.exitCode = 1;
  await writeFile(join(state, 'request-observations.json'), JSON.stringify(rawRequests, null, 2) + '\n');
  evidence.requestSummary = {total: rawRequests.length, publicRelevant: evidence.requests.length, rawSha256: sha(JSON.stringify(rawRequests, null, 2) + '\n')};
  await writeFile(join(out, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({runId, status: evidence.status, steps: evidence.steps.length, screenshots: evidence.screenshots.length, axe: evidence.axe.length}));
}
