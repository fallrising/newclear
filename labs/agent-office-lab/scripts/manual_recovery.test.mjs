import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RecoveryJournal, ResumeContinuation, installManualRecovery } from './manual_recovery.mjs';
const model = 'strata/local-test';
function setup(t, status = 'working', cleanup = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-recovery-'));
  if (cleanup) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = { info: { id: 'fixture', kind: 'agent', provider: 'opencode', model, status, sessionId: 'session', task: { name: 'Task', summary: 'Original task' } } };
  const map = new Map([['fixture', worker]]);
  const file = path.join(dir, 'lab-recovery.json');
  return { dir, worker, map, file, journal: new RecoveryJournal(file) };
}
for (const status of ['working', 'needs_input', 'starting']) test(`${status} remains interrupted across repeated restarts`, t => {
  const s = setup(t, status); s.journal.capture(s.map);
  for (let i = 0; i < 3; i++) {
    const journal = new RecoveryJournal(s.file); journal.restore(s.worker); journal.capture(s.map);
    assert.equal(s.worker.info.status, 'offline'); assert.equal(s.worker.info.labTaskState, 'interrupted');
    assert.match(s.worker.info.task.summary, /interrupted/);
    assert.equal(journal.records.get('fixture').task.summary, 'Original task');
  }
});
test('completed work is not relabelled interrupted or replayed', t => {
  const s = setup(t, 'done'); s.journal.capture(s.map, true);
  new RecoveryJournal(s.file).restore(s.worker);
  assert.equal(s.worker.info.labTaskState, 'completed'); assert.equal(s.worker.interrupted, false);
});
test('graceful shutdown records unfinished work before native stopping clears it', t => {
  const s = setup(t, 'needs_input'); s.journal.capture(s.map, true);
  assert.equal(JSON.parse(readFileSync(s.file)).workers[0].state, 'interrupted');
});
test('malformed and duplicate journal records fail closed', t => {
  const s = setup(t);
  for (const body of ['{', JSON.stringify({ version: 1, workers: [{ id: 'x', state: 'surprise' }] }), JSON.stringify({ version: 1, workers: [{ id: 'x', state: 'idle' }, { id: 'x', state: 'idle' }] })]) {
    writeFileSync(s.file, body); assert.throws(() => new RecoveryJournal(s.file)); assert.equal(readFileSync(s.file, 'utf8'), body);
  }
});
function manager(t) {
  const s = setup(t, 'working', false); s.journal.capture(s.map); s.worker.info.status = 'offline'; s.worker.saved = { ptyId: 'owned-pty' };
  let exited;
  class Manager {
    constructor() {
      this.dir = s.dir; this.statePath = path.join(s.dir, 'workers.json'); this.workers = s.map;
      this.host = { attach: async () => ({ pty: { onExit(fn) { exited = fn; }, kill() { queueMicrotask(exited); } } }) };
      this.launches = 0; this.events = { toast() {} };
    }
    async start() { this.adopted = await this.host.attach('owned-pty'); this.wakeAll(); }
    wakeAll() { this.resume('fixture'); }
    persist() {}
    shutdown() { this.closed = true; this.persist(); }
    emitUpdate() {}
    handleProviderHook() { return true; }
    checkBlocked() {}
    prompt() {}
    resume(id) { this.launches++; this.workers.get(id).info.status = 'idle'; }
  }
  installManualRecovery(Manager, s.dir, model);
  const instance = new Manager(); t.after(() => { try { instance.shutdown(); } finally { rmSync(s.dir, { recursive: true, force: true }); } });
  return { ...s, manager: instance };
}
test('startup stops the old PTY without adopting or waking; manual resume retains session', async t => {
  const s = manager(t); await s.manager.start();
  assert.equal(s.manager.adopted, undefined); assert.equal(s.manager.launches, 0);
  assert.equal(s.worker.info.labTaskState, 'interrupted');
  assert.equal(s.manager.resume('fixture'), undefined); assert.equal(s.manager.launches, 1);
  assert.equal(s.worker.info.sessionId, 'session'); assert.equal(s.worker.info.task.summary, 'Original task');
});
test('native terminal-host lost callback cannot automatically resume active work', async t => {
  const s = manager(t); await s.manager.start(); s.worker.info.status = 'working';
  assert.match(s.manager.resume('fixture'), /manually/); assert.equal(s.manager.launches, 0);
  assert.equal(s.worker.info.status, 'offline'); assert.equal(s.worker.info.labTaskState, 'interrupted');
});
test('restored remote providers and missing sessions cannot launch', async t => {
  const s = manager(t); await s.manager.start(); s.worker.info.provider = 'cloud';
  assert.match(s.manager.resume('fixture'), /Only the local/);
  s.worker.info.provider = 'opencode'; delete s.worker.info.sessionId;
  assert.match(s.manager.resume('fixture'), /no saved session/); assert.equal(s.manager.launches, 0);
});

function continuation(t) {
  const s = setup(t, 'idle'); const sent = [];
  const gate = new ResumeContinuation((id, text) => { sent.push({ id, text }); }, () => assert.fail('unexpected continuation failure'));
  t.after(() => gate.clear());
  s.worker.pty = {};
  let screen = '';
  s.worker.term = { rows: 1, buffer: { active: { type: 'alternate', baseY: 0, getLine: () => ({ translateToString: () => screen }) } } };
  gate.queue(s.worker, 'continue fixture');
  return { ...s, gate, sent, screen(value) { screen = value; gate.screen(s.worker); } };
}
test('manual continuation waits for authenticated same-session history and a fresh ready TUI, once', t => {
  const s = continuation(t); s.screen('Qwen3.8 ctrl+p');
  s.gate.hook(s.worker, { type: 'usage', sessionId: 'session' }, false);
  s.gate.hook(s.worker, { type: 'usage', sessionId: 'other' }, true);
  assert.equal(s.sent.length, 0);
  s.screen('loading'); s.gate.hook(s.worker, { type: 'usage', sessionId: 'session' }, true);
  assert.equal(s.sent.length, 0);
  s.screen('Qwen3.8 ctrl+p Permission required'); assert.equal(s.sent.length, 0);
  s.screen('Qwen3.8 ctrl+p'); s.screen('Qwen3.8 ctrl+p');
  assert.deepEqual(s.sent, [{ id: 'fixture', text: 'continue fixture' }]);
});
test('another native action or session switch cancels queued continuation', t => {
  const s = continuation(t);
  s.gate.hook(s.worker, { status: 'working', sessionId: 'session' }, true);
  s.screen('Qwen3.8 ctrl+p'); s.gate.hook(s.worker, { type: 'usage', sessionId: 'session' }, true);
  assert.equal(s.sent.length, 0);
  s.gate.queue(s.worker, 'continue'); s.worker.info.sessionId = 'other';
  s.gate.hook(s.worker, { type: 'usage', sessionId: 'session' }, true);
  assert.equal(s.sent.length, 0); assert.equal(s.gate.pending.size, 0);
});
