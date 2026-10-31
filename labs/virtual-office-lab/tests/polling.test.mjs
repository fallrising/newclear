import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {present} from '../src/presentation.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('UI polling retains good snapshot, backs off, pauses hidden and resumes without overlap', async () => {
  const node = () => ({textContent: '', children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }});
  const elements = Object.fromEntries(['#connection', '#last-success', '#agents'].map(id => [id, node()]));
  let visibility; const timers = new Map(); let id = 0; let mode = 'good'; let calls = 0; let pending = false;
  const document = {hidden: false, querySelector: id => elements[id], createElement: node, addEventListener: (event, fn) => { visibility = fn; }};
  const state = {schemaVersion: 1, mode: 'live', simulated: false, bots: [{id: 'test', name: '<img>', role: 'test', summary: 'public', seat: 'director', status: 'coding', reportedStatus: 'coding', stale: false, alert: false, collaborators: []}]};
  const source = (await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8')).replace("import {present} from './presentation.mjs';", '');
  runInNewContext(source, {document, present, AbortController, Date, Math, setTimeout: (fn, delay) => { timers.set(++id, {fn, delay}); return id; }, clearTimeout: id => timers.delete(id), fetch: async (url, options) => {
    calls++;
    if (mode === 'bad') throw new Error('offline');
    if (mode === 'pending') { pending = true; await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { pending = false; reject(new Error('abort')); })); }
    return {ok: true, json: async () => state};
  }});
  await tick(); assert.equal(calls, 1); assert.equal(elements['#agents'].children.length, 1);
  const original = elements['#agents'].children[0].children[0].textContent;
  const fire = () => { const entry = [...timers].find(([, t]) => t.delay >= 15000); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); };
  mode = 'bad'; fire(); await tick();
  assert.match(elements['#connection'].textContent, /連線中斷/);
  assert.equal(elements['#agents'].children[0].children[0].textContent, original);
  assert.ok([...timers.values()].some(t => t.delay >= 30000 && t.delay < 31000));
  mode = 'pending'; fire(); await tick(); assert.equal(pending, true);
  const before = calls; visibility(); await tick(); assert.equal(calls, before); // visible event while in-flight
  document.hidden = true; visibility(); await tick(); assert.equal(pending, false); assert.equal(timers.size, 0);
  mode = 'good'; document.hidden = false; visibility(); await tick();
  assert.equal(calls, before + 1); assert.match(elements['#connection'].textContent, /即時/);
  assert.ok([...timers.values()].some(t => t.delay >= 15000 && t.delay < 16000));
});
