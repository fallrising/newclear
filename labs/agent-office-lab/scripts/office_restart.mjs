// Live host-process crash/restart acceptance. No mock status or model responses.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionProbe } from './permission_probe.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out, workspace, promptFile] = process.argv.slice(2).map(p => path.resolve(p));
assert(out.startsWith(lab + '/runs/') && workspace.startsWith(out + '/'));
const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
const fixture = JSON.parse(readFileSync(path.join(workspace, 'input.json')));
const model = 'strata/qwen3.8-flash-next-q2_0';
const config = { out, workspace, password: randomBytes(24).toString('base64url'), ask: true, port: 0 };
const configFile = path.join(out, 'host-config.json');
const report = { status: 'starting', provider: 'opencode', model, cloud_fallback: false, states: [] };
const save = () => writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
save();
let host, ready, ws, worker, browser, failure, closing;
let permissions = new PermissionProbe();
let generations = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, reason) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (failure) throw failure;
    if (check()) return;
    await sleep(100);
  }
  throw new Error(reason);
}
function ownedTree(pid) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(s => s.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, parent] of rows) if (ids.has(parent) && !ids.has(id)) { ids.add(id); changed = true; }
  }
  return [...ids];
}
const gone = pid => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
async function startHost() {
  ready = undefined; failure = undefined; worker = undefined; permissions = new PermissionProbe();
  writeFileSync(configFile, JSON.stringify(config) + '\n', { mode: 0o600 });
  host = fork(path.join(lab, 'scripts/office_host.mjs'), [configFile], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  generations.push(host.pid);
  host.stderr.on('data', data => appendFileSync(path.join(out, 'host.stderr.log'), data));
  host.on('message', msg => {
    if (msg.t === 'ready') ready = msg;
    if (msg.t === 'error') failure = new Error(msg.error);
    if (msg.t === 'hook') {
      try { permissions.hook(msg.workerId, msg.payload, true); } catch (error) { failure = error; }
    }
  });
  await until(() => ready, 30000, 'Office host did not start');
  config.port = ready.port;
  const base = `http://127.0.0.1:${ready.port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  ws = new WebSocket(base.replace('http', 'ws') + '/ws?name=Local%20Lab&lite=1', { headers: { cookie, origin: base } });
  let welcomed = false;
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    permissions.screen(msg);
    if (msg.t === 'welcome') { welcomed = true; worker = msg.workers?.[0]; }
    if (msg.t === 'worker.update') worker = msg.worker;
    if (msg.t === 'worker.update' || msg.t === 'welcome') {
      if (worker) report.states.push({ generation: generations.length, status: worker.status, task: worker.labTaskState });
      appendFileSync(path.join(out, 'restart-events.jsonl'), JSON.stringify(msg) + '\n');
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => welcomed, 10000, 'Office welcome missing');
  return { base, cookie };
}
async function inspect() {
  const request = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const current = host;
    const timer = setTimeout(() => { current.off('message', receive); reject(new Error('Host inspection timed out')); }, 5000);
    function receive(msg) {
      if (msg.t === 'inspect' && msg.request === request) { clearTimeout(timer); current.off('message', receive); resolve(msg); }
    }
    current.on('message', receive); current.send({ t: 'inspect', request });
  });
}
async function stopHost(crash = false) {
  if (ws) { ws.close(); ws = undefined; }
  const current = host;
  if (!current || current.exitCode !== null || current.signalCode !== null) { host = undefined; return; }
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Office host did not exit')), 15000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  if (crash) current.kill('SIGKILL'); else current.send({ t: 'stop' });
  await exited; host = undefined;
}
async function cleanup() {
  if (closing) return closing;
  closing = (async () => {
    await browser?.close(); browser = undefined;
    // A crash may have left native detached PTYs. The recovery startup reclaims/stops them.
    if (!host && generations.length) await startHost();
    await stopHost(); report.cleanup_completed = true; save();
  })();
  return closing;
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  report.status = 'interrupted'; cleanup().then(() => process.exit(1));
});
try {
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic restart fixture']);
  await startHost();
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'opencode', model, prompt: readFileSync(promptFile, 'utf8'), worktree: false }));
  await until(() => worker, 15000, 'No native worker');
  const workerId = worker.id;
  ws.send(JSON.stringify({ t: 'worker.attach', workerId }));
  await until(() => permissions.ready(worker), 180000, 'No native pending permission before crash');
  assert(!existsSync(path.join(workspace, 'result.json')));
  const sessionId = worker.sessionId;
  const first = await inspect(); const pid = first.owners.find(p => p.workerId === workerId)?.pid;
  assert(pid, 'Missing owned OpenCode PID');
  const oldPids = ownedTree(pid);
  report.interrupted_at_permission = true; save();
  await stopHost(true); // Real process crash; no shutdown hook can write the interrupted state.
  await startHost();
  await until(() => oldPids.every(gone), 10000, 'Old owned processes survived recovery');
  async function checkParked() {
    const snap = await inspect();
    assert.equal(snap.owners.filter(owner => owner.pid).length, 0, 'A worker auto-started');
    assert.equal(snap.workers.length, 1);
    assert.equal(snap.workers[0].id, workerId);
    assert.equal(snap.workers[0].sessionId, sessionId);
    assert.equal(snap.workers[0].status, 'offline');
    assert.equal(snap.workers[0].labTaskState, 'interrupted');
    assert(!existsSync(path.join(workspace, 'result.json')));
  }
  await checkParked(); await sleep(3000); await checkParked();
  report.crash_recovery_verified = true;
  report.old_processes_exited = true;
  await stopHost(); // Repeat a graceful host restart while interrupted: state must not disappear.
  const { base, cookie } = await startHost();
  await checkParked(); report.repeated_restart_preserved = true;
  const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const split = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }]);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base + '/lite', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Your name').fill('Local Lab');
  await page.getByRole('button', { name: 'Come on in' }).click();
  await page.getByText(/interrupted ·/).first().waitFor();
  await page.screenshot({ path: path.join(out, 'office-interrupted.png'), fullPage: true });
  await checkParked(); report.browser_interrupted_visible = true;
  ws.send(JSON.stringify({ t: 'worker.attach', workerId }));
  // In the pinned lite UI, explicitly opening an offline card sends worker.resume.
  await page.locator('.lite-card').filter({ hasText: 'interrupted ·' }).click();
  await browser.close(); browser = undefined;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (worker?.status === 'done' && worker?.usage?.output > 0 && existsSync(path.join(workspace, 'result.json'))) break;
    if (permissions.ready(worker)) {
      assert(permissions.requests.length <= 8);
      assert(!existsSync(path.join(workspace, 'result.json')));
      ws.send(JSON.stringify(permissions.reply(worker)));
    }
    await sleep(100);
  }
  assert.equal(worker.status, 'done', 'Manual resume did not complete');
  assert.equal(worker.sessionId, sessionId);
  const artifact = readFileSync(path.join(workspace, 'result.json'));
  assert.deepEqual(JSON.parse(artifact), { marker: fixture.marker, total: fixture.values.reduce((a, b) => a + b, 0) });
  assert(permissions.requests.length > 0 && permissions.requests.every(p => p.replied && p.continued));
  report.manual_resume_verified = true; report.permission_roundtrips = permissions.summary();
  report.worker = worker; report.model_inference_verified = true; report.file_task_passed = true;
  report.artifact_sha256 = createHash('sha256').update(artifact).digest('hex');
  const mtime = statSync(path.join(workspace, 'result.json')).mtimeMs;
  await stopHost(); await startHost();
  const final = await inspect();
  assert.equal(final.owners.filter(owner => owner.pid).length, 0);
  assert.equal(final.workers[0].labTaskState, 'completed');
  assert.equal(final.workers[0].sessionId, sessionId);
  assert.equal(statSync(path.join(workspace, 'result.json')).mtimeMs, mtime);
  report.completed_not_replayed = true;
  report.distinct_host_processes = new Set(generations).size === generations.length;
  assert(report.distinct_host_processes);
  report.host_generations = generations.length;
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.status = 'failed'; report.cleanup_error = String(error); process.exitCode = 1; }
  save(); console.log(JSON.stringify(report));
}
