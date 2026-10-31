// Live A02: native Office PTY + OpenCode status plugin + local Strata.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { localOnly } from './local_office_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out, workspace, promptFile] = process.argv.slice(2, 5).map(p => path.resolve(p));
const keepOpen = process.argv.includes('--keep-open');
const checkCancel = process.argv.includes('--check-cancel');
assert(out.startsWith(lab + '/runs/') && workspace.startsWith(out + '/'));
const fixture = JSON.parse(readFileSync(path.join(workspace, 'input.json'), 'utf8'));
const prompt = readFileSync(promptFile, 'utf8');
const report = { status: 'starting', provider: 'opencode', model: 'strata/qwen3.8-flash-next-q2_0', states: [], cloud_fallback: false };
const save = () => writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
function descendants(rootPid) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3] }] : [];
  });
  const ids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of rows) if (ids.has(p.parent) && !ids.has(p.pid)) { ids.add(p.pid); changed = true; }
  }
  return rows.filter(p => ids.has(p.pid));
}
save();
const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
let office;
let ws;
let lastWorker;
let browser;
let shutdown;
async function stop() {
  if (shutdown) return shutdown;
  shutdown = (async () => {
    report.cleanup_completed = false;
    save();
    await browser?.close();
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise(resolve => { ws.once('close', resolve); ws.close(); });
    }
    if (office) {
      const closed = new Promise(resolve => office.server.once('close', resolve));
      office.shutdown(false);
      office.server.closeAllConnections();
      await closed;
    }
    report.cleanup_completed = true;
    save();
  })();
  return shutdown;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  report.status = 'interrupted';
  stop().then(() => process.exit(1));
});

try {
  const git = argv => execFileSync('git', argv, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture',
    '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic OpenCode task']);
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_OFFICE_')) delete process.env[key];
  process.env.LAB_OPENCODE_RUN = out;
  process.env.LAB_OPENCODE_WORKSPACE = workspace;
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'),
    '--projects', path.join(out, 'projects'), '--host', '127.0.0.1', '--no-open',
    '--max-workers', '1', '--weather', 'clear', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/opencode')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) localOnly(floor, report.model);
  const base = `http://127.0.0.1:${office.server.address().port}`;
  report.url = `${base}/lite`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const messages = [];
  ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=Local%20Lab&lite=1`, { headers: { cookie, origin: base } });
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    messages.push(msg);
    if (msg.t === 'worker.update' || msg.t === 'worker.remove' || msg.t === 'toast') {
      appendFileSync(path.join(out, 'office-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...msg }) + '\n');
    }
    if (msg.t === 'worker.update') {
      lastWorker = msg.worker;
      if (report.states.at(-1) !== lastWorker.status) report.states.push(lastWorker.status);
    }
    if (msg.t.startsWith('term.')) appendFileSync(path.join(out, 'terminal-events.jsonl'), JSON.stringify(msg) + '\n');
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  async function until(check, ms, message) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(message);
  }
  await until(() => messages.some(m => m.t === 'welcome'), 10000, 'No Office welcome');
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'opencode', model: report.model, prompt, worktree: false }));
  await until(() => lastWorker, 15000, 'Office did not create the worker');
  ws.send(JSON.stringify({ t: 'worker.attach', workerId: lastWorker.id }));
  await until(() => lastWorker?.status === 'done' && lastWorker?.usage?.output > 0, 240000, 'No completed worker with reported model usage');
  report.worker = lastWorker;
  assert(lastWorker.sessionId, 'Native OpenCode session ID missing');
  assert(report.states.includes('working'), 'No native working event');
  const artifact = readFileSync(path.join(workspace, 'result.json'));
  assert.deepEqual(JSON.parse(artifact), { marker: fixture.marker, total: fixture.values.reduce((a, b) => a + b, 0) });
  report.artifact_sha256 = createHash('sha256').update(artifact).digest('hex');
  report.file_task_passed = true;
  report.model_inference_verified = true;
  report.office_native_status_verified = true;
  // Render the completed real worker, not a mock dashboard card.
  const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const split = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/lite`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Your name').fill('Local Lab');
  await page.getByRole('button', { name: 'Come on in' }).click();
  await page.getByText(lastWorker.name, { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(out, 'office-opencode.png'), fullPage: true });
  await browser.close();
  browser = undefined;
  if (checkCancel) {
    const workerId = lastWorker.id;
    const workerPid = office.floors()[0].workers.owners().find(p => p.workerId === workerId)?.pid;
    assert(workerPid, 'No owned worker PID for cancellation verification');
    const before = messages.length;
    ws.send(JSON.stringify({ t: 'worker.prompt', workerId,
      prompt: 'Cancellation test: use your bash tool to run sleep 120. After it finishes, write cancelled-task.txt containing finished. Do not do anything else.' }));
    await until(() => descendants(workerPid).some(p => path.basename(p.command) === 'sleep'),
      90000, 'Cancellation task did not start its bash tool');
    const owned = descendants(workerPid);
    report.cancelled_process_pids = owned.map(p => p.pid);
    const cancelledAt = Date.now();
    ws.send(JSON.stringify({ t: 'worker.kill', workerId, cleanup: 'keep' }));
    await until(() => messages.slice(before).some(m => m.t === 'worker.remove' && m.workerId === workerId), 10000, 'Worker was not removed after cancellation');
    report.cancel_duration_ms = Date.now() - cancelledAt;
    report.cancelled_worker_id = workerId;
    report.cancel_event_verified = true;
    await until(() => report.cancelled_process_pids.every(pid => {
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
    }), 10000, 'Owned worker processes survived cancellation');
    report.cancelled_processes_exited = true;
  }
  report.status = 'completed';
  save();
  if (keepOpen) {
    const ready = { url: report.url, sign_in: base + office.signInLink(), workspace };
    writeFileSync(path.join(out, 'office-ready.json'), JSON.stringify(ready, null, 2) + '\n', { mode: 0o600 });
    console.log('Local Office demo ready; Ctrl+C stops the Office and model.');
    await new Promise(() => {});
  }
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  if (lastWorker) report.last_worker = lastWorker;
  save();
  process.exitCode = 1;
} finally {
  await stop();
  console.log(JSON.stringify(report));
}
