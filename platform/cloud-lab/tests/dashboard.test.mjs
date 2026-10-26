import test from 'node:test';
import assert from 'node:assert/strict';
import { observation, commandView, makeSubmission, createClient, can, renderCommand } from '../apps/control/public/dashboard.mjs';

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
