// Browser check for T27 redacted result display/download behavior; never starts a provider.
// Usage: node scripts/check_result_redaction_browser.mjs fixture.json private-output-dir
// The fixture may be either an offline snapshot ({generated_at, providers, runs}) or a console
// state object ({results:{runs:[...]}, ...}). The script injects it into the console via
// Playwright route and writes a file:// offline snapshot copy for the static results page.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.argv.length, 4, 'Usage: node scripts/check_result_redaction_browser.mjs fixture.json private-output-dir');
const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const input = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const snapshot = input.runs ? input : input.results?.runs ? { generated_at: input.generated_at || 'fixture', providers: input.providers || [...new Set(input.results.runs.map(r => r.provider))], runs: input.results.runs } : input.offline;
assert(snapshot?.runs?.length, 'fixture must contain runs');
const state = input.results?.runs ? input : input.state || { active_job: null, shared_execution: { status: 'available' }, checks: {}, remote_grants: { pending: [], enabled_providers: [] }, projects: [], jobs: [], results: { runs: snapshot.runs } };
state.results = state.results || { runs: snapshot.runs };
state.results.runs = state.results.runs || snapshot.runs;
state.shared_execution = state.shared_execution || { status: 'available' };
state.checks = state.checks || {};
state.remote_grants = state.remote_grants || { pending: [], enabled_providers: [] };
state.projects = state.projects || [];
state.jobs = state.jobs || [];

const safe = text => assert(!/(?<![A-Za-z0-9])SYNTHSECRET_[0-9a-f]{16}(?![A-Za-z0-9])/.test(text));
safe(JSON.stringify(snapshot));
const encoded = text => new TextEncoder().encode(text);
const hex = text => crypto.createHash('sha256').update(encoded(text)).digest('hex');
const blobText = text => Buffer.from(encoded(text)).toString('utf8');
const htmlTemplate = fs.readFileSync(path.join(lab, 'scripts/office_results.html'), 'utf8');
const consoleHtml = fs.readFileSync(path.join(lab, 'scripts/office_console.html'), 'utf8');
const consoleJs = fs.readFileSync(path.join(lab, 'scripts/office_console.js'), 'utf8');
function writeSnapshot(name, value) {
  const file = path.join(out, name);
  fs.writeFileSync(file, htmlTemplate.replace('__OFFICE_RESULTS_JSON__', JSON.stringify(value).replaceAll('<', '\\u003c')), { mode: 0o600 });
  return file;
}
const offlineFile = writeSnapshot('offline.html', snapshot);
const tampered = JSON.parse(JSON.stringify(snapshot));
const downloadable = tampered.runs.find(r => r.artifact?.status === 'verified' && (r.artifact.text || r.artifact.export_text) && r.artifact.display_sha256);
assert(downloadable, 'fixture must include a verified text/revision/fixture artifact with display_sha256');
downloadable.artifact.display_sha256 = '0'.repeat(64);
const tamperedFile = writeSnapshot('tampered.html', tampered);

const textRun = snapshot.runs.find(r => r.artifact?.text && r.artifact.display_sha256 && /\r\n/.test(r.artifact.text) && /[\uD800-\uDFFF\uFFFD]/.test(r.artifact.text));
assert(textRun, 'fixture must include downloadable projected text with CRLF and a surrogate/U+FFFD case');
assert.equal(hex(textRun.artifact.text), textRun.artifact.display_sha256, 'fixture display_sha256 must match TextEncoder bytes');
const secretOnlyRun = snapshot.runs.find(r => r.artifact?.kind === 'revision' && r.artifact.changed === true && r.artifact.display_changed === false);
assert(secretOnlyRun, 'fixture must include secret-only revision changed=true/display_changed=false');
const fixtureRun = snapshot.runs.find(r => r.artifact?.export_text && r.artifact.display_sha256);
assert(fixtureRun, 'fixture must include canonical fixture export_text with display_sha256');
assert.equal(hex(fixtureRun.artifact.export_text), fixtureRun.artifact.display_sha256, 'fixture export_text hash must match');
const retryRun = state.results.runs.find(r => r.provider === 'pi' && r.status === 'failed' && r.retry && r.root === 1 && r.ref);
assert(retryRun, 'fixture must include root===1 failed Pi retry row with ref');

