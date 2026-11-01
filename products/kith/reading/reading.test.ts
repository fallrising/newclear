import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, symlink, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { buildReading } from './build.ts';
import { parseBundle } from './bundle.ts';
import { runExport } from './export.ts';

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
async function fixture() {
  const root = await mkdtemp(join(process.env.AGENT_BUILD_DIR ?? tmpdir(), 'reading-'));
  const repo = join(root, 'repo'); const remote = join(root, 'remote.git');
  await mkdir(repo); git(repo, 'init', '-b', 'main'); git(repo, 'init', '--bare', remote);
  await writeFile(join(repo, 'README'), 'synthetic fixture\n'); git(repo, 'add', 'README'); git(repo, 'commit', '-m', 'initial'); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  return { root, repo, remote };
}
const capture = (id = 'capture_A') => ({ id, body: '  原文\nline 2  ', source: 'web', created_at: '2026-10-22T00:00:00.000Z', exported_commit: null as string | null });
const note = (revision = 1) => ({ id: 'note_A', article_id: 'article_A', body: ` 補充 ${revision}\n`, revision, updated_at: '2026-10-22T00:00:00.000Z', exported_commit: null as string | null });
function service() {
  const state = { captures: [capture()], notes: [note()], acks: [] as any[], failAck: false };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer kith_export_fixture');
    assert.equal(init?.redirect, 'error');
    const u = new URL(String(url));
    if (u.pathname.endsWith('/ack')) {
      const ack = JSON.parse(String(init?.body)); state.acks.push(ack);
      let captures = 0, notes = 0;
      for (const row of state.captures) if (ack.captures.includes(row.id) && row.exported_commit === null) { row.exported_commit = ack.commit; captures++; }
      for (const row of state.notes) if (ack.notes.some((n: any) => n.id === row.id && n.revision === row.revision) && row.exported_commit === null) { row.exported_commit = ack.commit; notes++; }
      if (state.failAck) { state.failAck = false; throw new Error('lost ACK response'); }
      return Response.json({ captures, notes });
    }
    const kind = u.searchParams.get('kind') as 'captures' | 'notes';
    const cursor = u.searchParams.get('cursor') ?? '';
    return Response.json({ records: state[kind].filter(row => row.id > cursor), next_cursor: null });
  };
  return { state, fetch: fetcher };
}
function options(repo: string, svc: ReturnType<typeof service>) { return { repo, branch: 'main', baseUrl: 'http://127.0.0.1:8080', token: 'kith_export_fixture', fetch: svc.fetch }; }

test('builder reads exact immutable commit, stable IDs survive rename; invalid build preserves complete old artifact', async () => {
  const { root, repo } = await fixture(); const output = join(root, 'bundle.json');
  await writeFile(join(repo, 'a.md'), '# A\n[Next](/reading/B)'); await writeFile(join(repo, 'b.md'), '# B');
  const registry = { version: 1, articles: [{ id: 'A', title: 'A', path: 'a.md' }, { id: 'B', title: 'B', path: 'b.md' }] };
  await writeFile(join(repo, 'articles.json'), JSON.stringify(registry)); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'articles'); const one = git(repo, 'rev-parse', 'HEAD');
  await writeFile(join(repo, 'a.md'), 'uncommitted ignored');
  assert.equal((await buildReading({ repo, commit: one, registry: 'articles.json', output })).articles[0]?.body, '# A\n[Next](/reading/B)');
  await rename(join(repo, 'a.md'), join(repo, 'renamed.md')); registry.articles[0]!.path = 'renamed.md'; await writeFile(join(repo, 'articles.json'), JSON.stringify(registry)); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'rename');
  const two = git(repo, 'rev-parse', 'HEAD'); assert.equal((await buildReading({ repo, commit: two, registry: 'articles.json', output })).articles[0]?.id, 'A');
  const old = await readFile(output, 'utf8');
  for (const invalid of [{ ...registry, articles: [...registry.articles, registry.articles[0]] }, { ...registry, articles: [{ id: 'A', title: 'A', path: '../outside' }] }, { version: 1, articles: [{ id: 'A', title: 'A', path: 'missing.md' }] }]) {
    await writeFile(join(repo, 'articles.json'), JSON.stringify(invalid)); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'bad');
    await assert.rejects(buildReading({ repo, commit: git(repo, 'rev-parse', 'HEAD'), registry: 'articles.json', output })); assert.equal(await readFile(output, 'utf8'), old);
  }
  await writeFile(join(repo, 'articles.json'), JSON.stringify(registry)); await writeFile(join(repo, 'renamed.md'), '[unknown](/reading/UNKNOWN)'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'unknown link');
  await assert.rejects(buildReading({ repo, commit: git(repo, 'rev-parse', 'HEAD'), registry: 'articles.json', output })); assert.equal(await readFile(output, 'utf8'), old);
  await symlink('b.md', join(repo, 'linked.md')); registry.articles[0]!.path = 'linked.md'; await writeFile(join(repo, 'articles.json'), JSON.stringify(registry)); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'symlink');
  await assert.rejects(buildReading({ repo, commit: git(repo, 'rev-parse', 'HEAD'), registry: 'articles.json', output }));
});

