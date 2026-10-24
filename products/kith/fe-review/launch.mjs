// Review-only equivalent of e2e/global-setup.ts and harness/server.ts; never starts a sidecar.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export function validateIsolation(interfaces = readdirSync('/sys/class/net')) {
  if (interfaces.length !== 1 || interfaces[0] !== 'lo') throw new Error('requires a private loopback-only network namespace (Docker --network none)');
}
export function assertLoopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('requires a plain loopback HTTP origin');
  return url.origin;
}
export function cleanEnvironment(source = process.env) {
  const env = {};
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH', 'npm_config_cache']) {
    if (source[name]) env[name] = source[name];
  }
  return { ...env, CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' };
}
export function temporaryDirectory(root, id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid run identifier');
  const path = join(root, id);
  mkdirSync(path, { mode: 0o700 });
  return path;
}


async function launch() {
validateIsolation();
const reviewDir = dirname(fileURLToPath(import.meta.url));
const kithDir = dirname(reviewDir);
const webDir = join(kithDir, 'web');
if (readdirSync(webDir).some((name) => /^\.env(?:\.|$)/.test(name) && !name.endsWith('.example'))) throw new Error('review refuses ambient Vite environment files');
const env = cleanEnvironment();
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);
const runId = new Date().toISOString().replace(/[^0-9TZ]/g, '') + '-' + randomUUID();
const root = join(reviewDir, 'runs', '.state');
mkdirSync(root, { recursive: true, mode: 0o700 });
const lock = join(root, 'launcher.lock');
closeSync(openSync(lock, 'wx', 0o600));
let stateDir, runDir, fakeProvider, browser;
let cleanupPromise;
let getFreePort, waitForHttp, track, stopStack, wranglerEnv, recordObservedSecret;
let redactText = (value) => String(value);
const cleanup = () => cleanupPromise ??= (async () => {
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => browser?.close()),
    Promise.resolve().then(() => stopStack?.()),
    Promise.resolve().then(() => fakeProvider?.close()),
  ]);
  if (outcomes.some((outcome) => outcome.status === 'rejected')) throw new Error('owned cleanup failed; lock retained for investigation');
  if (runDir) writeFileSync(join(runDir, 'cleanup.json'), JSON.stringify({ owned_process_groups_stopped: true, stopped_at: new Date().toISOString() }) + '\n');
  unlinkSync(lock);
})();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopping = true;
  cleanup().then(() => process.exit(0), () => process.exit(1));
});
try {
  // Every operation after lock acquisition, including module loading, is protected.
  ({ getFreePort, waitForHttp, track, stopStack, wranglerEnv } = await import('../e2e/harness/server.ts'));
  ({ recordObservedSecret, redactText } = await import('../e2e/harness/redact.ts'));
  stateDir = temporaryDirectory(root, runId);
  runDir = temporaryDirectory(join(reviewDir, 'runs'), runId);
  process.env.KITH_E2E_SECRET_FILE = join(stateDir, 'observed.secrets');
  writeFileSync(process.env.KITH_E2E_SECRET_FILE, '', { mode: 0o600 });
  const { PROVIDER_CANARY, ACCOUNTS } = await import('../e2e/fixtures/accounts.ts');
  const { buildSeed } = await import('../e2e/fixtures/seed.ts');
  const { startFakeProvider } = await import('../e2e/harness/fake-provider.ts');
  const { loginViaUi } = await import('../e2e/fixtures/actors.ts');
  const require = createRequire(join(kithDir, 'e2e', 'package.json'));
  const { chromium } = require('@playwright/test');
  const wrangler = join(kithDir, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(wrangler)) throw new Error('missing pinned dependencies: npm ci in kith, web and e2e');
  const secret = randomBytes(32).toString('base64url');
  recordObservedSecret(secret);
  recordObservedSecret(PROVIDER_CANARY);
  const envFile = join(stateDir, 'wrangler.env');
  writeFileSync(envFile, `KITH_E2E=1\nKITH_SECRETS_KEY=${secret}\n`, { mode: 0o600 });
  let pendingLog = '';
  const log = (data) => {
    pendingLog += String(data);
    const lines = pendingLog.split('\n'); pendingLog = lines.pop();
    for (const line of lines) appendFileSync(join(runDir, 'server.log'), redactText(line) + '\n');
  };
  for (const args of [
    ['d1', 'migrations', 'apply', 'kith', '--local', '--persist-to', stateDir, '--env-file', envFile],
    ['d1', 'execute', 'kith', '--local', '--persist-to', stateDir, '--env-file', envFile, '--file', join(stateDir, 'seed.sql'), '-y'],
  ]) {
    if (args.includes('execute')) {
      const seed = await buildSeed();
      writeFileSync(join(stateDir, 'seed.sql'), seed.sql, { mode: 0o600 });
      writeFileSync(join(runDir, 'seed.json'), JSON.stringify({ id: seed.id, sha256: seed.sha256 }) + '\n');
    }
    const result = spawnSync(wrangler, args, { cwd: kithDir, env: wranglerEnv(), encoding: 'utf8', timeout: 120000 });
    log(result.stdout ?? ''); log(result.stderr ?? '');
    if (result.status !== 0) throw new Error(`local D1 ${args[1]} failed; see redacted server.log`);
  }
  fakeProvider = await startFakeProvider(PROVIDER_CANARY);
  const apiPort = await getFreePort(), inspectorPort = await getFreePort();
  const assets = join(stateDir, 'empty-assets'); mkdirSync(assets);
  writeFileSync(join(assets, 'index.html'), '<!doctype html><title>review assets</title>');
  const vars = { ff_mcp: 'on', ff_hosted_agent: 'on', ff_sidecar: 'off', ff_ambient: 'off', KITH_PAID_ENABLED: 'on', KITH_MAX_PAID_ATTEMPTS_PER_DAY: '1000', KITH_MAX_AGENT_ATTEMPTS_PER_DAY: '1000', KITH_MAX_PAID_CONCURRENCY: '8', KITH_MAX_API_REQUESTS_PER_MINUTE: '1000', KITH_MAX_LOGIN_ATTEMPTS_PER_MINUTE: '1000', ff_providers: 'on', ff_drafts: 'on', KITH_DEV_ALLOW_HTTP_PROVIDERS: 'on' };
  const child = spawn(wrangler, ['dev', '--local', '--ip', '127.0.0.1', '--port', String(apiPort), '--inspector-port', String(inspectorPort), '--persist-to', stateDir, '--assets', assets, '--env-file', envFile, '--show-interactive-dev-session=false', ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`])], { cwd: kithDir, env: wranglerEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  track(child, stateDir); child.stdout.on('data', log); child.stderr.on('data', log);
  child.on('error', () => { if (!stopping) { stopping = true; cleanup().finally(() => process.exit(1)); } });
  const apiOrigin = assertLoopback(`http://127.0.0.1:${apiPort}`);
  await waitForHttp(apiOrigin + '/api/csrf', 60000);
  const baseUrl = 'http://127.0.0.1:5174';
  const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { cwd: webDir, env: { ...env, KITH_API_ORIGIN: apiOrigin }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  track(vite, stateDir); vite.stdout.on('data', log); vite.stderr.on('data', log);
  vite.on('error', () => { if (!stopping) { stopping = true; cleanup().finally(() => process.exit(1)); } });
  await waitForHttp(baseUrl + '/login', 60000);
  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: baseUrl, locale: 'zh-TW' });
  const page = await context.newPage();
  // Same native CDP network initialization used by existing fixtures/kith.ts in --network none.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'ethernet' });
  await loginViaUi(page, ACCOUNTS.ada);
  for (const cookie of await context.cookies()) recordObservedSecret(cookie.value);
  const auth = join(stateDir, 'auth.storage.json');
  await context.storageState({ path: auth }); chmodSync(auth, 0o600);
  const metadata = { runId, runDir, stateDir, baseUrl, apiOrigin, fakeProviderUrl: fakeProvider.url, seed: 'base-v1', node: process.versions.node, chromium: browser.version() };
  writeFileSync(join(stateDir, 'context.json'), JSON.stringify(metadata) + '\n', { mode: 0o600 });
  await browser.close(); browser = undefined;
  const pointer = join(root, 'current');
  const staging = join(root, `current-${runId}`); symlinkSync(runId, staging); renameSync(staging, pointer);
  console.log(JSON.stringify({ baseUrl, apiOrigin, fakeProviderUrl: fakeProvider.url, seed: 'base-v1', runId }));
  await new Promise(() => {});
} catch (error) {
  console.error(redactText(error instanceof Error ? error.message : String(error)));
  await cleanup(); process.exitCode = 1;
}

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await launch();
