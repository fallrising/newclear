import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../backend/src/worker.ts';
import { SqliteDatabase } from '../scripts/sqlite-db.mjs';
import { sample } from '../scripts/mock-agent.mjs';

// Worker handler + M0 contracts + M0 TelemetryStore on the node:sqlite port. NOW is in ms; the
// store works in UTC seconds, as the M0 schema does.
const NOW=Date.parse('2026-09-28T10:30:00Z');
const BOOT='00000000-0000-4000-8000-00000000000a';
function harness(t) {
  const db=new SqliteDatabase();t.after(()=>db.close());const env={db,mode:'demo'};
  const call=async(path,body,headers={},options={})=>{
    const req=new Request(options.url??'http://127.0.0.1:8787'+path,{method:body===undefined?'GET':'POST',headers:{'x-edge-demo-role':'viewer',...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
    const r=await handle(req,options.env??env,()=>options.now??NOW);
    return {status:r.status,body:await r.json(),headers:r.headers};
  };
  const enroll=()=>call('/agent/v1/enroll',{node_id:'node_demo01',display_name:'demo-01'},{authorization:'Demo node_demo01'});
  const send=(body,headers={},options={})=>call('/agent/v1/telemetry',body,{authorization:'Demo node_demo01',...headers},options);
  const node=async(now=NOW)=>(await call('/api/v1/nodes',undefined,{},{now})).body.data.nodes[0];
  return {db,env,call,enroll,send,node};
}
test('explicit loopback mock gate rejects disabled and public mode',async t=>{
 const h=harness(t);
 for(const opts of [{env:{db:h.db}},{env:{db:h.db,mode:'live'}},{url:'https://edge.example.invalid/api/v1/nodes'}]) assert.equal((await h.call('/api/v1/nodes',undefined,{},opts)).status,503);
 assert.equal((await h.call('/api/v1/nodes',undefined,{origin:'https://evil.invalid'})).status,403);
 assert.equal((await h.call('/api/v1/nodes')).body.data.auth,'mock-loopback-only');
});
test('empty database, bounded synthetic enrollment and human/machine identity separation',async t=>{
 const h=harness(t);assert.deepEqual((await h.call('/api/v1/nodes')).body.data.nodes,[]);
 assert.equal((await h.call('/agent/v1/enroll',{node_id:'node_demo01',display_name:'demo'})).status,401);
 assert.equal((await h.enroll()).status,201);assert.equal((await h.enroll()).status,201);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes.length,1);
 assert.equal((await h.node()).connectivity,'never-seen');
 assert.deepEqual((await h.call('/api/v1/nodes',undefined,{'x-edge-demo-role':'outsider'})).body.data.nodes,[]);
 assert.equal((await h.call('/api/v1/nodes/node_demo01',undefined,{'x-edge-demo-role':'outsider'})).status,404);
 assert.equal((await h.send(sample('node_demo02',NOW))).status,403);
});
test('enrollment writes the M0 schema: active node, monitor-only, no host authority',async t=>{
 const h=harness(t);await h.enroll();
 const row=h.db.connection.prepare('SELECT workspace_id,enrollment_generation,host_authority,status,mode FROM nodes').get();
 assert.deepEqual({...row},{workspace_id:'ws_demo',enrollment_generation:1,host_authority:'none',status:'active',mode:'monitor-only'});
});
test('a receipt is persisted; a byte-identical replay is a duplicate and adds no sample',async t=>{
 const h=harness(t);await h.enroll();const body=sample('node_demo01',NOW,3,BOOT);
 const first=await h.send(body);assert.equal(first.status,200);assert.equal(first.body.data.duplicate,false);
 const again=await h.send(body,{},{now:NOW+1000});
 assert.equal(again.status,200);assert.equal(again.body.data.duplicate,true);assert.equal(again.body.data.received_at,first.body.data.received_at);
 const n=await h.node(NOW+1000);assert.equal(n.sample_count,1);
 assert.equal(n.latest.metrics.network_rx_bytes,'9007199254740993');assert.equal(n.latest.report.metrics.net[0].rx_bytes_total,'9007199254740993');
 assert.equal(n.health,'healthy');assert.equal(n.latest.metrics.memory_used_percent,37.5);assert.equal(n.latest.metrics.disk_used_percent,43.5);
 assert.equal(h.db.connection.prepare('SELECT count(*) AS n FROM metric_samples').get().n,1);
});
test('same sample key and different content conflicts without overwriting data',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,BOOT);await h.send(b);
 const changed=sample('node_demo01',NOW,0,BOOT,1);
 const r=await h.send(changed);assert.equal(r.status,409);assert.equal(r.body.code,'sample_conflict');
 assert.equal((await h.node()).latest.metrics.cpu_avg_percent,24);
});
test('concurrent duplicate insertions have only one winning receipt',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,BOOT);
 const rs=await Promise.all(Array.from({length:12},()=>h.send(b)));
 assert.ok(rs.every(r=>r.status===200));assert.equal(rs.filter(r=>!r.body.data.duplicate).length,1);
 assert.equal((await h.node()).sample_count,1);
});
test('concurrent conflicting insertions do not produce two successful samples',async t=>{
 const h=harness(t);await h.enroll();
 const rs=await Promise.all([h.send(sample('node_demo01',NOW,0,BOOT)),h.send(sample('node_demo01',NOW,0,BOOT,2))]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
});
test('heartbeat and data freshness stay distinct: a replay proves liveness, not fresh data (SDD 02 §3)',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,BOOT);await h.send(b);
 assert.equal((await h.node(NOW+100_000)).connectivity,'stale');
 let n=await h.node(NOW+240_000);assert.equal(n.connectivity,'offline');assert.equal(n.health,'unknown');
 // M0 TelemetryStore sets last_seen from the receive time of every valid request, replays included.
 await h.send(b,{},{now:NOW+240_000});
 n=await h.node(NOW+240_000);assert.equal(n.connectivity,'online');assert.equal(n.data_fresh,false);assert.equal(n.health,'unknown');
 await h.send(sample('node_demo01',NOW+240_000,1,BOOT),{},{now:NOW+240_000});
 n=await h.node(NOW+240_000);assert.equal(n.connectivity,'online');assert.equal(n.data_fresh,true);assert.equal(n.health,'healthy');
});
test('late backfill changes history but never replaces a fresher observed sample',async t=>{
 const h=harness(t);await h.enroll();await h.send(sample('node_demo01',NOW,5,BOOT));
 await h.send(sample('node_demo01',NOW-600_000,4,BOOT,88));
 const n=await h.node();assert.equal(n.sample_count,2);assert.equal(n.latest.seq,5);assert.equal(n.health,'healthy');
});
test('backfill-only node is connected with stale, unknown telemetry',async t=>{
 const h=harness(t);await h.enroll();await h.send(sample('node_demo01',NOW-600_000,0,BOOT));
 const n=await h.node();assert.equal(n.connectivity,'online');assert.equal(n.data_fresh,false);assert.equal(n.health,'unknown');
});
test('unsupported metrics remain null, never manufactured zeroes',async t=>{
 const h=harness(t);await h.enroll();await h.send(sample('node_demo01',NOW,0,BOOT,null));
 const n=await h.node();assert.equal(n.health,'unknown');
 assert.equal(n.latest.metrics.cpu_avg_percent,null);assert.equal(n.latest.metrics.memory_used_percent,null);assert.equal(n.latest.metrics.disk_used_percent,null);
 assert.equal(n.latest.report.metrics.cpu_busy_bp,null);
});
test('M0 contract violations are rejected with the M0 error codes',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,BOOT);
 const cases=[
  [{...b,schema_version:'edgeops.telemetry.v99'},422,'unsupported_version'],
  [{...b,command:'reboot'},422,'unknown_field'],
  [{...b,seq:9007199254740992},400,'strict_json_integer_out_of_range'],
  [{...b,boot_id:'boot_1'},422,'invalid_field'],
  [{...b,metrics:{...b.metrics,cpu_busy_bp:{avg:10001,max:10001,last:0}}},422,'invalid_field'],
  [{...b,metrics:{...b.metrics,cpu_busy_bp:{avg:12.5,max:20,last:1}}},400,'strict_json_non_integer_number'],
  [{...b,metrics:{...b.metrics,mem_total_bytes:'18446744073709551616'}},422,'invalid_field'],
  [{...b,metrics:{...b.metrics,mem_total_bytes:100}},422,'invalid_field'],
  [{...b,metrics:{...b.metrics,disk_io:undefined}},422,'missing_field'],
  [{...b,enrollment_generation:2},409,'generation_mismatch'],
  [sample('node_demo01',NOW+60_000,0,BOOT),422,'outside_retention'],
 ];
 for(const [bad,status,code] of cases){const r=await h.send(bad);assert.equal(r.status,status,code);assert.equal(r.body.code,code);}
 assert.equal((await h.send('{"bad"')).body.code,'strict_json_syntax');
 assert.equal((await h.send('{"x":1,"x":2}')).body.code,'strict_json_duplicate_key');
 assert.equal((await h.send('{"a":1,"\\u0061":2}')).body.code,'strict_json_duplicate_key');
 assert.equal((await h.send('﻿{}')).body.code,'strict_json_bom');
 assert.equal((await h.send(' '.repeat(256*1024+1))).status,413);
 assert.equal((await h.node()).sample_count,0);
});
test('unauthenticated upload rejected before reading any body bytes',async t=>{
 const h=harness(t);let pulls=0;
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1));c.close();}},{highWaterMark:0});
 const r=await handle(new Request('http://127.0.0.1/agent/v1/telemetry',{method:'POST',body,duplex:'half'}),h.env,()=>NOW);
 assert.equal(r.status,401);assert.equal(pulls,0);
});
test('history ordering, truncation and query limits',async t=>{
 const h=harness(t);await h.enroll();
 for(let seq=0;seq<5;seq++) await h.send(sample('node_demo01',NOW-(4-seq)*60_000,seq,BOOT));
 const r=await h.call('/api/v1/nodes/node_demo01/metrics?limit=2');assert.equal(r.status,200);assert.equal(r.body.data.truncated,true);assert.deepEqual(r.body.data.samples.map(x=>x.seq),[3,4]);
 for(const q of ['limit=241','limit=-1','limit=abc','limit=1&limit=2','sql=DROP','from=2026-09-28','from=2026-01-01T00%3A00%3A00Z']) assert.equal((await h.call('/api/v1/nodes/node_demo01/metrics?'+q)).status,422,q);
});
test('clock and reset require mock operator and exact confirmation',async t=>{
 const h=harness(t);await h.enroll();
 assert.equal((await h.call('/demo/v1/reset',{confirm:'RESET_SYNTHETIC_DATA'})).status,403);
 assert.equal((await h.call('/demo/v1/reset',{confirm:false},{'x-edge-demo-role':'operator'})).status,422);
 assert.equal((await h.call('/demo/v1/clock',{advance_seconds:-1},{'x-edge-demo-role':'operator'})).status,422);
 assert.equal((await h.call('/demo/v1/clock',{advance_seconds:1.5},{'x-edge-demo-role':'operator'})).status,400);
 assert.equal((await h.call('/demo/v1/reset',{confirm:'RESET_SYNTHETIC_DATA'},{'x-edge-demo-role':'operator'})).status,200);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes.length,0);
});
test('job, log, recipe and bootstrap routes have no executable path',async t=>{
 const h=harness(t);
 for(const path of ['/agent/v1/jobs/claim','/api/v1/jobs','/api/v1/recipes','/api/v1/bootstrap','/api/v1/nodes/node_demo01/logs']) assert.equal((await h.call(path,{}, {'x-edge-demo-role':'operator'})).status,501);
});
test('failed transaction rolls back; storage errors never leak internals or success',async t=>{
 const h=harness(t);
 await assert.rejects(h.db.batch([{sql:"INSERT INTO workspaces VALUES('ws_demo',0,0)",params:[]},{sql:'INSERT INTO nonexistent VALUES(1)',params:[]}]));
 assert.equal(h.db.connection.prepare('SELECT count(*) AS n FROM workspaces').get().n,0);
 const r=await h.call('/api/v1/nodes',undefined,{}, {env:{mode:'demo',db:{all(){throw new Error('private database detail');},batch(){throw new Error('private database detail');}}}});
 assert.equal(r.status,503);assert.equal(r.body.retryable,true);assert.ok(!JSON.stringify(r.body).includes('private'));assert.ok(!Object.hasOwn(r.body,'data'));
});
test('bounded retained sample capacity rejects overflow but permits duplicate receipt',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,BOOT);await h.send(b);
 h.db.connection.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<4095)
 INSERT INTO metric_samples SELECT workspace_id,node_id,generation,boot_id,n.x,observed_at,received_at,body_sha256,payload FROM metric_samples,n WHERE seq=0;`);
 assert.equal((await h.send(sample('node_demo01',NOW,4096,BOOT))).status,429);
 assert.equal((await h.send(b)).body.data.duplicate,true);
});
