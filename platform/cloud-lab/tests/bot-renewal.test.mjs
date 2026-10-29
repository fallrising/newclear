import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createLocalLab} from '../tools/local.mjs';
const fixture=fileURLToPath(new URL('./fixtures/mcp_stdio_cli.py',import.meta.url));
const bridge=fileURLToPath(new URL('./fixtures/bot_bridge_cli.py',import.meta.url));
const runner=fileURLToPath(new URL('../adapters/node-health/runner.py',import.meta.url));
function child(args,input='',env={}){return new Promise((resolve,reject)=>{
 const p=spawn('python3',args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],timeout:20000});let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('close',code=>resolve({code,out,err}));p.stdin.end(input);
});}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('explicit renewal: preview, real expiry, concurrent CLI rollover, MCP lost-ACK recovery and replay without refill',async()=>{
 const dir=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'bot-renewal-'));const lab=await createLocalLab(dir);
 try{
  const cfg=JSON.parse(await readFile(join(dir,'runner.json'),'utf8'));
  const grant=JSON.parse(lab.DB.db.prepare("SELECT policy FROM grants WHERE id='local-human'").get().policy);
  lab.DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run('local-bot',JSON.stringify({...grant,principal_id:'local-bot'}));
  const keys=JSON.parse(lab.env.MACHINE_KEYS);keys['local-bot']={...keys['local-runner'],principal_id:'local-bot',grant_id:'local-bot'};lab.env.MACHINE_KEYS=JSON.stringify(keys);
  const config=join(dir,'bot.json'),state=join(dir,'bot-state'),old=join(dir,'old.json'),next=join(dir,'next.json');
  await writeFile(config,JSON.stringify({...cfg,credential_id:'local-bot'}),{mode:0o600});await mkdir(state,{mode:0o700});
  const hash=await child(['-c',"import hashlib,json,sys;print(hashlib.sha256(json.dumps(json.load(open(sys.argv[1])),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest())",config]);assert.equal(hash.code,0,hash.err);
  const now=Math.floor(Date.now()/1000),end=now+8,utc=s=>new Date(s*1000).toISOString().replace('.000Z','Z');
  const policy={schema_version:'cloudlab.bot-policy.v1',config_sha256:hash.out.trim(),not_before:utc(now),expires_at:utc(end),authority_until:utc(now+180),max_calls:1,max_new_requests:1,call_interval_seconds:5,new_request_interval_seconds:60};
  await writeFile(old,JSON.stringify(policy),{mode:0o600});await writeFile(next,JSON.stringify({...policy,not_before:utc(end),expires_at:utc(now+120)}),{mode:0o600});
  const base=[bridge,dir,'--config',config,'--state-dir',state,'--policy',old,'--allow-loopback-http'];
  const init=await child([...base,'--initialize-policy']);assert.equal(init.code,0,init.out+init.err);
  const nonces=()=>lab.DB.db.prepare('SELECT count(*) n FROM nonces').get().n;
  const before=nonces();const plan=await child([...base,'--renew-policy','--next-policy',next,'--dry-run']);assert.equal(plan.code,0,plan.out+plan.err);assert.equal(JSON.parse(plan.out).state,'planned');assert.equal(nonces(),before);
  async function invoke(policyPath,op,env={}){
   const frames=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:`cloudlab_health_${op}`,arguments:{request_id:'12345678-1234-4234-8234-123456789abc'}}}];
   const r=await child([fixture,dir,'--config',config,'--state-dir',state,'--policy',policyPath,'--allow-submit','--allow-loopback-http'],frames.map(v=>JSON.stringify(v)+'\n').join(''),env);
   assert.equal(r.code,0,r.err);assert.equal(r.err,'');for(const secret of [cfg.secret_hex,cfg.base_url,dir])assert.ok(!r.out.includes(secret));
   return JSON.parse(r.out.trim().split('\n').at(-1)).result;
  }
  assert.equal((await invoke(old,'check',{MT_TEST_DELAY_ACK:'1'})).structuredContent.code,'BRIDGE_TIMEOUT_UNCONFIRMED');
  const original=lab.DB.db.prepare('SELECT id,body FROM commands').get();assert.ok(original);
  const early=await child([...base,'--renew-policy','--next-policy',next]);assert.equal(early.code,2);assert.equal(JSON.parse(early.out).code,'POLICY_RENEWAL_TOO_EARLY');
  const run=await child([runner,'--config',join(dir,'runner.json'),'--once','--allow-loopback-http']);assert.equal(run.code,0,run.err);
  await delay(Math.max(0,end*1000-Date.now()+100));
  const renewArgs=[...base,'--renew-policy','--next-policy',next];
  const results=await Promise.all([child(renewArgs),child(renewArgs)]);
  const bodies=results.map(r=>JSON.parse(r.out));assert.equal(bodies.filter(r=>r.state==='renewed').length,1);
  assert.equal(bodies.filter(r=>r.state==='already_applied'||r.code==='STATE_BUSY').length,1);
  assert.equal((await invoke(old,'status')).structuredContent.code,'POLICY_CONTEXT_MISMATCH');
  const recovered=await invoke(next,'check');assert.equal(recovered.structuredContent.state,'validated');assert.equal(recovered.structuredContent.command_id,original.id);
  const replay=await child(renewArgs);assert.equal(replay.code,0,replay.out+replay.err);assert.equal(JSON.parse(replay.out).state,'already_applied');
  const beforeDenied=nonces();assert.equal((await invoke(next,'status')).structuredContent.code,'POLICY_CALL_LIMIT');assert.equal(nonces(),beforeDenied);
  assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);assert.equal(lab.DB.db.prepare('SELECT body FROM commands').get().body,original.body);
  const persisted=await child(['-c',"import sqlite3,sys,json;db=sqlite3.connect(sys.argv[1]);print(json.dumps(db.execute('SELECT calls,(SELECT count(*) FROM bot_reservations),(SELECT count(*) FROM bot_policy_renewals) FROM bot_policy').fetchone()));db.close()",join(state,'requests.sqlite')]);assert.equal(persisted.code,0,persisted.err);assert.deepEqual(JSON.parse(persisted.out),[1,0,1]);
 }finally{await lab.close();}
});
