/** Real local SQLite DO smoke. Run with pinned wrangler on PATH; no remote resources. */
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {run as lifecycle} from '../bin/office-run.mjs';
const dir = await mkdtemp(join(tmpdir(), 'office-workerd-'));
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const lifecycleToken = randomBytes(32).toString('base64url');
const lifecycleHash = createHash('sha256').update(lifecycleToken).digest('hex');
const origin = 'http://127.0.0.1:18787';
let child;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start() {
  child = spawn('wrangler', ['dev', '--local', '--ip', '127.0.0.1', '--port', '18787', '--config', join(dir, 'wrangler.json'), '--persist-to', join(dir, 'storage')], {detached: true, stdio: 'ignore', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
  let spawnError; child.on('error', error => { spawnError = error; });
  for (let i = 0; i < 120; i++) {
    if (spawnError || child.exitCode !== null) throw new Error('local wrangler failed to start');
    try { if ((await fetch(`${origin}/state`, {signal: AbortSignal.timeout(500)})).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error('local workerd readiness timeout');
}
async function stop() {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(100);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  child = undefined;
}
async function post(status, revision, eventId = randomUUID()) {
  return fetch(`${origin}/report`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify({agentId: 'grok', status, taskType: 'code', collaborators: [], eventId, expectedRevision: revision})});
}
try {
  await writeFile(join(dir, 'wrangler.json'), JSON.stringify({name: 'office-local-smoke', main: fileURLToPath(new URL('../src/worker.mjs', import.meta.url)), compatibility_date: '2026-10-01', workers_dev: false, vars: {OFFICE_ID: 'isolated-test', OFFICE_MODE: 'live'}, durable_objects: {bindings: [{name: 'OFFICE', class_name: 'OfficeRoom'}]}, migrations: [{tag: 'v1', new_sqlite_classes: ['OfficeRoom']}]}));
  await writeFile(join(dir, '.dev.vars'), `AGENT_TOKEN_HASHES='${JSON.stringify({grok: hash, content: lifecycleHash})}'\n`, {mode: 0o600});
  await start();
  const lifecycleResult = await lifecycle(['content', '--', process.execPath, '--check', fileURLToPath(new URL('../src/core.mjs', import.meta.url))],
    {...process.env, OFFICE_URL: origin, OFFICE_TOKEN: lifecycleToken});
  assert.deepEqual(lifecycleResult, {exitCode: 0, reported: true, started: true});
  const completed = (await (await fetch(`${origin}/state`)).json()).bots.find(bot => bot.id === 'content');
  assert.equal(completed.status, 'done');
  assert.equal(completed.revision, 2);
  // Reserve a full fixed-minute window for both process starts and quota checks.
  await sleep(60000 - Date.now() % 60000 + 100);
  const window = Math.floor(Date.now() / 60000);
  const firstEvent = randomUUID();
  assert.equal((await post('coding', 0, firstEvent)).status, 200);
  const concurrent = await Promise.all([post('thinking', 1), post('done', 1)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const before = await (await fetch(`${origin}/state`)).json();
  assert.equal(before.bots[0].revision, 2);
  // Fill the accepted-update quota before restarting the actual SQLite runtime.
  for (let revision = 2; revision < 12; revision++) {
    assert.equal((await post('coding', revision)).status, 200);
  }
  const full = await (await fetch(`${origin}/state`)).json();
  assert.equal(full.bots[0].revision, 12);
  assert.equal((await post('done', 12)).status, 429);
  await stop(); await start();
  const after = await (await fetch(`${origin}/state`)).json();
  assert.equal(after.bots[0].revision, 12);
  assert.equal(after.bots[0].reportedStatus, full.bots[0].reportedStatus);
  assert.equal(after.bots[0].lastSeen, full.bots[0].lastSeen);
  // A retry survives restart even at quota; changing the same event is rejected.
  assert.equal((await post('coding', 0, firstEvent)).status, 200);
  assert.equal((await post('done', 0, firstEvent)).status, 409);
  const limited = await post('done', 12);
  assert.equal(Math.floor(Date.now() / 60000), window, 'smoke exceeded fixed rate window; rerun on a faster host');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  const unchanged = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(unchanged.bots, after.bots, 'retries and rejected reports must not mutate public state');
  console.log('PASS: real local workerd SQLite DO CAS, restart, persisted state, deduplication and rate limit');
} finally { await stop(); await rm(dir, {recursive: true, force: true}); }
