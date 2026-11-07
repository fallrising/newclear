import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import questionCheck from './pi_question_check.mjs';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = path.join(lab, 'runs');
fs.mkdirSync(runs, { recursive: true, mode: 0o700 });

function setup(values = [false, true, false]) {
  const out = fs.mkdtempSync(path.join(runs, 'question-test-'));
  const workspace = path.join(out, 'workspace');
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const old = { ...process.env }; const cwd = process.cwd();
  process.env.LAB_PI_QUESTION_MODE = '1';
  process.env.LAB_PI_QUESTION_NONCE = '0123456789abcdef0123456789abcdef';
  process.env.LAB_PI_OUT = out;
  process.env.LAB_PI_WORKSPACE = workspace;
  process.chdir(workspace);
  const handlers = new Map();
  let command;
  const pi = { on: (name, fn) => handlers.set(name, fn), registerCommand: (name, spec) => { command = { name, spec }; } };
  questionCheck(pi);
  let i = 0;
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => 'session-1' }, model: { provider: 'deepseek', id: 'deepseek-flash' },
    ui: { confirm: async () => values[i++] } };
  const cleanup = () => { process.chdir(cwd); process.env = old; fs.rmSync(out, { recursive: true, force: true }); };
  return { out, handlers, command, ctx, cleanup, get calls() { return i; } };
}

function readEvents(out) {
  return fs.readFileSync(path.join(out, 'question-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
}

test('false true false writes one allow marker', async () => {
  const t = setup([false, true, false]);
  try {
    assert.equal(t.command.name, 'lab-office-question');
    await t.command.spec.handler([], t.ctx);
    const marker = JSON.parse(fs.readFileSync(path.join(t.out, 'question/allow-marker.json'), 'utf8'));
    assert.deepEqual(marker, { schema: 'lab.pi.question.v1', session: 'session-1', index: 1, nonce: process.env.LAB_PI_QUESTION_NONCE });
    const events = readEvents(t.out);
    assert.equal(events.filter(e => e.type === 'marker_written').length, 1);
    assert.deepEqual(events.filter(e => e.type === 'confirm_result').map(e => e.ui), [false, true, false]);
    assert.equal(events.at(-1).type, 'command_complete');
  } finally { t.cleanup(); }
});

test('unexpected acceptance at deny step aborts before any marker', async () => {
  const t = setup([true, true, true]);
  try {
    await assert.rejects(() => t.command.spec.handler([], t.ctx), /unexpected question responses/);
    const events = readEvents(t.out);
    assert.deepEqual(events.filter(e => e.type === 'marker_written'), []);
    assert.equal(fs.readdirSync(path.join(t.out, 'question')).length, 0);
  } finally { t.cleanup(); }
});

test('existing marker causes exclusive create failure', async () => {
  const t = setup([false, true, false]);
  try {
    fs.mkdirSync(path.join(t.out, 'question'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(t.out, 'question/allow-marker.json'), '{}', { mode: 0o600 });
    await assert.rejects(() => t.command.spec.handler([], t.ctx));
  } finally { t.cleanup(); }
});

test('missing env rejects extension activation', () => {
  const old = { ...process.env }; const cwd = process.cwd();
  delete process.env.LAB_PI_QUESTION_MODE;
  assert.throws(() => questionCheck({ on() {}, registerCommand() {} }), /question mode disabled/);
  process.env = old;
});

test('provider request detector throws and records diagnostic event', () => {
  const t = setup();
  try {
    assert.throws(() => t.handlers.get('before_provider_request')({}, t.ctx), /must not request/);
    assert.equal(readEvents(t.out).find(e => e.type === 'provider_request_attempt').session, 'session-1');
  } finally { t.cleanup(); }
});

test('second command is rejected without reopening dialogs', async () => {
  const t = setup([false, true, false, true]);
  try {
    await t.command.spec.handler([], t.ctx);
    await t.command.spec.handler([], t.ctx);
    assert.equal(t.calls, 3);
    assert.equal(readEvents(t.out).filter(e => e.type === 'command_rejected').length, 1);
  } finally { t.cleanup(); }
});


test('malformed boolean response aborts without marker', async () => {
  const t = setup([0, true, false]);
  try {
    await assert.rejects(() => t.command.spec.handler([], t.ctx), /response type/);
    assert(!fs.existsSync(path.join(t.out, 'question/allow-marker.json')));
  } finally { t.cleanup(); }
});

test('command arguments and missing UI reject without opening dialogs', async () => {
  for (const args of ['unexpected', []]) {
    const t = setup();
    try {
      if (Array.isArray(args)) {
        t.ctx.hasUI = false;
        await assert.rejects(() => t.command.spec.handler(args, t.ctx), /UI unavailable/);
      } else await t.command.spec.handler(args, t.ctx);
      assert.equal(t.calls, 0);
      assert(!fs.existsSync(path.join(t.out, 'question/allow-marker.json')));
    } finally { t.cleanup(); }
  }
});

test('event symlink and question directory symlink are rejected', async () => {
  for (const name of ['question-events.jsonl', 'question']) {
    const t = setup();
    try {
      fs.symlinkSync(path.join(t.out, 'workspace'), path.join(t.out, name));
      await assert.rejects(() => t.command.spec.handler([], t.ctx));
      assert.equal(t.calls, 0);
      assert(!fs.existsSync(path.join(t.out, 'workspace/allow-marker.json')));
    } finally { t.cleanup(); }
  }
});