test('bundle validator rejects malformed Unicode, oversized/unknown fields and duplicate IDs', () => {
  const good = { version: 1, commit: 'a'.repeat(40), articles: [{ id: 'A', title: 'title', body: 'body' }] };
  assert.deepEqual(parseBundle(good), good);
  for (const bad of [{ ...good, commit: 'HEAD' }, { ...good, extra: 1 }, { ...good, articles: [...good.articles, ...good.articles] }, ...['\uD800', '\0', '', 'x'.repeat(65537)].map(body => ({ ...good, articles: [{ ...good.articles[0], body }] }))]) assert.equal(parseBundle(bad), null);
});

test('full reconciliation commits remote bytes before ACK; repeat produces no new commit; manual edits recorded', async () => {
  const { repo, remote } = await fixture(); const svc = service();
  const result = await runExport(options(repo, svc)); assert.equal(result.complete, true); assert.equal(svc.state.captures[0]!.exported_commit?.length, 40);
  const head = git(repo, 'rev-parse', 'HEAD'); await runExport(options(repo, svc)); assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(JSON.parse(git(remote, 'show', 'main:captures/capture_A.json')).body, capture().body);
  await writeFile(join(repo, 'notes/note_A.json'), '{"manual":true}\n'); git(repo, 'add', 'notes/note_A.json'); git(repo, 'commit', '-m', 'manual note edit'); git(repo, 'push');
  const reconciled = await runExport(options(repo, svc)); assert.ok(reconciled.overwrites.some(event => event.kind === 'notes' && event.id === 'note_A'));
  assert.equal(JSON.parse(git(remote, 'show', 'main:notes/note_A.json')).body, note().body);
});

for (const stage of ['afterWrite', 'afterCommit', 'afterPush'] as const) test(`journal recovers interruption ${stage} without duplicate commit or premature ACK`, async () => {
  const { repo, remote } = await fixture(); const svc = service();
  await assert.rejects(runExport({ ...options(repo, svc), fault(point) { if (point === stage) throw new Error('injected crash'); } }));
  assert.equal(svc.state.captures[0]!.exported_commit, null);
  await runExport(options(repo, svc)); assert.match(String(svc.state.captures[0]!.exported_commit), /^[a-f0-9]{40}$/u);
  const head = git(remote, 'rev-parse', 'main'); await runExport(options(repo, svc)); assert.equal(git(remote, 'rev-parse', 'main'), head);
  assert.equal(JSON.parse(git(remote, 'show', 'main:captures/capture_A.json')).body, capture().body);
});

test('old snapshot ACK leaves newer same-tick revision pending and next pass replaces fixed file', async () => {
  const { repo, remote } = await fixture(); const svc = service(); let changed = false;
  await runExport({ ...options(repo, svc), fault(stage, snapshot) { if (stage === 'afterPush' && snapshot.kind === 'notes' && !changed) { svc.state.notes[0] = note(2); changed = true; } } });
  assert.equal(svc.state.notes[0]!.exported_commit, null); await runExport(options(repo, svc));
  assert.equal(JSON.parse(git(remote, 'show', 'main:notes/note_A.json')).revision, 2); assert.ok(svc.state.notes[0]!.exported_commit);
});

test('lost ACK response recovers same committed snapshot without new commit', async () => {
  const { repo } = await fixture(); const svc = service(); svc.state.failAck = true;
  await assert.rejects(runExport(options(repo, svc))); const head = git(repo, 'rev-parse', 'HEAD');
  await runExport(options(repo, svc)); assert.equal(svc.state.acks.filter(ack => ack.captures.length > 0).length, 2);
  assert.equal(git(repo, 'rev-list', '--count', `${head}..HEAD`), '1'); // only the other kind's first export
});

