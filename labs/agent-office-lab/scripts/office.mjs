#!/usr/bin/env node
// Lab bootstrap around the pinned upstream checkout; no upstream source changes.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(lab, 'vendor/agent-office');
const pinned = '852e2ab28c4f3f31bffdf4b20353bd119c9d3270';
const args = process.argv.slice(2);
assert(args.every(a => ['--serve', '--screenshot'].includes(a)), 'Options: --serve, --screenshot');
const serve = args.includes('--serve');
const out = path.join(lab, 'runs', `office-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'launcher.mjs'), readFileSync(fileURLToPath(import.meta.url)));
const result = { status: 'starting', commit: pinned, mode: serve ? 'preview' : 'smoke', workers_started: 0 };
const password = randomBytes(24).toString('base64url');
let office;
let browser;
let stopped = false;
const save = () => writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
async function stop() {
  if (stopped) return;
  stopped = true;
  result.cleanup_completed = false;
  save();
  await browser?.close();
  if (office) {
    const closed = new Promise(resolve => office.server.once('close', resolve));
    office.shutdown(false);
    office.server.closeAllConnections();
    await closed;
    result.cleanup_completed = true;
  }
  save();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  result.status = 'stopped';
  stop().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
});

try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vendor, encoding: 'utf8' }).trim(), pinned);
  result.package_lock_sha256 = createHash('sha256').update(readFileSync(path.join(vendor, 'package-lock.json'))).digest('hex');
  result.node = process.version;
  result.providers = Object.fromEntries(['opencode', 'grok', 'pi'].map(name => {
    try {
      const executable = execFileSync('/usr/bin/which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return [name, { executable, status: 'present_unverified' }];
    } catch { return [name, { executable: null, status: 'missing_from_path' }]; }
  }));
  // Explicit configuration, separate state and no inherited webhooks/remote deployment settings.
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_OFFICE_')) delete process.env[key];
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const project = serve ? path.join(lab, 'projects/demo') : path.join(out, 'demo');
  if (!existsSync(project)) {
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'README.md'), '# Agent Office Lab demo\n\nSynthetic workspace for local integration tests. No private project data.\n');
    const git = argv => execFileSync('git', argv, { cwd: project, stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['add', 'README.md']);
    git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '-m', 'Initialize synthetic lab workspace']);
  }
  const cfg = loadConfig([
    project,
    '--home', serve ? path.join(lab, 'state/office-preview') : path.join(out, 'home'),
    '--projects', path.join(lab, 'projects'), '--host', '127.0.0.1',
    '--port', '4600', '--no-open', '--max-workers', '1', '--weather', 'clear',
    '--webhook', '', '--password', password,
    // A preview must never silently launch the upstream default cloud agent.
    '--agent', '/usr/bin/false',
  ]);
  if (!serve) cfg.port = 0;
  office = await startServer(cfg);
  const address = office.server.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  result.url = `${base}/lite`;
  result.max_workers = cfg.maxWorkers;
  result.default_agent = cfg.agentCmd;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal((await fetch(`${base}/api/whoami`)).status, 401);
  const redirect = await fetch(`${base}/lite`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const auth = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ password }),
  });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie };
  assert.equal((await fetch(`${base}/api/whoami`, { headers })).status, 200);
  const lite = await fetch(`${base}/lite`, { headers });
  assert.equal(lite.status, 200);
  const html = await lite.text();
  assert(html.includes('<html') && html.includes('/assets/'));
  result.checks = ['loopback', 'health', 'unauthenticated_401', 'lite_login_redirect', 'password_login', 'authenticated_whoami', 'lite_html'];
  if (args.includes('--screenshot')) {
    const require = createRequire(path.join(vendor, 'package.json'));
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true, chromiumSandbox: true,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15000);
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const split = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/lite`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Your name').fill('Local Lab');
    await page.getByRole('button', { name: 'Come on in' }).click();
    await page.getByPlaceholder('Your name').waitFor({ state: 'hidden' });
    await page.getByText('Nobody is working on this floor. ✨ New task hires someone.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'lite.png'), fullPage: true });
    result.browser_errors = errors;
    result.browser_title = await page.title();
    assert.equal(errors.length, 0, 'Browser JavaScript errors');
    result.checks.push('browser_render');
    await browser.close();
    browser = undefined;
  }
  result.status = serve ? 'preview_running' : 'completed';
  save();
  if (serve) {
    console.log(`Preview: ${result.url}\nSign in: ${base}${office.signInLink()}\nDefault agent is disabled; provider integration is not yet accepted.\nArtifacts: ${out}`);
  } else {
    await stop();
    console.log(JSON.stringify({ ...result, artifacts: out }, null, 2));
  }
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  save();
  await stop();
  console.error(JSON.stringify({ ...result, artifacts: out }, null, 2));
  process.exitCode = 1;
}
