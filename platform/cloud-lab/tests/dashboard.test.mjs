import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as dashboard from '../apps/control/public/dashboard.mjs';
import { observation, commandView, makeSubmission, createClient, can, renderCommand, mount } from '../apps/control/public/dashboard.mjs';

const now = '2026-10-26T16:00:30Z';
const record = (overrides = {}) => ({
  command_id: 'cmd_demo', revision: 1, delivery: 'result_recorded', cancel_requested: false,
  command: { parameters: { max_sample_age_seconds: 30 } },
  result: { owner_outcome: 'succeeded', health: 'healthy', finished_at: '2026-10-26T16:00:10Z',
    received_at: now, artifact_sha256: 'sha256:' + 'a'.repeat(64), validation: { status: 'passed', checks: {} }, artifact_expires_at: '2026-11-02T16:00:10Z' },
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
  const stop = mount(doc, {schedule: async () => ({schema_version:'cloudlab.health-schedule.v1',cron_verified:false,schedule:null,now}), ...client}); t.after(stop);
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

const scheduleFixture = () => ({schema_version:'cloudlab.health-schedule.v1',cron_verified:false,now,schedule:{id:'health-minute',revision:1,enabled:true,status:'ready',interval_minutes:15,not_before:'2026-10-26T16:00:00Z',expires_at:'2026-10-27T16:00:00Z',next_due_at:'2026-10-26T16:15:00Z',last_firing:{due_at:'2026-10-26T16:00:00Z',outcome:'submitted',command_id:'scheduled-one'},latest_result:record()}});
test('schedule panel renders next slot and historical result without claiming Cron verification',async t=>{
 const client={bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),schedule:async()=>scheduleFixture()};const ui=mounted(t,client);await ui.settled();
 assert.match(ui.node('schedule').textContent,/15 分鐘/);assert.match(ui.node('schedule').textContent,/16:15:00Z/);assert.match(ui.node('schedule').textContent,/不代表觸發器或執行端在線/);assert.match(ui.node('schedule').textContent,/最近完成觀測/);
});
test('schedule auth denial clears old schedule content and requires explicit recovery',async t=>{
 let denied=false;const client={bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),schedule:async()=>{if(denied)throw Object.assign(new Error('denied'),{status:403});return scheduleFixture();}};
 const ui=mounted(t,client);await ui.settled();assert.match(ui.node('schedule').textContent,/15 分鐘/);denied=true;await ui.node('refresh').click();assert.doesNotMatch(ui.node('schedule').textContent,/15 分鐘|scheduled-one/);assert.equal(ui.node('submit').disabled,true);
 denied=false;await ui.node('refresh').click();assert.match(ui.node('schedule').textContent,/15 分鐘/);
});
test('schedule result becomes stale and past next slot is not advertised as future',async t=>{
 const old=scheduleFixture();old.schedule.next_due_at='2026-10-26T16:00:00Z';old.schedule.latest_result.result.finished_at='2026-10-26T15:00:00Z';
 const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),schedule:async()=>old});await ui.settled();assert.match(ui.node('schedule').textContent,/觀測已過期/);assert.match(ui.node('schedule').textContent,/等待更新/);assert.doesNotMatch(ui.node('schedule').textContent,/Collector 正常/);
});
test('schedule API uses the authenticated read route',async()=>{
 const paths=[];const client=createClient(async(path,init)=>{paths.push(path);assert.equal(init.method,'GET');return Response.json(scheduleFixture());});assert.equal((await client.schedule()).schema_version,'cloudlab.health-schedule.v1');assert.deepEqual(paths,['/api/health-schedule']);
});

