import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createLocalLab} from '../tools/local.mjs';
const fixture=fileURLToPath(new URL('./fixtures/mcp_stdio_cli.py',import.meta.url));
const runner=fileURLToPath(new URL('../adapters/node-health/runner.py',import.meta.url));
function child(args,input='',env={}){return new Promise((resolve,reject)=>{
 const p=spawn('python3',args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],timeout:20000});let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('close',code=>resolve({code,out,err}));p.stdin.end(input);
});}
test('MCP stdio: real POST timeout, restart same ID, collector result, read-only status and revocation',async()=>{
 const dir=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'mcp-stdio-'));const lab=await createLocalLab(dir);
 try{
  const cfg=JSON.parse(await readFile(join(dir,'runner.json'),'utf8'));
  const policy=JSON.parse(lab.DB.db.prepare("SELECT policy FROM grants WHERE id='local-human'").get().policy);
  lab.DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run('local-bot',JSON.stringify({...policy,principal_id:'local-bot'}));
  const keys=JSON.parse(lab.env.MACHINE_KEYS);keys['local-bot']={...keys['local-runner'],principal_id:'local-bot',grant_id:'local-bot'};lab.env.MACHINE_KEYS=JSON.stringify(keys);
  const config=join(dir,'bot.json'),state=join(dir,'bot-state');await writeFile(config,JSON.stringify({...cfg,credential_id:'local-bot'}),{mode:0o600});await mkdir(state,{mode:0o700});
  const id='12345678-1234-4234-8234-123456789abc';
  const invoke=async(op,submit=false,env={})=>{
   const frames=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-host',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:`cloudlab_health_${op}`,arguments:{request_id:id}}},{jsonrpc:'2.0',id:4,method:'ping'}];
   const r=await child([fixture,dir,'--config',config,'--state-dir',state,'--allow-loopback-http',...(submit?['--allow-submit']:[])],frames.map(x=>JSON.stringify(x)+'\n').join(''),env);
   assert.equal(r.code,0,r.err);assert.equal(r.err,'');for(const secret of [cfg.secret_hex,cfg.base_url,cfg.workspace_id,dir])assert.ok(!r.out.includes(secret));
   const replies=r.out.trim().split('\n').map(x=>JSON.parse(x));assert.equal(replies.length,4);assert.equal(replies[0].result.protocolVersion,'2025-11-25');assert.equal(replies[1].result.tools.length,submit?2:1);assert.deepEqual(replies[3].result,{});
   const answer=replies[2].result;assert.deepEqual(JSON.parse(answer.content[0].text),answer.structuredContent);return answer;
  };
  const lost=await invoke('check',true,{MT_TEST_DELAY_ACK:'1'});assert.equal(lost.isError,true);assert.equal(lost.structuredContent.code,'BRIDGE_TIMEOUT_UNCONFIRMED');assert.equal(lost.structuredContent.request_id,id);
  const original=lab.DB.db.prepare('SELECT id,body FROM commands').get();assert.ok(original);
  const nonces=()=>lab.DB.db.prepare('SELECT count(*) n FROM nonces').get().n;
  const before=nonces();const pending=await invoke('status');assert.equal(pending.structuredContent.state,'unconfirmed');assert.equal(nonces(),before);
  const retry=await invoke('check',true);assert.equal(retry.isError,false);assert.equal(retry.structuredContent.command_id,original.id);
  assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);assert.equal(lab.DB.db.prepare('SELECT body FROM commands').get().body,original.body);
  const run=await child([runner,'--config',join(dir,'runner.json'),'--once','--allow-loopback-http']);assert.equal(run.code,0,run.err);
  const status=await invoke('status');assert.equal(status.isError,false);assert.equal(status.structuredContent.state,'validated');assert.equal(status.structuredContent.verified,true);
  lab.DB.db.prepare("UPDATE grants SET revoked=1,revision=revision+1 WHERE id='local-bot'").run();
  const revoked=await invoke('status');assert.equal(revoked.isError,true);assert.equal(revoked.structuredContent.state,'denied');assert.equal(revoked.structuredContent.health,null);assert.equal(revoked.structuredContent.verified,false);
  assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
 }finally{await lab.close();}
});
