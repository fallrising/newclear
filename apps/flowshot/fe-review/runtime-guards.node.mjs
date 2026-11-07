import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedTransport, routeKind, safeReason, closeOwned } from './runtime-guards.mjs';
test('HTTP/WS accept only exact namespace loopback origin; credentials and other ports/protocols refuse', () => {
  assert.equal(allowedTransport('http://127.0.0.1:1420/src/main.ts'), true);
  assert.equal(allowedTransport('ws://127.0.0.1:1420/?token=synthetic', true), true);
  for (const value of ['https://127.0.0.1:1420/', 'http://localhost:1420/', 'http://127.0.0.1:1421/', 'http://evil.example/', 'http://name:CANARY@127.0.0.1:1420/', 'file:///CANARY', 'not-a-url']) assert.equal(allowedTransport(value), false);
  assert.equal(allowedTransport('wss://127.0.0.1:1420/', true), false);
  assert.equal(allowedTransport('ws://evil.example:1420/', true), false);
  assert.equal(routeKind('http://127.0.0.1:1420/favicon.ico?x=CANARY'), 'same_origin_asset');
});
test('safe failure classification never emits arbitrary error, URL or path content', () => {
  for (const e of [new Error('http://CANARY/secret'), new Error('/home/CANARY'), new TypeError('private')]) assert.equal(safeReason(e), 'UNCLASSIFIED_FAILURE');
  assert.equal(safeReason({ code: 'ERR_ASSERTION', message: 'CANARY' }), 'ASSERTION_FAILED');
});
test('browser rejection and hanging close still attempt every owned resource and fail closed', async () => {
  let serverClosed = false;
  const result = await closeOwned([{ name: 'browser', close: () => { throw new Error('synthetic'); } }, { name: 'server', close: () => { serverClosed = true; } }, { name: 'hung', close: () => new Promise(() => {}) }], 10);
  assert.equal(serverClosed, true); assert.deepEqual(result, { browser: false, server: true, hung: false });
});

test('signal during async creation retains late resource ownership for final cleanup', async () => {
  const { createInterruption, acquireOwned } = await import('./runtime-guards.mjs');
  const interrupted = createInterruption(); let release, owned, closed = false;
  const factory = () => new Promise((resolve) => { release = resolve; });
  const acquisition = acquireOwned(factory, (resource) => { owned = resource; }, interrupted);
  interrupted.request('SIGTERM'); release({ close() { closed = true; } });
  await assert.rejects(acquisition, /REVIEW_INTERRUPTED/);
  const result = await closeOwned([{ name: 'late', close: () => owned.close() }]);
  assert.equal(result.late, true); assert.equal(closed, true);
});
test('normal scenarios reject every unexpected health category without raw diagnostic data', async () => {
  const { assertRuntimeHealth } = await import('./runtime-guards.mjs');
  const clean = { blockedHttp: 0, blockedWebSocket: 0, pageErrors: 0, console: [], failedRequests: [], responses: [] };
  assert.doesNotThrow(() => assertRuntimeHealth(clean));
  for (const delta of [{ blockedHttp: 1 }, { blockedWebSocket: 1 }, { pageErrors: 1 }, { failedRequests: [{ url: 'CANARY' }] }, { responses: [{ status: 404 }] }, { console: [{ type: 'error', raw: 'CANARY' }] }]) assert.throws(() => assertRuntimeHealth({ ...clean, ...delta }), { message: 'REVIEW_UNEXPECTED_BROWSER_HEALTH' });
});
