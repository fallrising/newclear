import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../apps/control-plane/web/isolated.js', import.meta.url), 'utf8');
const run = id => ({id, state: 'running', state_version: 3, cleanup_state: 'pending'});
async function page({stored, submit, action, getRun, tasks, submissions} = {}) {
  const elements = new Map(), storage = new Map(stored || []), requests = [], timers = [];
  const node = id => {
    if (!elements.has(id)) elements.set(id, {value: '0', textContent: '', disabled: false, options: [], listeners: {}, children: [],
      addEventListener(type, fn) {this.listeners[type] = fn;},
      replaceChildren(...children) {this.children = children; this.options = children;}, append(child) {this.children.push(child);}});
    return elements.get(id);
  };
  const context = vm.createContext({document: {getElementById: node, createElement: () => node(Symbol())},
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, v) => storage.set(key, v), removeItem: key => storage.delete(key)},
    Option: function(text, value) {return {text, value};}, crypto: {randomUUID: () => `key-${requests.length}`},
    setTimeout: fn => {timers.push(fn); return timers.length;}, clearTimeout() {}, Date,
    fetch: async (url, options) => {
      requests.push({url, ...options});
      let data;
      if (url.endsWith('/session')) data = {authenticated: true, csrf_token: 'csrf'};
      else if (url.endsWith('/submissions')) data = submissions ? await submissions() : {items: [], blocked: false};
      else if (url.endsWith('/projects')) data = {items: [{id: 'project', canonical_repo: 'repo', name: 'fixture'}]};
      else if (url.endsWith('/agent-profiles')) data = {items: ['claude', 'codex', 'fake'].map(name => ({id: name, name, backend: `${name}-subscription`}))};
      else if (url.endsWith('/runtime')) data = {repositories: [{canonical_repo: 'repo', base_sha: 'a'.repeat(40)}]};
      else if (url.endsWith('/tasks') && options.method === 'POST') data = await (submit ? submit() : Promise.resolve({run: run('A')}));
      else if (url.endsWith('/tasks')) data = {items: tasks ? await tasks() : [{title: 'A', run_id: 'A', state: 'running'}, {title: 'B', run_id: 'B', state: 'running'}]};
      else if (url.endsWith('/actions')) data = await action();
      else data = getRun ? await getRun(url.split('/').at(-1)) : run(url.split('/').at(-1));
      return {ok: true, status: 200, json: async () => data};
    }});
  await vm.runInContext(`(async () => {${source}\n})()`, context);
  const flush = async () => {for(let n = 0; n < 10; n++) await Promise.resolve();};
  const submitForm = async () => {await node('task-form').listeners.submit({preventDefault(){}}); await flush();};
  return {node, storage, requests, submitForm, flush};
}
test('M2-01: same catalog offers both real subscription vendors only', async () => {
  const p = await page();
  assert.deepEqual(p.node('agent').options.map(x => x.value), ['claude', 'codex']);
});
test('M2-04: accepted running A allows explicit B with distinct submit keys', async () => {
  const p = await page(); await p.submitForm();
  assert.equal(p.node('submit-task').disabled, false);
  await p.submitForm();
  const posts = p.requests.filter(x => x.url.endsWith('/tasks') && x.method === 'POST');
  assert.equal(posts.length, 2); assert.notEqual(posts[0].headers['Idempotency-Key'], posts[1].headers['Idempotency-Key']);
});
test('M2-04: newly accepted active tasks can be selected without reload or completion', async () => {
  const tasks = [];
  const p = await page({tasks: () => [...tasks], submit: async () => {
    const id = tasks.length ? 'B' : 'A';
    tasks.push({title: id, run_id: id, state: 'running'});
    return {run: run(id)};
  }});
  assert.equal(p.node('recent-tasks').children.length, 0);
  await p.submitForm(); await p.submitForm();
  assert.equal(p.node('recent-tasks').children.length, 2);
  p.node('recent-tasks').children[0].children[0].listeners.click(); await p.flush();
  assert.equal(p.node('run-id').textContent, 'A');
  assert.equal(p.requests.filter(x => x.url.endsWith('/tasks') && x.method === 'POST').length, 2);
});
test('M2-04: list read failure preserves confirmed admission and never resends', async () => {
  let accepted = false;
  const p = await page({tasks: () => {
    if (accepted) throw new Error('list offline');
    return [];
  }, submit: async () => {accepted = true; return {run: run('A')};}});
  await p.submitForm();
  assert.equal(p.node('submit-status').textContent, '任務已受理');
  assert.equal(p.node('submit-task').disabled, false);
  assert.equal(JSON.parse(p.storage.get('fanz-submission')).runId, 'A');
  assert.equal(p.requests.filter(x => x.url.endsWith('/tasks') && x.method === 'POST').length, 1);
});
test('M2-04: an older task list cannot hide a more recently accepted task', async () => {
  const tasks = []; let release;
  const p = await page({tasks: () => {
    const snapshot = [...tasks];
    return snapshot.length === 1 ? new Promise(resolve => {release = () => resolve(snapshot);}) : snapshot;
  }, submit: async () => {
    const id = tasks.length ? 'B' : 'A'; tasks.push({title: id, run_id: id, state: 'running'});
    return {run: run(id)};
  }});
  const first = p.submitForm(); await p.flush();
  await p.submitForm(); release(); await first; await p.flush();
  assert.equal(p.node('recent-tasks').children.length, 2);
  p.node('recent-tasks').children[1].children[0].listeners.click(); await p.flush();
  assert.equal(p.node('run-id').textContent, 'B');
});
test('M2-04: reload of a confirmed receipt allows a distinct task', async () => {
  const p = await page({stored: [['fanz-submission', JSON.stringify({key: 'old', runId: 'A'})]]});
  assert.equal(p.node('submit-task').disabled, false);
});
test('M2-04: unknown or malformed receipt locks across reload; never automatically posts', async () => {
  for (const value of ['{', '{}', JSON.stringify({key: 'old', unknown: true})]) {
    const p = await page({stored: [['fanz-submission', value]]});
    assert.equal(p.node('submit-task').disabled, true); await p.submitForm();
    assert.equal(p.requests.filter(x => x.method === 'POST').length, 0);
  }
});
test('M2-04: uncertain submission does not retry and locks another explicit submit', async () => {
  const p = await page({submit: () => Promise.reject(new Error('lost response'))});
  await p.submitForm(); await p.submitForm();
  assert.equal(p.node('submit-task').disabled, true);
  assert.equal(p.requests.filter(x => x.url.endsWith('/tasks') && x.method === 'POST').length, 1);
});
test('M2-04: late cancel reply for A cannot overwrite selected B status', async () => {
  let release; const p = await page({stored: [['fanz-current-run', 'A']], action: () => new Promise(resolve => {release = resolve;})});
  const cancellation = p.node('cancel-run').listeners.click();
  p.node('recent-tasks').children[1].children[0].listeners.click(); await p.flush();
  release({}); await cancellation; await p.flush();
  assert.equal(p.node('run-id').textContent, 'B');
  assert.equal(p.node('cancel-status').textContent, '');
});

