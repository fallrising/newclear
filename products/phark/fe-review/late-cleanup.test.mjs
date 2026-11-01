import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireOwned, boundedOperation, cleanupStages} from './guards.mjs';

test('cancelled launch acquired later remains owned and is closed during cleanup', async () => {
  let deliver; let owned; let cancelled = false; let closed = false;
  const acquisition = new Promise(resolve => {deliver = resolve;});
  const running = acquireOwned(() => acquisition, resource => {owned = resource;}, () => cancelled);
  const observed = running.then(() => ({ok: true}), error => ({error}));
  cancelled = true;
  deliver({close: async () => {closed = true;}});
  const outcome = await observed;
  assert.equal(outcome.error.message, 'REVIEW_INTERRUPTED');
  const cleanup = await cleanupStages([['browser', () => boundedOperation(() => owned.close(), 100)]]);
  assert(closed); assert(cleanup[0].passed);
});
test('stalled close times out and later cleanup still executes; late reject is handled', async () => {
  let fail; let serverStopped = false;
  const stalled = new Promise((_, reject) => {fail = reject;});
  const cleanup = await cleanupStages([['browser', () => boundedOperation(() => stalled, 5)], ['server', async () => {serverStopped = true;}] ]);
  fail(Error('late synthetic rejection'));
  await new Promise(resolve => setImmediate(resolve));
  assert(serverStopped); assert.deepEqual(cleanup, [{name: 'browser', passed: false}, {name: 'server', passed: true}]);
});