test('concurrent pass is rejected; unrelated dirty files and symlink paths fail closed', async () => {
  const { repo, root } = await fixture(); const svc = service();
  let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  const first = runExport({ ...options(repo, svc), async fault(stage) { if (stage === 'afterWrite') { entered(); await barrier; } } });
  await started; await assert.rejects(runExport(options(repo, svc)), /lock|running/i); release(); await first;
  await writeFile(join(repo, 'unrelated.txt'), 'do not touch'); await assert.rejects(runExport(options(repo, svc)), /dirty|unrelated/i);
  assert.equal(await readFile(join(repo, 'unrelated.txt'), 'utf8'), 'do not touch');
  const fresh = await fixture(); await symlink(root, join(fresh.repo, 'captures')); await assert.rejects(runExport(options(fresh.repo, service()))); assert.equal(git(fresh.remote, 'rev-list', '--count', 'main'), '1');
});

test('push rejection retains pending journal and refuses to discard remote or local work', async () => {
  const { repo, remote, root } = await fixture(); const svc = service(); const other = join(root, 'other'); git(root, 'clone', '--branch', 'main', remote, other);
  await assert.rejects(runExport({ ...options(repo, svc), fault(stage) { if (stage === 'afterCommit') { execFileSync('git', ['-C', other, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'competing']); git(other, 'push'); } } }));
  assert.equal(svc.state.captures[0]!.exported_commit, null); await assert.rejects(runExport(options(repo, svc)), /diverg|conflict|push/i); assert.equal(svc.state.acks.length, 0);
});

test('untrusted export IDs and endpoint URLs are rejected before writes or credential forwarding', async () => {
  const { repo } = await fixture(); const svc = service(); svc.state.captures[0]!.id = '../escape';
  await assert.rejects(runExport(options(repo, svc))); assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1');
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'ftp://example.com']) await assert.rejects(runExport({ ...options(repo, svc), baseUrl }));
});