const usageFixture=()=>({schema_version:'cloudlab.usage.v1',observed_at:now,scope:{workspace_id:'test',resource_ref:bootstrapFixture().resource_ref,recipe_ref:bootstrapFixture().recipe_ref},application:{retained:{used:10,limit:10000,remaining:9990},rolling_24h:{used:4,limit:1440,remaining:1436,window_start_exclusive:'2026-10-25T16:00:30Z'},active:{used:1,limit:1,remaining:0}},provider:{status:'not_connected',workers_requests:null,d1_rows_read:null,d1_rows_written:null,d1_storage_bytes:null,billing:null}});
test('usage is manual-only, displays global counters and does not promise provider allowance',async t=>{
 let calls=0;const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),usage:async()=>{calls++;return usageFixture();}});await ui.settled();assert.equal(calls,0);
 await ui.node('refresh').click();assert.equal(calls,0);await ui.node('usage-refresh').click();assert.equal(calls,1);
 assert.match(ui.node('usage').textContent,/10 \/ 10000/);assert.match(ui.node('usage').textContent,/4 \/ 1440/);assert.match(ui.node('usage').textContent,/1 \/ 1/);assert.match(ui.node('usage').textContent,/Cloudflare.*未接入/);assert.match(ui.node('usage').textContent,/不保證/);
});
test('usage network failure preserves explicitly unconfirmed snapshot, not a fresh zero',async t=>{
 let fail=false;const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),usage:async()=>{if(fail)throw new Error('offline');return usageFixture();}});await ui.settled();await ui.node('usage-refresh').click();fail=true;await ui.node('usage-refresh').click();
 assert.match(ui.node('usage').textContent,/10 \/ 10000/);assert.match(ui.node('usage').textContent,/未確認/);
});
for(const status of [401,403])test(`usage ${status} clears sensitive snapshot and requires manual session recovery`,async t=>{
 let denied=false;const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[]}),usage:async()=>{if(denied)throw Object.assign(new Error('denied'),{status});return usageFixture();}});await ui.settled();await ui.node('usage-refresh').click();denied=true;await ui.node('usage-refresh').click();
 assert.doesNotMatch(ui.node('usage').textContent,/10 \/ 10000/);assert.equal(ui.node('usage-refresh').disabled,true);denied=false;await ui.node('refresh').click();assert.doesNotMatch(ui.node('usage').textContent,/10 \/ 10000/);await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/10 \/ 10000/);
});
for(const status of [200,403])test(`late usage ${status} after session revocation cannot refill data or invalidate recovered session`,async t=>{
 let denied=false,complete,reject,calls=0;const ui=mounted(t,{bootstrap:async()=>{if(denied)throw Object.assign(new Error('denied'),{status:403});return bootstrapFixture();},commands:async()=>({commands:[]}),usage:()=>{calls++;return new Promise((r,j)=>{complete=r;reject=j;});}});await ui.settled();
 const pending=ui.node('usage-refresh').click();await ui.node('usage-refresh').click();assert.equal(calls,1);denied=true;await ui.node('refresh').click();denied=false;await ui.node('refresh').click();assert.equal(typeof complete,'function');if(status===200)complete(usageFixture());else reject(Object.assign(new Error('old denial'),{status}));await pending;assert.doesNotMatch(ui.node('usage').textContent,/10 \/ 10000/);assert.equal(ui.node('submit').disabled,false);
});
test('usage stale/malformed/future snapshots and scope changes cannot advertise fresh counts',async t=>{
 let data=usageFixture();data.observed_at='2026-10-26T15:59:00Z';data.application.rolling_24h.window_start_exclusive='2026-10-25T15:59:00Z';let bootstrap=bootstrapFixture();
 const ui=mounted(t,{bootstrap:async()=>bootstrap,commands:async()=>({commands:[]}),usage:async()=>data});await ui.settled();await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/過期/);
 for(const patch of [{schema_version:'unknown'},{provider:{...usageFixture().provider,billing:0}},{observed_at:'2026-10-26T16:00:42Z'},{application:{...usageFixture().application,retained:{used:-1,limit:10000,remaining:10001}}}]){
  data={...usageFixture(),...patch};await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/未確認/);assert.doesNotMatch(ui.node('usage').textContent,/-1 \/ 10000/);
 }
 bootstrap={...bootstrap,workspace_id:'other'};await ui.node('refresh').click();assert.doesNotMatch(ui.node('usage').textContent,/10 \/ 10000/);
});
test('usage API is an authenticated GET through the existing bounded client',async()=>{
 const paths=[];const client=createClient(async(path,init)=>{paths.push(path);assert.equal(init.method,'GET');return Response.json(usageFixture());});assert.equal((await client.usage()).schema_version,'cloudlab.usage.v1');assert.deepEqual(paths,['/api/usage']);
});


test('usage freshness expires at exactly sixty seconds without changing historical counts',async t=>{
 for(const seconds of [59,60]){
  const time=new Date(Date.parse(now)+seconds*1000).toISOString().replace('.000Z','Z');
  const ui=mounted(t,{bootstrap:async()=>({...bootstrapFixture(),now:time}),commands:async()=>({commands:[]}),usage:async()=>usageFixture()});await ui.settled();await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/10 \/ 10000/);assert.equal(ui.node('usage').textContent.includes('快照已過期'),seconds===60);
 }
});

