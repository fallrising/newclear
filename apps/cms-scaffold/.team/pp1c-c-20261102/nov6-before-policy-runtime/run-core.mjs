import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, open } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { prepareSmokeFixture } from '../T144/fixture-client.mjs';
import { inspectTarget, observedSessionConfig } from '../../../scripts/local/maintenance-target.mjs';
import { restoreLocal } from '../../../scripts/ops/local-restore.mjs';
import { canonicalBytes } from '../../../scripts/ops/recovery-protocol.mjs';
import * as workflow from '../../../scripts/local/maintenance-workflow.mjs';
import { executeHelperLifecycle } from '../../../scripts/local/maintenance-helper.mjs';
const execute=promisify(execFile),cwd=process.cwd(),e=join(cwd,'.team/pp1c-c-20261102/runtime');
const runtime=JSON.parse(await readFile(join(e,'source-runtime.json'))),targetRunId=randomUUID().replaceAll('-',''),operationId=randomUUID();
const bootstrapOperationId=randomUUID(),environment={...process.env,JAVA_HOME:'/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8',
  CMS_DOCKER_COMPOSE:'/home/ckc/.cache/devbox/toolchains/docker-compose-v5.6.1/docker-compose'};
const summary={sourceRunId:runtime.runId,targetRunId,operationId,bootstrapOperationId,startedAt:new Date().toISOString(),
  scope:'actual C core through SESSIONS_REVOKED only; no D startup/browser/proof or RTO acceptance',steps:[],http:[]};
let adminPassword=randomBytes(32).toString('base64url'),operatorPassword=randomBytes(32).toString('base64url'),fixture;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const step=(name,fields={})=>{summary.steps.push({name,at:new Date().toISOString(),...fields});
  writeFileSync(join(e,'core-progress.json'),JSON.stringify({sourceRunId:runtime.runId,targetRunId,operationId,steps:summary.steps},null,2)+'\n',{mode:0o600});};
const docker=async args=>(await execute('docker',['--host','unix:///var/run/docker.sock',...args],
  {env:environment,shell:false,timeout:60000,maxBuffer:16777216})).stdout;
async function inputCommand(file,args,input,timeout=180000) {
  const child=spawn(file,args,{env:environment,shell:false,stdio:['pipe','pipe','pipe']}),out=[],err=[];let size=0;
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
  try {
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576)child.kill('SIGTERM');else out.push(chunk);});
    child.stderr.on('data',chunk=>{size+=chunk.length;if(size>1048576)child.kill('SIGTERM');else err.push(chunk);});
    const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    const result=await completed;
    if(result.code!==0||result.signal||size>1048576)throw Object.assign(Error('C_CHILD_FAILED'),{code:'C_CHILD_FAILED'});
    return Buffer.concat(out);
  } finally {clearTimeout(timer);input.fill(0);}
}
const sql=async text=>(await inputCommand('docker',['--host','unix:///var/run/docker.sock','exec','-i',runtime.containers.postgres.id,
  'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','cms_local','-d','cms'],Buffer.from(text))).toString().trim();
const tables=['cms_audit_event','cms_audit_settings','cms_content_type','cms_credential','cms_entry','cms_entry_index','cms_media_attachment',
  'cms_entry_ref','cms_entry_revision','cms_field','cms_media','cms_media_settings','cms_media_variant','cms_navigation_menu',
  'cms_permission','cms_principal','cms_principal_role','cms_role','cms_session','flyway_schema_history'].sort();
