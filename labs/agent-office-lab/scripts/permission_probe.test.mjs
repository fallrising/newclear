import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionProbe, observePermissions } from './permission_probe.mjs';
const worker = { id: 'fixture-worker', sessionId: 'fixture-session', status: 'needs_input' };
const asked = { type: 'permission', status: 'needs_input', detail: 'edit', sessionId: worker.sessionId };
const frame = { t: 'screen', workerId: worker.id, full: true, lines: { 0: [['Permission required']], 1: [['Allow once Allow always Reject']] } };
function prompt() { const p = new PermissionProbe(); p.hook(worker.id, asked, true); p.screen(frame); return p; }
test('observes the HTTP router generic hook after native authentication, preserving all arguments', () => {
  const calls = []; const probe = new PermissionProbe(); const failures = [];
  const manager = { handleProviderHook(...args) { calls.push(args); return args[2] === 'fixture-token'; } };
  observePermissions(manager, probe, error => failures.push(error));
  assert.equal(manager.handleProviderHook('opencode', worker.id, 'wrong', '', asked), false);
  assert.equal(probe.requests.length, 0);
  manager.handleProviderHook('pi', worker.id, 'fixture-token', '', asked);
  assert.equal(probe.requests.length, 0);
  assert.equal(manager.handleProviderHook('opencode', worker.id, 'fixture-token', '', asked), true);
  assert.equal(probe.requests.length, 1);
  assert.deepEqual(calls.at(-1), ['opencode', worker.id, 'fixture-token', '', asked]);
  assert.deepEqual(failures, []);
});
test('requires an accepted native permission hook and the actual terminal prompt', () => {
  const p = new PermissionProbe(); p.screen(frame); p.hook(worker.id, asked, false);
  assert.equal(p.ready(worker), false);
  p.hook(worker.id, asked, true); assert.equal(p.ready(worker), true);
  p.screen({ ...frame, lines: {} }); assert.equal(p.ready(worker), false);
});
test('does not answer a foreign worker, session or nonwaiting state', () => {
  const p = prompt();
  for (const change of [{ id: 'other' }, { sessionId: 'other' }, { status: 'working' }]) assert.equal(p.ready({ ...worker, ...change }), false);
});
test('one PTY reply per request and matching continuation required', () => {
  const p = prompt(); assert.deepEqual(p.reply(worker), { t: 'term.input', workerId: worker.id, data: '\r' });
  assert.throws(() => p.reply(worker));
  p.hook('other', { ...asked, type: 'session', status: 'working' }, true); assert(p.pending);
  p.hook(worker.id, { ...asked, type: 'session', status: 'working' }, true);
  assert.deepEqual(p.summary(), [{ kind: 'edit', replied: true, continued: true }]);
});
test('unexpected requests, overlap and advance before reply fail closed', () => {
  assert.throws(() => prompt().hook(worker.id, asked, true), /Overlapping/);
  assert.throws(() => new PermissionProbe().hook(worker.id, { ...asked, detail: 'external_directory' }, true), /Unexpected/);
  assert.throws(() => prompt().hook(worker.id, { ...asked, type: 'session', status: 'working' }, true), /before/);
});
test('provider errors cannot count as permission replies', () => {
  assert.throws(() => prompt().hook(worker.id, { ...asked, type: 'error' }, true), /error/);
});
test('records only accepted usage snapshots for resumed-session readiness', () => {
  const p = new PermissionProbe();
  const usage = { type: 'usage', sessionId: worker.sessionId, usage: { output: 123 } };
  p.hook(worker.id, usage, false); assert.deepEqual(p.usageEvents, []);
  p.hook(worker.id, usage, true);
  assert.deepEqual(p.usageEvents, [{ workerId: worker.id, sessionId: worker.sessionId, output: 123 }]);
  assert.equal(p.pending, undefined);
});