test('usage accepts normal second rollover within measured bootstrap latency but rejects beyond its bound',async t=>{
 let clock=0; t.mock.method(performance,'now',()=>clock);
 let observed='2026-10-26T16:00:33Z';
 const ui=mounted(t,{bootstrap:async()=>{clock+=1500;return bootstrapFixture();},commands:async()=>({commands:[]}),usage:async()=>{const d=usageFixture();d.observed_at=observed;d.application.rolling_24h.window_start_exclusive=observed.replace('26T','25T');return d;}});
 await ui.settled();await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/10 \/ 10000/);assert.doesNotMatch(ui.node('usage').textContent,/-3 秒/);
 observed='2026-10-26T16:00:34Z';await ui.node('usage-refresh').click();assert.match(ui.node('usage').textContent,/未確認/);assert.doesNotMatch(ui.node('usage').textContent,/16:00:34Z/);
});

test('bootstrap beyond the ten-second clock measurement bound leaves usage unavailable',async t=>{
 let clock=0;t.mock.method(performance,'now',()=>clock);let calls=0;
 const ui=mounted(t,{bootstrap:async()=>{clock+=10001;return bootstrapFixture();},commands:async()=>({commands:[]}),usage:async()=>{calls++;return usageFixture();}});await ui.settled();await ui.node('usage-refresh').click();assert.equal(calls,0);assert.equal(ui.node('usage-refresh').disabled,true);assert.match(ui.node('message').textContent,/時間估計已失效/);
});

test('operator-closed unknown stays unknown and cannot cancel or download a synthetic success', () => {
  const item=record();item.delivery='closed_unknown';
  const view=commandView(item,['commands:cancel-request','artifact:read'],now);
  assert.equal(view.status,'已結案，結果仍未知');assert.equal(view.state,'unknown');
  assert.equal(view.canCancel,false);assert.equal(view.artifactAvailable,false);
});

const artifactBytes = new TextEncoder().encode('{\n  "status": "healthy", "note": "觀測"\n}\n');
const artifactHash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const artifactRecord = () => { const r=record();r.result.artifact_sha256=artifactHash(artifactBytes);return r; };

test('DI artifact client preserves raw UTF-8 and whitespace across stream chunks',async()=>{
 const bytes=artifactBytes,client=createClient(async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,38));c.enqueue(bytes.slice(38));c.close();}}),{headers:{'Content-Type':'application/json'}}));
 assert.deepEqual(await client.artifact('cmd_demo'),bytes);
});

test('DI verifier rejects malformed metadata and mismatched bytes; returns an independent verified copy',async()=>{
 const input=artifactBytes.slice(),verified=await dashboard.verifyArtifact(input,artifactHash(input));
 assert.deepEqual(verified,input);assert.notEqual(verified,input);input[0]=0;assert.equal(verified[0],123);
 for(const hash of [null,'a'.repeat(64),'sha256:'+'A'.repeat(64),'sha256:'+'a'.repeat(63)])
  await assert.rejects(dashboard.verifyArtifact(artifactBytes,hash),e=>e.code==='ARTIFACT_METADATA_INVALID');
 const altered=new TextEncoder().encode(new TextDecoder().decode(artifactBytes)+' ');
 await assert.rejects(dashboard.verifyArtifact(altered,artifactHash(artifactBytes)),e=>e.code==='ARTIFACT_INTEGRITY_MISMATCH');
 await assert.rejects(dashboard.verifyArtifact(new Uint8Array(16385),artifactHash(artifactBytes)),e=>e.code==='ARTIFACT_TOO_LARGE');
});

test('DI artifact stream cancels at 16385 bytes and preserves API error status',async()=>{
 let pulled=0,cancelled=false;
 const client=createClient(async()=>new Response(new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array(pulled===1?16384:1));},cancel(){cancelled=true;}},{highWaterMark:0}),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(client.artifact('cmd_demo'),e=>e.code==='ARTIFACT_TOO_LARGE');assert.equal(pulled,2);assert.equal(cancelled,true);
 for(const status of [401,403,410]){
  const denied=createClient(async()=>new Response(JSON.stringify({code:'denied',request_id:'safe-request',message:'denied'}),{status,headers:{'Content-Type':'application/json'}}));
  await assert.rejects(denied.artifact('cmd_demo'),e=>e.status===status&&e.requestId==='safe-request');
 }
});

