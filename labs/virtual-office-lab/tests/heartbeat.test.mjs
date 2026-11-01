import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../bin/office-run.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  return {callback: null, cleared: false,
    setInterval(fn, ms) { assert.equal(ms, 300000); this.callback = fn; return 1; },
    clearInterval(id) { assert.equal(id, 1); this.cleared = true; }};
}
test('slow heartbeat stays single-flight and final report waits', async () => {
  const timer = clock(); const states = []; let releaseHeartbeat; let finish;
  const result = run(['content', '--', 'unused'], {}, async args => {
    states.push(args[1]);
    if (states.length === 2) await new Promise(resolve => { releaseHeartbeat = resolve; });
  }, () => new Promise(resolve => { finish = resolve; }), timer);
  await tick(); timer.callback(); await tick(); timer.callback(); await tick();
  assert.deepEqual(states, ['terminal', 'terminal']);
  finish(0); await tick();
  assert.equal(timer.cleared, true);
  assert.deepEqual(states, ['terminal', 'terminal']);
  releaseHeartbeat();
  assert.deepEqual(await result, {exitCode: 0, reported: true, started: true});
  assert.deepEqual(states, ['terminal', 'terminal', 'done']);
});
test('failed heartbeat is visible, later heartbeat can recover, command never restarts', async () => {
  const timer = clock(); let count = 0; let launches = 0; let finish;
  const result = run(['content', '--', 'unused'], {}, async () => {
    if (++count === 2) throw new Error('offline');
  }, () => { launches++; return new Promise(resolve => { finish = resolve; }); }, timer);
  await tick(); timer.callback(); await tick(); timer.callback(); await tick(); finish(0);
  assert.deepEqual(await result, {exitCode: 0, reported: true, started: true, heartbeatFailed: true});
  assert.equal(count, 4); assert.equal(launches, 1); assert.equal(timer.cleared, true);
});
test('heartbeat and final report failure return nonzero', async () => {
  const timer = clock(); let count = 0; let finish;
  const result = run(['content', '--', 'unused'], {}, async () => {
    if (++count > 1) throw new Error('offline');
  }, () => new Promise(resolve => { finish = resolve; }), timer);
  await tick(); timer.callback(); await tick(); finish(0);
  assert.deepEqual(await result, {exitCode: 125, reported: false, started: true});
});
test('launch rejection clears heartbeat and reports error', async () => {
  const timer = clock(); const states = [];
  const result = await run(['content', '--', 'unused'], {}, async args => states.push(args[1]), async () => { throw new Error('spawn'); }, timer);
  assert.equal(result.exitCode, 127); assert.equal(timer.cleared, true);
  assert.deepEqual(states, ['terminal', 'error']);
});