async function snapshot() {
  const queries=tables.map(name=>`SELECT '${name}' AS name,count(*)::text AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${name}" t`);
  return JSON.parse(await sql(`BEGIN READ ONLY;SELECT json_agg(t ORDER BY name) FROM (${queries.join(' UNION ALL ')}) t;COMMIT;`));
}
function apiClient(ip,ca) {
  return descriptor=>new Promise((resolve,reject)=>{
    const {method,path,headers,response,json,multipart}=descriptor;
    if(!path.startsWith('/api/v1/')||/[\r\n]/.test(path))return reject(Error('FIXED_ROUTE_REQUIRED'));
    let body;
    const requestHeaders={...headers};
    if(json!==undefined)body=Buffer.from(JSON.stringify(json));
    if(multipart){
      const boundary='pp1c-'+randomBytes(16).toString('hex'),file=multipart.file;
      body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`),
        file.bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
      requestHeaders['Content-Type']='multipart/form-data; boundary='+boundary;
    }
    if(body)requestHeaders['Content-Length']=String(body.length);
    const request=https.request({hostname:'api.cms.test',servername:'api.cms.test',port:8443,path,method,headers:requestHeaders,ca,
      rejectUnauthorized:true,agent:false,family:4,lookup:(_host,_options,callback)=>callback(null,ip,4)},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>16777216)request.destroy(Error('RESPONSE_BOUND'));else chunks.push(chunk);});
      res.on('end',()=>{
        const bytes=Buffer.concat(chunks);
        summary.http.push({method,path:path.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g,':id'),status:res.statusCode});
        const value={status:res.statusCode,setCookies:res.headers['set-cookie']??[]};
        try {if(response==='bytes')value.bytes=bytes;else if(bytes.length)value.json=JSON.parse(bytes);resolve(value);}
        catch{reject(Error('RESPONSE_INVALID'));}
      });
    });
    request.setTimeout(30000,()=>request.destroy(Error('HTTP_TIMEOUT')));request.on('error',()=>reject(Error('HTTP_FAILED')));
    request.end(body);
  });
}
async function orphan() {
  const inspection=await inspectTarget(runtime.root,{}, {apiState:'running'}),name='cms-pp1c-orphan-'+randomUUID().replaceAll('-','');
  const script="process.stdin.on('data',()=>process.exit(2));process.stdin.on('end',()=>{const f=require('node:fs');const p='/media/pp1c-orphan.bin',h=f.openSync(p,'wx',0o644);f.writeSync(h,Buffer.from([80,80,49,67,32,111,114,112,104,97,110,10]));f.fsyncSync(h);f.closeSync(h);const s=f.lstatSync(p);if(!s.isFile()||s.nlink!==1)throw Error();const d=f.openSync('/media','r');f.fsyncSync(d);f.closeSync(d);});process.stdin.resume();";
  const image=JSON.parse(await docker(['image','inspect',inspection.target.images.node]))[0];
  const volume=JSON.parse(await docker(['volume','inspect',inspection.target.volumeNames['media-data']]))[0];
  const none=JSON.parse(await docker(['network','inspect','none']))[0];
  if(none.Name!=='none'||none.Driver!=='null'||none.Scope!=='local'||volume.Name!==inspection.target.volumeNames['media-data'])throw Error('ORPHAN_POLICY');
  const policy={version:1,kind:'PROFILE',side:'source',imageId:image.Id,user:'0:0',entrypoint:'/opt/pp1-node',args:['-e',script],
    env:[...(image.Config.Env??[])].sort(),mounts:[{type:'volume',source:volume.Name,destination:'/media',readOnly:false},
      {type:'bind',source:process.execPath,destination:'/opt/pp1-node',readOnly:true}],networkId:null,
    readOnlyRootfs:true,capDrop:['ALL'],noNewPrivileges:true,restart:'no',logDriver:'none'};
  const expected={name,labels:{...(image.Config.Labels??{}),'org.cms.pp1c.operation':operationId,'org.cms.pp1c.seq':'1',
    'org.cms.pp1c.kind':'PROFILE','org.cms.pp1c.policy':sha(canonicalBytes(policy))},volumeMountpoints:{[volume.Name]:volume.Mountpoint},noneNetworkId:none.Id};
  let helperId;
  await executeHelperLifecycle(policy,expected,async child=>{
    const empty=stream=>new Promise((resolve,reject)=>{stream.on('data',()=>reject(Error('ORPHAN_OUTPUT')));stream.once('end',resolve);stream.once('error',reject);});
    const finished=Promise.all([empty(child.stdout),empty(child.stderr)]);child.stdin.end();await finished;
  },{environment,onCreated:async id=>{helperId=id;}});
  step('source-orphan-created',{fixedBytes:12,helperId});
}
try {
  if(!runtime.healthy||!runtime.controlledFreshLifecycle)throw Error('SOURCE_NOT_FRESH');
  for(const [service,value]of Object.entries(runtime.containers)){
    const c=JSON.parse(await docker(['inspect',value.id]))[0];
    if(c.Id!==value.id||c.Config.Labels['com.docker.compose.project']!==runtime.project||c.Config.Labels['com.docker.compose.service']!==service
      ||c.Image!==value.image||!c.State.Running)throw Error('SOURCE_OWNERSHIP');
  }
  const bootstrap=JSON.parse(await inputCommand('python3',[join(e,'bootstrap.py')],Buffer.from(JSON.stringify({runId:runtime.runId,
    operationId:bootstrapOperationId,username:'pp1c-admin-'+runtime.runId.slice(-8),password:adminPassword}))));
  if(!bootstrap.success)throw Error('BOOTSTRAP_FAILED');step('true-tty-bootstrap',bootstrap);
  const seed=`BEGIN;DO $$BEGIN IF EXISTS(SELECT 1 FROM cms_audit_event WHERE category='PP1C_FIXTURE') THEN RAISE EXCEPTION 'FIXTURE_EXISTS';END IF;END$$;
INSERT INTO cms_audit_event(id,category,action,outcome,detail_json) SELECT md5('pp1c-c-stream-${runtime.runId}-'||i)::uuid,'PP1C_FIXTURE','STREAM_BACKPRESSURE','success',jsonb_build_object('synthetic',(SELECT string_agg(md5(i::text||':'||j::text),'') FROM generate_series(1,1024) j)) FROM generate_series(1,4096) i;COMMIT;
SELECT json_build_object('rows',count(*),'syntheticPayloadBytes',sum(octet_length(detail_json->>'synthetic'))) FROM cms_audit_event WHERE category='PP1C_FIXTURE';`;
  const load=JSON.parse(await sql(seed));if(load.rows!==4096||load.syntheticPayloadBytes!==134217728)throw Error('STREAM_FIXTURE_FAILED');
  step('synthetic-stream-observation-load',{...load,sqlSha256:sha(Buffer.from(seed)),note:'C test data before capture; no D fixture acceptance'});
  const inspection=await inspectTarget(runtime.root,{}, {apiState:'running'}),settings=await observedSessionConfig(inspection);
  step('actual-session-config',{...settings});
  const ingress=JSON.parse(await docker(['inspect',runtime.containers.ingress.id]))[0],ip=Object.values(ingress.NetworkSettings.Networks)[0].IPAddress;
  const pngs=Object.fromEntries(await Promise.all(['public','replacement','draft','private','deleted'].map(async name=>[name,await readFile(join(cwd,'local/pp1c-c-fixture-images',name+'.png'))])));
  fixture=await prepareSmokeFixture({sourceRunId:runtime.runId,admin:{username:'pp1c-admin-'+runtime.runId.slice(-8),password:adminPassword},
    operatorPassword,pngs,sessionConfig:settings,apiClient:apiClient(ip,await readFile(join(runtime.root,'tls/ca.crt'))),beforeFinalLogin:orphan});
  step('fixed-annex-api-fixture',{httpRequests:summary.http.length,pngSha256:Object.fromEntries(Object.entries(pngs).map(([name,bytes])=>[name,sha(bytes)]))});
  const path=join(runtime.root,'recovery-smoke-input.json'),input=canonicalBytes(fixture.smokeFixtureInput);
  await writeFile(path,input,{flag:'wx',mode:0o600});const file=await open(path,'r');try{await file.sync();}finally{await file.close();}
  const before=await snapshot();summary.sourceBefore=before;
  const finalInspection=await inspectTarget(runtime.root,{}, {apiState:'running'});
  const incidentStartedAt=new Date().toISOString();
  const result=await restoreLocal(finalInspection,{operationId,purpose:'RESTORE_VERIFY_LOCAL',completionPolicy:'KEEP_STOPPED',targetRunId,incidentStartedAt},
    {environment,recoverySecrets:fixture.recoverySecrets,smokeFixtureInput:fixture.smokeFixtureInput});
  if(result.phase!=='SESSIONS_REVOKED'||!result.rawComparison.equal||result.rawComparison.tables.length!==20)throw Error('CORE_NOT_VERIFIED');
  const current=await workflow.assertWorkflow(result.token,{side:'target',stage:'SESSIONS_REVOKED'});
  if(current.lease.helper!==null||current.target.runId!==targetRunId)throw Error('CORE_IDENTITY');
  const after=await snapshot();if(!canonicalBytes(before).equals(canonicalBytes(after)))throw Error('SOURCE_CHANGED');
  const inventory=JSON.parse(await readFile(join(runtime.root,'bundles',result.backupId,'inventory.json')));
  const media={};for(const [side,id]of [['source',runtime.containers['cms-api'].id],['target',current.target.containerIds['cms-api']]]){
    media[side]=JSON.parse(await inputCommand('python3',[join(e,'check-media.py')],Buffer.from(JSON.stringify({containerId:id,files:inventory.files}))));
    if(media[side].mediaHeaderSha256!==inventory.mediaHeaderSha256)throw Error('MEDIA_CHANGED');
  }
  summary.success=true;summary.backupId=result.backupId;summary.phase=result.phase;summary.fixtureSha256=result.fixtureSha256;
  summary.rawComparison=result.rawComparison;summary.sessionCommit=result.sessionCommit.receipt;summary.targetIdentity=current.target;
  summary.sourceAll20TablesUnchanged=true;summary.media=media;summary.lockRetainedForUnsealedD=true;
  const auditRows=inventory.tables.find(t=>t.tableName==='cms_audit_event').rowCount;
  step('actual-core-accepted',{rawTables:20,rawAuditRows:auditRows,mediaFiles:String(inventory.files.length),
    revokedCount:result.sessionCommit.receipt.revokedCount,targetAppStarted:false});
}catch(error){summary.success=false;summary.code=error.code??'C_DRIVER_FAILED';summary.failureType=error.constructor.name;process.exitCode=1;}
finally {
  if(fixture)for(const actor of Object.values(fixture.recoverySecrets)){actor.password='';actor.oldSessionToken='';}
  fixture=null;adminPassword=null;operatorPassword=null;
  summary.stopped=[];
  for(const [project,id]of [[runtime.project,runtime.runId],['cms-pp1-local-'+targetRunId,targetRunId]]){
    try {
      const ids=(await docker(['ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+project])).trim().split('\n').filter(Boolean);
      for(const cid of ids){const c=JSON.parse(await docker(['inspect',cid]))[0];
        if(c.Id!==cid||c.Config.Labels['com.docker.compose.project']!==project||!['postgres','cms-api','ingress'].includes(c.Config.Labels['com.docker.compose.service']))throw Error('STOP_OWNERSHIP');}
      if(ids.length){await docker(['stop','--time','30',...ids]);summary.stopped.push({runId:id,containerIds:ids});}
    }catch{summary.stopFailure=true;}
  }
  summary.endedAt=new Date().toISOString();await writeFile(join(e,'core-result.json'),JSON.stringify(summary,null,2)+'\n');
}
console.log(JSON.stringify({success:summary.success,code:summary.code,phase:summary.phase,backupId:summary.backupId}));