test('DI invalid digest metadata never offers download',()=>{
 for(const value of [null,'a'.repeat(64),'sha256:'+'A'.repeat(64)]){
  const r=record();r.result.artifact_sha256=value;assert.equal(commandView(r,['artifact:read'],now).artifactAvailable,false);
 }
});

for(const valid of [true,false])test(`DI mounted download ${valid?'preserves verified original bytes':'blocks a digest mismatch'}`,async t=>{
 let blob=null;const bytes=valid?artifactBytes:new TextEncoder().encode('{"status":"healthy"}');
 t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:test';});t.mock.method(URL,'revokeObjectURL',()=>{});
 const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:[artifactRecord()]}),artifact:async()=>bytes});await ui.settled();
 await ui.node('commands').querySelector('button').click();
 if(valid){assert.ok(blob);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),artifactBytes);}
 else{assert.equal(blob,null);assert.match(ui.node('message').textContent,/完整性/);}
});

test('DI unavailable crypto fails closed without a download',async t=>{
 t.mock.method(globalThis.crypto.subtle,'digest',async()=>{throw new Error('unavailable');});
 await assert.rejects(dashboard.verifyArtifact(artifactBytes,artifactHash(artifactBytes)),e=>e.code==='ARTIFACT_VERIFICATION_UNAVAILABLE');
});

for(const change of ['session','expiry','digest','capability'])test(`DI ${change} change while hashing prevents download`,async t=>{
 const realDigest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let finish,hashing=false,denied=false,current=artifactRecord(),caps=bootstrapFixture().capabilities,downloads=0;
 t.mock.method(globalThis.crypto.subtle,'digest',(...args)=>{hashing=true;return new Promise((resolve,reject)=>{finish=()=>realDigest(...args).then(resolve,reject);});});
 t.mock.method(URL,'createObjectURL',()=>{downloads++;return 'blob:test';});
 const ui=mounted(t,{bootstrap:async()=>{if(denied)throw Object.assign(new Error('revoked'),{status:403});return {...bootstrapFixture(),capabilities:caps};},commands:async()=>({commands:[current]}),artifact:async()=>artifactBytes});
 await ui.settled();const action=ui.node('commands').querySelector('button').click();await ui.settled();assert.equal(hashing,true);
 if(change==='session'){denied=true;await ui.node('refresh').click();denied=false;await ui.node('refresh').click();}
 if(change==='expiry'){current=structuredClone(current);current.result.artifact_expires_at=now;await ui.node('refresh').click();}
 if(change==='digest'){current=structuredClone(current);current.result.artifact_sha256='sha256:'+'0'.repeat(64);await ui.node('refresh').click();}
 if(change==='capability'){caps=caps.filter(x=>x!=='artifact:read');await ui.node('refresh').click();}
 await finish();await action;assert.equal(downloads,0);assert.equal(ui.node('total-count').textContent,'1');
 if(change==='session'){assert.equal(ui.node('submit').disabled,false);assert.equal(ui.node('message').hidden,true);}
});

test('DI maximum-sized diagnostic bytes verify without JSON reserialization',async()=>{
 const bytes=new Uint8Array(16384).fill(32);bytes[0]=123;bytes[bytes.length-1]=125;
 assert.deepEqual(await dashboard.verifyArtifact(bytes,artifactHash(bytes)),bytes);
 const diagnostic=new TextEncoder().encode('invalid JSON retained as diagnostic evidence');
 assert.deepEqual(await dashboard.verifyArtifact(diagnostic,artifactHash(diagnostic)),diagnostic);
});

test('DI artifact success requires JSON media type and cancels other content',async()=>{
 let cancelled=false;
 const client=createClient(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}},{highWaterMark:0}),{headers:{'Content-Type':'text/plain'}}));
 await assert.rejects(client.artifact('cmd_demo'),e=>e.code==='ARTIFACT_TYPE_INVALID');assert.equal(cancelled,true);
});

test('DI verifier copies bytes before waiting for crypto',async t=>{
 const original=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let finish;
 t.mock.method(globalThis.crypto.subtle,'digest',(...args)=>new Promise((resolve,reject)=>{finish=()=>original(...args).then(resolve,reject);}));
 const input=Buffer.from(artifactBytes),verification=dashboard.verifyArtifact(input,artifactHash(input));input[0]=0;
 await finish();assert.deepEqual(await verification,artifactBytes);
});