const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const report = { status: 'starting', fixture: fixturePath };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  const errors = [], external = [], planBodies = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.name)));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === 'http://127.0.0.1:41727') {
      if (url.pathname === '/' || url.pathname === '/console.html') return route.fulfill({ status: 200, contentType: 'text/html', body: consoleHtml });
      if (url.pathname === '/console.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: consoleJs });
      if (url.pathname === '/console.css') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      if (url.pathname === '/api/state') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
      if (url.pathname === '/api/plan' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        planBodies.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan_id: 'retry-plan', executable: false, plan: { provider: 'pi', model: 'fixture', remote: false, task: 'task', retry_of: 'redacted', attempt: 1, limits: {} } }) });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }
    if (req.url() === pathToFileURL(offlineFile).href || req.url() === pathToFileURL(tamperedFile).href) return route.continue();
    if (url.protocol === 'blob:') return route.continue();
    external.push(req.url());
    return route.abort();
  });

  let page = await context.newPage();
  page.on('pageerror', e => errors.push(e.name));
  await page.goto(pathToFileURL(offlineFile).href);
  await page.locator(`#runs tr[data-ref="${secretOnlyRun.ref}"]`).getByRole('button').click();
  assert((await page.locator('#detail').innerText()).includes('secret-only'));
  assert((await page.locator('#detail').innerText()).includes('下載內容 SHA-256'));
  await page.selectOption('#provider', textRun.provider);
  await page.selectOption('#status', textRun.status);
  await page.locator(`#runs tr[data-ref="${textRun.ref}"]`).getByRole('button').click();
  const textButton = page.getByRole('button', { name: `下載 ${textRun.artifact.name || textRun.artifact.target || 'output.md'}` });
  await assert.doesNotReject(() => textButton.waitFor({ state: 'visible' }));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /^下載 /.test(b.textContent) && !b.disabled));
  const textDownload = page.waitForEvent('download');
  await textButton.click();
  const gotText = await textDownload;
  const textPath = path.join(out, gotText.suggestedFilename());
  await gotText.saveAs(textPath);
  assert.equal(fs.readFileSync(textPath, 'utf8'), blobText(textRun.artifact.text));
  assert.equal(hex(fs.readFileSync(textPath, 'utf8')), textRun.artifact.display_sha256);

  await page.selectOption('#provider', fixtureRun.provider);
  await page.selectOption('#status', fixtureRun.status);
  await page.locator(`#runs tr[data-ref="${fixtureRun.ref}"]`).getByRole('button').click();
  const fixtureButton = page.getByRole('button', { name: '下載 result.json' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '下載 result.json' && !b.disabled));
  const fixtureDownload = page.waitForEvent('download');
  await fixtureButton.click();
  const gotFixture = await fixtureDownload;
  const fixtureOut = path.join(out, 'result-download.json');
  await gotFixture.saveAs(fixtureOut);
  assert.equal(fs.readFileSync(fixtureOut, 'utf8'), fixtureRun.artifact.export_text);
  safe(await page.locator('body').innerText());
  safe(fs.readFileSync(textPath, 'utf8'));
  safe(fs.readFileSync(fixtureOut, 'utf8'));
  report.offline_downloads_match_display_hash = true;

  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.name));
  await page.goto(pathToFileURL(tamperedFile).href);
  await page.locator(`#runs tr[data-ref="${downloadable.ref}"]`).getByRole('button').click();
  await page.waitForFunction(() => document.querySelector('#detail')?.innerText.includes('integrity mismatch'));
  assert(await page.getByRole('button', { name: /integrity mismatch/ }).isDisabled());
  report.tampered_display_hash_disabled = true;

  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.name));
  await page.goto('http://127.0.0.1:41727/');
  await page.selectOption('#filter', 'pi');
  await page.locator(`#runs tr[data-ref="${retryRun.ref}"]`).getByRole('button', { name: /重試計畫/ }).click();
  await page.waitForFunction(() => document.querySelector('#plan-card') && !document.querySelector('#plan-card').hidden);
  assert.equal(planBodies.length, 1);
  assert.deepEqual(planBodies[0], { retry_ref: retryRun.ref });
  assert(!('retry_id' in planBodies[0]));
  report.retry_posts_only_ref = true;

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  report.status = 'passed';
  report.browser_errors = 0;
  report.external_requests = 0;
  fs.writeFileSync(path.join(out, 'result-redaction-browser.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
