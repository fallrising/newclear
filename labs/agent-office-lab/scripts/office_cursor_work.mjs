// One native Office/Cursor fixture or an authenticated offline startup.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { oneCursorTask } from './cursor_work_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
assert(out?.startsWith(lab + '/runs/'));
const workspace = path.join(out, 'workspace');
const plan = JSON.parse(fs.readFileSync(path.join(out, 'task-plan.json')));
const events = () => fs.existsSync(path.join(out, 'task-events.jsonl')) ? fs.readFileSync(path.join(out, 'task-events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
const report = { status: 'starting', provider: 'cursor',
  cloud_fallback: false, model_inference_verified: false, task_completed: false, session_hook_verified: false, states: [], authenticated_hooks: [] };
const save = () => fs.writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
let office, ws, worker, closing;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, reason) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    if (events().some(e => e.allowed === false || e.failed || (e.event === 'stop' && e.status !== 'completed'))) throw new Error('Cursor boundary or native failure');
    if (worker?.status === 'exited') throw new Error('Native Cursor failed');
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
    assert(owned.every(gone), 'Owned Cursor process survived shutdown');
    const hooks = JSON.parse(fs.readFileSync(path.join(workspace, '.cursor/hooks.json')));
    report.workspace_hooks_removed = !JSON.stringify(hooks).includes('agent-office-cursor-hook.cjs');
    assert(report.workspace_hooks_removed, 'Office Cursor hooks survived shutdown');
    report.cleanup_completed = true; save();
  })();
  return closing;
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { report.status = 'interrupted'; void stop().then(() => process.exit(1)); });
try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(lab, 'vendor/agent-office'), encoding: 'utf8' }).trim(), '852e2ab28c4f3f31bffdf4b20353bd119c9d3270');
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic Cursor fixture']);
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'), '--projects', path.join(out, 'projects'),
    '--host', '127.0.0.1', '--no-open', '--max-workers', '1', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/cursor-task/cursor-agent')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    oneCursorTask(floor, plan.model, plan.prompt ?? undefined);
    const native = floor.workers.handleProviderHook.bind(floor.workers);
    floor.workers.handleProviderHook = (route, id, token, event, payload) => {
      const accepted = native(route, id, token, event, payload);
      if (route === 'cursor' && accepted) report.authenticated_hooks.push({ event, session: payload.conversation_id ?? payload.session_id });
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
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'cursor', model: plan.model, prompt: plan.prompt ?? undefined, worktree: false }));
  if (plan.allow_remote) {
    await until(() => worker?.status === 'done' && events().some(e => e.event === 'stop'), 110000, 'Cursor task did not complete');
    const recorded = events();
    const state = JSON.parse(fs.readFileSync(path.join(out, 'boundary-state.json')));
    assert(!state.failed && state.prompts === 1);
    assert.deepEqual(state.tools, ['Read', 'Write']);
    assert.deepEqual(state.completed_tools, ['Read', 'Write']);
    assert(worker.sessionId && recorded.every(e => e.session === worker.sessionId && e.model === plan.model));
    assert(report.authenticated_hooks.some(e => e.event === 'stop' && e.session === worker.sessionId));
    const stopped = recorded.find(e => e.event === 'stop');
    assert(stopped.status === 'completed' && stopped.loop_count === 0 && stopped.output_tokens > 0);
    const target = path.join(workspace, 'result.json');
    assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink() && fs.realpathSync(target) === target && fs.statSync(target).size < 4096);
    const artifact = fs.readFileSync(target);
    const input = JSON.parse(fs.readFileSync(path.join(workspace, 'input.json')));
    assert.deepEqual(JSON.parse(artifact), { marker: input.marker, total: input.values.reduce((a, b) => a + b, 0) });
    report.artifact_sha256 = createHash('sha256').update(artifact).digest('hex');
    report.native_stop_verified = true; report.session_hook_verified = true;
    report.file_task_passed = true; report.task_completed = true;
    report.model = plan.model; report.input_tokens = stopped.input_tokens; report.output_tokens = stopped.output_tokens;
  } else {
    const ready = () => office.floors().flatMap(f => f.workers.fullScreens()).some(s => {
      if (s.workerId !== worker?.id) return false;
      const text = Object.values(s.frame.lines).map(runs => runs.map(run => run[0]).join('')).join('\n');
      return /Composer 2\.5|composer-2\.5/.test(text) && !/Press any key to log in/i.test(text);
    });
    await until(() => ready() && fs.existsSync(path.join(out, 'native-launch.json')), 35000, 'Authenticated Cursor ready screen missing');
    assert(!events().some(e => ['beforeSubmitPrompt', 'preToolUse', 'afterAgentResponse', 'stop'].includes(e.event)));
    report.startup_verified = true; report.outcome = 'ready_without_prompt';
  }
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await stop(); } catch { report.status = 'failed'; report.cleanup_completed = false; process.exitCode = 1; }
  save();
}
