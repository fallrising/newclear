import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { observeStableHandles } from './geometry.mjs';
function environment(moving = false, occluded = false) {
  let frame = 0;
  const handle = { getBoundingClientRect: () => ({ x: moving ? frame : 20, y: 30, width: 8, height: 8 }), contains: (hit) => hit === handle, closest: () => null, getAttribute: () => 'out', tagName: 'DIV' };
  const document = { querySelector: (selector) => selector.includes('viewport') ? { getAttribute: () => `transform:${moving ? frame : 1}` } : handle, querySelectorAll: () => [], elementFromPoint: () => occluded ? null : handle };
  return vm.createContext({ document, window: { __LOOM_REVIEW__: { exportSeed: () => ({ canvas: { edges: [] } }), snapshot: () => ({ counts: { canvas_write: 1 } }) } }, requestAnimationFrame: (callback) => { frame++; queueMicrotask(callback); } });
}
test('geometry observer requires successive actual frames and reports occlusion without changing DOM', async () => {
  const stable = await vm.runInContext(`(${observeStableHandles.toString()})()`, environment());
  assert.equal(stable.stable, true); assert.equal(stable.stableFrames, 3); assert.equal(stable.frames, 4);
  const covered = await vm.runInContext(`(${observeStableHandles.toString()})()`, environment(false, true));
  assert.equal(covered.stable, true); assert.equal(covered.last.source.centerHit, false);
});
test('continually moving geometry reaches its bounded failure rather than claiming stable coordinates', async () => {
  const result = await vm.runInContext(`(${observeStableHandles.toString()})()`, environment(true));
  assert.equal(result.stable, false); assert.equal(result.frames, 90);
});