for (const stage of ['afterWrite', 'afterCommit', 'afterPush'] as const) test(`actual process SIGKILL ${stage} releases kernel lock and recovers journal`, { timeout: 20_000 }, async () => {
  const { root, repo, remote } = await fixture(); const svc = service();
  const script = join(root, 'crash.mjs');
  await writeFile(script, `import { runExport } from ${JSON.stringify(new URL('./export.ts', import.meta.url).href)};
const records = ${JSON.stringify([capture()])};
await runExport({ repo: ${JSON.stringify(repo)}, branch: 'main', baseUrl: 'http://127.0.0.1:8080', token: 'kith_export_fixture',
  fetch: async () => Response.json({records,next_cursor:null}),
  fault: async (stage) => { if(stage === ${JSON.stringify(stage)}) { process.send('cut'); await new Promise(() => {}); } }
});`);
  const child = fork(script, [], { execPath: process.execPath, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const signal = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Crash fixture exited before cut'); })]);
    assert.equal(signal[0], 'cut'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    await runExport(options(repo, svc)); assert.ok(svc.state.captures[0]!.exported_commit);
    const head = git(remote, 'rev-parse', 'main'); await runExport(options(repo, svc)); assert.equal(git(remote, 'rev-parse', 'main'), head);
    assert.equal(JSON.parse(git(remote, 'show', 'main:captures/capture_A.json')).body, capture().body);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('builder rejects malformed UTF-8 and missing commit without replacing output', async () => {
  const { repo, root } = await fixture(); const output = join(root, 'current.json');
  await writeFile(output, 'last complete bundle');
  await writeFile(join(repo, 'articles.json'), JSON.stringify({version:1,articles:[{id:'A',title:'A',path:'bad.md'}]}));
  await writeFile(join(repo, 'bad.md'), Buffer.from([0xf0, 0x90, 0x80])); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'invalid UTF8');
  await assert.rejects(buildReading({repo,commit:git(repo,'rev-parse','HEAD'),registry:'articles.json',output}));
  await assert.rejects(buildReading({repo,commit:'b'.repeat(40),registry:'articles.json',output}));
  assert.equal(await readFile(output,'utf8'), 'last complete bundle');
  await writeFile(join(repo, 'bad.md'), '\uFEFForiginal BOM'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'valid BOM');
  assert.equal((await buildReading({repo,commit:git(repo,'rev-parse','HEAD'),registry:'articles.json',output})).articles[0]?.body, '\uFEFForiginal BOM');
});

test('valid 100-row maximally JSON-escaped raw bodies survive response/journal limits', async () => {
  const { repo, remote } = await fixture(); const svc = service();
  svc.state.captures = Array.from({length:100}, (_, index) => ({ ...capture(`capture_${String(index).padStart(3,'0')}`), body: '\u0001'.repeat(16384) }));
  svc.state.notes = [];
  await runExport(options(repo, svc));
  assert.ok(svc.state.captures.every(row => row.exported_commit !== null));
  assert.equal(JSON.parse(git(remote,'show','main:captures/capture_099.json')).body, '\u0001'.repeat(16384));
});

test('tracked, ignored, nested and info attributes cannot execute configured clean filters', async () => {
  for (const placement of ['tracked','ignored','nested','info'] as const) {
    const { repo, root } = await fixture(); const svc = service(); const sentinel = join(root,'filter-executed');
    git(repo,'config','filter.attack.clean', `touch '${sentinel}'; cat`);
    if (placement === 'tracked') {
      await writeFile(join(repo,'.gitattributes'), '*.json filter=attack\n'); git(repo,'add','.gitattributes'); git(repo,'commit','-m','attributes'); git(repo,'push');
    } else if (placement === 'ignored') {
      await writeFile(join(repo,'.gitignore'), '.gitattributes\n'); git(repo,'add','.gitignore'); git(repo,'commit','-m','ignore'); git(repo,'push'); await writeFile(join(repo,'.gitattributes'),'*.json filter=attack\n');
    } else if (placement === 'nested') {
      await mkdir(join(repo,'notes')); await writeFile(join(repo,'notes/.gitattributes'),'*.json filter=attack\n');
    } else { await writeFile(join(repo,'.git/info/attributes'),'*.json filter=attack\n'); }
    await assert.rejects(runExport(options(repo,svc)), /attributes/i); await assert.rejects(access(sentinel)); assert.equal(svc.state.acks.length,0);
  }
});

test('CLI refuses public or symlink credential files without printing credential bytes', async () => {
  const { repo, root } = await fixture(); const tokenFile = join(root,'credential'); const token = 'kith_export_PRIVATE_CANARY';
  await writeFile(tokenFile,token); await chmod(tokenFile,0o644);
  const invoke = (path: string) => spawnSync(process.execPath, [new URL('./export.ts',import.meta.url).pathname,'--repo',repo,'--branch','main','--url','http://127.0.0.1:8080','--token-file',path], {encoding:'utf8',timeout:10000});
  const one = invoke(tokenFile); assert.equal(one.status,1); assert.ok(!(one.stdout + one.stderr).includes(token));
  await chmod(tokenFile,0o600); const link = join(root,'credential-link'); await symlink(tokenFile,link);
  const two = invoke(link); assert.equal(two.status,1); assert.ok(!(two.stdout + two.stderr).includes(token));
});

test('bundle byte/count limits are enforced including Unicode titles and complete artifact', () => {
  const article = {id:'A',title:'Title',body:'body'}; const bundle = {version:1,commit:'a'.repeat(40),articles:[article]};
  assert.equal(parseBundle({...bundle,articles:[{...article,title:'界'.repeat(67)}]}),null);
  assert.equal(parseBundle({...bundle,articles:Array.from({length:201},(_,n)=>({...article,id:String(n)}))}),null);
  assert.equal(parseBundle({...bundle,articles:Array.from({length:140},(_,n)=>({...article,id:String(n),body:'x'.repeat(65536)}))}),null);
});

test('100-page bound reports incomplete explicitly without acknowledging unseen work', {timeout:30000}, async () => {
  const { repo } = await fixture(); const svc = service();
  svc.state.captures = Array.from({length:100}, (_,index)=>capture(`capture_${String(index).padStart(3,'0')}`)); svc.state.notes=[];
  await runExport(options(repo,svc)); svc.state.acks=[]; let pages=0;
  const paged: typeof fetch = async (input,init) => {
    const url = new URL(String(input));
    if(url.pathname.endsWith('/ack')) return svc.fetch(input,init);
    assert.equal(url.searchParams.get('kind'),'captures'); const row=svc.state.captures[pages++]; assert.ok(row);
    return Response.json({records:[row],next_cursor:row.id});
  };
  await assert.rejects(runExport({...options(repo,svc),fetch:paged}), /incomplete.*page bound/i);
  assert.equal(pages,100); assert.equal(svc.state.acks.length,0);
});

test('unexpected redirect, oversized response and forged journal fail closed without private error text', async () => {
  const { repo } = await fixture(); const svc = service();
  for (const response of [new Response('PRIVATE_CANARY',{status:302,headers:{location:'https://other.invalid'}}),new Response('x'.repeat(16*1024*1024+1))]) {
    await assert.rejects(runExport({...options(repo,svc),fetch:async()=>response}), error=>error instanceof Error && !error.message.includes('PRIVATE_CANARY'));
  }
  await assert.rejects(runExport({...options(repo,svc),fault(){throw new Error('cut');}}));
  const path=join(repo,'.git/kith-reading-export/journal.json'); const journal=JSON.parse(await readFile(path,'utf8'));
  journal.records[0].id='../unsafe'; await writeFile(path,JSON.stringify(journal));
  await assert.rejects(runExport(options(repo,svc)),/Invalid export record/); assert.equal(svc.state.acks.length,0);
});
