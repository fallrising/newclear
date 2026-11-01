/** AC-01: real Chromium -> transparent TLS -> actual Rust -> accepted T007 shell executable. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { Lifecycle, privateState } from '../fe-review/lifecycle.mjs';
import { installFreshTrust } from '../fe-review/trust.mjs';
import { fixtureFromRust, ledgerCounts, assertJourney } from './p0-browser-contract.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function sourceHashes() {
  const files = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'fe-review/lifecycle.mjs', 'fe-review/trust.mjs'];
  function walk(path) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
      else throw Error('T008_SOURCE_TYPE');
    }
  }
  for (const path of ['apps/control-plane', 'crates', 'acceptance']) walk(path);
  return Object.fromEntries(files.sort().map(path => [path, sha(readFileSync(join(root, path)))]));
}
if (process.argv[2] === '--source-hashes') {
  console.log(JSON.stringify(sourceHashes(), null, 2));
  process.exit(0);
}

const life = new Lifecycle({ closeMs: 8000 });
const origin = 'https://127.0.0.1:8443';
const backendPort = 8080;
const binary = '/control-plane';
const fixtureRoot = '/state/fixture';
const ledger = fixtureRoot + '/invocations.log';
const receipt = { mode: 'real-browser-rust-fake-codex', passed: false, stage: 'PRECONDITION',
  sourceCommit: null, sourceHashes: {}, binarySha256: null, tools: {},
  journey: { submitClicks: 0, submitResponses: 0, diffResponses: 0, events: [],
    pageErrors: 0, failedRequests: 0, unexpectedResponses: 0, upgrades: 0, subscribes: 0 },
};
let child, browser, proxy;
let phase = 'bootstrap';
let bearer;
let childExit = null;
const sockets = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, limit = 10000) {
  const end = performance.now() + limit;
  while (!(await check())) {
    life.check();
    if (childExit !== null) throw Error('T008_BACKEND_EXIT');
    if (performance.now() >= end) throw Error('T008_WAIT_TIMEOUT');
    await sleep(25);
  }
  life.check();
}
async function portPresent(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(300, () => { socket.destroy(); resolve(false); });
  });
}
function trackSocket(socket) {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  socket.on('error', () => socket.destroy());
  return socket;
}
async function startProxy(tls) {
  // Transparent forwarding only: response status, headers and bytes originate in Rust.
  const server = createHttpsServer(tls, (request, response) => {
    const upstream = httpRequest({ host: '127.0.0.1', port: backendPort,
      path: request.url, method: request.method, headers: request.rawHeaders }, incoming => {
      response.writeHead(incoming.statusCode, incoming.rawHeaders);
      incoming.pipe(response);
      incoming.on('error', () => response.destroy());
    });
    upstream.on('error', () => response.destroy());
    request.on('error', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', trackSocket);
  server.on('upgrade', (request, client, head) => {
    receipt.journey.upgrades++;
    const upstream = trackSocket(createConnection({ host: '127.0.0.1', port: backendPort }));
    upstream.once('connect', () => {
      let headers = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`;
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        headers += `${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}\r\n`;
      }
      upstream.write(headers + '\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8443, '127.0.0.1', resolve);
  });
  return server;
}
function observe(page) {
  const phases = new WeakMap();
  page.on('request', request => phases.set(request, phase));
  page.on('pageerror', () => receipt.journey.pageErrors++);
  page.on('requestfailed', () => receipt.journey.failedRequests++);
  page.on('response', response => {
    const request = response.request();
    const url = new URL(response.url());
    const path = url.origin === origin ? url.pathname : 'OTHER';
    const status = response.status();
    if (path === '/api/p0/v1/session/turns' && request.method() === 'POST' && status === 202) receipt.journey.submitResponses++;
    if (path === '/api/p0/v1/session/diff' && status === 200) receipt.journey.diffResponses++;
    const allowed401 = status === 401 && path === '/api/p0/v1/session' && ['bootstrap', 'logged-out'].includes(phases.get(request));
    if ((status < 200 || status >= 400) && !allowed401) receipt.journey.unexpectedResponses++;
  });
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      try { if (JSON.parse(frame.payload).type === 'subscribe') receipt.journey.subscribes++; } catch { /* verdict rejects absent valid subscribe */ }
    });
    socket.on('framereceived', frame => {
      try {
        const value = JSON.parse(frame.payload);
        if (value.type !== 'event') return;
        const envelope = value.envelope;
        const type = envelope?.payload?.type;
        const state = envelope?.payload?.lifecycle?.state ?? null;
        // Persist only a small fixed vocabulary and sequence; never raw frames or identities.
        receipt.journey.events.push({ seq: Number.isSafeInteger(envelope?.seq) ? envelope.seq : -1,
          type: ['turn_accepted', 'lifecycle_changed'].includes(type) ? type : 'unexpected',
          state: [null, 'pending', 'ready'].includes(state) ? state : 'unexpected' });
      } catch { receipt.journey.pageErrors++; }
    });
  });
}
async function main() {
  assert.equal(process.getuid(), 1000);
  assert.equal(homedir(), '/home/ubuntu');
  assert(!Object.keys(process.env).some(key => /^(CODEBOX_|CODEX_|OPENAI_|ANTHROPIC_)/.test(key)), 'T008_HOST_CREDENTIAL_ENV');
  assert.match(process.env.P0_SOURCE_COMMIT ?? '', /^[0-9a-f]{40}$/);
  assert.equal(process.env.P0_SOURCE_HASHES, '/frozen/source-hashes.json');
  await privateState('/state');
  await privateState('/output');
  receipt.sourceCommit = process.env.P0_SOURCE_COMMIT;
  receipt.sourceHashes = sourceHashes();
  assert.deepEqual(receipt.sourceHashes, JSON.parse(readFileSync(process.env.P0_SOURCE_HASHES, 'utf8')), 'T008_SOURCE_DRIFT');
  const executable = lstatSync(binary);
  assert(executable.isFile() && !executable.isSymbolicLink() && (executable.mode & 0o022) === 0);
  receipt.binarySha256 = sha(readFileSync(binary));
  assert.equal(await portPresent(backendPort), false, 'T008_EXISTING_BACKEND');
  assert.equal(await portPresent(8443), false, 'T008_EXISTING_TLS');
  mkdirSync(fixtureRoot, { mode: 0o700 });
  for (const name of ['codex-home', 'state', 'working']) mkdirSync(fixtureRoot + '/' + name, { mode: 0o700 });
  const fixture = fixtureFromRust(readFileSync(join(root, 'apps/control-plane/tests/p0_subscription_e2e.rs'), 'utf8'), ledger);
  writeFileSync(fixtureRoot + '/codex-fixture', fixture.script, { flag: 'wx', mode: 0o700 });
  writeFileSync(ledger, '', { flag: 'wx', mode: 0o600 });
  // This is a canary, never an operator credential; the fake script does not read it.
  writeFileSync(fixtureRoot + '/codex-home/auth.json', 'T007-CREDENTIAL-CANARY', { flag: 'wx', mode: 0o600 });
  bearer = randomBytes(32).toString('base64url');
  receipt.stage = 'RUST_START';
  child = await life.acquire('rust-control-plane', () => {
    const process = spawn(binary, [], { cwd: fixtureRoot + '/working', stdio: 'ignore', env: {
      PATH: '/usr/bin:/bin', CODEBOX_CODEX_EXECUTABLE: fixtureRoot + '/codex-fixture',
      CODEBOX_CODEX_HOME: fixtureRoot + '/codex-home', CODEBOX_STATE_DIR: fixtureRoot + '/state',
      CODEBOX_WORKING_DIR: fixtureRoot + '/working', CODEBOX_CLOUD_ENVIRONMENT: 'env_synthetic',
      CODEBOX_CLOUD_BRANCH: 'main', CODEBOX_PUBLIC_ORIGIN: origin, CODEBOX_BOOTSTRAP_TOKEN: bearer,
      CODEBOX_LISTEN_ADDRESS: '127.0.0.1:' + backendPort,
    } });
    process.once('exit', (code, signal) => { childExit = { code, signaled: signal !== null }; });
    process.once('error', () => { childExit = { code: null, signaled: false }; });
    return process;
  }, async process => {
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGINT');
    const end = performance.now() + 5000;
    while (process.exitCode === null && process.signalCode === null && performance.now() < end) await sleep(25);
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
      throw Error('T008_BACKEND_FORCED_STOP');
    }
    assert.equal(process.exitCode, 0, 'T008_BACKEND_SHUTDOWN');
  });
  await until(() => portPresent(backendPort));
  receipt.stage = 'TRUST';
  const tls = installFreshTrust(life, receipt);
  proxy = await life.acquire('transparent-tls-proxy', () => startProxy(tls), server => new Promise((resolve, reject) => {
    for (const socket of sockets) socket.destroy();
    server.close(error => error ? reject(error) : resolve());
  }));
  const require = createRequire('/review-tools/node_modules/playwright/package.json');
  assert.equal(require('playwright/package.json').version, '1.63.0');
  assert.equal(process.version, 'v24.18.0');
  const { chromium } = await import('/review-tools/node_modules/playwright/index.mjs');
  receipt.stage = 'BROWSER';
  browser = await life.acquire('chromium', () => chromium.launch({
    executablePath: '/ms-playwright/chromium-1243/chrome-linux64/chrome',
    timeout: 30000, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }), value => value.close());
  assert.equal(browser.version(), '153.0.8010.12');
  receipt.tools = { node: process.version, playwright: '1.63.0', chromium: browser.version(), fakeCli: '0.145.0' };
  const context = await life.acquire('browser-context', () => browser.newContext({
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block',
  }), value => value.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  observe(page);
  await page.goto(origin);
  await page.locator('#bootstrap-panel').waitFor({ state: 'visible' });
  receipt.stage = 'AUTHENTICATE';
  phase = 'authenticated';
  await page.locator('#bootstrap-token').fill(bearer);
  await page.locator('#authenticate').click();
  await page.waitForFunction(() => document.querySelector('#stream-status')?.textContent === 'connected');
  receipt.journey.authenticated = await page.locator('#operator-panel').isVisible();
  receipt.journey.loggedIn = (await page.locator('#login-status').textContent()) === 'logged_in';
  assert(receipt.journey.loggedIn, 'T008_LOGIN');
  receipt.stage = 'SUBMIT_AND_STREAM';
  await page.locator('#prompt').fill(fixture.prompt);
  receipt.journey.submitClicks++;
  await page.locator('#submit-turn').click();
  await until(() => receipt.journey.events.some(event => event.state === 'ready'), 30000);
  await page.waitForFunction(() => document.querySelector('#event-list')?.textContent.includes('3: Cloud lifecycle changed'));
  receipt.journey.activityOnPage = (await page.locator('#event-list').textContent()).includes('1: Turn accepted');
  receipt.stage = 'REFRESH_READY';
  const subscriptions = receipt.journey.subscribes;
  await page.locator('#refresh').click();
  await until(() => receipt.journey.subscribes === subscriptions + 1);
  await page.waitForFunction(() => document.querySelector('#stream-status')?.textContent === 'connected'
    && document.querySelector('#session-status')?.textContent === 'ready · cloud · sequence 3');
  receipt.journey.readyOnPage = true;
  receipt.journey.reconnected = true;
  receipt.stage = 'FINAL_DIFF';
  await page.locator('#show-diff').click();
  await page.waitForFunction(expected => document.querySelector('#diff-output')?.textContent === expected, fixture.diff);
  receipt.journey.exactDiff = true;
  receipt.stage = 'LOGOUT';
  const oldCookie = (await context.cookies(origin)).find(cookie => cookie.name === '__Host-codebox_p0');
  assert(oldCookie, 'T008_SESSION_COOKIE');
  await page.locator('#logout').click();
  await page.locator('#bootstrap-panel').waitFor({ state: 'visible' });
  phase = 'logged-out';
  // Probe only the exact previously minted app cookie in memory; never store credentials.
  await context.addCookies([oldCookie]);
  receipt.journey.logoutRejected = (await page.evaluate(async () =>
    (await fetch('/api/p0/v1/session', { credentials: 'same-origin', cache: 'no-store' })).status)) === 401;
  await context.clearCookies();
  receipt.journey.ledger = ledgerCounts(readFileSync(ledger, 'utf8'));
  assertJourney(receipt.journey);
  assert.deepEqual(sourceHashes(), receipt.sourceHashes, 'T008_SOURCE_DRIFT');
  receipt.stage = 'COMPLETE';
  receipt.passed = true;
}

