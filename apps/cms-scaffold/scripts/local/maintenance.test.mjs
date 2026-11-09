import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter, getEventListeners } from 'node:events';
import { parseArgs, run } from './maintenance.mjs';
import { canonicalBytes, OpsError } from '../ops/recovery-protocol.mjs';
const id='a'.repeat(32), op='10000000-0000-0000-0000-000000000001', java='/verified/jdk25/bin/java';
const digest=b=>createHash('sha256').update(b).digest('hex');
const nodeSha=digest(await readFile(process.execPath));
const tail=['fresh-init','--username','PP1.Root','--display-name','PP1 root','--target-id',`pp1-local:${id}`,'--operation-id',op,'--confirm','FRESH_INIT'];
const argv=(jar,javaBin=java)=>['--run-id',id,'--java-bin',javaBin,'--jar',jar,'--',...tail];
async function fixture(t) {
  const cwd=await mkdtemp(join(tmpdir(),'pp1-bridge-')); t.after(()=>rm(cwd,{recursive:true,force:true}));
  const libs=join(cwd,'services/cms-api/build/libs'), root=join(cwd,'local/pp1',id), jar=join(libs,'app.jar'), javaBin=join(cwd,'tools/java');
  await mkdir(libs,{recursive:true,mode:0o700}); await mkdir(join(root,'secrets'),{recursive:true,mode:0o700});
  await mkdir(join(cwd,'scripts/local'),{recursive:true,mode:0o700});
  await mkdir(join(cwd,'tools'),{mode:0o700});await writeFile(javaBin,'synthetic java',{mode:0o700});
  await writeFile(jar,'synthetic jar'); await writeFile(join(cwd,'scripts/local/maintenance-guard.mjs'),'synthetic guard');
  await writeFile(join(root,'secrets/spring.datasource.password'),'db-only-canary',{mode:0o600});
  const inspection={target:{runId:id,targetId:`pp1-local:${id}`,nodeBinarySha256:nodeSha,apiBuild:{jarSha256:digest('synthetic jar')}},jdbcUrl:'jdbc:postgresql://172.18.0.2:5432/cms',dataGateway:'172.18.0.1'};
  const lease={...inspection.target,connection:{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway}};
  const events=[], spawned=[], inspectCalls=[]; let childExit=0, signal=null, finishFailure=null;
  const deps={cwd,environment:{JAVA_TOOL_OPTIONS:'forbidden',NODE_OPTIONS:'forbidden',CMS_BAD:'forbidden'},tty:{stdin:true,stdout:true,stderr:true},
    inspect:async(...args)=>{assert.equal(args[0],root);inspectCalls.push(args);events.push('inspect');return inspection;},
    command:async(file,args,options)=>{assert.equal(file,javaBin);assert.deepEqual(args,['-XshowSettings:properties','-version']);assert.deepEqual(options.env,{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'});assert.equal(options.timeout,30000);events.push('version');return {stderr:'java.specification.version = 25',stdout:''};},
    acquire:async(actual,operation)=>{assert.equal(actual,inspection);assert.deepEqual(operation,{operationId:op,operation:'FRESH_INIT'});events.push('acquire');return lease;},
    spawn:(file,args,options)=>{events.push('spawn');spawned.push({file,args,originalEnv:options.env,options:{...options,env:{...options.env}}});const child=new EventEmitter();child.kill=s=>{events.push(`kill:${s}`);queueMicrotask(()=>child.emit('exit',null,s));};
      queueMicrotask(()=>{spawned.at(-1).clearedBeforeExit=!Object.hasOwn(options.env,'SPRING_DATASOURCE_PASSWORD');signal?process.emit(signal):child.emit('exit',childExit,null);});return child;},
    finish:async(actual,exit)=>{assert.equal(actual,lease);assert.ok(Number.isInteger(exit));events.push(`finish:${exit}`);if(finishFailure)throw new Error(finishFailure);return {phase:'COMPLETE'};}};
  return {cwd,root,jar,java:javaBin,lease,inspection,deps,events,spawned,inspectCalls,setExit:n=>childExit=n,setSignal:s=>signal=s,setFinish:s=>finishFailure=s};
}
test('strict parse keeps canonical operation and rejects every invalid flag before work',()=>{
  const parsed=parseArgs(argv('/synthetic/app.jar'));assert.equal(parsed.operation,'FRESH_INIT');assert.equal(parsed.operationId,op);assert.deepEqual(parsed.maintenanceArgs,tail);
  for(const input of [[],[...argv('/x'),'--unknown'],['--run-id',id,...argv('/x')],argv('/x').map(v=>v===op?'1-1-1-1-1':v),argv('/x').map(v=>v==='FRESH_INIT'?'FRESH_INIT ':v),[...argv('/x'),'--password','secret'],[...argv('/x'),'--reenable'],argv('/x').map(v=>v==='PP1.Root'?'seed-admin':v)]) assert.throws(()=>parseArgs(input),{message:'INPUT_INVALID'});
  const recover=['--run-id',id,'--java-bin',java,'--jar','/x','--','recover-admin','--principal-id',op,'--target-id',`pp1-local:${id}`,'--operation-id',op,'--confirm','RECOVER_ADMIN','--reenable'];
  assert.equal(parseArgs(recover).operation,'RECOVER_ADMIN');
});
test('fixed clean child has TTY and private DB secret only after acquisition',async t=>{
  const f=await fixture(t);assert.equal(await run(parseArgs(argv(f.jar,f.java)),f.deps),0);
  assert.ok(f.events.indexOf('version')<f.events.indexOf('acquire'));assert.deepEqual(f.events.slice(-3),['acquire','spawn','finish:0']);
  const child=f.spawned[0];assert.equal(child.file,f.java);assert.equal(child.clearedBeforeExit,true);assert.equal(child.originalEnv.SPRING_DATASOURCE_PASSWORD,undefined);assert.deepEqual(child.args,['-jar',f.jar,'maintenance',...tail]);
  assert.equal(child.options.cwd,f.cwd);assert.equal(child.options.shell,false);assert.equal(child.options.stdio,'inherit');
  assert.equal(child.options.env.SPRING_DATASOURCE_PASSWORD,'db-only-canary');assert.equal(child.options.env.SPRING_DATASOURCE_URL,f.inspection.jdbcUrl);
  assert.equal(Object.keys(child.options.env).length,17);for(const k of ['JAVA_TOOL_OPTIONS','NODE_OPTIONS','CMS_BAD'])assert.equal(child.options.env[k],undefined);
  assert.equal(child.options.env.CMS_MAINTENANCE_RUN_ID,id);assert.equal(child.options.env.CMS_MAINTENANCE_NODE_BINARY,process.execPath);assert.equal(child.options.env.CMS_MAINTENANCE_NODE_SHA256,nodeSha);
  assert.equal(child.options.env.CMS_MAINTENANCE_GUARD_SHA256,digest('synthetic guard'));assert.ok(!child.args.join(' ').includes('db-only-canary'));
});
test('notty backup and private path faults never acquire or spawn',async t=>{
  for(const mode of ['notty','jar','nodehash','secretmode','hardlink','symlink','backup','jdk']){
    const f=await fixture(t),args=argv(f.jar,f.java);let expected=6;
    if(mode==='notty'){f.deps.tty.stderr=false;expected=2;}
    if(mode==='jar')await writeFile(f.jar,'wrong jar');if(mode==='nodehash')f.inspection.target.nodeBinarySha256='0'.repeat(64);
    const secret=join(f.root,'secrets/spring.datasource.password');if(mode==='secretmode')await chmod(secret,0o644);if(mode==='hardlink')await link(secret,join(f.root,'secrets/alias'));
    if(mode==='symlink'){await rm(secret);await symlink(f.jar,secret);}if(mode==='backup'){args.splice(args.indexOf('--')+1,99,'recover-admin','--principal-id',op,'--target-id',`pp1-local:${id}`,'--operation-id',op,'--confirm','RECOVER_ADMIN');}
    if(mode==='jdk')f.deps.command=async()=>({stderr:'java.specification.version = 24'});
    assert.equal(await run(parseArgs(args),f.deps),expected,mode);assert.ok(!f.events.includes('acquire'),mode);assert.equal(f.spawned.length,0);
  }
});
test('finish once preserves child failures signals and restores listeners',async t=>{
  for(const mode of ['exit','spawn','SIGINT','SIGTERM','finish']){
    const f=await fixture(t),counts=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));let expected=5;
    if(mode==='exit')f.setExit(3),expected=3;if(mode==='spawn')f.deps.spawn=()=>{throw new Error('secret internal canary');};
    if(mode==='SIGINT'||mode==='SIGTERM')f.setSignal(mode),expected=mode==='SIGINT'?130:143;
    if(mode==='finish')f.setFinish('COMMITTED_HOST_RESTORE_FAILED');
    assert.equal(await run(parseArgs(argv(f.jar,f.java)),f.deps),expected);assert.equal(f.events.filter(v=>v.startsWith('finish:')).length,1);
    assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),counts);
  }
});
test('CLI rejects injection flags with fixed JSON before any runtime lookup',async()=>{
  const {spawnSync}=await import('node:child_process');
  for(const flags of [['--cwd','/tmp'],['--test-deps','{}']]){
    const result=spawnSync(process.execPath,['scripts/local/maintenance.mjs',...argv('/synthetic/app.jar'),...flags],{encoding:'utf8',timeout:5000,shell:false});
    assert.equal(result.status,2);assert.equal(result.stdout,'');assert.deepEqual(JSON.parse(result.stderr),{code:'INPUT_INVALID',operationId:null});
  }
});
test('asynchronous spawn error still finishes once and removes owned listeners',async t=>{
  const f=await fixture(t),counts=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
  f.deps.spawn=()=>{const child=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>child.emit('error',new Error('private canary')));return child;};
  assert.equal(await run(parseArgs(argv(f.jar,f.java)),f.deps),5);assert.deepEqual(f.events.filter(v=>v.startsWith('finish:')),['finish:5']);
  assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),counts);
});

