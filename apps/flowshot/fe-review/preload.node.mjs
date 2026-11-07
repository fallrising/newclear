import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { installFlowshotFixture } from './preload.mjs';

function context() {
  const box = vm.createContext({ document: { readyState: 'loading', querySelector: () => null } });
  vm.runInContext('window = globalThis', box);
  return box;
}
function install(box) { return vm.runInContext(`(${installFlowshotFixture.toString()})()`, box); }
function launch(box) {
  let source = readFileSync(new URL('../src/launch-build-info.ts', import.meta.url), 'utf8');
  source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/generated\/contracts";/, '');
  source = source.replace('export function loadBuildInfoAtLaunch', 'function loadBuildInfoAtLaunch');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let calls = 0;
  box.getBuildInfo = () => { calls++; return Promise.reject(new Error('NATIVE_FORBIDDEN')); };
  vm.runInContext(js, box);
  return { promise: vm.runInContext('loadBuildInfoAtLaunch()', box), nativeCalls: () => calls };
}

test('real eager launch consumes preload pending promise, then exact synthetic DTO', async () => {
  const box = context(); install(box);
  assert.equal(typeof box.__FLOWSHOT_BUILD_INFO_PROMISE__?.then, 'function');
  const loaded = launch(box); let settled = false;
  loaded.promise.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(loaded.nativeCalls(), 0);
  box.__FLOW_REVIEW__.observeLoading(); box.__FLOW_REVIEW__.ready(false);
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.promise)), { version: '0.0.0-review', gitSha: 'synthetic-revision', buildProfile: 'review-only' });
});
test('typed error is controlled after loading and is the existing eager promise rejection', async () => {
  const box = context(); install(box); const loaded = launch(box);
  box.__FLOW_REVIEW__.observeLoading(); box.__FLOW_REVIEW__.error();
  await assert.rejects(loaded.promise, (e) => e.code === 'INTERNAL' && e.retryable === false && e.correlationId === 'synthetic-error');
  assert.equal(loaded.nativeCalls(), 0);
});
test('resolve before observed loading, duplicate settle, late/colliding installation fail closed', () => {
  const box = context(); install(box);
  assert.throws(() => box.__FLOW_REVIEW__.ready(), /LOADING_NOT_OBSERVED/);
  box.__FLOW_REVIEW__.observeLoading(); box.__FLOW_REVIEW__.ready();
  assert.throws(() => box.__FLOW_REVIEW__.error(), /ALREADY_SETTLED/);
  assert.throws(() => install(box), /FIXTURE_COLLISION/);
  const late = context(); late.document.readyState = 'complete';
  assert.throws(() => install(late), /LATE_PRELOAD/);
});
test('fresh contexts do not reuse resolved state and long metadata remains synthetic', async () => {
  const a = context(); install(a); a.__FLOW_REVIEW__.observeLoading(); a.__FLOW_REVIEW__.ready(true);
  assert.ok((await a.__FLOWSHOT_BUILD_INFO_PROMISE__).gitSha.length > 120);
  const b = context(); install(b); assert.equal(b.__FLOW_REVIEW__.snapshot().state, 'loading');
  assert.notEqual(a.__FLOWSHOT_BUILD_INFO_PROMISE__, b.__FLOWSHOT_BUILD_INFO_PROMISE__);
});
test('unknown native invoke refuses with safe code and records no supplied payload', async () => {
  const box = context(); install(box);
  await assert.rejects(box.__TAURI_INTERNALS__.invoke('canary-secret-command', { secret: 'CANARY' }), /NATIVE_FORBIDDEN/);
  assert.equal(box.__FLOW_REVIEW__.snapshot().unknownInvokes, 1);
  assert.equal(JSON.stringify(box.__FLOW_REVIEW__.snapshot()).includes('CANARY'), false);
});
