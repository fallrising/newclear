// Optional isolated fault qualification: actual Worker/D1 and real Python CLI processes.
// Uses an already installed external Miniflare; no product dependency or cloud access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {sign,recipeRef} from '../apps/control/worker/protocol.mjs';

const toolchain=process.argv[2],build=process.env.AGENT_BUILD_DIR,evidence=process.env.AGENT_EVIDENCE_DIR;
assert.ok(toolchain&&build&&evidence,'Use shared launcher and provide external toolchain path');
const require=createRequire(resolve(toolchain,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=join(root,'tests/fixtures/recovery_runner.py');
const directory=join(evidence,'recovery');
mkdirSync(directory,{mode:0o700}); // Exclusive directory: never silently reuse a prior fault run.
const save=(name,value)=>writeFileSync(join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=Date.now(),iso=n=>new Date(n).toISOString().replace(/\.\d{3}Z$/,'Z');
const ref=await recipeRef(),origin='https://lab.example',audience='recovery-qualification';
const secrets={bot:'ab'.repeat(32),runner:'cd'.repeat(32)};
const keys=Object.fromEntries(Object.entries(secrets).map(([id,key])=>[id,{principal_id:id,grant_id:id,generation:1,secret_hex:key,expires_at:iso(now+3600000)}]));
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',cf:false,telemetry:{enabled:false},
 resourcePersistencePath:join(directory,'d1-state'),resourceTmpPath:join(build,'recovery-tmp'),workers:[{
 name:'recovery',modulesRoot:join(root,'apps/control/worker'),modules:['index.mjs','auth.mjs','protocol.mjs'].map(name=>({type:'ESModule',path:join(root,'apps/control/worker',name)})),
 compatibilityDate:'2026-10-26',d1Databases:{DB:'recovery'},outboundService:()=>new Response(null,{status:503}),
 bindings:{PUBLIC_ORIGIN:origin,AUDIENCE:audience,MACHINE_KEYS:JSON.stringify(keys),ACCESS_CONFIG:'{}'}}]}));