test('inspector receives exact running state and dependency tuple',async t=>{
  const f=await fixture(t);assert.equal(await run(parseArgs(argv(f.jar,f.java)),f.deps),0);
  assert.equal(f.inspectCalls[0].length,3);assert.equal(f.inspectCalls[0][0],f.root);assert.equal(f.inspectCalls[0][1],f.deps);assert.deepEqual(f.inspectCalls[0][2],{apiState:'running'});
});
test('real finish records unknown nonzero and committed failure without Docker',async t=>{
  const {finish:realFinish}=await import('./maintenance-guard.mjs');
  for(const mode of ['no-result','committed','corrupt']){
    const f=await fixture(t),h='b'.repeat(64),source='c'.repeat(40),base=join(f.root,'maintenance');
    Object.assign(f.inspection.target,{version:1,project:`cms-pp1-local-${id}`,sourceCommit:source,
      apiBuild:{sourceCommit:source,jarSha256:digest('synthetic jar'),baseImage:`sha256:${h}`},
      images:{api:`sha256:${h}`,node:`sha256:${h}`,postgres:`sha256:${h}`},containerIds:{postgres:h,'cms-api':h,ingress:h},networkIds:{web:h,data:h},
      volumeNames:{'db-data':`cms-pp1-local-${id}_db-data`,'media-data':`cms-pp1-local-${id}_media-data`},databaseOid:42,ingressScriptSha256:h,mediaProbeSha256:h});
    Object.assign(f.lease,f.inspection.target,{operationId:op,operation:'FRESH_INIT',releaseId:`sha256:${digest('synthetic jar')}`,phase:'BOUND',createdAt:'2026-10-09T00:00:00.000Z',
      boundBackend:{pid:123,backendStartEpoch:'1720000000.123456',db:'cms',role:'cms_local',clientAddr:'172.18.0.1',applicationName:op}});
    await mkdir(join(base,'operations'),{recursive:true,mode:0o700});await mkdir(join(base,'operation.lock'),{mode:0o700});
    const journal={operationId:op,operation:'FRESH_INIT',targetId:f.lease.targetId,releaseId:f.lease.releaseId,phase:'BOUND',at:'2026-10-09T00:00:00.000Z',failureCode:null};
    for(const [path,value] of [[join(base,'lease.json'),f.lease],[join(base,'target.json'),f.inspection.target],[join(base,'operations',`${op}.json`),journal]])await writeFile(path,JSON.stringify(value),{mode:0o600});
    if(mode==='committed')await writeFile(join(base,'operations',`${op}.result.json`),JSON.stringify({operationId:op,operation:'FRESH_INIT',principalId:op,completedAt:'2026-10-09T00:00:00Z',releaseId:f.lease.releaseId,targetId:f.lease.targetId}),{mode:0o600});
    if(mode==='corrupt')await writeFile(join(base,'target.json'),'{}');
    f.setExit(mode==='committed'?5:3);let finishCalls=0,dockerCalls=0;f.deps.finish=async(lease,exit)=>{finishCalls++;return realFinish(lease,exit,{cwd:f.cwd,command:()=>{dockerCalls++;throw new Error('DOCKER_MUST_NOT_RUN');}});};
    assert.equal(await run(parseArgs(argv(f.jar,f.java)),f.deps),mode==='no-result'?3:mode==='committed'?5:6);assert.equal(finishCalls,1);assert.equal(dockerCalls,0);
    const stored=JSON.parse(await readFile(join(base,'lease.json')));assert.equal(stored.phase,mode==='no-result'?'FAILED_OR_UNKNOWN':mode==='committed'?'COMMITTED':'BOUND');
    assert.ok((await (await import('node:fs/promises')).lstat(join(base,'operation.lock'))).isDirectory());
  }
});