test('PS duplicate and skipped revisions are full snapshots, not event deltas',()=>{
 const prior=record({revision:2}),duplicate=structuredClone(prior),latest=record({revision:5,delivery:'closed_unknown',result:null});
 assert.deepEqual(dashboard.acceptCommandSnapshot([prior],[duplicate],now),[prior]);
 assert.deepEqual(dashboard.acceptCommandSnapshot([prior],[latest],now),[latest]);
 assert.deepEqual(prior,duplicate);
});

test('PS older revisions and equal-revision conflicts reject the complete batch',()=>{
 const prior=record({revision:5});
 for(const item of [record({revision:4,result:null}),record({revision:5,result:null})])
  assert.throws(()=>dashboard.acceptCommandSnapshot([prior],[record({command_id:'new'}),item],now),/快照/);
 assert.equal(prior.result.health,'healthy');
});

test('PS validates bounded unique IDs and positive safe revisions instead of silently truncating',()=>{
 for(const rows of [[record({revision:0})],[record({revision:1.5})],[record({revision:Number.MAX_SAFE_INTEGER+1})],[record({command_id:''})],[record(),record()],Array.from({length:21},(_,i)=>record({command_id:'id'+i}))])
  assert.throws(()=>dashboard.acceptCommandSnapshot([],rows,now),/快照/);
 assert.deepEqual(dashboard.acceptCommandSnapshot([record()],[],now),[]);
});

test('PS lease expiry projection is legal at the same revision and cannot roll back to running',()=>{
 const running=record({delivery:'dispatching',result:null,attempt:{lease_expires_at:now}}),expired={...running,delivery:'reconciling'};
 assert.deepEqual(dashboard.acceptCommandSnapshot([running],[expired],now),[expired]);
 assert.deepEqual(dashboard.acceptCommandSnapshot([expired],[running],now),[expired]);
 assert.equal(running.delivery,'dispatching');
 const before='2026-10-26T16:00:29Z';
 assert.throws(()=>dashboard.acceptCommandSnapshot([running],[expired],before),/快照/);
});

test('PS mounted stale/conflicting reads preserve state, disable actions and recover on fresh polling',async t=>{
 let rows=[record({revision:5})];
 const ui=mounted(t,{bootstrap:async()=>bootstrapFixture(),commands:async()=>({commands:structuredClone(rows)})});await ui.settled();
 const before=ui.node('commands').textContent;
 for(const revision of [4,5]){
  rows=[record({revision,result:null,delivery:'reconciling'})];await ui.node('refresh').click();
  assert.equal(ui.node('commands').textContent,before);assert.equal(ui.node('submit').disabled,true);
  assert.match(ui.node('message').textContent,/快照/);assert.match(ui.node('connection').textContent,/未確認/);
  assert(ui.node('commands').querySelectorAll('button').every(b=>b.disabled));
 }
 rows=[record({revision:8,result:null,delivery:'reconciling'})];await ui.node('refresh').click();
 assert.equal(ui.node('submit').disabled,false);assert.equal(ui.node('message').hidden,true);assert.equal(ui.node('unknown-count').textContent,'1');
});

test('PS changing scope clears the old comparison baseline even when new read fails',async t=>{
 let bootstrap=bootstrapFixture(),rows=[record({revision:5})],fail=false;
 const ui=mounted(t,{bootstrap:async()=>bootstrap,commands:async()=>{if(fail)throw new Error('offline');return {commands:rows};}});await ui.settled();
 bootstrap={...bootstrap,workspace_id:'other'};fail=true;await ui.node('refresh').click();
 assert.equal(ui.node('commands').textContent,'');assert.equal(ui.node('submit').disabled,true);
 fail=false;rows=[record({revision:1,result:null,delivery:'accepted'})];await ui.node('refresh').click();assert.equal(ui.node('total-count').textContent,'1');assert.equal(ui.node('submit').disabled,false);
});

test('PS auth loss clears revision baseline before explicit recovery',async t=>{
 let denied=false,rows=[record({revision:5})];
 const ui=mounted(t,{bootstrap:async()=>{if(denied)throw Object.assign(new Error('denied'),{status:403});return bootstrapFixture();},commands:async()=>({commands:rows})});await ui.settled();
 denied=true;await ui.node('refresh').click();denied=false;rows=[record({revision:1})];await ui.node('refresh').click();assert.equal(ui.node('submit').disabled,false);assert.equal(ui.node('message').hidden,true);
});
