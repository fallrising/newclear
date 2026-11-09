import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const SCHEMA = 'lab.pi.hook-probe.v1';
const TIMEOUT_MS = 1500;

function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function snapshot(manager, workerId, acceptedCount) {
  const workers = manager?.workers;
  assert(workers instanceof Map, 'hook probe requires a real worker map');
  const w = workers.get(workerId);
  assert(w, 'hook probe requires a live worker');
  assert.equal(typeof acceptedCount, 'function', 'hook probe requires an accepted-count callback');
  const accepted = acceptedCount();
  assert(Number.isInteger(accepted) && accepted >= 0, 'hook probe requires a numeric accepted-count callback');
  return jsonClone({
    workersSize: workers.size,
    info: w.info,
    token: w.hookToken,
    hasPty: !!w.pty,
    acceptedCount: accepted,
  });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function authHeaders(token) {
  return token === undefined ? { 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function post(url, { token, body, raw = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: authHeaders(token),
      body: raw ? body : JSON.stringify(body), signal: controller.signal,
    });
    await response.body?.cancel();
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function requireWorker(manager, workerId) {
  assert(manager?.workers instanceof Map, 'hook probe requires a real worker manager');
  const w = manager.workers.get(workerId);
  assert(w, 'hook probe requires a live worker');
  assert(w.pty, 'hook probe requires a live worker');
  assert.equal(w.info?.id, workerId, 'hook probe worker identity mismatch');
  assert.equal(w.info?.provider, 'pi', 'hook probe requires a Pi worker');
  assert.equal(w.info?.kind, 'agent', 'hook probe requires an agent worker');
  assert.equal(typeof w.hookToken, 'string', 'hook probe requires a live hook token');
  assert(w.hookToken.length > 0, 'hook probe requires a live hook token');
  assert.equal(typeof w.info?.sessionId, 'string', 'hook probe requires a pinned session');
  assert(w.info.sessionId.length > 0, 'hook probe requires a pinned session');
  return w;
}

function distinctId(manager, workerId) {
  let id;
  do { id = `${workerId}-missing-${randomBytes(6).toString('hex')}`; }
  while (manager.workers.has(id));
  return id;
}

function distinctSession(session) {
  let foreign;
  do { foreign = 'probe-foreign-' + randomBytes(12).toString('hex'); } while (foreign === session);
  return foreign;
}

export async function probePiHooks({ port, manager, workerId, acceptedCount, oldToken } = {}) {
  assert(Number.isInteger(port) && port > 0 && port < 65536, 'hook probe requires a hook port');
  assert.equal(typeof workerId, 'string', 'hook probe requires a worker id');
  const w = requireWorker(manager, workerId);
  const session = w.info.sessionId;
  const token = w.hookToken;
  if (oldToken !== undefined) {
    assert.equal(typeof oldToken, 'string', 'hook probe old token must be a string');
    assert(oldToken.length > 0, 'hook probe old token must be nonempty');
    assert(oldToken !== token, 'hook probe requires a rotated old token');
  }
  const base = `http://127.0.0.1:${port}`;
  const hook = (route, id = workerId, event = '') => `${base}/hooks/${route}?worker=${encodeURIComponent(id)}${event ? `&event=${encodeURIComponent(event)}` : ''}`;
  const body = { sessionId: session, type: 'tool', status: 'working', tool: 'probe' };
  let wrongToken = randomBytes(18).toString('base64url');
  while (wrongToken === token) wrongToken = randomBytes(18).toString('base64url');
  const foreign = distinctSession(session);
  const cases = [
    { name: 'missing_token', expected: 401, url: hook('pi'), req: { body } },
    { name: 'wrong_token', expected: 401, url: hook('pi'), req: { token: wrongToken, body } },
    { name: 'unknown_worker', expected: 401, url: hook('pi', distinctId(manager, workerId)), req: { token, body } },
    { name: 'wrong_route', expected: 401, url: hook('opencode'), req: { token, body } },
    { name: 'unknown_route', expected: 404, url: hook('not-a-pi-provider'), req: { token, body } },
    { name: 'malformed_json', expected: 400, url: hook('pi'), req: { token, raw: true, body: '{' } },
    { name: 'malformed_payload', expected: 401, url: hook('pi'), req: { token, body: { sessionId: session, type: 'session' } } },
    { name: 'foreign_session', expected: 401, url: hook('pi'), req: { token, body: { ...body, sessionId: foreign } } },
    { name: 'foreign_start', expected: 401, url: hook('pi'), req: { token, body: { sessionId: foreign, type: 'session', status: 'starting' } } },
    { name: 'duplicate_start', expected: 401, url: hook('pi'), req: { token, body: { sessionId: session, type: 'session', status: 'starting' } } },
    { name: 'unexpected_event', expected: 401, url: hook('pi', workerId, 'probe'), req: { token, body } },
  ];
  if (oldToken !== undefined) cases.push({ name: 'old_token', expected: 401, url: hook('pi'), req: { token: oldToken, body } });

  const results = [];
  for (const c of cases) {
    const before = snapshot(manager, workerId, acceptedCount);
    let res;
    try {
      res = await post(c.url, c.req);
    } catch {
      throw new Error(`hook probe request failed for ${c.name}`);
    }
    const after = snapshot(manager, workerId, acceptedCount);
    if (res.status !== c.expected) throw new Error(`hook probe status mismatch for ${c.name}`);
    if (!sameJson(before, after)) throw new Error(`hook probe state changed for ${c.name}`);
    results.push({ name: c.name, status: res.status, unchanged: true });
  }
  return { schema: SCHEMA, cases: results, verified: true };
}
