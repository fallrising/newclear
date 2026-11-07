import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { canonicalBytes,sha256,parseStrictJson } from '../ops/recovery-protocol.mjs';
import { runJdbcHandshake } from './maintenance-helper.mjs';
const op='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',hash='a'.repeat(64);
function fixture(change=()=>{}) {
  const request={version:1,mode:'INVENTORY',operationId:op,side:'source',targetId:`pp1-local:${'b'.repeat(32)}`,
    releaseId:`sha256:${hash}`,jdbcUrl:'jdbc:postgresql://172.30.0.2:5432/cms',dbUser:'cms_local',
    passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  const backend={pid:71,backendStartEpoch:'1793550000.123456',db:'cms',role:'cms_local',clientAddr:'172.30.0.9',applicationName:op};
  const ready={version:1,operationId:op,side:'source',mode:'INVENTORY',requestSha256:sha256(canonicalBytes(request)),backend,readOnly:true};
  const result={version:1,operationId:op,mode:'INVENTORY',inventorySha256:hash,dbSnapshotSha256:hash,
    assetCount:'0',referencedFileCount:'0',orphanFileCount:'0',fileCount:'0',fileBytes:'0'};
  const child={stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()}, sent=[];
  child.stdin.on('data',b=>sent.push(b));
  const state={request,ready,result,backend,child,sent,rows:[structuredClone(backend)],afterRows:[],extra:Buffer.alloc(0),stderr:''};change(state);
  child.stdin.on('finish',()=>{child.stdout.end(Buffer.concat([canonicalBytes(state.result),state.extra]));child.stderr.end(state.stderr);});
  queueMicrotask(()=>child.stdout.write(state.rawReady??canonicalBytes(state.ready)));
  let observations=0;const events=[];
  const deps={address:'172.30.0.9',assertCurrent:async()=>events.push('assert'),
    observe:async()=>++observations===1?state.rows:state.afterRows,
    onReady:async()=>events.push('ready'),onPermitted:async()=>events.push('permitted')};
  return {...state,deps,events};
}
test('H02a_exact_ready_independent_backend_single_permit_EOF_result',async()=>{
  const f=fixture();assert.deepEqual(await runJdbcHandshake(f.child,f.request,f.deps),f.result);
  assert.deepEqual(parseStrictJson(Buffer.concat(f.sent)),{version:1,operationId:op,requestSha256:sha256(canonicalBytes(f.request)),backendSha256:sha256(canonicalBytes(f.backend)),action:'READ_INVENTORY'});
  assert.deepEqual(f.events,['assert','ready','assert','permitted']);
});
for(const [name,change] of Object.entries({
  ready_unknown:f=>f.ready.extra=true,request_hash:f=>f.ready.requestSha256='b'.repeat(64),operation:f=>f.ready.operationId='bad',
  side:f=>f.ready.side='target',mode:f=>f.ready.mode='REVOKE_SESSIONS',readonly:f=>f.ready.readOnly=false,
  extra_backend:f=>f.rows.push({...f.backend,pid:72}),replaced_backend:f=>f.rows[0].backendStartEpoch='1793550000.999999',
  wrong_ip:f=>f.rows[0].clientAddr='172.30.0.10',backend_epoch_number:f=>f.ready.backend.backendStartEpoch=1793550000,
  missing_backend:f=>f.rows=[],unknown_request:f=>f.request.password='secret-canary'
}))test(`H02a_reject_before_permit_${name}`,async()=>{
  const f=fixture(change);await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps));assert.equal(f.sent.length,0);
  f.child.stdout.destroy();f.child.stderr.destroy();
});
for(const [name,change] of Object.entries({
  extra_line:f=>f.extra=canonicalBytes({unexpected:true}),partial_extra:f=>f.extra=Buffer.from('x'),
  result_unknown:f=>f.result.extra=true,result_operation:f=>f.result.operationId='bad',
  result_count:f=>f.result.fileCount=1,backend_left:f=>f.afterRows=[f.backend],stderr:f=>f.stderr='secret-canary'
}))test(`H02a_reject_after_permit_${name}`,async()=>{
  const f=fixture(change);await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps),e=>!e.message.includes('canary'));
});
test('H02a_revoke_keeps_parent_receipt_shape_and_same_backend',async()=>{
  const f=fixture(x=>{x.request.mode='REVOKE_SESSIONS';x.request.side='target';x.request.mediaRoot=null;x.request.outputFile=null;
    x.request.backupId=`pp1-20261101T120000000Z-${'c'.repeat(32)}`;x.request.rawProofSha256=hash;
    x.ready.mode=x.request.mode;x.ready.side='target';x.ready.requestSha256=sha256(canonicalBytes(x.request));
    x.result={operationId:op,backupId:x.request.backupId,revokedCount:'2',auditEventId:'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',committed:true};});
  assert.deepEqual(await runJdbcHandshake(f.child,f.request,f.deps),f.result);
  assert.equal(parseStrictJson(Buffer.concat(f.sent)).action,'REVOKE_SESSIONS');
});

for(const [name,bytes] of [['oversized',Buffer.alloc(4097,120)],['duplicate',Buffer.from('{"a":1,"a":1}\n')],['noncanonical',Buffer.from('{ }\n')]]) {
 test(`H02a_bad_ready_wire_${name}`,async()=>{const f=fixture(x=>x.rawReady=bytes);await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps));f.child.stdout.destroy();f.child.stderr.destroy();});
}
test('H02a_ready_deadline_is_fixed_30_seconds',async()=>{
 const f=fixture();f.deps.waitDeadline=async(promise,ms)=>{promise.catch(()=>{});assert.equal(ms,30000);throw Error('timeout');};
 await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps));f.child.stdout.destroy();f.child.stderr.destroy();
});
test('H02a_java_fixed_failure_survives_without_raw_diagnostic',async()=>{
 const f=fixture();f.child.stdin.removeAllListeners('finish');
 f.child.stdin.on('finish',()=>{f.child.stdout.end();f.child.stderr.end('MEDIA_HASH_MISMATCH\n');});
 await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps),e=>e.code==='MEDIA_HASH_MISMATCH');
});
