// Native Office PTY -> Pi -> bounded relay. No mock provider states.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { onePiTask } from './pi_office_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
assert(out?.startsWith(lab + '/runs/'));
const workspace = path.join(out, 'workspace');
const startup = process.argv.includes('--check-startup');
const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
const report = { status: 'starting', provider: 'pi', model: 'deepseek/deepseek-flash',
  cloud_fallback: false, model_inference_verified: false, states: [], authenticated_hooks: [] };
const save = () => fs.writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
let office, ws, worker, closing;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = () => fs.existsSync(path.join(out, 'pi-events.jsonl')) ? fs.readFileSync(path.join(out, 'pi-events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
async function until(check, ms, reason) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    if (worker?.status === 'exited' || events().some(e => e.type === 'assistant_end' && ['error', 'aborted', 'length'].includes(e.stopReason))) throw new Error('Native Pi failed');
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
    assert(owned.every(gone), 'Owned Pi process survived shutdown');
    report.cleanup_completed = true; save();
  })();
  return closing;
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { report.status = 'interrupted'; void stop().then(() => process.exit(1)); });
try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(lab, 'vendor/agent-office'), encoding: 'utf8' }).trim(), '852e2ab28c4f3f31bffdf4b20353bd119c9d3270');
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic Pi fixture']);
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'), '--projects', path.join(out, 'projects'),
    '--host', '127.0.0.1', '--no-open', '--max-workers', '1', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/pi')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    onePiTask(floor);
    const native = floor.workers.handleProviderHook.bind(floor.workers);
    floor.workers.handleProviderHook = (route, id, token, event, payload) => {
      const accepted = native(route, id, token, event, payload);
      if (route === 'pi' && accepted) report.authenticated_hooks.push({ type: payload.type, status: payload.status, session: payload.sessionId });
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
  const prompt = startup ? undefined : 'Read input.json using read. Write result.json using write with exactly {"marker": the input marker, "total": the sum of input values}. Do not use other paths or tools. Then briefly confirm completion.';
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'pi', model: report.model, prompt, worktree: false }));
  await until(() => worker && events().some(e => e.type === 'session_start') && report.authenticated_hooks.some(e => e.type === 'session' && e.status === 'starting'), 30000, 'Native Pi session did not start');
  report.startup_verified = true;
  assert(worker.sessionId);
  if (!startup) {
    await until(() => worker.status === 'done' && events().some(e => e.type === 'agent_settled'), 150000, 'Native Pi did not settle');
    const recorded = events();
    assert(recorded.every(e => e.session === worker.sessionId && e.provider === 'deepseek' && e.model === 'deepseek-flash'));
    assert(recorded.some(e => e.type === 'tool_call' && e.tool === 'read' && e.allowed));
    assert(recorded.some(e => e.type === 'tool_call' && e.tool === 'write' && e.allowed));
    assert(!recorded.some(e => e.allowed === false));
    assert(recorded.some(e => e.type === 'assistant_end' && e.output > 0));
    const target = path.join(workspace, 'result.json');
    assert(!fs.lstatSync(target).isSymbolicLink() && fs.realpathSync(target) === target && fs.statSync(target).size < 4096);
    const artifact = fs.readFileSync(target);
    const input = JSON.parse(fs.readFileSync(path.join(workspace, 'input.json')));
    assert.deepEqual(JSON.parse(artifact), { marker: input.marker, total: input.values.reduce((a, b) => a + b, 0) });
    report.artifact_sha256 = createHash('sha256').update(artifact).digest('hex');
    report.file_task_passed = true; report.agent_settled_verified = true;
  }
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await stop(); } catch { report.status = 'failed'; report.cleanup_completed = false; process.exitCode = 1; }
  save();
}