const recoverArgs = (jar, javaBin) => ['--run-id', id, '--java-bin', javaBin, '--jar', jar, '--', 'recover-admin',
  '--principal-id', op, '--target-id', `pp1-local:${id}`, '--operation-id', op, '--confirm', 'RECOVER_ADMIN'];
async function recoverFixture(t) {
  const f = await fixture(t), token = Object.freeze({}), abortController = new AbortController();
  const connection = {jdbcUrl: f.inspection.jdbcUrl, dataGateway: f.inspection.dataGateway};
  const context = {root: f.root, operationId: op, target: structuredClone(f.inspection.target), connection: {...connection},
    lease: {operationId: op, purpose: 'RECOVER_ADMIN', phase: 'ACCOUNT_PRE_CONNECTION', source: structuredClone(f.inspection.target), sourceConnection: {...connection},
      originalApiState: 'stopped', completionPolicy: 'KEEP_STOPPED', target: null, helper: null,
      releaseId: 'sha256:' + f.inspection.target.apiBuild.jarSha256,
      proof: {backupId: 'pp1-20261106T170000000Z-' + 'b'.repeat(32), sourceIdentitySha256: digest(canonicalBytes(f.inspection.target))},
      account: {operation: 'RECOVER_ADMIN', phase: 'PRE_CONNECTION', boundBackend: null}}};
  const finishes = [];
  f.deps.acquire = async () => { f.events.push('legacy-acquire'); throw Error('LEGACY_RECOVER_MUST_NOT_ACQUIRE'); };
  f.deps.finish = async () => { f.events.push('legacy-finish'); throw Error('LEGACY_RECOVER_MUST_NOT_FINISH'); };
  f.deps.attachRecovery = async (inspection, request, deps) => {
    assert.equal(inspection, f.inspection); assert.deepEqual(request, {operationId: op}); assert.equal(deps, f.deps);
    f.events.push('proof-preflight', 'attach-one-lock'); return token;
  };
  f.deps.assertWorkflow = async (actual, request, deps) => {
    assert.equal(actual, token); assert.deepEqual(request, {side: 'source', stage: 'ACCOUNT_PRE_CONNECTION'}); assert.equal(deps, f.deps);
    f.events.push('assert-opaque'); return context;
  };
  f.deps.finishRecoverWorkflow = async (actual, outcome, deps) => {
    assert.equal(actual, token); assert.equal(deps, f.deps); finishes.push(outcome); f.events.push(`recover-finish:${outcome.exitCode}`);
  };
  f.deps.workflowSignalContext = async (actual, deps) => { assert.equal(actual,token);assert.equal(deps,f.deps);return {signal:abortController.signal}; };
  return {...f, token, context, finishes, abortController};
}
test('T166_A_stopped_source_one_opaque_attach_before_exact_account_launch_then_finish_once', async t => {
  const f = await recoverFixture(t), options = parseArgs(recoverArgs(f.jar, f.java));
  assert.equal(await run(options, f.deps), 0);
  assert.deepEqual(f.inspectCalls[0], [f.root, f.deps, {apiState: 'stopped'}]);
  assert.deepEqual(f.events, ['inspect', 'version', 'proof-preflight', 'attach-one-lock', 'assert-opaque', 'spawn', 'recover-finish:0']);
  assert.deepEqual(f.finishes, [{exitCode: 0, spawnFailure: false}]);
  const child = f.spawned[0]; assert.deepEqual(child.args, ['-jar', f.jar, 'maintenance', ...options.maintenanceArgs]);
  assert.equal(child.options.stdio, 'inherit'); assert.equal(child.options.shell, false); assert.equal(Object.keys(child.options.env).length, 17);
  assert.equal(child.clearedBeforeExit, true); assert.equal(child.originalEnv.SPRING_DATASOURCE_PASSWORD, undefined);
  assert.ok(!child.args.join(' ').includes('backup')); assert.ok(!f.events.some(value => value.startsWith('legacy')));
});
test('T166_A_default_attach_receives_deps_and_failed_proof_has_zero_account_spawn', async t => {
  const f = await recoverFixture(t); delete f.deps.attachRecovery;
  f.deps.preflightRecovery = async (inspection, deps) => {
    assert.equal(inspection, f.inspection); assert.equal(deps, f.deps); f.events.push('real-default-preflight'); throw new OpsError('BUNDLE_MISMATCH');
  };
  assert.equal(await run(parseArgs(recoverArgs(f.jar, f.java)), f.deps), 6);
  assert.ok(f.events.includes('real-default-preflight')); assert.equal(f.spawned.length, 0); assert.equal(f.finishes.length, 0);
});
test('T166_A_default_assert_refuses_JSON_token_without_private_workflow_authority', async t => {
  const f = await recoverFixture(t); delete f.deps.assertWorkflow;
  f.deps.attachRecovery = async () => structuredClone(f.context);
  assert.equal(await run(parseArgs(recoverArgs(f.jar, f.java)), f.deps), 6);
  assert.equal(f.spawned.length, 0); assert.equal(f.finishes.length, 0);
});
for (const fault of ['missing_proof', 'source', 'connection', 'proof_source', 'phase', 'account', 'root', 'purpose']) {
  test(`T166_A_opaque_context_${fault}_cannot_launch`, async t => {
    const f = await recoverFixture(t), c = f.context;
    if (fault === 'missing_proof') c.lease.proof = null;
    if (fault === 'source') c.lease.source.nodeBinarySha256 = '0'.repeat(64);
    if (fault === 'connection') c.connection.jdbcUrl = 'jdbc:postgresql://172.18.0.3:5432/cms';
    if (fault === 'proof_source') c.lease.proof.sourceIdentitySha256 = '0'.repeat(64);
    if (fault === 'phase') c.lease.phase = 'ACCOUNT_BOUND';
    if (fault === 'account') c.lease.account.boundBackend = {};
    if (fault === 'root') c.root = f.cwd;
    if (fault === 'purpose') c.lease.purpose = 'RESTORE_VERIFY_LOCAL';
    assert.equal(await run(parseArgs(recoverArgs(f.jar, f.java)), f.deps), 6);
    assert.equal(f.spawned.length, 0); assert.equal(f.finishes.length, 0); assert.ok(!f.events.some(value => value.startsWith('legacy')));
  });
}


