// Native Office PTY -> Grok. No prompt or remote model task.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { grokStartupOnly } from './grok_office_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
assert(out?.startsWith(lab + '/runs/'));
const workspace = path.join(out, 'workspace');

const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
const report = { status: 'starting', provider: 'grok',
  cloud_fallback: false, model_inference_verified: false, task_completed: false, session_hook_verified: false, states: [], authenticated_hooks: [] };
const save = () => fs.writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
let office, ws, worker, closing;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, reason) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    if (worker?.status === 'exited') throw new Error('Native Grok failed');
    await sleep(100);
  }
  throw new Error(reason);
}
async function stop() {
  if (closing) return closing;
  closing = (async () => {
    const owned = office?.floors().flatMap(f => f.workers.owners()).map(o => o.pid).filter(Boolean) ?? [];
    ws?.close();
    if (office) {
      const closed = new Promise(resolve => office.server.once('close', resolve));
      office.shutdown(false); office.server.closeAllConnections(); await closed;
    }
    const deadline = Date.now() + 10000;
    const gone = pid => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
    while (!owned.every(gone) && Date.now() < deadline) await sleep(100);
    assert(owned.every(gone), 'Owned Grok process survived shutdown');
    report.cleanup_completed = true; save();
  })();
  return closing;
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { report.status = 'interrupted'; void stop().then(() => process.exit(1)); });
try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(lab, 'vendor/agent-office'), encoding: 'utf8' }).trim(), '852e2ab28c4f3f31bffdf4b20353bd119c9d3270');
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic Grok fixture']);
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'), '--projects', path.join(out, 'projects'),
    '--host', '127.0.0.1', '--no-open', '--max-workers', '1', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/grok')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    grokStartupOnly(floor);
    const native = floor.workers.handleProviderHook.bind(floor.workers);
    floor.workers.handleProviderHook = (route, id, token, event, payload) => {
      const accepted = native(route, id, token, event, payload);
      if (route === 'grok' && accepted) report.authenticated_hooks.push({ event, session: payload.sessionId ?? payload.session_id });
      return accepted;
    };
  }
  const base = `http://127.0.0.1:${office.server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  ws = new WebSocket(base.replace('http', 'ws') + '/ws?name=Lab&lite=1', { headers: { cookie: login.headers.get('set-cookie').split(';')[0], origin: base } });
  let welcomed = false;
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome') welcomed = true;
    if (msg.t === 'worker.update') {
      worker = msg.worker;
      if (report.states.at(-1) !== worker.status) report.states.push(worker.status);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => welcomed, 10000, 'Office welcome missing');
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'grok', worktree: false }));
  const loginVisible = () => office.floors().flatMap(f => f.workers.fullScreens()).some(s => {
    if (s.workerId !== worker?.id) return false;
    const text = Object.values(s.frame.lines).map(runs => runs.map(run => run[0]).join('')).join('\n');
    return /Login with Grok/.test(text) && /Grok Build\s+1\.0\.70/.test(text);
  });
  await until(() => worker?.status === 'needs_input' && loginVisible(), 30000, 'Native Grok login screen missing');
  const launch = JSON.parse(fs.readFileSync(path.join(out, 'native-launch.json')));
  assert(worker.sessionId && worker.sessionId === launch.session);
  assert.equal(report.authenticated_hooks.length, 0, 'Credential-free startup must remain before session hooks');
  report.startup_verified = true;
  report.outcome = 'login_required';
  report.native_login_screen_verified = true;
  report.launch_session_id_preserved = true;
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await stop(); } catch { report.status = 'failed'; report.cleanup_completed = false; process.exitCode = 1; }
  save();
}
