import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable, Readable } from 'node:stream';
import { canonicalBytes,sha256,parseStrictJson } from '../ops/recovery-protocol.mjs';
import { runJdbcHandshake, pgpassBytes, runPgTool } from './maintenance-helper.mjs';
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
  assert.deepEqual(f.events.slice(0,4),['assert','ready','assert','permitted']);
  assert.ok(f.events.slice(4).length>=2&&f.events.slice(4).every(event=>event==='assert'));
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
test('H02a_permit_pipe_failure_is_handled_without_secret_or_unhandled_error',async()=>{
 const f=fixture();f.child.stdin._write=(_chunk,_encoding,callback)=>callback(Error('secret-canary'));
 await assert.rejects(()=>runJdbcHandshake(f.child,f.request,f.deps),e=>e.code==='CAPTURE_FAILED'&&!e.message.includes('canary'));
 f.child.stdout.destroy();f.child.stderr.destroy();
});

test('H04_pgpass_escapes_only_private_single_line',()=>{
 assert.equal(pgpassBytes(Buffer.from('a:b\\c')).toString(),'postgres:5432:cms:cms_local:a\\:b\\\\c\n');
 for(const value of ['x\n','x\r','x\0'])assert.throws(()=>pgpassBytes(Buffer.from(value)),e=>!e.message.includes(value));
});
function pgFixture(fault) {
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
 const backend={pid:71,backendStartEpoch:'1793550000.123456',db:'cms',role:'cms_local',clientAddr:'172.30.0.9',applicationName:op};
 const policy={kind:'PG_DUMP',entrypoint:'/usr/local/bin/pg_dump',args:['--host=postgres']};
 let live=true,observations=0;const output=[],diagnostic=[];
 const destination=parts=>new Writable({write(chunk,_encoding,callback){parts.push(Buffer.from(chunk));callback();}});
 const deps={operationId:op,address:backend.clientAddr,policy,output:destination(output),diagnostic:destination(diagnostic),
  assertCurrent:async()=>{},inspectProcess:async()=>!live||fault==='process'?[]:[{pid:123,args:[policy.entrypoint,...policy.args]}],
  observe:async()=>{observations++;if(!live)return fault==='left'?[backend]:[];
    if(fault==='missing')return [];if(fault==='extra')return [backend,{...backend,pid:72}];
    if(fault==='replace'&&observations>1)return [{...backend,backendStartEpoch:'1793550000.999999'}];return [backend];},
  onBackend:async()=>{}};
 const timer=setTimeout(()=>{live=false;child.stdout.end(Buffer.from('PGDMP-synthetic-stream-not-a-valid-database-archive'));child.stderr.end('private diagnostic');child.emit('close',fault==='nonzero'?7:0,null);},220);
 return {child,deps,output,diagnostic,stop:()=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();}};
}
test('H04_single_process_backend_raw_pipeline_and_final_zero',async()=>{
 const f=pgFixture();try{const result=await runPgTool(f.child,f.deps);assert.equal(result.backend.pid,71);
 assert.equal(result.byteSize,String(Buffer.concat(f.output).length));assert.equal(result.sha256,sha256(Buffer.concat(f.output)));
 assert.equal(Buffer.concat(f.diagnostic).toString(),'private diagnostic');}finally{f.stop();}
});
for(const fault of ['process','missing','extra','replace','left','nonzero'])test(`H04_reject_${fault}`,async()=>{
 const f=pgFixture(fault);try{await assert.rejects(()=>runPgTool(f.child,f.deps),e=>e.code==='CAPTURE_FAILED');}finally{f.stop();}
});
test('H04_failed_raw_output_does_not_return_success',async()=>{
 const f=pgFixture();f.deps.output=new Writable({write(_c,_e,cb){cb(Error('secret-canary'));}});
 try{await assert.rejects(()=>runPgTool(f.child,f.deps),e=>e.code==='CAPTURE_FAILED'&&!e.message.includes('canary'));}finally{f.stop();}
});

test('H04_process_exit_can_precede_private_output_drain',async()=>{
 const f=pgFixture();f.deps.output=new Writable({write(chunk,_encoding,callback){setTimeout(callback,350);}});
 try{const result=await runPgTool(f.child,f.deps);assert.equal(result.backend.pid,71);}finally{f.stop();}
});

test('H04_restore_streams_verified_input_without_raw_stdout',async()=>{
 const f=pgFixture();f.deps.policy={kind:'PG_RESTORE',entrypoint:'/usr/local/bin/pg_restore',args:['--host=postgres']};
 f.deps.inspectProcess=async()=>[{pid:123,args:[f.deps.policy.entrypoint,...f.deps.policy.args]}];
 f.deps.input=Readable.from([Buffer.from('synthetic-input')]);const sent=[];f.child.stdin.on('data',chunk=>sent.push(chunk));
 // This fixture's generic timer emits dump bytes; a restore child must emit none.
 const end=f.child.stdout.end.bind(f.child.stdout);f.child.stdout.end=()=>end();
 try{const result=await runPgTool(f.child,f.deps);assert.equal(Buffer.concat(sent).toString(),'synthetic-input');assert.equal(result.byteSize,'0');}finally{f.stop();}
});
test('H04_private_stderr_limit_rejects_excess',async()=>{
 const f=pgFixture();const end=f.child.stderr.end.bind(f.child.stderr);f.child.stderr.end=()=>end(Buffer.alloc(4194305,120));
 try{await assert.rejects(()=>runPgTool(f.child,f.deps),e=>e.code==='CAPTURE_FAILED');}finally{f.stop();}
});
