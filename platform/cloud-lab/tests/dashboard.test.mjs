import test from 'node:test';
import assert from 'node:assert/strict';
import { observation, commandView, makeSubmission, createClient, can, renderCommand, mount } from '../apps/control/public/dashboard.mjs';

const now = '2026-10-26T16:00:30Z';
const record = (overrides = {}) => ({
  command_id: 'cmd_demo', revision: 1, delivery: 'result_recorded', cancel_requested: false,
  command: { parameters: { max_sample_age_seconds: 30 } },
  result: { owner_outcome: 'succeeded', health: 'healthy', finished_at: '2026-10-26T16:00:10Z',
    received_at: now, artifact_sha256: 'a'.repeat(64), validation: { status: 'passed', checks: {} }, artifact_expires_at: '2026-11-02T16:00:10Z' },
  ...overrides,
});

test('freshness uses finished_at; delayed delivery never refreshes old observations', () => {
  assert.equal(observation(record(), now).tone, 'good');
  const stale = record(); stale.result.finished_at = '2026-10-26T15:59:59Z';
  assert.equal(observation(stale, now).state, 'stale');
  assert.notEqual(observation(stale, now).tone, 'good');
});

test('unknown, invalid timestamps and failed validation cannot become green', () => {
  for (const change of [{ health: 'unknown' }, { finished_at: 'invalid' }, { finished_at: '2026-10-26T16:00:31Z' },
    { owner_outcome: 'unknown' }, { validation: { status: 'failed' } }]) {
    const item = record(); Object.assign(item.result, change);
    assert.notEqual(observation(item, now).tone, 'good');
  }
  assert.equal(observation(record({ result: null, delivery: 'reconciling' }), now).state, 'unknown');
});

test('capabilities independently guard submit, cancellation and artifact download', () => {
  assert.equal(can(['commands:read'], 'artifact:read'), false);
  assert.equal(commandView(record(), ['commands:read'], now).artifactAvailable, false);
  assert.equal(commandView(record(), ['artifact:read'], now).artifactAvailable, true);
  assert.equal(commandView(record(), ['artifact:read'], '2026-11-03T00:00:00Z').artifactAvailable, false);
  const item = record({ delivery: 'awaiting_result', result: null, cancel_requested: true });
  const view = commandView(item, ['commands:cancel-request'], now);
  assert.match(view.cancelLabel, /取消意圖/);
  assert.equal(view.canCancel, false);
  assert.notEqual(view.status, '已停止');
});

test('submission includes only the exact documented immutable fields', () => {
  const bootstrap = { workspace_id: 'ws_demo', resource_ref: { resource_id: 'node_demo', generation: 1 },
    recipe_ref: { recipe_id: 'node-health', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) } };
  const body = makeSubmission(bootstrap, now, 'key_demo');
  assert.deepEqual(Object.keys(body).sort(), ['schema_version','schema_minor','workspace_id','resource_ref','recipe_ref','parameters',
    'idempotency_key','not_before','dispatch_deadline','execution_deadline','timeout_seconds','output_budget_bytes'].sort());
  assert.equal(body.dispatch_deadline, '2026-10-26T16:01:30Z');
  assert.equal(body.execution_deadline, '2026-10-26T16:02:30Z');
  assert.deepEqual(body.parameters, { max_sample_age_seconds: 30 });
  assert.equal(body.timeout_seconds, 10);
  assert.equal(body.output_budget_bytes, 16384);
});

test('API uses same-origin Access session; retry preserves exact request bytes', async () => {
  const calls = [];
  const client = createClient(async (path, init) => { calls.push({ path, init }); return new Response(JSON.stringify({ command: record(), request_id: 'req_demo' })); });
  const raw = '{"idempotency_key":"test"}';
  await client.submit(raw); await client.submit(raw); await client.cancel('id /?');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['X-Cloud-Lab'], '1');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[2].path, '/api/commands/id%20%2F%3F/cancel');
  assert.equal(calls[2].init.body, '{}');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('permission and artifact expiry errors preserve request IDs without retry', async () => {
  for (const status of [401, 403, 410]) {
    const client = createClient(async () => new Response(JSON.stringify({ code: 'DENIED', message: '<script>bad</script>', request_id: 'req_denied', retryable: false }), { status }));
    await assert.rejects(client.commands(), error => error.status === status && error.requestId === 'req_denied' && !error.retryable);
  }
});

test('renderer handles untrusted strings as text and provides encoded artifact route only with capability', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
    set innerHTML(_) { throw new Error('HTML interpolation forbidden'); }
    append(...items) { this.children.push(...items); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener() {}
  }
  const document = { createElement: tag => new Element(tag) };
  const item = record({ command_id: '<img src=x onerror=alert(1)>/test' });
  const root = renderCommand(document, item, ['artifact:read'], now, {});
  const all = element => [element, ...element.children.flatMap(all)];
  const nodes = all(root);
  assert(nodes.some(node => node.textContent === item.command_id));
  assert.equal(nodes.filter(node => node.tagName === 'img').length, 0);
  assert.equal(nodes.filter(node => node.tagName === 'button' && node.textContent === '下載 JSON 成果').length, 1);
});

test('malformed calendar values and absent freshness budgets remain unknown', () => {
  const item = record(); item.result.finished_at = '2026-02-30T16:00:10Z';
  assert.equal(observation(item, '2026-03-02T16:00:15Z').state, 'unknown');
  item.result.finished_at = '2026-10-26T16:00:10Z'; item.command.parameters = {};
  assert.equal(observation(item, now).state, 'unknown');
});