test('M2-04: pending or failed B fetch never leaves A identity/status/reason', async () => {
  let reject;
  const p = await page({stored: [['fanz-current-run', 'A']], getRun: id => id === 'A' ? {...run('A'), reason: 'operator_cancelled'} : new Promise((_, no) => {reject = no;})});
  p.node('recent-tasks').children[1].children[0].listeners.click(); await p.flush();
  assert.equal(p.node('run-id').textContent, 'B');
  assert.equal(p.node('run-status').textContent, '讀取中');
  assert.equal(p.node('run-reason').textContent, '');
  reject(new Error('offline')); await p.flush();
  assert.equal(p.node('run-id').textContent, 'B');
  assert.equal(p.node('run-status').textContent, '讀取中');
  assert.equal(p.node('cancel-run').disabled, true);
});

test('M3-06: fresh browser recovers server unknown and cannot submit', async () => {
  const p = await page({submissions: async () => ({blocked: true, items: [{key: 'unknown-key', state: 'unknown', request: {title: 'uncertain'}}]})});
  assert.equal(p.node('submit-task').disabled, true);
  await p.submitForm();
  assert.equal(p.requests.filter(x => x.method === 'POST').length, 0);
  assert.match(p.node('submit-status').textContent, /待對帳/);
});
test('M3-06: fresh browser opens persisted confirmed run without submit', async () => {
  const p = await page({submissions: async () => ({blocked: false, items: [{key: 'saved-key', state: 'confirmed', receipt: {run: {id: 'saved-run'}}}]})});
  assert.equal(p.node('run-id').textContent, 'saved-run');
  assert.equal(p.requests.filter(x => x.method === 'POST').length, 0);
});
test('M3-06: durable list failure fails closed instead of enabling submit', async () => {
  const p = await page({submissions: async () => {throw new Error('store unavailable');}});
  assert.equal(p.node('submit-task').disabled, true);
  await p.submitForm();
  assert.equal(p.requests.filter(x => x.method === 'POST').length, 0);
});
test('M3-04: observation history replaces browser wall-clock reconstruction', async () => {
  const p = await page({stored: [['fanz-current-run','A']], getRun: async () => ({...run('A'), fanz_history: {cursor: 2, history_truncated: false, events: [{cursor: 1, state: 'queued', state_version: 1}, {cursor: 2, state: 'running', state_version: 3}]}})});
  assert.match(p.node('activity').textContent, /#1.*排隊中/);
  assert.match(p.node('activity').textContent, /#2.*Agent 執行中/);
});
test('M3-06: late A response cannot replace B uncertainty after durable A recovery', async () => {
  let releaseA, recovery = false, submits = 0;
  const p = await page({submissions: async () => ({blocked: false, items: recovery ? [{key: JSON.parse(p.storage.get('fanz-submission')).key, state: 'confirmed', receipt: {run: {id: 'A'}}}] : []}), submit: async () => {
    submits++;
    if (submits === 1) return new Promise(resolve => {releaseA = resolve;});
    throw new Error('lost B response');
  }});
  const first = p.submitForm(); await p.flush(); recovery = true;
  p.node('refresh').listeners.click(); await p.flush();
  assert.equal(p.node('submit-task').disabled, false);
  await p.submitForm(); const unknownB = p.storage.get('fanz-submission');
  assert.equal(JSON.parse(unknownB).unknown, true);
  releaseA({run: run('A')}); await first;
  assert.equal(p.storage.get('fanz-submission'), unknownB);
  assert.equal(p.node('submit-task').disabled, true);
});
test('M3-06: confirmed 404 of stale selection falls back to durable run without POST', async () => {
  const p = await page({stored: [['fanz-current-run','gone']], submissions: async () => ({blocked: false, items: [{key:'saved', state:'confirmed', receipt:{run:{id:'saved-run'}}}]}), getRun: async id => {
    if(id === 'gone') { const e = new Error('not found'); e.status = 404; throw e; }
    return run(id);
  }});
  await p.flush(); assert.equal(p.node('run-id').textContent,'saved-run');
  assert.equal(p.requests.filter(x=>x.method==='POST').length,0);
});
