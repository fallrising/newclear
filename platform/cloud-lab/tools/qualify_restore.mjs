// Isolated logical D1 restore + SQLite online backup. Never connects to live Cloudflare.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {sign,recipeRef} from '../apps/control/worker/protocol.mjs';

const [toolchain,selected]=process.argv.slice(2),build=process.env.AGENT_BUILD_DIR,evidence=process.env.AGENT_EVIDENCE_DIR;
assert.ok(toolchain&&build&&evidence,'Use the shared launcher and existing toolchain');
const cases=['started','unknown','completed','missing-journal','identity-mismatch','accepted-control'];
assert.ok(selected===undefined||cases.includes(selected));
const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(evidence,'restore');
mkdirSync(directory,{mode:0o700});
const require=createRequire(resolve(toolchain,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const fixture=join(root,'tests/fixtures/recovery_runner.py'),backupTool=join(root,'tests/fixtures/restore_journal.py');
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(Array.isArray(x)?x.map(ordered):ordered(x));
function ordered(x){return Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;}
const save=(dir,name,value)=>writeFileSync(join(dir,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const tables=['grants','commands','nonces','schedules','firings','rejection_audit'];
const schemaSQL="SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT IN ('_cf_KV','_cf_METADATA') AND name NOT LIKE 'sqlite_%' ORDER BY name";
async function snapshot(db){
 const results=await db.batch([db.prepare(schemaSQL),...tables.map(name=>db.prepare(`SELECT * FROM ${name}`))]);
 assert.ok(results.every(r=>r.success));
 return {schema:results[0].results,tables:Object.fromEntries(tables.map((name,i)=>[name,results[i+1].results.sort((a,b)=>canonical(a).localeCompare(canonical(b)))]))};
}
async function restore(db,backup){
 assert.deepEqual((await db.prepare(schemaSQL).all()).results,[]);
 const statements=[];
 // Application schema only; table order retains grants before command foreign keys.
 for(const table of tables){const schema=backup.schema.find(x=>x.type==='table'&&x.name===table);assert.ok(schema);statements.push(db.prepare(schema.sql));}
 for(const table of tables)for(const row of backup.tables[table]){const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));statements.push(db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>row[k])));}
 for(const index of backup.schema.filter(x=>x.type==='index'))statements.push(db.prepare(index.sql));
 assert.equal(backup.schema.length,tables.length+4);
 const out=await db.batch(statements);assert.ok(out.every(r=>r.success));
 assert.deepEqual(await snapshot(db),backup);
 assert.deepEqual((await db.prepare('PRAGMA quick_check').all()).results,[{quick_check:'ok'}]);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
}
const ref=await recipeRef(),origin='https://lab.example',audience='restore-qualification',secret={bot:'ab'.repeat(32),runner:'cd'.repeat(32)};
const iso=t=>new Date(t).toISOString().replace(/\.\d{3}Z$/,'Z');
const count=p=>existsSync(p)?readFileSync(p,'utf8').split('\n').filter(Boolean).length:0;
const journal=p=>JSON.parse(execFileSync('python3',[fixture,'--snapshot',p],{encoding:'utf8',timeout:5000}));
const backup=(src,dst)=>JSON.parse(execFileSync('python3',[backupTool,src,dst],{encoding:'utf8',timeout:5000}));
const checks=[];
try {
 for(const mode of selected?[selected]:cases){
  const dir=join(directory,mode);mkdirSync(dir,{mode:0o700});const instances=[],children=new Map();
  let proxy,source,destination,route='source',drop=false,failure=null;const calls={source:{claims:[],reports:[]},restore:{claims:[],reports:[]}};
  const now=Date.now(),expires=iso(now+3600000),keys=Object.fromEntries(Object.entries(secret).map(([name,key])=>[name,{principal_id:name,grant_id:name,generation:1,secret_hex:key,expires_at:expires}]));
  function runtime(name){const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',cf:false,telemetry:{enabled:false},resourcePersistencePath:join(dir,name+'-d1'),resourceTmpPath:join(build,mode.slice(0,3)+'-'+name),workers:[{name:'restore-test',modulesRoot:join(root,'apps/control/worker'),modules:['index.mjs','auth.mjs','protocol.mjs'].map(n=>({type:'ESModule',path:join(root,'apps/control/worker',n)})),compatibilityDate:'2026-10-26',d1Databases:{DB:name},outboundService:()=>new Response(null,{status:503}),bindings:{PUBLIC_ORIGIN:origin,AUDIENCE:audience,MACHINE_KEYS:JSON.stringify(keys),ACCESS_CONFIG:'{}'}}]}));instances.push(mf);return mf;}
  let nonce=0;
  async function request(mf,path,body,who='bot'){
   const raw=JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),n=(++nonce).toString(16).padStart(32,'0');
   const signature=await sign(secret[who],audience,who,1,'POST',path,time,n,raw);
   const r=await mf.dispatchFetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Key-Id':who,'X-Lab-Time':time,'X-Lab-Nonce':n,'X-Lab-Signature':signature},body:raw});return {status:r.status,data:await r.json()};
  }
  function child(config,marker,flags=[]){
   const p=spawn('python3',[fixture,'--config',config,'--collector-log',marker,...flags],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
   p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>p.kill('SIGKILL'),10000);
   const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',(code,signal)=>{clearTimeout(timer);children.delete(p);resolve({code,signal,stdout,stderr});});});children.set(p,done);return {p,done};
  }
  try {
   source=runtime('src');const db=await source.getD1Database('DB');
   const sql=['0001.sql','0002.sql'].map(n=>readFileSync(join(root,'apps/control/migrations',n),'utf8')).join('\n').replace(/^--.*$/gm,'');await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
   const common={workspace_id:'restore-test',resource_ref:{resource_id:'synthetic-node',generation:1},recipe_ref:ref,not_before:iso(now-1000),expires_at:expires,max_timeout_seconds:30,max_output_bytes:16384};
   for(const [name,capabilities] of [['bot',['commands:submit','commands:read','node:health:read']],['runner',['dispatch:claim','runs:reconcile','runs:report']]])await db.prepare('INSERT INTO grants VALUES(?,1,0,?)').bind(name,JSON.stringify({...common,principal_id:name,capabilities})).run();
   // Disabled synthetic schedule and preserved due marker exercise restored history, no Cron.
   await db.prepare("INSERT INTO schedules VALUES('health-minute',1,0,'bot',NULL)").run();
   await db.prepare("INSERT INTO firings VALUES('health-minute',1,0,'skipped_misfire')").run();
   proxy=createServer(async(req,res)=>{try{
    assert.equal(req.headers.host,`127.0.0.1:${proxy.address().port}`);assert.equal(req.method,'POST');assert.ok(['/api/runner/claim','/api/runner/report'].includes(req.url));
    const chunks=[];let n=0;for await(const b of req){n+=b.length;assert.ok(n<=32768);chunks.push(b);}const body=Buffer.concat(chunks),which=route;
    if(req.url.endsWith('/report')){calls[which].reports.push(JSON.parse(body));if(which==='source'&&drop){drop=false;req.socket.destroy();return;}}
    const headers={...req.headers};for(const key of ['host','connection','content-length'])delete headers[key];
    const response=await (which==='source'?source:destination).dispatchFetch(origin+req.url,{method:'POST',headers,body});const raw=await response.text();
    if(req.url.endsWith('/claim'))calls[which].claims.push({status:response.status,body:JSON.parse(raw)});
    res.writeHead(response.status,{'Content-Type':'application/json'});res.end(raw);
   }catch(error){failure=error;res.destroy();}});
   await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
   const srcJournal=join(dir,'source.sqlite'),restoreJournal=join(dir,'restored.sqlite'),srcMarker=join(dir,'source-collector.log'),dstMarker=join(dir,'restored-collector.log');
   const config={base_url:`http://127.0.0.1:${proxy.address().port}`,audience,credential_id:'runner',generation:1,secret_hex:secret.runner,journal_path:srcJournal,workspace_id:common.workspace_id,resource_ref:common.resource_ref,recipe_ref:ref};
   const srcConfig=join(dir,'source.json'),dstConfig=join(dir,'restored.json');writeFileSync(srcConfig,JSON.stringify(config),{flag:'wx',mode:0o600});
   execFileSync('python3',['-c',"import importlib.util,sys;s=importlib.util.spec_from_file_location('r',sys.argv[1]);r=importlib.util.module_from_spec(s);s.loader.exec_module(r);r.Journal(sys.argv[2]).close()",join(root,'adapters/node-health/runner.py'),srcJournal],{timeout:5000});
   if(mode==='missing-journal')backup(srcJournal,join(dir,'journal-backup.sqlite'));
   const t=Date.now(),command={schema_version:'cloudlab.command.v1',schema_minor:0,workspace_id:common.workspace_id,resource_ref:common.resource_ref,recipe_ref:ref,parameters:{max_sample_age_seconds:60},idempotency_key:'restore-'+mode,not_before:iso(t-1000),dispatch_deadline:iso(t+60000),execution_deadline:iso(t+120000),timeout_seconds:10,output_budget_bytes:16384};
   const admitted=await request(source,'/api/commands',command);assert.equal(admitted.status,202);const id=admitted.data.command.command_id;
   let controlBackup=mode==='accepted-control'?await snapshot(db):null;
   const blocking=['started','missing-journal'].includes(mode);drop=['completed','identity-mismatch','accepted-control'].includes(mode);
   const first=child(srcConfig,srcMarker,blocking?['--block-collector']:mode==='unknown'?['--unknown-collector']:[]);
   if(blocking){const until=Date.now()+5000;while(count(srcMarker)!==1){assert.ok(Date.now()<until,'collector barrier timeout');await sleep(20);}assert.equal(journal(srcJournal)[0][3],'started');assert.ok(first.p.kill('SIGKILL'));}
   const exit=await first.done;assert.equal(exit.signal,blocking?'SIGKILL':null);assert.equal(exit.code,blocking?null:mode==='unknown'?0:1);assert.equal(failure,null);assert.equal(count(srcMarker),1);
   const old=calls.source.claims[0].body.assignment;assert.equal(old.attempt.mode,'dispatch');assert.equal(old.command_id,id);
   controlBackup??=await snapshot(db);save(dir,'control-backup',controlBackup);
   if(mode!=='missing-journal')backup(srcJournal,join(dir,'journal-backup.sqlite'));
   const backed=backup(join(dir,'journal-backup.sqlite'),restoreJournal);assert.deepEqual(backed,journal(join(dir,'journal-backup.sqlite')));
   const identity=hash(canonical({command,external_ref:old.external_ref}));if(backed.length)assert.equal(backed[0][1],identity);
   const sourceFrozen=await snapshot(db),sourceJournalFrozen=journal(srcJournal);save(dir,'source-frozen',{control:sourceFrozen,journal:sourceJournalFrozen,exit});
   destination=runtime('dst');const restored=await destination.getD1Database('DB');await restore(restored,controlBackup);
   save(dir,'restore-exact',{control:await snapshot(restored),journal:journal(restoreJournal),control_sha256:hash(canonical(controlBackup)),journal_sha256:hash(canonical(backed))});
   // Quarantine is an explicit destination-only policy change AFTER exact restore proof.
   const runnerPolicy=JSON.parse(controlBackup.tables.grants.find(g=>g.id==='runner').policy);runnerPolicy.capabilities=['runs:reconcile','runs:report'];
   await restored.batch([restored.prepare("UPDATE grants SET revoked=1,revision=revision+1 WHERE id='bot'"),restored.prepare("UPDATE grants SET policy=?,revision=revision+1 WHERE id='runner'").bind(JSON.stringify(runnerPolicy)),restored.prepare('UPDATE schedules SET enabled=0')]);
   save(dir,'quarantine',{grants:(await restored.prepare('SELECT * FROM grants ORDER BY id').all()).results,schedules:(await restored.prepare('SELECT * FROM schedules').all()).results});
   if(mode==='identity-mismatch')execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('UPDATE executions SET identity_digest=?',('0'*64,));c.commit();c.close()",restoreJournal],{timeout:5000});
   const journalBefore=journal(restoreJournal),rowBefore=await restored.prepare('SELECT * FROM commands WHERE id=?').bind(id).first();
   const wait=Math.max(0,Date.parse(old.attempt.lease_expires_at)-Date.now()+1100);assert.ok(wait<=17000);if(mode!=='accepted-control'&&mode!=='unknown')await sleep(wait);
   writeFileSync(dstConfig,JSON.stringify({...config,journal_path:restoreJournal}),{flag:'wx',mode:0o600});route='restore';
   const recovered=await child(dstConfig,dstMarker).done;save(dir,'restore-process',recovered);assert.equal(failure,null);assert.equal(recovered.signal,null);
   assert.equal(count(dstMarker),0,'restoration must never call the collector');assert.equal(count(srcMarker),1);
   const row=await restored.prepare('SELECT * FROM commands WHERE id=?').bind(id).first(),v=JSON.parse(row.record),assignment=calls.restore.claims[0].body.assignment;
   assert.deepEqual(v.command,command);assert.equal(row.body,rowBefore.body);assert.equal(row.body_digest,rowBefore.body_digest);assert.equal(row.id,id);
   if(mode==='accepted-control'){
    assert.equal(recovered.code,1);assert.equal(calls.restore.claims[0].status,403);assert.equal(calls.restore.claims[0].body.code,'SCOPE_DENIED');assert.equal(calls.restore.reports.length,0);assert.deepEqual(row,rowBefore);assert.deepEqual(journal(restoreJournal),journalBefore);
   }else{
    assert.equal(assignment.attempt.mode,'reconcile_only');assert.equal(assignment.attempt.fence,old.attempt.fence+1);assert.deepEqual(assignment.external_ref,old.external_ref);
    if(mode==='identity-mismatch'){
     assert.equal(recovered.code,1);assert.equal(calls.restore.reports.length,0);assert.deepEqual(journal(restoreJournal),journalBefore);assert.equal(v.result,null);assert.equal(row.active,1);
    }else{
     assert.equal(recovered.code,0,JSON.stringify(recovered));assert.equal(calls.restore.reports.length,1);
     if(mode==='completed'){
      const result=JSON.parse(backed[0][4]);assert.equal(backed[0][3],'completed');assert.equal(v.delivery,'result_recorded');assert.equal(row.active,0);
      for(const key of ['owner_outcome','started_at','finished_at'])assert.equal(v.result[key],result[key]);assert.equal(v.artifact,result.artifact);assert.equal(v.result.artifact_sha256,'sha256:'+hash(result.artifact));assert.deepEqual(journal(restoreJournal),journalBefore);
     }else{
      assert.equal(v.delivery,'reconciling');assert.equal(v.result,null);assert.equal(row.active,1);assert.equal(calls.restore.reports[0].owner_outcome,'unknown');
      if(mode==='missing-journal'){const j=journal(restoreJournal);assert.equal(j.length,1);assert.equal(j[0][3],'unknown');assert.equal(j[0][1],identity);assert.equal(JSON.parse(j[0][4]).artifact,null);}else assert.deepEqual(journal(restoreJournal),journalBefore);
     }
    }
    const stale=await request(destination,'/api/runner/report',{command_id:id,attempt_id:old.attempt.attempt_id,fence:old.attempt.fence,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null},'runner');assert.equal(stale.status,409);assert.equal(stale.data.code,'STALE_FENCE');assert.deepEqual(await restored.prepare('SELECT * FROM commands WHERE id=?').bind(id).first(),row);
    const audit=await restored.prepare('SELECT code FROM rejection_audit WHERE request_id=?').bind(stale.data.request_id).first();assert.equal(audit.code,'STALE_FENCE');
   }
   assert.deepEqual(await snapshot(db),sourceFrozen);assert.deepEqual(journal(srcJournal),sourceJournalFrozen);
   assert.deepEqual((await restored.prepare('SELECT * FROM firings').all()).results,controlBackup.tables.firings);
   save(dir,'reconciled',{command:row,journal:journal(restoreJournal),claims:calls.restore.claims,reports:calls.restore.reports,source_unchanged:true,source_collector_calls:1,restore_collector_calls:0});
   checks.push({case:mode,status:'passed',source_collector_calls:1,restore_collector_calls:0,restored_delivery:v.delivery,restored_active:row.active,journal_state:journal(restoreJournal)[0]?.[3]??null,source_unchanged:true});console.log('passed',mode);
  }finally{
   const owned=[...children.entries()];for(const [p] of owned)p.kill('SIGKILL');await Promise.allSettled(owned.map(([,done])=>done));
   if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
   await Promise.all(instances.map(mf=>mf.dispose()));
  }
 }
 const paths=['apps/control/worker/index.mjs','apps/control/worker/auth.mjs','apps/control/worker/protocol.mjs','apps/control/migrations/0001.sql','apps/control/migrations/0002.sql','adapters/node-health/runner.py','tests/fixtures/recovery_runner.py','tests/fixtures/restore_journal.py','tools/qualify_restore.mjs'];
 const summary={status:'passed',scope:'isolated local workerd logical D1 restore and real Python/SQLite journal; no remote export/import or live change',cases:checks,miniflare:require('miniflare/package.json').version,sources:Object.fromEntries(paths.map(p=>[p,hash(readFileSync(join(root,p)))]))};save(directory,'summary',summary);console.log(JSON.stringify(summary));
}catch(error){save(directory,'failure',{name:error.name,message:error.message,stack:error.stack,completed:checks});throw error;}
