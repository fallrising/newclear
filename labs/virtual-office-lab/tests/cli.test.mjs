import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, chmod, symlink, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {buildReport, officeUrl, readToken, run} from '../bin/office-report.mjs';
import {handle, initialState, digest} from '../src/core.mjs';
const token = 'c'.repeat(40);
test('80 Unicode code points accepted; 81 and controls rejected', () => {
  assert.equal(buildReport(['grok', 'coding', '字'.repeat(80)]).report.status, 'coding');
  assert.doesNotThrow(() => buildReport(['grok', 'coding', '😀'.repeat(80)]));
  assert.throws(() => buildReport(['grok', 'coding', '字'.repeat(81)]));
  assert.throws(() => buildReport(['grok', 'coding', 'a\nb']));
});
test('private summary never appears in dry-run or network payload', async () => {
  const out = await run(['grok', 'coding', 'PRIVATE-ONLY-SAMPLE', '--dry-run', '--task', 'code'], {});
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE-ONLY-SAMPLE/); assert.equal(out.summary, '程式開發：撰寫程式');
  assert.ok(!Object.hasOwn(buildReport(['grok', 'coding', 'sample']).report, 'summary'));
});
test('short form uses explicit local agent binding', () => {
  const out = buildReport(['整理資料', 'content'], {OFFICE_AGENT: 'grok', OFFICE_STATUS: 'thinking'});
  assert.equal(out.report.agentId, 'grok'); assert.deepEqual(out.report.collaborators, ['content']);
});
test('only HTTPS origins or exact loopback HTTP accepted', () => {
  for (const input of ['http://office.example', 'https://token@office.example', 'https://office.example/path', 'https://office.example/?token=x', 'http://127.0.0.1.evil.example', 'file:///secret']) assert.throws(() => officeUrl(input));
  for (const input of ['https://office.example', 'http://127.0.0.1:8787', 'http://[::1]:8787']) assert.ok(officeUrl(input));
});
test('token file enforces owner-only permissions and refuses symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-token-'));
  try {
    const path = join(dir, 'key'); await writeFile(path, token, {mode: 0o600});
    assert.equal(await readToken({OFFICE_TOKEN_FILE: path}), token);
    await chmod(path, 0o644); await assert.rejects(readToken({OFFICE_TOKEN_FILE: path}));
    await chmod(path, 0o600); await symlink(path, join(dir, 'link'));
    await assert.rejects(readToken({OFFICE_TOKEN_FILE: join(dir, 'link')}));
  } finally { await rm(dir, {recursive: true, force: true}); }
});
test('bounded retries reuse event/revision; redirect policy and timeout set', async () => {
  const bodies = []; let attempts = 0;
  const fake = async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    if (url.endsWith('/state')) return Response.json({mode: 'live', bots: [{id: 'grok', revision: 7}]});
    bodies.push(init.body); attempts++;
    return attempts < 3 ? new Response('', {status: 503}) : Response.json({ok: true, duplicate: true, revision: 8});
  };
  assert.equal((await run(['grok', 'done', '工作結束'], {OFFICE_URL: 'https://office.example', OFFICE_TOKEN: token}, fake, async () => {})).revision, 8);
  assert.equal(bodies.length, 3); assert.equal(new Set(bodies).size, 1); assert.equal(JSON.parse(bodies[0]).expectedRevision, 7);
});
test('409 is not silently retried with a refreshed revision', async () => {
  let posts = 0;
  const fake = async url => url.endsWith('/state') ? Response.json({mode: 'live', bots: [{id: 'grok', revision: 0}]}) : (posts++, new Response('', {status: 409}));
  await assert.rejects(run(['grok', 'done', '工作結束'], {OFFICE_URL: 'https://office.example', OFFICE_TOKEN: token}, fake));
  assert.equal(posts, 1);
});
test('demo office never receives a report and long Retry-After is not ignored', async () => {
  let calls = 0;
  await assert.rejects(run(['grok', 'done', '完成'], {OFFICE_URL: 'https://office.example', OFFICE_TOKEN: token}, async () => { calls++; return Response.json({mode: 'demo', bots: [{id: 'grok', revision: 0}]}); }));
  assert.equal(calls, 1);
  await assert.rejects(run(['grok', 'done', '完成'], {OFFICE_URL: 'https://office.example', OFFICE_TOKEN: token}, async () => new Response('', {status: 429, headers: {'retry-after': '60'}})), /rate limited/);
});
test('real loopback HTTP: CLI -> handler -> public state; no raw summary on wire', async () => {
  const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url)));
  let state = initialState(); const bodies = [];
  const store = {read: () => structuredClone(state), transact(fn) { const next = structuredClone(state); const result = fn(next); state = next; return result; }};
  const env = {OFFICE_MODE: 'live', AGENT_TOKEN_HASHES: JSON.stringify({grok: await digest(token)})};
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks); if (body.length) bodies.push(body.toString());
      const incoming = new Request(`http://127.0.0.1${req.url}`, {method: req.method, headers: req.headers, ...(body.length ? {body} : {})});
      const response = await handle(incoming, env, store, roster);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await run(['grok', 'coding', 'LOCAL-SENSITIVE-SAMPLE', '--task', 'code'], {OFFICE_URL: url, OFFICE_TOKEN: token});
    assert.equal(result.revision, 1);
    const projection = await (await fetch(`${url}/state`)).json();
    assert.equal(projection.bots[0].status, 'coding');
    assert.equal(projection.bots[0].summary, '程式開發：撰寫程式');
    assert.ok(bodies.every(b => !b.includes('LOCAL-SENSITIVE-SAMPLE')));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
