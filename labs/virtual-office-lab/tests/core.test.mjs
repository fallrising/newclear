import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {handle, digest, initialState, applyReport, publicState, validateRoster, validateReport, STATES, TASKS} from '../src/core.mjs';
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const token = 'a'.repeat(40), other = 'b'.repeat(40);
const env = {OFFICE_MODE: 'live', AGENT_TOKEN_HASHES: JSON.stringify({grok: await digest(token), content: await digest(other)})};
const now = 1800000000000;
const report = (patch = {}) => ({agentId: 'grok', status: 'thinking', taskType: 'general', collaborators: [], eventId: randomUUID(), expectedRevision: 0, ...patch});
class Store {
  constructor(state = initialState()) { this.state = structuredClone(state); this.writes = 0; }
  read() { return structuredClone(this.state); }
  transact(fn) { const next = this.read(); const result = fn(next); this.state = next; this.writes++; return result; }
}
function request(data, {path = '/report', method = 'POST', auth = token, headers = {}} = {}) {
  return new Request(`https://office.example${path}`, {method, headers: {'content-type': 'application/json', ...(auth ? {authorization: `Bearer ${auth}`} : {}), ...headers}, ...(method === 'GET' ? {} : {body: typeof data === 'string' ? data : JSON.stringify(data)})});
}
const invoke = (data, options = {}, store = new Store(), settings = env) => handle(request(data, options), settings, store, roster, now);
test('roster config is valid, typed, unique and presentation-safe', () => {
  assert.equal(validateRoster(roster), roster);
  for (const bad of [null, {bots: [null]}, {bots: [{...roster.bots[0], id: undefined}]}, {bots: [roster.bots[0], roster.bots[0]]}, {bots: [{...roster.bots[0], name: '<script>'}]}]) assert.throws(() => validateRoster(bad));
});
test('eight states and seven task types accepted', () => {
  for (const status of STATES) for (const taskType of TASKS) assert.equal(validateReport(report({status, taskType}), roster).status, status);
});
test('raw summary and unknown properties are rejected, not persisted', async () => {
  const store = new Store(); const res = await invoke(report({summary: 'private text'}), {}, store);
  assert.equal(res.status, 422); assert.equal(store.writes, 0); assert.doesNotMatch(await res.text(), /private/);
});
test('IDs, status, revisions and event IDs fail closed', async () => {
  for (const patch of [{agentId: '../secret'}, {agentId: 'unknown'}, {status: 'off-duty'}, {expectedRevision: -1}, {expectedRevision: 0.5}, {eventId: 'not-a-uuid'}, {taskType: 'raw-task'}]) assert.equal((await invoke(report(patch))).status, 422);
});
test('collaborators must be known, distinct, not self and bounded', async () => {
  for (const collaborators of [['grok'], ['content', 'content'], ['../foo'], ['content', 'xstats', 'media', 'grok'], 'content']) assert.equal((await invoke(report({collaborators}))).status, 422);
  assert.equal((await invoke(report({collaborators: ['content']}))).status, 200);
});
test('missing, incorrect and cross-agent bearer credentials are rejected', async () => {
  for (const auth of [null, other, 'bad']) assert.equal((await invoke(report(), {auth})).status, 401);
  assert.equal((await invoke(report({agentId: 'content'}), {auth: token})).status, 401);
  assert.equal((await invoke(report({agentId: 'content'}), {auth: other})).status, 200);
});
test('missing or duplicate token hash configuration is unavailable', async () => {
  assert.equal((await invoke(report(), {}, new Store(), {OFFICE_MODE: 'live'})).status, 503);
  assert.equal((await invoke(report(), {}, new Store(), {...env, AGENT_TOKEN_HASHES: JSON.stringify({grok: await digest(token), content: await digest(token)})})).status, 503);
});
test('stream byte cap applies even without content-length', async () => {
  assert.equal((await invoke(' '.repeat(1025))).status, 413);
  assert.equal((await invoke('字'.repeat(350))).status, 413);
  assert.equal((await invoke('{}', {headers: {'content-length': '999999'}})).status, 413);
});
test('malformed JSON, content type, browser Origin and methods rejected', async () => {
  assert.equal((await invoke('{')).status, 400);
  assert.equal((await invoke(report(), {headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await invoke(report(), {headers: {origin: 'https://office.example'}})).status, 403);
  const response = await invoke(report(), {method: 'PUT'});
  assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
});
test('fixed routes never turn user input into a filesystem path', async () => {
  for (const path of ['/roster.json', '/state.json', '/%2e%2e%2fsecret', '/report/../secret', '/report/grok']) assert.equal((await invoke(report(), {path})).status, 404);
});
test('exact replay is idempotent; same event with changed body conflicts', async () => {
  const store = new Store(), data = report();
  assert.equal((await (await invoke(data, {}, store)).json()).revision, 1);
  assert.deepEqual(await (await invoke(data, {}, store)).json(), {ok: true, duplicate: true, revision: 1});
  assert.equal((await invoke({...data, status: 'done'}, {}, store)).status, 409);
});
test('late reports cannot overwrite newer revisions', async () => {
  const store = new Store();
  await invoke(report(), {}, store);
  assert.equal((await invoke(report({status: 'done', expectedRevision: 1}), {}, store)).status, 200);
  assert.equal((await invoke(report({status: 'coding', expectedRevision: 1}), {}, store)).status, 409);
  assert.equal(store.read().agents.grok.status, 'done');
});
test('per-agent quota survives snapshot reload and returns Retry-After', async () => {
  const store = new Store();
  for (let revision = 0; revision < 12; revision++) assert.equal((await invoke(report({expectedRevision: revision}), {}, store)).status, 200);
  const reloaded = new Store(store.read());
  const res = await invoke(report({expectedRevision: 12}), {}, reloaded);
  assert.equal(res.status, 429); assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.equal((await invoke(report({agentId: 'content'}), {auth: other}, reloaded)).status, 200);
});
test('stale projection becomes idle but retains alert and reported status', () => {
  const state = initialState(); applyReport(state, report({status: 'needs-you'}), now);
  const bot = publicState(state, roster, now + 1800000).bots[0];
  assert.equal(bot.status, 'idle'); assert.equal(bot.reportedStatus, 'needs-you'); assert.equal(bot.alert, true); assert.equal(bot.stale, true);
});
test('public read excludes authentication, event IDs, rate internals and fingerprints', async () => {
  const store = new Store(), data = report(); await invoke(data, {}, store);
  const res = await invoke(undefined, {path: '/state', method: 'GET', auth: null}, store);
  const text = await res.text();
  for (const forbidden of [token, data.eventId, 'recent', 'fingerprint', 'AGENT_TOKEN_HASHES', '"rate"']) assert.ok(!text.includes(forbidden));
  assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
test('demo reads do not read live storage and writes are forbidden', async () => {
  const store = {read() { throw new Error('must not read'); }, transact() { throw new Error('must not write'); }};
  const demoEnv = {...env, OFFICE_MODE: 'demo'};
  const res = await invoke(undefined, {method: 'GET', path: '/state'}, store, demoEnv);
  assert.equal((await res.json()).simulated, true);
  assert.equal((await invoke(report(), {}, store, demoEnv)).status, 403);
});
test('unregistered mode fails closed', async () => assert.equal((await invoke(report(), {}, new Store(), {...env, OFFICE_MODE: 'typo'})).status, 503));
test('history is bounded; expired event cannot replay over newer revision', () => {
  const state = initialState(), first = report(); applyReport(state, first, now);
  for (let i = 1; i < 40; i++) applyReport(state, report({expectedRevision: i}), now + i * 60000);
  assert.ok(state.agents.grok.recent.length <= 32);
  assert.throws(() => applyReport(state, first, now + 4000000), /revision_conflict/);
});
test('ordinary prototype-name IDs do not read inherited object properties', () => {
  const changed = {bots: [{...roster.bots[0], id: 'constructor'}]};
  assert.equal(publicState(initialState(), changed, now).bots[0].revision, 0);
});
