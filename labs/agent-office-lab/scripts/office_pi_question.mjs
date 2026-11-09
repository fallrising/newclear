// Native Office/Pi confirm UI lifecycle harness. No prompt and no model request.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { onePiTask } from './pi_office_policy.mjs';
import { probePiHooks } from './pi_hook_probe.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
assert.equal(argv.length, 2);
const [out, flag] = argv;
assert.equal(flag, '--check-question');
assert(out?.startsWith(lab + '/runs/'));
const workspace = path.join(out, 'workspace');
const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const WebSocket = require('ws');
const report = { status: 'starting', provider: 'pi', model: 'deepseek/deepseek-flash',
  cloud_fallback: false, model_inference_verified: false, input_path: 'office_ws_terminal_input',
  question_responses: [], question_prompt_starts: 0, question_prompt_ends: 0,
  marker_written_after_allow: false, native_question_verified: false,
  provider_request_detector_installed: false, same_session_verified: false,
  denial_preserved_workspace: false, replay_rejected: false, states: [], authenticated_hooks: [] };
const save = () => fs.writeFileSync(path.join(out, 'office-result.json'), JSON.stringify(report, null, 2) + '\n');
let office, ws, worker, closing;
const hookTokens = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventPath = path.join(out, 'question-events.jsonl');
const piEventPath = path.join(out, 'pi-events.jsonl');
const markerPath = path.join(out, 'question', 'allow-marker.json');
const workspaceResult = path.join(workspace, 'result.json');
const events = () => fs.existsSync(eventPath) ? fs.readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
const piEvents = () => fs.existsSync(piEventPath) ? fs.readFileSync(piEventPath, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
async function until(check, ms, reason) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (worker?.status === 'exited') throw new Error('Native Pi exited');
    if (events().some(e => e.type === 'provider_request_attempt')) throw new Error('Provider request attempted');
    if (check()) return;
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
function sendInput(data) {
  assert(worker?.id, 'worker id missing');
  ws.send(JSON.stringify({ t: 'term.input', workerId: worker.id, data }));
}
function questionHooks(type) {
  return report.authenticated_hooks.filter(e => type === 'ui_prompt_start' ? e.type === 'question' && e.status === 'needs_input' : e.type === 'session' && ['done', 'working'].includes(e.status));
}
async function answer(index, input, key) {
  await until(() => events().some(e => e.type === 'confirm_start' && e.index === index) && questionHooks('ui_prompt_start').length === index + 1 && worker?.status === 'needs_input',
    15000, `confirm ${index} did not start`);
  report.question_states ??= [];
  report.question_states.push({ index, status: worker.status });
  if (key !== null) sendInput(key);
  await until(() => events().some(e => e.type === 'confirm_result' && e.index === index),
    index === 2 ? 7000 : 15000, `confirm ${index} did not finish`);
  const result = events().find(e => e.type === 'confirm_result' && e.index === index);
  report.question_responses.push({ index, input, ui_result: result.ui === true });
  if (index === 0) {
    assert.equal(result.ui, false);
    assert(!fs.existsSync(markerPath));
    assert(!fs.existsSync(workspaceResult));
    report.denial_preserved_workspace = true;
  }
  if (index === 1) {
    assert.equal(result.ui, true);
    await until(() => fs.existsSync(markerPath) && events().some(e => e.type === 'marker_written' && e.index === 1), 5000, 'allow marker missing');
  }
  if (index === 2) assert.equal(result.ui, false);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { report.status = 'interrupted'; void stop().then(() => process.exit(1)); });
try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(lab, 'vendor/agent-office'), encoding: 'utf8' }).trim(), '852e2ab28c4f3f31bffdf4b20353bd119c9d3270');
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Lab fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic Pi question fixture']);
  const { loadConfig } = await import('../vendor/agent-office/dist/server/server/config.js');
  const { startServer } = await import('../vendor/agent-office/dist/server/server/server.js');
  const password = randomBytes(24).toString('base64url');
  const cfg = loadConfig([workspace, '--home', path.join(out, 'office-home'), '--projects', path.join(out, 'projects'),
    '--host', '127.0.0.1', '--no-open', '--max-workers', '1', '--webhook', '', '--password', password,
    '--agent', path.join(lab, 'scripts/bin/pi')]);
  cfg.port = 0;
  office = await startServer(cfg);
  for (const floor of office.floors()) {
    onePiTask(floor, { allowReconnect: false });
    const native = floor.workers.handleProviderHook.bind(floor.workers);
    floor.workers.handleProviderHook = (route, id, token, event, payload) => {
      const accepted = native(route, id, token, event, payload);
      if (route === 'pi' && accepted) {
        hookTokens.add(token);
        const hook = { type: payload.type, status: payload.status, session: payload.sessionId };
        report.authenticated_hooks.push(hook);
        if (payload.type === 'question' && payload.status === 'needs_input') report.question_prompt_starts += 1;
        if (payload.type === 'session' && ['done', 'working'].includes(payload.status)) report.question_prompt_ends += 1;
      }
      return accepted;
    };
  }
  const base = `http://127.0.0.1:${office.server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  ws = new WebSocket(base.replace('http', 'ws') + '/ws?name=Lab&lite=1', { headers: { cookie: login.headers.get('set-cookie').split(';')[0], origin: base } });
  let welcomed = false, attached = false;
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome') welcomed = true;
    if (msg.t === 'term.snapshot') attached = true;
    if (msg.t === 'worker.update') {
      worker = msg.worker;
      if (report.states.at(-1) !== worker.status) report.states.push(worker.status);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => welcomed, 10000, 'Office welcome missing');
  ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', provider: 'pi', model: report.model, worktree: false }));
  await until(() => worker?.status === 'idle' && piEvents().some(e => e.type === 'session_start') && report.authenticated_hooks.some(e => e.type === 'session' && e.status === 'starting'),
    30000, 'Native Pi idle session did not start');
  report.session_id = worker.sessionId;
  assert(Number.isInteger(office.hookPort) && office.hookPort > 0);
  report.hook_boundary = await probePiHooks({ port: office.hookPort, manager: office.floors()[0].workers, workerId: worker.id, acceptedCount: () => report.authenticated_hooks.length });
  ws.send(JSON.stringify({ t: 'worker.attach', workerId: worker.id }));
  await until(() => attached, 10000, 'Terminal attach missing');
  sendInput('/lab-office-question\r');
  await answer(0, 'deny', '\u001b');
  await answer(1, 'allow', '\r');
  const markerBytes = fs.readFileSync(markerPath);
  assert.deepEqual(JSON.parse(markerBytes), {schema: 'lab.pi.question.v1', session: report.session_id, index: 1, nonce: process.env.LAB_PI_QUESTION_NONCE});
  const markerHash = createHash('sha256').update(markerBytes).digest('hex');
  await answer(2, 'timeout', null);
  await until(() => events().some(e => e.type === 'command_complete'), 5000, 'question command did not complete');
  assert.equal(createHash('sha256').update(fs.readFileSync(markerPath)).digest('hex'), markerHash);
  sendInput('/lab-office-question\r');
  await until(() => events().filter(e => e.type === 'command_rejected').length === 1, 5000, 'replay was not rejected');
  await sleep(1000);
  assert.equal(events().filter(e => e.type === 'confirm_start').length, 3);
  assert.equal(createHash('sha256').update(fs.readFileSync(markerPath)).digest('hex'), markerHash);
  const recorded = events();
  const piRecorded = piEvents();
  assert(recorded.every(e => e.session === report.session_id && e.provider === 'deepseek' && e.model === 'deepseek-flash'));
  assert(piRecorded.every(e => e.session === report.session_id && e.provider === 'deepseek' && e.model === 'deepseek-flash'));
  assert(report.authenticated_hooks.every(e => e.session === report.session_id));
  assert.equal(hookTokens.size, 1);
  assert.deepEqual(recorded.filter(e => e.type === 'confirm_result').map(e => e.ui), [false, true, false]);
  assert(!recorded.some(e => e.type === 'provider_request_attempt'));
  assert(!piRecorded.some(e => ['prompt', 'tool_call', 'assistant_end'].includes(e.type)));
  assert(!report.authenticated_hooks.some(e => e.type === 'prompt'));
  assert(!fs.existsSync(workspaceResult));
  assert.equal(report.question_prompt_starts, 3);
  assert.equal(report.question_prompt_ends, 3);
  report.marker_sha256 = markerHash;
  report.marker_written_after_allow = true;
  report.provider_request_detector_installed = recorded.some(e => e.type === 'detector_installed');
  report.same_session_verified = true;
  report.replay_rejected = true;
  report.native_question_verified = true;
  report.status = 'question_verified';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try { await stop(); } catch { report.status = 'failed'; report.cleanup_completed = false; process.exitCode = 1; }
  save();
}
process.exit(process.exitCode || 0);
