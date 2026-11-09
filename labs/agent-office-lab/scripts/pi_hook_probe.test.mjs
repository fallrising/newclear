import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probePiHooks } from './pi_hook_probe.mjs';

const token = 'tok-private-123';
const oldToken = 'tok-old-456';
const session = 'sess-private-abc';

function makeManager() {
  const worker = { pty: { pid: 123 }, hookToken: token, info: { id: 'w1', kind: 'agent', provider: 'pi', model: 'deepseek/deepseek-flash', sessionId: session, status: 'idle' } };
  return { workers: new Map([['w1', worker]]) };
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

async function withStub(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    await fn(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function statusServer({ mutate, statusOverride } = {}) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.startsWith('/hooks/') ? url.pathname.slice('/hooks/'.length) : '';
    let status = 401;
    if (req.method !== 'POST' || !['pi', 'opencode'].includes(route)) status = 404;
    else {
      let payload;
      try { payload = JSON.parse(await readBody(req)); }
      catch { status = 400; payload = undefined; }
      if (status !== 400 && route === 'pi') {
        const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const worker = url.searchParams.get('worker') ?? '';
        const malformed = !payload || typeof payload !== 'object' || typeof payload.sessionId !== 'string'
          || !['session', 'prompt', 'tool', 'question', 'error'].includes(payload.type)
          || !['starting', 'working', 'needs_input', 'done'].includes(payload.status);
        if (worker !== 'w1' || auth !== token || url.searchParams.get('event')) status = 401;
        else if (malformed || payload.sessionId !== session || (payload.type === 'session' && payload.status === 'starting')) status = 401;
        else status = 200;
      }
    }
    if (mutate) mutate(req, status);
    if (statusOverride) status = statusOverride(req, status);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end('{}');
  };
}

test('probePiHooks verifies rejected hook boundary cases without leaking token or session', async () => {
  const manager = makeManager();
  let accepted = 0;
  await withStub(statusServer(), async port => {
    const report = await probePiHooks({ port, manager, workerId: 'w1', acceptedCount: () => accepted, oldToken });
    assert.equal(report.schema, 'lab.pi.hook-probe.v1');
    assert.equal(report.verified, true);
    assert.deepEqual(report.cases.map(c => c.name), [
      'missing_token', 'wrong_token', 'unknown_worker', 'wrong_route', 'unknown_route',
      'malformed_json', 'malformed_payload', 'foreign_session', 'foreign_start',
      'duplicate_start', 'unexpected_event', 'old_token',
    ]);
    assert(report.cases.every(c => c.unchanged === true));
    assert.deepEqual(report.cases.map(c => c.status), [401, 401, 401, 401, 404, 400, 401, 401, 401, 401, 401, 401]);
    const text = JSON.stringify(report);
    assert(!text.includes(token));
    assert(!text.includes(oldToken));
    assert(!text.includes(session));
  });
});

test('probePiHooks fails on status mismatch', async () => {
  const manager = makeManager();
  await withStub(statusServer({ statusOverride: (req, status) => req.headers.authorization ? status : 200 }), async port => {
    await assert.rejects(() => probePiHooks({ port, manager, workerId: 'w1', acceptedCount: () => 0 }), /status mismatch/);
  });
});

test('probePiHooks fails when rejected requests change native state or accepted count', async () => {
  const manager = makeManager();
  await withStub(statusServer({ mutate: req => {
    if (!req.headers.authorization) manager.workers.get('w1').info.status = 'working';
  } }), async port => {
    await assert.rejects(() => probePiHooks({ port, manager, workerId: 'w1', acceptedCount: () => 0 }), /state changed/);
  });

  const manager2 = makeManager();
  let accepted = 0;
  await withStub(statusServer({ mutate: () => { accepted += 1; } }), async port => {
    await assert.rejects(() => probePiHooks({ port, manager: manager2, workerId: 'w1', acceptedCount: () => accepted }), /state changed/);
  });
});

test('probePiHooks validates live worker, pinned session and rotated old token before probing', async () => {
  await assert.rejects(() => probePiHooks({ port: 1, manager: { workers: new Map() }, workerId: 'w1', acceptedCount: () => 0 }), /live worker/);
  const manager = makeManager();
  await assert.rejects(() => probePiHooks({ port: 1, manager, workerId: 'w1', acceptedCount: () => 0, oldToken: token }), /rotated old token/);
  manager.workers.get('w1').info.sessionId = '';
  await assert.rejects(() => probePiHooks({ port: 1, manager, workerId: 'w1', acceptedCount: () => 0 }), /pinned session/);
});
