import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../backend/src/worker.ts';
import { SqliteD1 } from '../scripts/sqlite-d1.mjs';
import { sample } from '../scripts/mock-agent.mjs';
import { strictJson, telemetry, sampleDigest } from '../contracts/validation.ts';
const NOW=Date.parse('2026-09-28T10:30:00.000Z');
function harness(t) {
  const DB=new SqliteD1();t.after(()=>DB.close());const env={DB,MODE:'demo'};
  const call=async(path,body,headers={},options={})=>{
    const req=new Request(options.url??'http://127.0.0.1:8787'+path,{method:body===undefined?'GET':'POST',headers:{'x-edge-demo-role':'viewer',...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
    const r=await handle(req,options.env??env,()=>options.now??NOW);
    return {status:r.status,body:await r.json(),headers:r.headers};
  };
  const enroll=()=>call('/agent/v1/enroll',{node_id:'node_demo01',display_name:'demo-01'},{authorization:'Demo node_demo01'});
  const send=(body,headers={},options={})=>call('/agent/v1/telemetry',body,{authorization:'Demo node_demo01',...headers},options);
  return {DB,env,call,enroll,send};
}
test('explicit loopback mock gate rejects disabled and public mode',async t=>{
 const h=harness(t);
 for(const opts of [{env:{DB:h.DB}},{env:{DB:h.DB,MODE:'live'}},{url:'https://edge.example.invalid/api/v1/nodes'}]) assert.equal((await h.call('/api/v1/nodes',undefined,{},opts)).status,503);
 assert.equal((await h.call('/api/v1/nodes',undefined,{origin:'https://evil.invalid'})).status,403);
 assert.equal((await h.call('/api/v1/nodes')).body.data.auth,'mock-loopback-only');
});
test('empty database, bounded synthetic enrollment and human/machine identity separation',async t=>{
 const h=harness(t);assert.deepEqual((await h.call('/api/v1/nodes')).body.data.nodes,[]);
 assert.equal((await h.call('/agent/v1/enroll',{node_id:'node_demo01',display_name:'demo'})).status,401);
 assert.equal((await h.enroll()).status,201);assert.equal((await h.enroll()).status,201);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes.length,1);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes[0].connectivity,'never-seen');
 assert.deepEqual((await h.call('/api/v1/nodes',undefined,{'x-edge-demo-role':'outsider'})).body.data.nodes,[]);
 assert.equal((await h.call('/api/v1/nodes/node_demo01',undefined,{'x-edge-demo-role':'outsider'})).status,404);
 assert.equal((await h.send(sample('node_demo02',NOW))).status,403);
});
test('a receipt is persisted; replays preserve receipt, sample count, and heartbeat',async t=>{
 const h=harness(t);await h.enroll();const body=sample('node_demo01',NOW,3,'boot_test');
 const first=await h.send(body);assert.equal(first.status,200);assert.equal(first.body.data.duplicate,false);
 const again=await h.send({...body,sent_at:new Date(NOW+1000).toISOString()},{},{now:NOW+1000});
 assert.equal(again.body.data.duplicate,true);assert.equal(again.body.data.persisted_request_id,first.body.data.persisted_request_id);
 const n=(await h.call('/api/v1/nodes')).body.data.nodes[0];assert.equal(n.sample_count,1);assert.equal(n.last_seen_received_at,new Date(NOW).toISOString());
 assert.equal(n.latest.metrics.network_rx_bytes,'9007199254740993');assert.equal(n.health,'healthy');
});
test('same sample key and different content conflicts without overwriting data',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_test');await h.send(b);
 assert.equal((await h.send({...b,metrics:{...b.metrics,cpu_avg_percent:1}})).status,409);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes[0].latest.metrics.cpu_avg_percent,24);
});
test('concurrent duplicate insertions have only one winning receipt',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_race');
 const rs=await Promise.all(Array.from({length:12},()=>h.send(b)));
 assert.ok(rs.every(r=>r.status===200));assert.equal(rs.filter(r=>!r.body.data.duplicate).length,1);
 assert.equal(new Set(rs.map(r=>r.body.data.persisted_request_id)).size,1);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes[0].sample_count,1);
});
test('concurrent conflicting insertions do not produce two successful samples',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_race');
 const rs=await Promise.all([h.send(b),h.send({...b,metrics:{...b.metrics,cpu_avg_percent:2}})]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
});
test('stale heartbeat, offline, old replay and genuine recovery remain distinct',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_test');await h.send(b);
 assert.equal((await h.call('/api/v1/nodes',undefined,{}, {now:NOW+100_000})).body.data.nodes[0].connectivity,'stale');
 let n=(await h.call('/api/v1/nodes',undefined,{}, {now:NOW+240_000})).body.data.nodes[0];assert.equal(n.connectivity,'offline');assert.equal(n.health,'unknown');
 await h.send({...b,sent_at:new Date(NOW+240_000).toISOString()},{},{now:NOW+240_000});
 n=(await h.call('/api/v1/nodes',undefined,{}, {now:NOW+240_000})).body.data.nodes[0];assert.equal(n.connectivity,'offline');
 await h.send(sample('node_demo01',NOW+240_000,1,'boot_test'),{},{now:NOW+240_000});
 n=(await h.call('/api/v1/nodes',undefined,{}, {now:NOW+240_000})).body.data.nodes[0];assert.equal(n.connectivity,'online');assert.equal(n.health,'healthy');
});
test('late backfill changes history but never replaces a fresher observed sample',async t=>{
 const h=harness(t);await h.enroll();await h.send(sample('node_demo01',NOW,5,'boot_test'));
 const b=sample('node_demo01',NOW,4,'boot_test',88);b.observed_at=new Date(NOW-600_000).toISOString();await h.send(b);
 const n=(await h.call('/api/v1/nodes')).body.data.nodes[0];assert.equal(n.sample_count,2);assert.equal(n.latest.seq,5);assert.equal(n.health,'healthy');
});
test('backfill-only node is connected with stale, unknown telemetry',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW);b.observed_at=new Date(NOW-600_000).toISOString();await h.send(b);
 const n=(await h.call('/api/v1/nodes')).body.data.nodes[0];assert.equal(n.connectivity,'online');assert.equal(n.data_fresh,false);assert.equal(n.health,'unknown');
});
test('unsupported metrics remain null, never manufactured zeroes',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_null',null);b.metrics.disk_used_percent=null;await h.send(b);
 const n=(await h.call('/api/v1/nodes')).body.data.nodes[0];assert.equal(n.health,'unknown');assert.equal(n.latest.metrics.cpu_avg_percent,null);
});
test('invalid versions, commands, counters, windows and numeric values rejected',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW);
 for(const bad of [{...b,schema_version:'edgeops.telemetry.v99'},{...b,command:'reboot'},{...b,enrollment_generation:2},{...b,seq:9007199254740992},{...b,sample_count:0},{...b,metrics:{...b.metrics,cpu_avg_percent:101}},{...b,metrics:{...b.metrics,memory_total_bytes:'0'}},{...b,metrics:{...b.metrics,network_rx_bytes:'18446744073709551616'}},{...b,metrics:{...b.metrics,memory_used_bytes:100}}]) assert.equal((await h.send(bad)).status,422);
 assert.equal((await h.send('{"bad"')).status,400);
 assert.equal((await h.send('{"x":1,"x":2}')).status,422);
 assert.equal((await h.send(' '.repeat(16385))).status,413);
});
test('duplicate escaped keys and excessive nesting are rejected',()=>{
 assert.throws(()=>strictJson('{"a":1,"\\u0061":2}'));
 assert.throws(()=>strictJson('['.repeat(13)+'0'+']'.repeat(13)));
 assert.deepEqual(strictJson('{"a":{"x":1},"b":{"x":2},"c":["a","a"]}'),{a:{x:1},b:{x:2},c:['a','a']});
});
test('hash ignores envelope sent_at and property order, not sample content',async()=>{
 const b=sample('node_demo01',NOW,0,'boot_hash');const perm=Object.fromEntries(Object.entries(b).reverse());perm.sent_at='2026-09-28T10:30:01.000Z';
 assert.equal(await sampleDigest(b),await sampleDigest(perm));
 assert.notEqual(await sampleDigest(b),await sampleDigest({...b,seq:1}));
});
test('unauthenticated upload rejected before reading any body bytes',async t=>{
 const h=harness(t);let pulls=0;
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1));c.close();}},{highWaterMark:0});
 const r=await handle(new Request('http://127.0.0.1/agent/v1/telemetry',{method:'POST',body,duplex:'half'}),h.env,()=>NOW);
 assert.equal(r.status,401);assert.equal(pulls,0);
});
test('history ordering, truncation and query limits',async t=>{
 const h=harness(t);await h.enroll();
 for(let seq=0;seq<5;seq++){const b=sample('node_demo01',NOW,seq,'boot_test');b.observed_at=new Date(NOW-(4-seq)*60_000).toISOString();await h.send(b);}
 const r=await h.call('/api/v1/nodes/node_demo01/metrics?limit=2');assert.equal(r.status,200);assert.equal(r.body.data.truncated,true);assert.deepEqual(r.body.data.samples.map(x=>x.seq),[3,4]);
 for(const q of ['limit=241','limit=-1','limit=abc','limit=1&limit=2','sql=DROP','from=2026-09-28','from=2026-01-01T00%3A00%3A00.000Z']) assert.equal((await h.call('/api/v1/nodes/node_demo01/metrics?'+q)).status,422);
});
test('clock and reset require mock operator and exact confirmation',async t=>{
 const h=harness(t);await h.enroll();
 assert.equal((await h.call('/demo/v1/reset',{confirm:'RESET_SYNTHETIC_DATA'})).status,403);
 assert.equal((await h.call('/demo/v1/reset',{confirm:false},{'x-edge-demo-role':'operator'})).status,422);
 assert.equal((await h.call('/demo/v1/clock',{advance_seconds:-1},{'x-edge-demo-role':'operator'})).status,422);
 assert.equal((await h.call('/demo/v1/reset',{confirm:'RESET_SYNTHETIC_DATA'},{'x-edge-demo-role':'operator'})).status,200);
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes.length,0);
});
test('job, log, recipe and bootstrap routes have no executable path',async t=>{
 const h=harness(t);
 for(const path of ['/agent/v1/jobs/claim','/api/v1/jobs','/api/v1/recipes','/api/v1/bootstrap','/api/v1/nodes/node_demo01/logs']) assert.equal((await h.call(path,{}, {'x-edge-demo-role':'operator'})).status,501);
});
test('failed transaction rolls back; storage errors never leak internals or success',async t=>{
 const h=harness(t);
 await assert.rejects(h.DB.batch([h.DB.prepare("INSERT INTO nodes VALUES('node_demo01','ws_demo','test',1,'Linux','amd64','test',NULL)"),h.DB.prepare('INSERT INTO nonexistent VALUES(1)')]));
 assert.equal((await h.call('/api/v1/nodes')).body.data.nodes.length,0);
 const r=await h.call('/api/v1/nodes',undefined,{}, {env:{MODE:'demo',DB:{prepare(){throw new Error('private database detail');}}}});
 assert.equal(r.status,503);assert.equal(r.body.retryable,true);assert.ok(!JSON.stringify(r.body).includes('private'));assert.ok(!Object.hasOwn(r.body,'data'));
});
test('bounded retained sample capacity rejects overflow but permits duplicate receipt',async t=>{
 const h=harness(t);await h.enroll();const b=sample('node_demo01',NOW,0,'boot_cap');await h.send(b);
 h.DB.connection.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<4095)
 INSERT INTO samples SELECT node_id,generation,boot_id,n.x,observed_at,received_at,request_id||'-copy-'||n.x,digest,payload FROM samples,n WHERE seq=0;`);
 assert.equal((await h.send({...b,seq:4096})).status,429);
 assert.equal((await h.send(b)).body.data.duplicate,true);
});
