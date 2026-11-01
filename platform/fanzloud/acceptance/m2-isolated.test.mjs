import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readCandidate, readReview, reviewResult} from '../apps/control-plane/web/candidate.js';
import {webcrypto} from 'node:crypto';
const source = (await readFile(new URL('../apps/control-plane/web/isolated.js', import.meta.url), 'utf8')).replace("import {readCandidate, readReview, reviewResult} from './candidate.js';", '');
const run = id => ({id, state: 'running', state_version: 3, cleanup_state: 'pending'});
async function page({stored, submit, action, getRun, tasks, submissions, artifacts, handoff} = {}) {
  const elements = new Map(), storage = new Map(stored || []), requests = [], timers = [];
  const node = id => {
    if (!elements.has(id)) elements.set(id, {value: '0', textContent: '', disabled: false, options: [], listeners: {}, children: [],
      addEventListener(type, fn) {this.listeners[type] = fn;},
      replaceChildren(...children) {this.children = children; this.options = children;}, append(child) {this.children.push(child);}, click() {this.clicked = true;}});
    return elements.get(id);
  };
  const context = vm.createContext({readCandidate, readReview, reviewResult, Blob, URL, document: {getElementById: node, createElement: () => node(Symbol())},
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
      else if (url.includes('/artifacts')) data = await artifacts(url);
      else if (options.method === 'POST' && (url.endsWith('/reviews') || url.endsWith('/rework'))) data = await handoff(url, options);
      else if (url.endsWith('/actions')) data = await action();
      else data = getRun ? await getRun(url.split('/').at(-1)) : run(url.split('/').at(-1));
      return {ok: true, status: 200, json: async () => data, text: async () => data};
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

test('C02: fixed candidate has an explicit authenticated read action', async () => {
  const p = await page();
  assert.equal(typeof p.node('load-candidate').listeners.click, 'function');
  assert.equal(p.node('download-candidate').disabled, true);
});

const candidateRunId = '018ff3ab-1277-7000-8000-000000000001';
const candidateArtifactId = '018ff3ab-1277-7000-8000-000000000002';
const candidateHash = async text => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
async function candidateFixture(mutate = () => {}) {
  const result = {base_sha: 'a'.repeat(40), diff: '修正\n', diff_bytes: 7, diff_sha256: await candidateHash('修正\n'), verification: {status: 'passed', checks: [{id: 'test', status: 'passed'}]}};
  const run = {id: candidateRunId, task_id: '018ff3ab-1277-7000-8000-000000000003', profile_revision: '018ff3ab-1277-7000-8000-000000000004', base_sha: result.base_sha, attempt_no: 1, goal: '<script>untrusted goal</script>', state: 'succeeded', state_version: 5, cleanup_state: 'confirmed', result};
  const archive = {schema_version: 'result-archive-v1', artifact_id: candidateArtifactId, run_id: run.id, task_id: run.task_id, profile_revision: run.profile_revision, base_sha: run.base_sha, attempt_no: 1, goal: run.goal, result: structuredClone(result)};
  mutate(archive); const raw = JSON.stringify(archive);
  const meta = {id: candidateArtifactId, run_id: run.id, kind: 'result', mime: 'application/json', pruned_at: null, sha256: await candidateHash(raw), size: new TextEncoder().encode(raw).length};
  const requests = [];
  const request = async (path, options) => {requests.push({path, options}); return path.endsWith('/artifacts') ? {items: [meta]} : raw;};
  return {run, raw, meta, request, requests};
}
test('C02: candidate verifies exact UTF8 archive, diff and identities without a mutation', async () => {
  const f = await candidateFixture(); const got = await readCandidate(f.run, f.request);
  assert.equal(got.raw, f.raw); assert.equal(got.sha256, f.meta.sha256); assert.notEqual(got.sha256, got.diff_sha256);
  assert.deepEqual(f.requests.map(x => x.path), [`/runs/${f.run.id}/artifacts`, `/runs/${f.run.id}/artifacts/${candidateArtifactId}`]);
  assert.equal(f.requests.some(x => x.options?.method), false);
});
test('C03: tampered metadata, missing/pruned archive and nonterminal writer fail closed', async () => {
  for (const change of [f => {f.meta.sha256 = '0'.repeat(64);}, f => {f.meta.size++;}, f => {f.meta.pruned_at = 'now';}, f => {f.meta.id = '../session';}, f => {f.meta.run_id = candidateArtifactId;}, f => {f.meta.mime = 'text/html';}, f => {f.meta.size = 1024*1024+1;}, f => {f.run.state = 'running';}, f => {f.meta.size = 1.5;}]) {
    const f = await candidateFixture(); change(f); await assert.rejects(readCandidate(f.run, f.request), /固定審查候選/);
  }
  const f = await candidateFixture();
  for (const items of [[], [f.meta, f.meta], null]) await assert.rejects(readCandidate(f.run, async () => ({items})), /固定審查候選/);
  await assert.rejects(readCandidate(f.run, async () => {throw new Error('410');}), /410/);
});
test('C03: rehashed foreign content cannot pass candidate identity and result binding', async () => {
  for (const mutate of [v => {v.run_id = candidateArtifactId;}, v => {v.task_id = candidateArtifactId;}, v => {v.profile_revision = candidateArtifactId;}, v => {v.base_sha = 'b'.repeat(40);}, v => {v.attempt_no = 2;}, v => {v.goal += '!';}, v => {v.artifact_id = candidateRunId;}, v => {v.schema_version = 'unknown';}, v => {v.result.diff += '!';}, v => {v.result.diff_bytes++;}, v => {v.result.diff_sha256 = '0'.repeat(64);}, v => {v.result.verification.status = 'failed';}]) {
    const f = await candidateFixture(mutate); await assert.rejects(readCandidate(f.run, f.request), /固定審查候選/);
  }
});
test('C04: load exposes hash as text; reread and download never dispatch', async () => {
  const f = await candidateFixture(); const p = await page({stored: [['fanz-current-run', f.run.id]], getRun: () => f.run, artifacts: url => f.request(url.replace('/api/v1',''))});
  assert.equal(p.node('load-candidate').disabled, false); await p.node('load-candidate').listeners.click();
  assert.match(p.node('candidate-status').textContent, new RegExp(f.meta.sha256));
  assert.match(p.node('candidate-status').textContent, /審查尚未開始/); assert.match(p.node('candidate-status').textContent, /test/); assert.equal(p.node('download-candidate').disabled, false);
  await p.node('download-candidate').listeners.click(); assert.equal(p.node('download-candidate').disabled, false);
  assert.equal(p.requests.filter(x => x.method !== 'GET').length, 0);
});
test('C04: late candidate after selection or logout cannot restore download', async () => {
  for (const logout of [false, true]) {
    const f = await candidateFixture(); let release;
    const p = await page({stored: [['fanz-current-run', f.run.id]], getRun: id => id === f.run.id ? f.run : run(id), artifacts: url => url.endsWith('/artifacts') ? new Promise(resolve => {release = resolve;}) : f.raw});
    const load = p.node('load-candidate').listeners.click(); await p.flush();
    if (logout) await p.node('logout').listeners.click(); else {p.node('recent-tasks').children[1].children[0].listeners.click(); await p.flush();}
    release({items: [f.meta]}); await load;
    assert.equal(p.node('download-candidate').disabled, true); assert.doesNotMatch(p.node('candidate-status').textContent, new RegExp(f.meta.sha256));
  }
});
test('C04: expiry during download clears candidate without cached bypass', async () => {
  const f = await candidateFixture(); let gone = false;
  const p = await page({stored: [['fanz-current-run', f.run.id]], getRun: () => f.run, artifacts: url => {if(gone) throw new Error('410'); return f.request(url.replace('/api/v1',''));}});
  await p.node('load-candidate').listeners.click(); gone = true; await p.node('download-candidate').listeners.click();
  assert.equal(p.node('download-candidate').disabled, true); assert.match(p.node('candidate-status').textContent, /未下載/);
  assert.equal(p.requests.filter(x => x.method !== 'GET').length, 0);
});

test('R03: fixed candidate explicitly hands off to opposite vendor once and unknown locks', async () => {
  const f = await candidateFixture(); f.run.backend = 'claude-subscription'; let calls = 0;
  const p = await page({stored: [['fanz-current-run', f.run.id]], getRun: () => f.run, artifacts: url => f.request(url.replace('/api/v1','')), handoff: () => {calls++; throw new Error('lost reply');}});
  await p.node('load-candidate').listeners.click();
  assert.deepEqual(p.node('review-agent').options.map(x => x.value), ['codex']);
  assert.equal(p.node('start-review').disabled, false); p.node('review-agent').value = 'codex';
  await p.node('start-review').listeners.click(); await p.node('start-review').listeners.click();
  assert.equal(calls, 1); assert.equal(p.node('start-review').disabled, true);
  assert.equal(p.node('submit-task').disabled, true);
  const post=p.requests.find(x=>x.url.endsWith('/reviews'));
  assert.deepEqual(JSON.parse(post.body), {artifact_id:f.meta.id,candidate_sha256:f.meta.sha256,profile_revision:'codex'});
});
test('R04: persisted unknown prevents review even after a new browser loads candidate', async () => {
  const f=await candidateFixture(); f.run.backend='claude-subscription';
  const p=await page({stored:[['fanz-current-run',f.run.id]],getRun:()=>f.run,artifacts:url=>f.request(url.replace('/api/v1','')),submissions:()=>({items:[],blocked:true})});
  await p.node('load-candidate').listeners.click(); assert.equal(p.node('start-review').disabled,true);
  await p.node('start-review').listeners.click(); assert.equal(p.requests.filter(x=>x.method==='POST').length,0);
});

async function reviewFixture(verdict = 'accept', mutate = () => {}) {
  const f=await candidateFixture(); const run=f.run;
  run.purpose='review'; run.backend='codex-subscription';
  run.review_context={root_writer_run_id:candidateArtifactId,writer_run_id:candidateArtifactId,artifact_id:candidateArtifactId,candidate_sha256:'b'.repeat(64),review_round:1,reviewer_profile_revision:run.profile_revision};
  run.result={verification:{status:'passed'},review:{...run.review_context,reviewer_run_id:run.id,verdict,reasons:['<img src=x onerror=alert(1)> 檢查與修復一致']}};
  const archive={schema_version:'result-archive-v1',artifact_id:f.meta.id,run_id:run.id,task_id:run.task_id,profile_revision:run.profile_revision,base_sha:run.base_sha,attempt_no:run.attempt_no,goal:run.goal,result:structuredClone(run.result)};
  mutate(archive); const raw=JSON.stringify(archive); const meta={...f.meta,sha256:await candidateHash(raw),size:new TextEncoder().encode(raw).length};
  return {run,raw,meta,request:async url=>url.endsWith('/artifacts')?{items:[meta]}:raw};
}
test('R03: typed review is hash/identity bound and downloads the exact immutable archive',async()=>{
  const f=await reviewFixture(); assert.equal((await readReview(f.run,f.request)).raw,f.raw);
  for (const mutate of [v=>v.result.review.candidate_sha256='c'.repeat(64),v=>v.result.review.reviewer_run_id=candidateArtifactId,v=>v.result.review.verdict='accept_anything']) {
    const bad=await reviewFixture('accept',mutate);await assert.rejects(readReview(bad.run,bad.request));
  }
  const wrong=structuredClone(f.run);wrong.result.review.candidate_sha256='c'.repeat(64);assert.throws(()=>reviewResult(wrong));
  const p=await page({stored:[['fanz-current-run',f.run.id]],getRun:()=>f.run,artifacts:f.request});
  assert.match(p.node('review-status').textContent,/接受候選/);assert.match(p.node('review-status').textContent,/<img/);
  assert.equal(p.node('download-diff').disabled,true);assert.equal(p.node('download-review').disabled,false);assert.equal(p.node('start-rework').disabled,true);
  await p.node('download-review').listeners.click();assert.equal(p.requests.filter(x=>x.method==='POST').length,0);
});
test('R04: only first request_changes exposes explicit rework, never an automatic loop',async()=>{
  const f=await reviewFixture('request_changes'); let calls=0;
  const p=await page({stored:[['fanz-current-run',f.run.id]],getRun:()=>f.run,handoff:async()=>{calls++;return{run:run('rework')};}});
  assert.equal(calls,0);assert.equal(p.node('start-rework').disabled,false);
  await p.node('start-rework').listeners.click();assert.equal(calls,1);
  const second=await reviewFixture('request_changes');second.run.review_context.review_round=2;second.run.result.review.review_round=2;
  const q=await page({stored:[['fanz-current-run',second.run.id]],getRun:()=>second.run});assert.equal(q.node('start-rework').disabled,true);
});
test('R03: late review download cannot survive selection or logout; expiry denies download',async()=>{
  for (const logout of [false,true]) {
    const f=await reviewFixture();let release;
    const p=await page({stored:[['fanz-current-run',f.run.id]],getRun:id=>id===f.run.id?f.run:run(id),artifacts:url=>url.endsWith('/artifacts')?new Promise(resolve=>{release=resolve;}):f.raw});
    const pending=p.node('download-review').listeners.click();await p.flush();
    if(logout)await p.node('logout').listeners.click();else{p.node('recent-tasks').children[0].children[0].listeners.click();await p.flush();}
    release({items:[f.meta]});await pending;assert.equal(p.node('download-review').disabled,true);
  }
  const f=await reviewFixture();const p=await page({stored:[['fanz-current-run',f.run.id]],getRun:()=>f.run,artifacts:()=>{throw new Error('410');}});
  await p.node('download-review').listeners.click();assert.equal(p.node('download-review').disabled,true);assert.match(p.node('review-status').textContent,/未下載/);
});