async function capturedRun(options, deps) {
  const messages = [], original = process.stderr.write;
  process.stderr.write = function (chunk, encoding, callback) {
    messages.push(String(chunk)); if (typeof encoding === 'function') encoding(); else if (typeof callback === 'function') callback(); return true;
  };
  try { const exit = await run(options, deps), text = messages.join(''); return {exit, text, error: text ? JSON.parse(text) : null}; }
  finally { process.stderr.write = original; }
}
for (const code of ['ADAPTER_UNSEALED', 'BUNDLE_MISMATCH', 'LOCAL_VERIFY_FAILED', 'INPUT_INVALID', 'LOCK_BUSY', 'SOURCE_CHANGED', 'WRITER_NOT_QUIESCED']) {
  test(`T166_B_attach_${code}_uses_fixed_maintenance_code_without_spawn`, async t => {
    const f = await recoverFixture(t); f.deps.attachRecovery = async () => { throw new OpsError(code); };
    const result = await capturedRun(parseArgs(recoverArgs(f.jar, f.java)), f.deps);
    const expected = code === 'LOCK_BUSY' ? 'MAINTENANCE_BUSY' : ['SOURCE_CHANGED', 'WRITER_NOT_QUIESCED'].includes(code) ? 'QUIESCENCE_NOT_PROVEN' : 'RECOVERY_BACKUP_REQUIRED';
    assert.equal(result.exit, code === 'LOCK_BUSY' ? 4 : 6); assert.deepEqual(result.error, {code: expected, operationId: op});
    assert.equal(f.spawned.length, 0); assert.equal(f.finishes.length, 0); assert.ok(!f.events.some(value => value.startsWith('legacy')));
  });
}
for (const missing of ['target', 'source', 'sourceConnection']) {
  test(`T166_B_malformed_opaque_${missing}_is_quiescence_failure_not_CLI_input`, async t => {
    const f = await recoverFixture(t);
    if (missing === 'target') delete f.context.target; else delete f.context.lease[missing];
    const result = await capturedRun(parseArgs(recoverArgs(f.jar, f.java)), f.deps);
    assert.equal(result.exit, 6); assert.equal(result.error.code, 'QUIESCENCE_NOT_PROVEN'); assert.equal(f.spawned.length, 0);
  });
}
for (const fault of ['notty', 'jar', 'nodehash', 'secretmode', 'hardlink', 'symlink', 'jdk']) {
  test(`T166_B_local_${fault}_fails_before_recovery_attach`, async t => {
    const f = await recoverFixture(t), path = join(f.root, 'secrets/spring.datasource.password');
    if (fault === 'notty') f.deps.tty.stdin = false;
    if (fault === 'jar') await writeFile(f.jar, 'changed');
    if (fault === 'nodehash') f.inspection.target.nodeBinarySha256 = '0'.repeat(64);
    if (fault === 'secretmode') await chmod(path, 0o644);
    if (fault === 'hardlink') await link(path, join(f.root, 'secrets/alias'));
    if (fault === 'symlink') { await rm(path); await symlink(f.jar, path); }
    if (fault === 'jdk') f.deps.command = async () => ({stderr: 'java.specification.version = 24'});
    const result = await capturedRun(parseArgs(recoverArgs(f.jar, f.java)), f.deps);
    assert.equal(result.exit, fault === 'notty' ? 2 : 6);
    assert.ok(!f.events.includes('attach-one-lock')); assert.equal(f.spawned.length, 0); assert.equal(f.finishes.length, 0);
    assert.ok(!result.text.includes('db-only-canary'));
  });
}
for (const mode of ['nonzero', 'spawn', 'async_spawn', 'SIGINT', 'SIGTERM', 'finish_unknown', 'finish_quiescence', 'confirmed_commit']) {
  test(`T166_B_${mode}_finishes_once_without_legacy_restart_and_clears_secret`, async t => {
    const f = await recoverFixture(t), listeners = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
    let expected = 5, clearObserved = true;
    if (mode === 'nonzero') { f.setExit(3); expected = 3; }
    if (mode === 'spawn') f.deps.spawn = () => { throw Error('PRIVATE-ERROR-CANARY'); };
    if (mode === 'async_spawn') f.deps.spawn = (_file, _args, options) => {
      const child = new EventEmitter(); child.kill = () => {};
      queueMicrotask(() => { clearObserved = !Object.hasOwn(options.env, 'SPRING_DATASOURCE_PASSWORD'); child.emit('error', Error('PRIVATE-ERROR-CANARY')); }); return child;
    };
    if (mode === 'SIGINT' || mode === 'SIGTERM') { f.setSignal(mode); expected = mode === 'SIGINT' ? 130 : 143; }
    const original = f.deps.finishRecoverWorkflow;
    if (mode.startsWith('finish_') || mode === 'confirmed_commit') f.deps.finishRecoverWorkflow = async (...args) => {
      await original(...args);
      if (mode === 'confirmed_commit') throw Error('COMMITTED_HOST_RESTORE_FAILED');
      if (mode === 'finish_quiescence') throw new OpsError('SOURCE_CHANGED');
      throw Error('PRIVATE-ERROR-CANARY');
    };
    if (mode === 'confirmed_commit') f.setExit(5);
    const result = await capturedRun(parseArgs(recoverArgs(f.jar, f.java)), f.deps);
    assert.equal(result.exit, expected); assert.equal(f.finishes.length, 1); assert.equal(clearObserved, true);
    assert.deepEqual(f.finishes[0], {exitCode: mode === 'nonzero' ? 3 : mode === 'SIGINT' ? 130 : mode === 'SIGTERM' ? 143 : mode === 'spawn' || mode === 'async_spawn' || mode === 'confirmed_commit' ? 5 : 0,
      spawnFailure: mode === 'spawn' || mode === 'async_spawn'});
    if (mode === 'confirmed_commit') assert.equal(result.error.code, 'COMMITTED_HOST_RESTORE_FAILED');
    if (mode === 'finish_quiescence' || mode === 'finish_unknown') assert.equal(result.error.code, 'MAINTENANCE_INTERNAL_ERROR');
    assert.ok(!result.text.includes('PRIVATE-ERROR-CANARY') && !result.text.includes('db-only-canary'));
    assert.ok(!f.events.some(value => value.startsWith('legacy')));
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), listeners);
    for (const child of f.spawned) { assert.equal(child.clearedBeforeExit, true); assert.equal(child.originalEnv.SPRING_DATASOURCE_PASSWORD, undefined); }
  });
}
test('T166_B_recovery_flags_remain_exact_and_default_finish_rejects_unowned_token', async t => {
  const f = await recoverFixture(t), args = recoverArgs(f.jar, f.java);
  for (const extra of [['--backup-id', 'arbitrary'], ['--proof-hash', '0'.repeat(64)], ['--lease-path', '/tmp/elsewhere']]) assert.throws(() => parseArgs([...args, ...extra]), {message: 'INPUT_INVALID'});
  delete f.deps.finishRecoverWorkflow;
  const result = await capturedRun(parseArgs(args), f.deps);
  assert.equal(result.exit, 5); assert.equal(result.error.code, 'MAINTENANCE_INTERNAL_ERROR');
  assert.equal(f.spawned.length, 1); assert.ok(!f.events.some(value => value.startsWith('legacy')));
});