const children=new Set(),checks=[],assignments=[],reports=[];
let dropReport=null,proxyFailure=null;
const proxy=createServer(async(req,res)=>{
 try {
  assert.equal(req.method,'POST');assert.ok(['/api/runner/claim','/api/runner/report'].includes(req.url));
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=32768);chunks.push(chunk);}
  const body=Buffer.concat(chunks);
  if(req.url.endsWith('/report')) {
   reports.push(JSON.parse(body));
   if(dropReport==='before'){dropReport=null;req.socket.destroy();return;}
  }
  const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
  const response=await mf.dispatchFetch(origin+req.url,{method:'POST',headers,body});
  const raw=await response.text();
  if(req.url.endsWith('/claim')&&response.status===200)assignments.push(JSON.parse(raw).assignment);
  if(req.url.endsWith('/report')&&dropReport==='after'){
   assert.equal(response.status,200,raw);dropReport=null;req.socket.destroy();return;
  }
  res.writeHead(response.status,{'Content-Type':'application/json'});res.end(raw);
 }catch(error){proxyFailure=error;res.destroy();}
});
let nonce=0;
async function request(path,body,who='bot') {
 const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),n=(++nonce).toString(16).padStart(32,'0');
 const signature=await sign(secrets[who],audience,who,1,method,path,time,n,raw);
 const response=await mf.dispatchFetch(origin+path,{method,headers:{'Content-Type':'application/json','X-Lab-Key-Id':who,'X-Lab-Time':time,'X-Lab-Nonce':n,'X-Lab-Signature':signature},...(body===undefined?{}:{body:raw})});
 return {status:response.status,data:await response.json()};
}
function child(config,marker,block=false) {
 const p=spawn('python3',[fixture,'--config',config,'--collector-log',marker,...(block?['--block-collector']:[])],{stdio:['ignore','pipe','pipe']});
 children.add(p);let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
 const timer=setTimeout(()=>p.kill('SIGKILL'),10000);
 const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',(code,signal)=>{clearTimeout(timer);children.delete(p);resolve({code,signal,stdout,stderr});});});
 return {p,done};
}
function snapshot(journal) {return JSON.parse(execFileSync('python3',[fixture,'--snapshot',journal],{encoding:'utf8',timeout:5000}));}
function count(marker){
 if(!existsSync(marker))return 0;
 const raw=readFileSync(marker,'utf8');if(raw==='')return 0;
 assert.match(raw,/^(collect\n)+$/);return raw.split('\n').length-1;
}
async function waitFor(predicate,timeout=5000){const deadline=Date.now()+timeout;while(!predicate()){assert.ok(Date.now()<deadline,'barrier timed out');await sleep(20);}}
async function expireLease(assignment){const wait=Math.max(0,Date.parse(assignment.attempt.lease_expires_at)-Date.now()+1100);assert.ok(wait<=17000);await sleep(wait);}
try {
 const db=await mf.getD1Database('DB');
 const sql=readFileSync(join(root,'apps/control/migrations/0001.sql'),'utf8').replace(/^--.*$/gm,'');
 await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
 for(const [id,capabilities] of [['bot',['commands:read','commands:submit','node:health:read','artifact:read']],['runner',['dispatch:claim','runs:report','runs:reconcile']]]) {
  const policy={principal_id:id,workspace_id:'recovery',resource_ref:{resource_id:'synthetic-node',generation:1},recipe_ref:ref,capabilities,not_before:iso(now-10000),expires_at:iso(now+3600000),max_timeout_seconds:30,max_output_bytes:16384};
  await db.prepare('INSERT INTO grants VALUES (?,1,0,?)').bind(id,JSON.stringify(policy)).run();
 }
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
 for(const mode of ['before','after','started']) {
  console.log('qualifying',mode);
  const dir=join(directory,mode);mkdirSync(dir,{mode:0o700});
  const journal=join(dir,'journal.sqlite'),marker=join(dir,'collector.log'),config=join(dir,'runner.json');
  writeFileSync(config,JSON.stringify({base_url:`http://127.0.0.1:${proxy.address().port}`,audience,credential_id:'runner',generation:1,secret_hex:secrets.runner,journal_path:journal,workspace_id:'recovery',resource_ref:{resource_id:'synthetic-node',generation:1},recipe_ref:ref}),{flag:'wx',mode:0o600});
  const time=Date.now(),command={schema_version:'cloudlab.command.v1',schema_minor:0,workspace_id:'recovery',resource_ref:{resource_id:'synthetic-node',generation:1},recipe_ref:ref,parameters:{max_sample_age_seconds:60},idempotency_key:'fault-'+mode,not_before:iso(time-1000),dispatch_deadline:iso(time+60000),execution_deadline:iso(time+120000),timeout_seconds:10,output_budget_bytes:16384};
  const admitted=await request('/api/commands',command);assert.equal(admitted.status,202);
  const id=admitted.data.command.command_id;
  const control=async()=>{const row=await db.prepare('SELECT * FROM commands WHERE id=?').bind(id).first();return {...row,record:JSON.parse(row.record)};};
  dropReport=mode==='started'?null:mode;
  const first=child(config,marker,mode==='started');
  if(mode==='started') {
   await waitFor(()=>count(marker)===1);
   const started=snapshot(journal);assert.equal(started[0][3],'started');assert.equal(started[0][4],null);
   assert.ok(first.p.kill('SIGKILL'));
  }
  const exit=await first.done;assert.equal(exit.signal,mode==='started'?'SIGKILL':null);assert.equal(exit.code,mode==='started'?null:1);
  assert.equal(proxyFailure,null);assert.equal(count(marker),1);
  const originalAssignment=assignments.at(-1);assert.equal(originalAssignment.command_id,id);assert.equal(originalAssignment.attempt.mode,'dispatch');
  const before=snapshot(journal),remoteBefore=await control();
  save(mode+'-fault',{exit,journal:before,control:remoteBefore,assignment:originalAssignment});
  assert.equal(remoteBefore.record.delivery,mode==='after'?'result_recorded':'dispatching');
  if(mode!=='after')await expireLease(originalAssignment); // Real lease passage, no direct DB/clock mutation.
  const reportCount=reports.length;
  const restarted=await child(config,marker).done;
  assert.equal(restarted.code,0,JSON.stringify(restarted));assert.equal(restarted.signal,null);assert.equal(proxyFailure,null);
  const after=snapshot(journal),remoteAfter=await control(),newAssignment=assignments.at(-1);
  assert.deepEqual(after,before);assert.equal(count(marker),1);
  assert.deepEqual(remoteAfter.record.command,command);
  assert.deepEqual(JSON.parse(after[0][2]),remoteAfter.record.external_ref);
  // Compute immutable digest independently with Python's canonical JSON representation.
  const canonical=execFileSync('python3',['-c','import json,sys,hashlib;v=json.load(sys.stdin);print(hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()).hexdigest())'],{input:JSON.stringify({command,external_ref:remoteAfter.record.external_ref}),encoding:'utf8',timeout:5000}).trim();
  assert.equal(after[0][1],canonical);
  if(mode==='after') {
   assert.equal(newAssignment,null);assert.equal(reports.length,reportCount);assert.deepEqual(remoteAfter,remoteBefore);
  }else{
   assert.equal(newAssignment.attempt.mode,'reconcile_only');assert.equal(newAssignment.attempt.fence,originalAssignment.attempt.fence+1);
   const stale=await request('/api/runner/report',{command_id:id,attempt_id:originalAssignment.attempt.attempt_id,fence:originalAssignment.attempt.fence,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null},'runner');
   assert.equal(stale.status,409);assert.deepEqual(await control(),remoteAfter);
  }
  if(mode==='started') {
   assert.equal(remoteAfter.record.delivery,'reconciling');assert.equal(remoteAfter.active,1);assert.equal(remoteAfter.record.result,null);
   assert.deepEqual(reports.at(-1),{command_id:id,attempt_id:newAssignment.attempt.attempt_id,fence:newAssignment.attempt.fence,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null});
   const extra=await request('/api/commands',{...command,idempotency_key:'blocked-by-unknown'});assert.equal(extra.status,429);
  }else{
   const result=JSON.parse(after[0][4]);assert.equal(after[0][3],'completed');
   assert.equal(remoteAfter.record.delivery,'result_recorded');assert.equal(remoteAfter.active,0);assert.equal(remoteAfter.record.result.validation.status,'passed');
   for(const key of ['owner_outcome','started_at','finished_at'])assert.equal(remoteAfter.record.result[key],result[key]);
   assert.equal(remoteAfter.record.artifact,result.artifact);assert.equal(remoteAfter.record.result.artifact_sha256,'sha256:'+hash(result.artifact));
   if(mode==='before')assert.deepEqual(reports.at(-1),{...result,command_id:id,attempt_id:newAssignment.attempt.attempt_id,fence:newAssignment.attempt.fence});
  }
  const repeated=await request('/api/commands',command);assert.equal(repeated.status,202);assert.equal(repeated.data.command.command_id,id);
  const visible=await request('/api/commands/'+id);assert.equal(visible.status,200);assert.equal(visible.data.command.delivery,remoteAfter.record.delivery);
  save(mode+'-recovered',{exit:restarted,journal:after,control:remoteAfter,assignment:newAssignment,collector_calls:count(marker),api:visible.data.command});
  checks.push({case:mode,status:'passed',collector_calls:1,delivery:remoteAfter.record.delivery});console.log('passed',mode);
 }
 const counts=await db.prepare('SELECT count(*) n,sum(active) active FROM commands').first();assert.deepEqual(counts,{n:3,active:1});
 const summary={status:'passed',scope:'isolated local workerd/D1 binding + real Python CLI/SQLite/HTTP; no remote Cloudflare or systemd changes',checks,counts,miniflare:require('miniflare/package.json').version,sources:Object.fromEntries(['adapters/node-health/runner.py','apps/control/worker/index.mjs','apps/control/worker/auth.mjs','apps/control/worker/protocol.mjs','apps/control/migrations/0001.sql','tests/fixtures/recovery_runner.py','tools/qualify_recovery.mjs'].map(path=>[path,hash(readFileSync(join(root,path)))]))};
 save('summary',summary);console.log(JSON.stringify(summary));
} catch(error) {save('failure',{name:error.name,message:error.message,stack:error.stack});throw error;}
finally {
 const outstanding=[...children];for(const p of outstanding)p.kill('SIGKILL');
 await Promise.all(outstanding.map(p=>new Promise(resolve=>p.once('close',resolve))));
 proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await mf.dispose();
}