test('non-JSON Access response and oversized responses are explicit errors', async () => {
  const html = createClient(async () => new Response('<html>Access login</html>'));
  await assert.rejects(html.bootstrap(), /Access/);
  const huge = createClient(async () => new Response(JSON.stringify({ data: 'x'.repeat(32769) })));
  await assert.rejects(huge.commands(), /大小/);
});

test('Access HTML denial retains auth status before reading an oversized login page', async () => {
  for (const status of [401, 403]) {
    const client = createClient(async () => new Response('<html>' + 'x'.repeat(40000), { status, headers: { 'Content-Type': 'text/html' } }));
    await assert.rejects(client.bootstrap(), error => error.status === status);
  }
});

test('login HTML and redirects stop at the session boundary; server HTML errors stay transient', async () => {
  const login = createClient(async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(login.commands(), error => error.status === 401);
  const redirect = createClient(async (_path, init) => {
    assert.equal(init.redirect, 'manual');
    return { type: 'opaqueredirect', status: 0, body: null };
  });
  await assert.rejects(redirect.bootstrap(), error => error.status === 401);
  const unavailable = createClient(async () => new Response('<html>unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(unavailable.commands(), error => error.status === 503);
});

test('oversized streamed response is cancelled before consuming the remaining body', async () => {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(16385)); if (pulls === 8) controller.close(); },
    cancel() { cancelled = true; },
  });
  const client = createClient(async () => new Response(stream));
  await assert.rejects(client.commands(), /大小/);
  assert.equal(cancelled, true); assert(pulls < 8);
});

// Minimal DOM boundary for deterministic async ordering; actual Chromium covers rendering.
function mounted(t, client) {
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; this.hidden = false; this.disabled = false; this.className = ''; this.value = ''; }
    set textContent(value) { this.value = String(value); this.children = []; }
    get textContent() { return this.value + this.children.map(c => c.textContent).join(''); }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; this.value = ''; }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(k, v) { this.events[k] = v; }
    click() { return this.events.click?.(); }
    querySelectorAll(selector) {
      const all = this.children.flatMap(c => [c, ...c.querySelectorAll('*')]);
      return all.filter(c => selector === '*' || (selector === 'button' && c.tagName === 'button') ||
        (selector === '[data-command-id]' && c.attributes['data-command-id']) || (selector.startsWith('.') && c.className.split(' ').includes(selector.slice(1))));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  }
  const nodes = new Map();
  const doc = { hidden: false, createElement: tag => new Element(tag), getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id);
  } };
  const original = globalThis.addEventListener;
  globalThis.addEventListener = () => {};
  t.after(() => { if (original) globalThis.addEventListener = original; else delete globalThis.addEventListener; });
  t.mock.method(globalThis, 'setInterval', () => 0);
  const stop = mount(doc, client); t.after(stop);
  return { doc, node: doc.getElementById, settled: () => new Promise(resolve => setImmediate(resolve)) };
}
const bootstrapFixture = () => ({ now, workspace_id: 'test', resource_ref: { resource_id: 'node', generation: 1 },
  recipe_ref: { recipe_id: 'node-health', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) },
  capabilities: ['commands:read', 'commands:submit', 'node:health:read', 'artifact:read'] });

test('retry POST401/403 preserves uncertain bytes through explicit session recovery', async t => {
  let denied = 0; const submissions = [];
  const client = { bootstrap: async () => bootstrapFixture(), commands: async () => ({ commands: [] }), submit: async raw => {
    submissions.push(raw); if (submissions.length === 1) throw new Error('lost ACK');
    if (denied) throw Object.assign(new Error('denied'), { status: denied }); return {};
  } };
  const ui = mounted(t, client); await ui.settled(); await ui.node('submit').click();
  for (const status of [401, 403]) {
    denied = status; await ui.node('retry').click();
    assert.equal(ui.node('retry').hidden, false); assert.equal(ui.node('retry').disabled, true);
    denied = 0; await ui.node('refresh').click();
  }
  await ui.node('retry').click(); assert.equal(new Set(submissions).size, 1); assert.equal(ui.node('retry').hidden, true);
});

for (const lateStatus of [200, 403]) test(`obsolete artifact ${lateStatus} cannot invalidate recovered session or download`, async t => {
  let denied = false, complete, reject;
  const client = { bootstrap: async () => { if (denied) throw Object.assign(new Error('revoked'), { status: 403 }); return bootstrapFixture(); },
    commands: async () => ({ commands: [record()] }), artifact: () => new Promise((resolve, fail) => { complete = resolve; reject = fail; }) };
  let downloads = 0; t.mock.method(URL, 'createObjectURL', () => { downloads++; return 'blob:test'; });
  const ui = mounted(t, client); await ui.settled();
  const action = ui.node('commands').querySelector('button').click();
  denied = true; await ui.node('refresh').click(); denied = false; await ui.node('refresh').click();
  assert.equal(ui.node('submit').disabled, false);
  if (lateStatus === 200) complete({ health: 'healthy' }); else reject(Object.assign(new Error('old denial'), { status: 403 }));
  await action;
  assert.equal(ui.node('submit').disabled, false); assert.equal(ui.node('total-count').textContent, '1');
  assert.equal(ui.node('message').hidden, true); assert.equal(downloads, 0);
});
