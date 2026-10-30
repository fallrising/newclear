import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from '../tools/sqlite-d1.mjs';
import {handle, scheduled} from '../apps/control/worker/index.mjs';
import {digest, recipeRef, sign} from '../apps/control/worker/protocol.mjs';

const T = 1793059200000, DAY = 86400000;
// The Worker normalizes handler time and public timestamps to whole seconds.
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');

async function fixture(t) {
  const DB = new SQLiteD1();
  t.after(() => DB.close());
  const ref = await recipeRef(), secret = 'ab'.repeat(32);
  const env = {DB, PUBLIC_ORIGIN: 'https://lab.example', AUDIENCE: 'quota-test'};
  const grant = {
    principal_id: 'bot', workspace_id: 'ws', resource_ref: {resource_id: 'node', generation: 1},
    recipe_ref: ref, capabilities: ['commands:read', 'commands:submit', 'commands:cancel-request', 'node:health:read'],
    not_before: iso(T - 3 * DAY), expires_at: iso(T + 3 * DAY), max_timeout_seconds: 10, max_output_bytes: 16384,
  };
  DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run('bot', JSON.stringify(grant));
  env.MACHINE_KEYS = JSON.stringify({bot: {principal_id: 'bot', grant_id: 'bot', generation: 1, secret_hex: secret, expires_at: grant.expires_at}});
  DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute', 'bot');
  env.HEALTH_SCHEDULE = JSON.stringify({revision: 1, interval_minutes: 15, not_before: iso(T), expires_at: iso(T + 2 * DAY)});
  let nonce = 0;
  async function request(path, body, now = T) {
    const method = body === undefined ? 'GET' : 'POST', raw = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Math.floor(now / 1000)), n = (++nonce).toString(16).padStart(32, '0');
    const signature = await sign(secret, env.AUDIENCE, 'bot', 1, method, path, ts, n, raw);
    const response = await handle(new Request(env.PUBLIC_ORIGIN + path, {
      method, headers: {'content-type': 'application/json', 'x-lab-key-id': 'bot', 'x-lab-time': ts, 'x-lab-nonce': n, 'x-lab-signature': signature},
      ...(body === undefined ? {} : {body: raw}),
    }), env, now);
    return {status: response.status, data: await response.json()};
  }
  const command = (key, now = T) => ({schema_version: 'cloudlab.command.v1', schema_minor: 0,
    workspace_id: 'ws', resource_ref: grant.resource_ref, recipe_ref: ref,
    parameters: {max_sample_age_seconds: 30}, idempotency_key: key, not_before: iso(now),
    dispatch_deadline: iso(now + 60000), execution_deadline: iso(now + 120000), timeout_seconds: 10, output_budget_bytes: 16384});
  const submit = (key, now = T) => request('/api/commands', command(key, now), now);
  const count = () => DB.db.prepare('SELECT count(*) n FROM commands').get().n;
  const rows = () => DB.db.prepare('SELECT * FROM commands ORDER BY id').all();
  const fire = (due = T, now = due) => scheduled({scheduledTime: due}, env, now);
  // Synthetic history copied from a real API terminal record, not thousands of live executions.
  async function seed(total, created = T - 1000) {
    assert.equal(count(), 0);
    assert.ok(total >= 1);
    const accepted = await submit('seed-0', created);
    assert.equal(accepted.status, 202);
    const id = accepted.data.command.command_id;
    assert.equal((await request(`/api/commands/${id}/cancel`, {}, created)).status, 200);
    const original = DB.db.prepare('SELECT * FROM commands').get();
    assert.equal(original.created_at, created);
    const copies = [];
    for (let i = 1; i < total; i++) {
      const key = `seed-${i}`, body = JSON.stringify(command(key, created));
      const record = {...JSON.parse(original.record), command_id: key, command: JSON.parse(body)};
      copies.push([key, key, body, await digest(body), JSON.stringify(record)]);
    }
    DB.db.exec('BEGIN');
    try {
      const insert = DB.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      for (const [id, key, body, hash, record] of copies)
        insert.run(id, 'bot', key, body, hash, 'bot', 1, record, original.revision, 0, created);
      DB.db.exec('COMMIT');
    } catch (error) { DB.db.exec('ROLLBACK'); throw error; }
    return original;
  }
  return {DB, request, command, submit, count, rows, fire, seed};
}

