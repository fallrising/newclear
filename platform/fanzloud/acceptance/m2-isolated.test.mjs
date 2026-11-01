import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../apps/control-plane/web/isolated.js', import.meta.url), 'utf8');
const run = id => ({id, state: 'running', state_version: 3, cleanup_state: 'pending'});
async function page({stored, submit, action, getRun} = {}) {
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
      else if (url.endsWith('/projects')) data = {items: [{id: 'project', canonical_repo: 'repo', name: 'fixture'}]};
      else if (url.endsWith('/agent-profiles')) data = {items: ['claude', 'codex', 'fake'].map(name => ({id: name, name, backend: `${name}-subscription`}))};
      else if (url.endsWith('/runtime')) data = {repositories: [{canonical_repo: 'repo', base_sha: 'a'.repeat(40)}]};
      else if (url.endsWith('/tasks') && options.method === 'POST') data = await (submit ? submit() : Promise.resolve({run: run('A')}));
      else if (url.endsWith('/tasks')) data = {items: [{title: 'A', run_id: 'A', state: 'running'}, {title: 'B', run_id: 'B', state: 'running'}]};
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
