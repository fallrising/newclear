import test from 'node:test';
import assert from 'node:assert/strict';
import { installPiHookGuard, piHookIdentity } from './pi_hook_guard.mjs';

const MODEL = 'deepseek/deepseek-flash';
const start = session => ({ sessionId: session, type: 'session', status: 'starting' });
const work = session => ({ sessionId: session, type: 'prompt', status: 'working', prompt: 'hello' });

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function makeManager({ token = 'tok', session = undefined, nativeResult = true } = {}) {
  const calls = [];
  const w = { hookToken: token, pty: {}, info: { id: 'w1', kind: 'agent', provider: 'pi', model: MODEL, status: 'starting' } };
  if (session !== undefined) w.info.sessionId = session;
  const manager = {
    workers: new Map([['w1', w]]),
    authenticate(id, tok) {
      const ww = this.workers.get(id);
      return ww && typeof tok === 'string' && tok === ww.hookToken ? ww.info : undefined;
    },
    handleProviderHook(route, id, tok, event, payload) {
      calls.push({ route, id, tok, event, payload: clone(payload) });
      if (!this.authenticate(id, tok)) return false;
      const report = payload; // Native state-effect fixture; payload normalization is tested separately.
      if (nativeResult instanceof Function) return nativeResult(w, report, calls.length);
      if (nativeResult !== true) return false;
      if (!w.info.sessionId || (report.type === 'session' && report.status === 'starting' && w.info.sessionId !== report.sessionId)) w.info.sessionId = report.sessionId;
      return true;
    }
  };
  return { manager, w, calls };
}

function acceptStart(manager, guard, session = 's1') {
  guard.expectFresh('w1');
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start(session)), true);
}

test('native state-effect fixture accepts foreign starting but rejects old token', () => {
  const { manager, w } = makeManager({ session: 's1' });
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('s2')), true);
  assert.equal(w.info.sessionId, 's2');
  w.hookToken = 'new';
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', work('s2')), false);
});

test('guard rejects unauthenticated, malformed, unannounced and policy-invalid hooks before native', () => {
  const { manager, w, calls } = makeManager();
  const guard = installPiHookGuard(manager, { model: MODEL });
  const before = () => calls.length;
  for (const invoke of [
    () => manager.handleProviderHook('opencode', 'w1', 'tok', '', start('s1')),
    () => manager.handleProviderHook('pi', 'missing', 'tok', '', start('s1')),
    () => manager.handleProviderHook('pi', 'w1', 'bad', '', start('s1')),
    () => manager.handleProviderHook('pi', 'w1', 'tok', 'x', start('s1')),
    () => manager.handleProviderHook('pi', 'w1', 'tok', '', { sessionId: 's1', type: 'nope', status: 'starting' }),
    () => manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')),
  ]) {
    const n = before();
    assert.equal(invoke(), false);
    assert.equal(calls.length, n);
    assert.equal(w.info.sessionId, undefined);
  }
  guard.expectFresh('w1');
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', work('s1')), false); // first event must start
  assert.equal(calls.length, 0);
  w.info.sessionId = 'pinned';
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('foreign')), false);
  assert.equal(calls.length, 0);
});

test('guard binds after native accepts and rejects foreign or duplicate starts without after-end blocking', () => {
  const { manager, calls } = makeManager();
  const guard = installPiHookGuard(manager, { model: MODEL });
  acceptStart(manager, guard, 's1');
  assert.equal(calls.length, 1);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')), false);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', work('other')), false);
  assert.equal(calls.length, 1);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', { sessionId: 's1', type: 'session', status: 'done' }), true);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', { sessionId: 's1', type: 'question', status: 'needs_input' }), true);
  assert.equal(calls.length, 3);
});

test('native start rejection does not commit and a later legal start can pass', () => {
  let failFirst = true;
  const { manager, w, calls } = makeManager({ nativeResult(worker, report) {
    if (failFirst) { failFirst = false; return false; }
    worker.info.sessionId = report.sessionId; return true;
  }});
  const guard = installPiHookGuard(manager, { model: MODEL });
  guard.expectFresh('w1');
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')), false);
  assert.equal(w.info.sessionId, undefined);
  assert.equal(calls.length, 1);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')), true);
  assert.equal(w.info.sessionId, 's1');
  assert.equal(calls.length, 2);
});

test('postcondition session mismatch poisons the worker generation', () => {
  const { manager, calls } = makeManager({ nativeResult(worker) { worker.info.sessionId = 'wrong'; return true; } });
  const guard = installPiHookGuard(manager, { model: MODEL });
  guard.expectFresh('w1');
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')), false);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'tok', '', work('s1')), false);
  assert.equal(calls.length, 1);
});

