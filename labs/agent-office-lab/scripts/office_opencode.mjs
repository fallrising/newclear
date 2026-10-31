// Live A02: native Office PTY + OpenCode status plugin + local Strata.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { localOnly } from './local_office_policy.mjs';
import { PermissionProbe, observePermissions } from './permission_probe.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out, workspace, promptFile] = process.argv.slice(2, 5).map(p => path.resolve(p));
const keepOpen = process.argv.includes('--keep-open');
const checkCancel = process.argv.includes('--check-cancel');
const checkLifecycle = process.argv.includes('--check-lifecycle');
const permissions = new PermissionProbe();
let probeError;
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
  if (checkLifecycle) process.env.LAB_OPENCODE_PERMISSION_MODE = 'ask';
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'),
    '--projects', path.join(out, 'projects'), '--host', '127.0.0.1', '--no-open',
    '--max-workers', '1', '--weather', 'clear', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/opencode')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    localOnly(floor, report.model);
    if (checkLifecycle) {
      observePermissions(floor.workers, permissions, error => { probeError = error; });
    }
  }
  const base = `http://127.0.0.1:${office.server.address().port}`;
  report.url = `${base}/lite`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const messages = [];
  ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=Local%20Lab&lite=1`, { headers: { cookie, origin: base } });
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (checkLifecycle) permissions.screen(msg);
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
      if (probeError) throw probeError;
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(message);
  }
  await until(() => messages.some(m => m.t === 'welcome'), 10000, 'No Office welcome');
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'opencode', model: report.model, prompt, worktree: false }));
  await until(() => lastWorker, 15000, 'Office did not create the worker');
  ws.send(JSON.stringify({ t: 'worker.attach', workerId: lastWorker.id }));
  async function completeWithPermissions(target, previousOutput = 0) {
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      if (probeError) throw probeError;
      if (lastWorker?.status === 'done' && lastWorker?.usage?.output > previousOutput && existsSync(target)) return;
      if (permissions.ready(lastWorker)) {
        assert(permissions.requests.length <= 8, 'Too many synthetic permission prompts');
        assert(!existsSync(target), 'Artifact appeared before permission was answered');
        // Deliberately leave this real request unanswered, then prove the write is still blocked.
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert(!existsSync(target), 'Artifact changed while native permission was pending');
        ws.send(JSON.stringify(permissions.reply(lastWorker)));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('No completed native task after permission replies');
  }
  if (checkLifecycle) await completeWithPermissions(path.join(workspace, 'result.json'));
  else await until(() => lastWorker?.status === 'done' && lastWorker?.usage?.output > 0, 240000, 'No completed worker with reported model usage');
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
  if (checkLifecycle) {
    const workerId = lastWorker.id;
    const sessionId = lastWorker.sessionId;
    const ownerPid = () => office.floors()[0].workers.owners().find(p => p.workerId === workerId)?.pid;
    const oldPid = ownerPid();
    assert(oldPid, 'Missing owned PID');
    const before = { output: lastWorker.usage.output, mtime: statSync(path.join(workspace, 'result.json')).mtimeMs, event: messages.length };
    const promptsBefore = permissions.requests.length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(lastWorker.name, { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(out, 'office-refreshed.png'), fullPage: true });
    assert.equal(ownerPid(), oldPid);
    assert.equal(lastWorker.sessionId, sessionId);
    assert.equal(lastWorker.usage.output, before.output);
    assert.equal(statSync(path.join(workspace, 'result.json')).mtimeMs, before.mtime);
    assert(!messages.slice(before.event).some(m => m.t === 'worker.update' && m.worker.status === 'working'));
    report.refresh_without_rerun = true;
    // Release the browser before starting another TUI; keep the resource guard unchanged.
    await browser.close();
    browser = undefined;
    // End the actual process; keep the Office worker record so native resume can reuse its session.
    const owned = descendants(oldPid).map(p => p.pid);
    process.kill(oldPid, 'SIGTERM');
    await until(() => lastWorker?.status === 'exited', 15000, 'No native exit event');
    await until(() => owned.every(pid => {
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
    }), 10000, 'Old OpenCode process survived exit');
    const resumeFrom = messages.length;
    const usageFrom = permissions.usageEvents.length;
    ws.send(JSON.stringify({ t: 'worker.resume', workerId }));
    await until(() => ownerPid() && ownerPid() !== oldPid && messages.slice(resumeFrom).some(m =>
      m.t === 'worker.update' && m.worker.id === workerId && ['idle', 'done'].includes(m.worker.status)) &&
      permissions.usageEvents.slice(usageFrom).some(e => e.workerId === workerId && e.sessionId === sessionId && e.output >= before.output) &&
      permissions.text(workerId).includes('ctrl+p') && permissions.text(workerId).includes('Qwen3.8'),
      45000, 'Native resumed session did not hydrate usage and render its TUI');
    assert.equal(lastWorker.sessionId, sessionId, 'Resume created a different session');
    assert.equal(statSync(path.join(workspace, 'result.json')).mtimeMs, before.mtime, 'Resume replayed the original task');
    ws.send(JSON.stringify({ t: 'worker.attach', workerId }));
    ws.send(JSON.stringify({ t: 'worker.prompt', workerId, prompt:
      'Read input.json and write resumed.json with exactly the input marker as marker and the sum of values as total. Do not change result.json. Use your file tools. Do not use the network.' }));
    await completeWithPermissions(path.join(workspace, 'resumed.json'), before.output);
    assert.equal(lastWorker.sessionId, sessionId);
    const resumed = readFileSync(path.join(workspace, 'resumed.json'));
    assert.deepEqual(JSON.parse(resumed), JSON.parse(artifact));
    assert.equal(statSync(path.join(workspace, 'result.json')).mtimeMs, before.mtime);
    assert(permissions.requests.length > promptsBefore, 'Allow once unexpectedly persisted across resumed task');
    assert(permissions.requests.every(p => p.replied && p.continued), 'Unresolved permission request');
    report.permission_roundtrips = permissions.summary();
    report.permission_wait_verified = true;
    report.resume_verified = true;
    report.resume = { same_session: true, new_process: true, old_processes_exited: true,
      native_usage_hydrated: true,
      original_artifact_unchanged: true, output_before: before.output, output_after: lastWorker.usage.output,
      artifact_sha256: createHash('sha256').update(resumed).digest('hex') };
    report.worker = lastWorker;
  }
  await browser?.close();
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
  if (checkLifecycle) report.permission_roundtrips = permissions.summary();
  if (lastWorker) report.last_worker = lastWorker;
  save();
  process.exitCode = 1;
} finally {
  await stop();
  console.log(JSON.stringify(report));
}
