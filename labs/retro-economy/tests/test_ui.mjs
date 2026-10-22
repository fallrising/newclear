import test from 'node:test';
import assert from 'node:assert/strict';
import clientModule from '../retro/static/app.js';

const { SessionClient, STORAGE_KEY, createUUID } = clientModule;
const state = (x = 0) => ({ id: 1, name: '旅人', profession: 'smith', x, y: 0,
  hp: 3, coins: 12, items: { ore: 0, herb: 0, kit: 0, medicine: 1 },
  tower_stage: 0, tower_reward_claimed: false });
const response = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
function storage(initial = null) {
  let saved = initial;
  return { getItem: () => saved, setItem: (_, value) => { saved = value; }, removeItem: () => { saved = null; }, value: () => saved };
}
const signedIn = () => storage(JSON.stringify({ token: 'secret', pendingJoin: null, pendingAction: null }));
function client(options = {}) {
  let seq = 0;
  return new SessionClient({ storage: signedIn(), uuid: () => `uuid-${++seq}`, ...options });
}

test('ambiguous action persists before send and retries exact body after reload', async () => {
  const store = signedIn();
  const bodies = [];
  let lost = true;
  let effects = 0;
  const seen = new Set();
  const fetch = async (url, options) => {
    if (url === '/api/state') return response({ ok: true, state: state(-1) });
    assert.equal(JSON.parse(store.value()).pendingAction.action_id, 'uuid-1');
    const body = JSON.parse(options.body);
    bodies.push(options.body);
    if (!seen.has(body.action_id)) { effects++; seen.add(body.action_id); }
    if (lost) { lost = false; throw new Error('reply lost'); }
    return response({ ok: true, state: state(-1), message: '已移動' });
  };
  const first = client({ storage: store, fetch });
  await first.act({ type: 'move', dx: -1, dy: 0 });
  assert.ok(JSON.parse(store.value()).pendingAction);
  const recovered = client({ storage: store, fetch });
  await recovered.resume();
  assert.deepEqual(bodies, [bodies[0], bodies[0]]);
  assert.equal(effects, 1);
  assert.equal(JSON.parse(store.value()).pendingAction, null);
  assert.equal(recovered.state.x, -1);
});

test('ambiguous join reuses persisted identity even when a different form is submitted', async () => {
  const store = storage();
  const requests = [];
  let lost = true;
  const fetch = async (url, options) => {
    if (url === '/api/state') return response({ ok: true, state: state() });
    assert.ok(JSON.parse(store.value()).pendingJoin);
    requests.push(JSON.parse(options.body));
    if (lost) { lost = false; throw new Error('offline'); }
    return response({ ok: true, token: 'secret', state: state(), message: '歡迎' }, 201);
  };
  await client({ storage: store, fetch }).join('旅人', 'smith');
  const recovered = client({ storage: store, fetch });
  await recovered.join('另一人', 'herbalist');
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[1].name, '旅人');
  assert.equal(JSON.parse(store.value()).token, 'secret');
});

test('an old poll completes before an action starts and cannot roll back newer action state', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const calls = [];
  const rendered = [];
  let reads = 0;
  const c = client({ onState: s => rendered.push(s.x), fetch: async (url) => {
    calls.push(url);
    if (url === '/api/state' && ++reads === 1) { entered(); await blocked; return response({ ok: true, state: state() }); }
    return response({ ok: true, state: state(-1), message: '移動' });
  } });
  const poll = c.poll();
  await started;
  const action = c.act({ type: 'move', dx: -1, dy: 0 });
  await Promise.resolve();
  assert.deepEqual(calls, ['/api/state']);
  release();
  await Promise.all([poll, action]);
  assert.equal(rendered.at(-1), -1);
  assert.equal(c.state.x, -1);
});

test('definite rule rejection clears pending ID and next intent receives a new ID', async () => {
  const ids = [];
  const c = client({ fetch: async (url, options) => {
    if (url === '/api/state') return response({ ok: true, state: state() });
    ids.push(JSON.parse(options.body).action_id);
    return response({ ok: false, error: { code: 'rule', message: '此處不能採集' }, state: state() }, 400);
  } });
  await c.act({ type: 'gather' });
  await c.act({ type: 'gather' });
  assert.deepEqual(ids, ['uuid-1', 'uuid-2']);
  assert.equal(c.session.pendingAction, null);
});

test('server errors preserve unresolved action and block replacement with a different intent', async () => {
  const bodies = [];
  const c = client({ fetch: async (_, options) => {
    bodies.push(options.body);
    return response({ ok: false, error: { message: '暫時無法服務' } }, 503);
  } });
  await c.act({ type: 'gather' });
  await c.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(c.session.pendingAction.action.type, 'gather');
});

test('unauthorized does not erase token or pending action or silently create a character', async () => {
  const urls = [];
  const c = client({ fetch: async (url) => {
    urls.push(url);
    return response({ ok: false, error: { message: '角色憑證無效' } }, 401);
  } });
  await c.act({ type: 'gather' });
  assert.equal(c.session.token, 'secret');
  assert.ok(c.session.pendingAction);
  assert.deepEqual(urls, ['/api/action']);
});

test('storage failure refuses to send an unrecorded action', async () => {
  let sends = 0;
  const store = signedIn();
  store.setItem = () => { throw new Error('quota'); };
  const c = client({ storage: store, fetch: async () => { sends++; } });
  await c.act({ type: 'gather' });
  assert.equal(sends, 0);
  assert.equal(c.session.pendingAction, null);
});

test('invalid stored session requires explicit reset before joining', async () => {
  let sends = 0;
  const c = client({ storage: storage('{broken'), fetch: async () => { sends++; } });
  await c.join('旅人', 'smith');
  assert.equal(sends, 0);
  assert.ok(c.storageError);
  c.reset();
  assert.equal(c.storageError, null);
  assert.equal(c.session.token, null);
  assert.equal(STORAGE_KEY, 'mistshore.session.v1');
});

test('UUID generation prefers the browser native generator when available', () => {
  const native = '12345678-1234-4234-8234-123456789abc';
  assert.equal(createUUID({ randomUUID: () => native,
    getRandomValues: () => { throw new Error('fallback should not run'); } }), native);
});

test('UUID fallback uses secure random bytes and sets RFC version and variant bits', () => {
  let calls = 0;
  const generated = createUUID({ getRandomValues(bytes) {
    calls++;
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length, 16);
    bytes.fill(255);
    return bytes;
  } });
  assert.equal(calls, 1);
  assert.equal(generated, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(createUUID({ getRandomValues: bytes => bytes.fill(0) }), '00000000-0000-4000-8000-000000000000');
});

test('UUID fallback preserves random payload bytes and refuses insecure randomness', () => {
  assert.equal(createUUID({ getRandomValues(bytes) {
    bytes.set([0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]);
    return bytes;
  } }), '00112233-4455-4677-8899-aabbccddeeff');
  assert.throws(() => createUUID({}), /secure randomness/i);
});
