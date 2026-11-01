// Native Office PTY -> Grok: startup-only or one explicitly approved fixture.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { oneGrokTask } from './grok_work_policy.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
assert(out?.startsWith(lab + '/runs/'));
const workspace = path.join(out, 'workspace');
const plan = JSON.parse(fs.readFileSync(path.join(out, 'task-plan.json')));
const nativeModel = session => {
  const log=path.join(workspace,'.agent-office/grok-home/logs/unified.jsonl');
  if (!fs.existsSync(log) || fs.statSync(log).size>5*1024*1024) return undefined;
  let model;
  for (const line of fs.readFileSync(log,'utf8').split('\n')) {
    let row; try {row=JSON.parse(line);} catch {continue;}
    if(row.ver==='1.0.70' && row.sid===session && row.msg==='model changed') model=row.ctx?.model;
  }
  return model;
};
const events = () => fs.existsSync(path.join(out,'task-events.jsonl')) ? fs.readFileSync(path.join(out,'task-events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

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
    if (events().some(e => e.allowed === false)) throw new Error('Native boundary or task failure');
    if (check()) return;
    if (worker?.status === 'exited') throw new Error('Native Grok failed');
    await sleep(100);
  }
  throw new Error(reason);
}
async function stop() {
  if (closing) return closing;
  closing = (async () => {
    fs.writeFileSync(path.join(out,'cleanup-started'),'true');
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
    '--agent', path.join(lab, 'scripts/grok-work/grok')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    oneGrokTask(floor, plan.model, plan.prompt ?? undefined);
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
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'grok', model: plan.model, prompt: plan.prompt ?? undefined, worktree: false }));
  if (plan.allow_remote) {
    await until(() => worker?.status === 'done' && events().some(e => e.event === 'Stop'), Math.max(0,plan.deadline*1000-Date.now()), 'Native task did not complete');
    const recorded=events();
    const state=JSON.parse(fs.readFileSync(path.join(out,'boundary-state.json')));
    assert(!state.failed && state.prompts===1 && nativeModel(worker.sessionId)===plan.model && state.stop && Object.keys(state.pending ?? {}).length===0);
    assert(state.calls.length>=3 && state.calls.length<=4 && state.edited);
    assert.deepEqual([...state.completed].sort(),[...state.calls].sort());
    assert(recorded.every(e => e.session===worker.sessionId));
    assert(report.authenticated_hooks.some(e=>e.event==='Stop' && e.session===worker.sessionId));
    const target=path.join(workspace,'result.json');
    assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink() && fs.realpathSync(target)===target && fs.statSync(target).size<=4096);
    const artifact=fs.readFileSync(target);const input=JSON.parse(fs.readFileSync(path.join(workspace,'input.json')));
    assert.deepEqual(JSON.parse(artifact),{marker:input.marker,total:25});
    report.artifact_sha256=createHash('sha256').update(artifact).digest('hex');
    report.task_completed=true;report.model_inference_verified=true;report.native_stop_verified=true;
  } else {
    await until(() => events().some(e=>e.event==='SessionStart' && e.allowed && nativeModel(e.session)===plan.model),35000,'Authenticated native session missing');
    assert(!events().some(e=>e.event==='UserPromptSubmit' || e.event==='PreToolUse'));
    report.startup_verified=true;report.outcome='authenticated_session_without_prompt';
  }
  assert(report.authenticated_hooks.some(e=>e.event==='SessionStart' && e.session===worker.sessionId));
  report.session_hook_verified=true;report.model=plan.model;report.native_model_selection_verified=true;
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await stop(); } catch { report.status = 'failed'; report.cleanup_completed = false; process.exitCode = 1; }
  save();
}