for(const when of ['already','active'])test(`T169_recover_owned_abort_${when}_finishes_once_and_cleans_listener`,async t=>{
  const f=await recoverFixture(t);
  if(when==='already')f.abortController.abort();
  else f.deps.spawn=(file,args,options)=>{
    const child=new EventEmitter();child.pid=123;f.spawned.push({file,args,options});f.events.push('spawn');
    child.kill=signal=>{f.events.push(`kill:${signal}`);queueMicrotask(()=>child.emit('exit',null,signal));};
    queueMicrotask(()=>f.abortController.abort());setTimeout(()=>child.emit('exit',0,null),20);return child;
  };
  assert.equal(await run(parseArgs(recoverArgs(f.jar,f.java)),f.deps),143);
  assert.equal(f.finishes.length,1);assert.deepEqual(f.finishes[0],{exitCode:143,spawnFailure:false});
  assert.equal(f.spawned.length,when==='already'?0:1);
  if(when==='active')assert.ok(f.events.includes('kill:SIGTERM'));
});
test('T169_recover_JSON_signal_lookalike_never_authorizes_account_spawn',async t=>{
  const f=await recoverFixture(t);f.deps.workflowSignalContext=async()=>({signal:{aborted:false}});
  assert.equal(await run(parseArgs(recoverArgs(f.jar,f.java)),f.deps),6);assert.equal(f.spawned.length,0);
});