const timeout = setTimeout(() => life.cancel('deadline'), 240000);
const handlers = ['SIGINT', 'SIGTERM'].map(name => [name, () => life.cancel(name)]);
for (const [name, handler] of handlers) process.on(name, handler);
try {
  await life.run(main);
} catch (error) {
  receipt.failure = /^T008_[A-Z_]+$/.test(error?.message ?? '') ? error.message
    : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'UNCLASSIFIED';
} finally {
  clearTimeout(timeout);
  receipt.cleanup = await life.finish();
  receipt.cleanup.backendAbsent = !(await portPresent(backendPort));
  receipt.cleanup.tlsAbsent = !(await portPresent(8443));
  receipt.cleanup.rustExitClean = childExit?.code === 0 && !childExit?.signaled;
  if (receipt.cleanup.backendAbsent && receipt.cleanup.resources.every(resource => resource.closed)) {
    if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true });
  }
  receipt.cleanup.fixtureAbsent = !existsSync(fixtureRoot);
  receipt.passed = receipt.passed && !receipt.cleanup.cancelled && receipt.cleanup.drainComplete
    && receipt.cleanup.resources.every(resource => resource.closed) && receipt.cleanup.backendAbsent
    && receipt.cleanup.tlsAbsent && receipt.cleanup.rustExitClean && receipt.cleanup.fixtureAbsent;
  if (bearer && JSON.stringify(receipt).includes(bearer)) {
    receipt.passed = false; receipt.failure = 'T008_SECRET'; delete receipt.journey;
  }
  for (const [name, handler] of handlers) process.off(name, handler);
  writeFileSync('/output/result.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: receipt.passed, stage: receipt.stage, failure: receipt.failure ?? null, cleanup: receipt.cleanup }));
  process.exit(receipt.passed ? 0 : 1);
}