test('restore/reconnect requires same worker, rotated token and saved session', () => {
  const { manager, w, calls } = makeManager({ token: 'old', session: 'saved' });
  const guard = installPiHookGuard(manager, { model: MODEL });
  guard.expectReconnect('w1', 'saved');
  assert.equal(manager.handleProviderHook('pi', 'w1', 'old', '', start('saved')), false); // same-token duplicate launch is forbidden
  w.hookToken = 'new';
  assert.equal(manager.handleProviderHook('pi', 'w1', 'new', '', start('other')), false);
  assert.equal(calls.length, 0);
  assert.equal(manager.handleProviderHook('pi', 'w1', 'new', '', start('saved')), true);
  assert.equal(calls.length, 1);
});

test('unannounced token rotation is rejected before native', () => {
  const { manager, w, calls } = makeManager();
  const guard = installPiHookGuard(manager, { model: MODEL });
  acceptStart(manager, guard, 's1');
  w.hookToken = 'new';
  assert.equal(manager.handleProviderHook('pi', 'w1', 'new', '', start('s1')), false);
  assert.equal(calls.length, 1);
});

test('install validates manager and refuses duplicate installation or Promise native API', () => {
  assert.throws(() => installPiHookGuard({ workers: new Map(), handleProviderHook(){} }), /real worker manager/);
  const { manager } = makeManager({ nativeResult: () => Promise.resolve(true) });
  const guard = installPiHookGuard(manager, { model: MODEL });
  assert.throws(() => installPiHookGuard(manager, { model: MODEL }), /already installed/);
  guard.expectFresh('w1');
  assert.throws(() => manager.handleProviderHook('pi', 'w1', 'tok', '', start('s1')), /Promise/);
});

test('payload domain rejects malformed lifecycle fields and accepts bounded known fields', () => {
  const accepted=[start('abc'),{...start('abc'),extra:{ignored:true}},
    {sessionId:'abc',type:'tool',status:'working',tool:'read'},
    {sessionId:'abc',type:'question',status:'needs_input'},
    {sessionId:'abc',type:'error',status:'working'}];
  const rejected=[null,[],{}, {...start('abc'),sessionId:''}, {...start('abc'),sessionId:'x'.repeat(161)},
    {...start('abc'),type:'permission'}, {...start('abc'),status:'other'},
    {...start('abc'),tool:''}, {...start('abc'),tool:'a\u0000b'},
    {...start('abc'),prompt:'x'.repeat(20001)}];
  for(const payload of accepted)assert(piHookIdentity(payload));
  for(const payload of rejected)assert.equal(piHookIdentity(payload),null);
});


test('exact worker identity and live native authentication are required before invocation', () => {
  for (const mutate of [w => w.info.id = 'other', w => w.info.kind = 'shell',
    w => w.info.provider = 'opencode', w => w.info.model = 'other', w => w.pty = undefined]) {
    const {manager,w,calls}=makeManager();const guard=installPiHookGuard(manager);guard.expectFresh('w1');
    mutate(w);assert.equal(manager.handleProviderHook('pi','w1','tok','',start('s1')),false);assert.equal(calls.length,0);
  }
  const {manager,calls}=makeManager();const guard=installPiHookGuard(manager);guard.expectFresh('w1');
  manager.authenticate=()=>({id:'w1'});
  assert.equal(manager.handleProviderHook('pi','w1','tok','',start('s1')),false);assert.equal(calls.length,0);
});

test('announced reconnect preserves binding through rejection and rejects stale tokens and worker replacement', () => {
  const {manager,w,calls}=makeManager();const guard=installPiHookGuard(manager);acceptStart(manager,guard);
  guard.expectReconnect('w1','s1');w.hookToken='new';
  assert.equal(manager.handleProviderHook('pi','w1','tok','',start('s1')),false);
  assert.equal(manager.handleProviderHook('pi','w1','new','',start('other')),false);
  manager.workers.set('w1',{...w});
  assert.equal(manager.handleProviderHook('pi','w1','new','',start('s1')),false);
  manager.workers.set('w1',w);
  assert.equal(manager.handleProviderHook('pi','w1','new','',start('s1')),true);
  assert.equal(manager.handleProviderHook('pi','w1','new','',work('s1')),true);
  assert.equal(manager.handleProviderHook('pi','w1','new','',start('s1')),false);
  assert.equal(calls.length,3);
});

test('synchronous native reentry cannot accept a duplicate starting hook', () => {
  const {manager,calls}=makeManager({nativeResult(w,payload){
    assert.equal(manager.handleProviderHook('pi','w1','tok','',start('s1')),false);
    w.info.sessionId=payload.sessionId;return true;
  }});
  const guard=installPiHookGuard(manager);acceptStart(manager,guard);assert.equal(calls.length,1);
});