for (const [limit, created] of [[1440, T - 1000], [10000, T - DAY - 1000]]) {
  test(`API accepts the last ${limit} slot; cancellation does not refund it and rejection preserves history`, async t => {
    const f = await fixture(t);
    await f.seed(limit - 1, created);
    const history = f.rows();
    const accepted = await f.submit('last');
    assert.equal(accepted.status, 202);
    assert.equal(f.count(), limit);
    const id = accepted.data.command.command_id;
    assert.equal((await f.request(`/api/commands/${id}/cancel`, {})).status, 200);
    const before = f.rows();
    const rejected = await f.submit('over');
    assert.equal(rejected.status, 429);
    assert.equal(rejected.data.code, 'QUOTA_EXCEEDED');
    assert.deepEqual(f.rows(), before);
    assert.deepEqual(f.rows().filter(row => row.id !== id), history);
    assert.equal((await f.request(`/api/commands/${id}`)).status, 200);
    assert.equal((await f.request('/api/commands', f.command('last'))).data.command.command_id, id);
    assert.equal((await f.request('/api/commands', {...f.command('last'), parameters: {max_sample_age_seconds: 20}})).status, 409);
    assert.deepEqual(f.rows(), before);
  });

  test(`Cron at ${limit} records a terminal quota skip without orphan work and preserves retry outcome`, async t => {
    const f = await fixture(t);
    await f.seed(limit, created);
    const before = f.rows();
    await f.fire();
    const firing = f.DB.db.prepare('SELECT * FROM firings').get();
    assert.equal(firing.outcome, 'skipped_quota');
    await f.fire(T, T + 30000);
    assert.deepEqual(f.DB.db.prepare('SELECT * FROM firings').all(), [firing]);
    assert.deepEqual(f.rows(), before);
    assert.equal(f.DB.db.prepare('SELECT last_due FROM schedules').get().last_due, T);
    const snapshot = await f.request('/api/health-schedule');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.schedule.last_firing.outcome, 'skipped_quota');
    assert.equal(snapshot.data.schedule.last_firing.command_id, null);
    assert.equal(snapshot.data.schedule.latest_result, null);
  });
}

test('rolling window excludes the exact lower bound; one second newer still consumes capacity', async t => {
  for (const offset of [0, 1000]) {
    const f = await fixture(t);
    await f.seed(1440, T - DAY + offset);
    const before = f.rows();
    assert.equal((await f.submit('boundary')).status, offset === 0 ? 202 : 429);
    assert.equal(f.count(), 1440 + (offset === 0 ? 1 : 0));
    assert.deepEqual(f.rows().filter(row => row.idem_key !== 'boundary'), before);
  }
});

test('window recovery keeps a skipped due final and admits only a new due without pruning history', async t => {
  const f = await fixture(t);
  await f.seed(1440, T);
  const history = f.rows();
  await f.fire();
  const first = f.DB.db.prepare('SELECT * FROM firings').get();
  assert.equal(first.outcome, 'skipped_quota');
  await f.fire(T, T + DAY);
  assert.equal(f.count(), 1440);
  assert.deepEqual(f.DB.db.prepare('SELECT * FROM firings').all(), [first]);
  await f.fire(T + DAY);
  assert.equal(f.count(), 1441);
  const newer = f.DB.db.prepare('SELECT * FROM firings WHERE due=?').get(T + DAY);
  assert.ok(f.DB.db.prepare('SELECT id FROM commands WHERE id=?').get(newer.outcome));
  assert.deepEqual(f.rows().filter(row => row.id !== newer.outcome), history);
  assert.equal((await f.submit('shared-api', T + DAY)).status, 429); // Shared single-active guard.
});

test('total retained cap does not recover with clock advance or expire old idempotency history', async t => {
  const f = await fixture(t), original = await f.seed(10000, T - DAY - 1000);
  const before = f.rows();
  assert.equal((await f.submit('later', T + DAY)).status, 429);
  const retry = await f.request('/api/commands', JSON.parse(original.body), T + DAY);
  assert.equal(retry.status, 202);
  assert.equal(retry.data.command.command_id, original.id);
  await f.fire(T + DAY);
  assert.equal(f.DB.db.prepare('SELECT outcome FROM firings').get().outcome, 'skipped_quota');
  assert.deepEqual(f.rows(), before);
});

test('API and Cron compete for the last rolling slot; at most one command is admitted', async t => {
  const f = await fixture(t);
  await f.seed(1439);
  const history = f.rows();
  const [api] = await Promise.all([f.submit('race'), f.fire()]);
  assert.ok([202, 429].includes(api.status));
  const additions = f.rows().filter(row => !history.some(old => old.id === row.id));
  assert.equal(additions.length, 1);
  assert.equal(f.count(), 1440);
  assert.deepEqual(f.rows().filter(row => row.id !== additions[0].id), history);
  const firing = f.DB.db.prepare('SELECT outcome FROM firings').get().outcome;
  if (api.status === 202) assert.equal(firing, 'skipped_quota');
  else assert.equal(firing, additions[0].id);
  assert.equal((await f.request(`/api/commands/${additions[0].id}/cancel`, {})).status, 200);
  assert.equal((await f.submit('after-race')).status, 429); // Quota, even with no active command.
});
