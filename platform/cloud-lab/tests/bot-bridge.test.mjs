import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createLocalLab} from '../tools/local.mjs';
const fixture=fileURLToPath(new URL('./fixtures/bot_bridge_cli.py',import.meta.url));
const runner=fileURLToPath(new URL('../adapters/node-health/runner.py',import.meta.url));
function child(args,input='',env={}){return new Promise((resolve,reject)=>{
 const p=spawn('python3',args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],timeout:20000});let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('exit',code=>resolve({code,out,err}));p.stdin.end(input);
});}
test('bot CLI lost ACK → exact retry → actual HTTP collector result → read-only status and revocation',async()=>{
 const dir=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'bot-bridge-'));const lab=await createLocalLab(dir);
 try{
  const cfg=JSON.parse(await readFile(join(dir,'runner.json'),'utf8'));
  const policy=JSON.parse(lab.DB.db.prepare("SELECT policy FROM grants WHERE id='local-human'").get().policy);
  lab.DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run('local-bot',JSON.stringify({...policy,principal_id:'local-bot'}));
  const keys=JSON.parse(lab.env.MACHINE_KEYS);keys['local-bot']={...keys['local-runner'],principal_id:'local-bot',grant_id:'local-bot'};lab.env.MACHINE_KEYS=JSON.stringify(keys);
  const config=join(dir,'bot.json'),state=join(dir,'bot-state');await writeFile(config,JSON.stringify({...cfg,credential_id:'local-bot'}),{mode:0o600});await mkdir(state,{mode:0o700});
  const id='12345678-1234-4234-8234-123456789abc';
  const invoke=async(op,submit=false,env={})=>{
   const r=await child([fixture,dir,'--config',config,'--state-dir',state,'--allow-loopback-http',...(submit?['--allow-submit']:[])],JSON.stringify({schema_version:'cloudlab.bot-request.v1',operation:op,request_id:id}),env);
   assert.equal(r.err,'');for(const secret of [cfg.secret_hex,cfg.base_url,cfg.workspace_id,dir])assert.ok(!r.out.includes(secret));return {...r,value:JSON.parse(r.out)};
  };
  const denied=await invoke('health.check');assert.equal(denied.code,2);assert.equal(denied.value.code,'SUBMIT_NOT_ENABLED');
  const lost=await invoke('health.check',true,{BOT_TEST_DROP_ACK:'1'});assert.equal(lost.code,1);assert.equal(lost.value.state,'unconfirmed');
  const original=lab.DB.db.prepare('SELECT id,body FROM commands').get();assert.ok(original);
  const nonces=()=>lab.DB.db.prepare('SELECT count(*) n FROM nonces').get().n;
  const before=nonces();const unknown=await invoke('health.status');assert.equal(unknown.value.state,'unconfirmed');assert.equal(nonces(),before,'status without ACK makes no HTTP request');
  const retry=await invoke('health.check',true);assert.equal(retry.code,0);assert.equal(retry.value.command_id,original.id);
  assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);assert.equal(lab.DB.db.prepare('SELECT body FROM commands').get().body,original.body);
  const run=await child([runner,'--config',join(dir,'runner.json'),'--once','--allow-loopback-http']);assert.equal(run.code,0,run.err);
  const status=await invoke('health.status');assert.equal(status.code,0);assert.equal(status.value.state,'validated');assert.equal(status.value.verified,true);assert.ok(['healthy','unhealthy'].includes(status.value.health));
  const again=await invoke('health.check',true);assert.equal(again.value.command_id,original.id);assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
  lab.DB.db.prepare("UPDATE grants SET revoked=1,revision=revision+1 WHERE id='local-bot'").run();
  const revoked=await invoke('health.status');assert.equal(revoked.value.state,'denied');assert.equal(revoked.value.health,null);assert.equal(revoked.value.verified,false);
 }finally{await lab.close();}
});
test('production bot CLI malformed stdin exposes only stable JSON error',async()=>{
 const path=fileURLToPath(new URL('../tools/bot_bridge.py',import.meta.url));
 const r=await child([path,'--config','/not-read/private.json','--state-dir','/not-read/state','--allow-submit'],'{"operation":"shell.exec"}');
 assert.equal(r.code,2);assert.equal(r.err,'');assert.deepEqual(JSON.parse(r.out),{schema_version:'cloudlab.bot-error.v1',code:'INVALID_REQUEST'});
});

test('Access-style HTML and oversized authorization denials stay denied',async()=>{
 const dir=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'bot-denial-'));let calls=0;
 let mode={status:403,type:'text/html',body:'<html>private-access-detail</html>'};
 const server=http.createServer((req,res)=>{calls++;assert.equal(req.method,'GET');assert.equal(req.url,'/api/bootstrap');res.writeHead(mode.status,{'Content-Type':mode.type});res.end(mode.body);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=join(dir,'bot.json'),state=join(dir,'state');await mkdir(state,{mode:0o700});
  await writeFile(config,JSON.stringify({base_url:`http://127.0.0.1:${server.address().port}`,audience:'synthetic',credential_id:'synthetic-bot',generation:1,secret_hex:'ab'.repeat(32),journal_path:'unused',workspace_id:'synthetic',resource_ref:{resource_id:'node',generation:1},recipe_ref:{recipe_id:'node-health',version:'1.0.0',digest:'sha256:'+'a'.repeat(64)}}),{mode:0o600});
  for(const item of [{status:403,type:'text/html',body:'<html>private-access-detail</html>'},{status:401,type:'text/html',body:'x'.repeat(65536)},{status:403,type:'application/json',body:'malformed-private-json'}]){
   mode=item;const r=await child([fixture,dir,'--config',config,'--state-dir',state,'--allow-loopback-http','--allow-submit'],JSON.stringify({schema_version:'cloudlab.bot-request.v1',operation:'health.check',request_id:'12345678-1234-4234-8234-123456789abc'}));
   assert.equal(r.code,1);assert.equal(r.err,'');const result=JSON.parse(r.out);assert.equal(result.state,'denied');assert.equal(result.code,'AUTHORIZATION_DENIED');assert.equal(result.health,null);assert.equal(result.verified,false);assert.ok(!r.out.includes('private'));
  }
  assert.equal(calls,3);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