for(const fault of ['ignoreTERM','unconfirmed','alreadyExited'])test(`T169_recover_abort_${fault}_is_bounded_owned_and_finishes_once`,async t=>{
  const f=await recoverFixture(t),timers=[];let unreferenced=false;
  f.deps.setRecoverTimeout=(callback,delay)=>{const timer={callback,delay};timers.push(timer);queueMicrotask(callback);return timer;};
  f.deps.clearRecoverTimeout=timer=>{timer.cleared=true;};
  f.deps.spawn=()=>{
    const child=new EventEmitter();child.pid=123;child.exitCode=fault==='alreadyExited'?0:null;child.signalCode=null;
    child.unref=()=>{unreferenced=true;};
    child.kill=signal=>{f.events.push(`kill:${signal}`);if(signal==='SIGKILL'&&fault==='ignoreTERM')queueMicrotask(()=>child.emit('exit',null,signal));};
    queueMicrotask(()=>f.abortController.abort());return child;
  };
  assert.equal(await run(parseArgs(recoverArgs(f.jar,f.java)),f.deps),fault==='alreadyExited'?0:5);
  assert.equal(f.finishes.length,1);assert.ok(timers.every(timer=>timer.delay===30000&&timer.cleared));
  assert.equal(getEventListeners(f.abortController.signal,'abort').length,0);
  if(fault==='alreadyExited')assert.ok(!f.events.some(event=>event.startsWith('kill:')));
  else assert.deepEqual(f.events.filter(event=>event.startsWith('kill:')),['kill:SIGTERM','kill:SIGKILL']);
  assert.equal(unreferenced,fault==='unconfirmed');
});
