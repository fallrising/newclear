// Optional qualification against an externally provisioned, pinned Miniflare/workerd.
// No production dependency. Run through the shared build workspace.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sign,recipeRef} from '../apps/control/worker/protocol.mjs';

const toolchain=process.argv[2];
assert.ok(toolchain&&process.env.AGENT_BUILD_DIR&&process.env.AGENT_EVIDENCE_DIR,
 'Provide an external toolchain directory and use the shared workspace launcher');
const require=createRequire(resolve(toolchain,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const root=fileURLToPath(new URL('../',import.meta.url));
const now=Date.now(),iso=n=>new Date(n).toISOString().replace(/\.\d{3}Z$/,'Z');
const secret='ab'.repeat(32),runnerSecret='cd'.repeat(32),ref=await recipeRef();
const keys=Object.fromEntries([['bot',secret],['runner',runnerSecret]].map(([id,key])=>[id,{principal_id:id,grant_id:id,generation:1,secret_hex:key,expires_at:iso(now+3600000)}]));
const checks=[];
const issuer='https://synthetic.cloudflareaccess.com';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'synthetic'};
const b64=x=>Buffer.from(x).toString('base64url');
const prefix=b64(JSON.stringify({alg:'RS256',kid:'synthetic'}))+'.'+b64(JSON.stringify({iss:issuer,aud:['synthetic-audience'],sub:'synthetic-human',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600}));
const jwt=prefix+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(prefix)));
let jwksFetches=0,redirectJwks=false;
const mf=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",cf:false,telemetry:{enabled:false},resourcePersistencePath:join(process.env.AGENT_BUILD_DIR,"state"),resourceTmpPath:join(process.env.AGENT_BUILD_DIR,"tmp"),workers:[{name:"qualification",modulesRoot:join(root,'apps/control/worker'),modules:['index.mjs','auth.mjs','protocol.mjs'].map(name=>({type:'ESModule',path:join(root,'apps/control/worker',name)})),
 compatibilityDate:'2026-10-26',d1Databases:{DB:'qualification'},
 assets:{directory:join(root,'apps/control/public'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}} ,
 outboundService:async request=>{assert.equal(request.url,issuer+'/cdn-cgi/access/certs');jwksFetches++;if(redirectJwks)return new Response(null,{status:302,headers:{Location:"https://untrusted.example/keys"}});return Response.json({keys:[jwk]});},
 bindings:{ACCESS_CONFIG:JSON.stringify({issuer,audience:'synthetic-audience',subjects:{'synthetic-human':{principal_id:'bot',grant_id:'bot'}}}),PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'runtime-qualification',MACHINE_KEYS:JSON.stringify(keys)}}]}));
try {
 const db=await mf.getD1Database('DB');
 const sql=readFileSync(join(root,'apps/control/migrations/0001.sql'),'utf8').replace(/^--.*$/gm,'');
 await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
 checks.push('actual migration via D1 binding');
 for(const [id,caps] of [['bot',['commands:read','commands:submit','commands:cancel-request','node:health:read','artifact:read']],['runner',['dispatch:claim','runs:report','runs:reconcile']]]) {
  const policy={principal_id:id,workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:ref,capabilities:caps,not_before:iso(now-10000),expires_at:iso(now+3600000),max_timeout_seconds:30,max_output_bytes:16384};
  await db.prepare('INSERT INTO grants VALUES (?,1,0,?)').bind(id,JSON.stringify(policy)).run();
 }
 await assert.rejects(db.batch([
  db.prepare('INSERT INTO nonces VALUES (?,?,?)').bind('rollback','same',now),
  db.prepare('INSERT INTO nonces VALUES (?,?,?)').bind('rollback','same',now)]));
 assert.equal(await db.prepare("SELECT count(*) n FROM nonces WHERE credential_id='rollback'").first('n'),0);
 checks.push('D1 batch failure rolls back preceding write');
 const cas=await Promise.all([1,2].map(()=>db.prepare("UPDATE grants SET revision=2 WHERE id='bot' AND revision=1").run()));
 assert.deepEqual(cas.map(x=>x.meta.changes).sort(),[0,1]);
 checks.push('concurrent CAS permits one revision transition');
 for(const path of ['/','/styles.css','/dashboard.mjs','/api/bootstrap'])
  {const r=await mf.dispatchFetch('https://lab.example'+path);assert.equal(r.status,401,await r.text());}
 assert.equal((await mf.dispatchFetch('https://other.example/')).status,403);
 checks.push('anonymous assets/API and wrong origin denied by actual Worker');
 for(const [path,file] of [['/','index.html'],['/styles.css','styles.css'],['/dashboard.mjs','dashboard.mjs']]) {
  const response=await mf.dispatchFetch('https://lab.example'+path,{headers:{'Cf-Access-Jwt-Assertion':jwt}});
  assert.equal(response.status,200);
  assert.equal(await response.text(),readFileSync(join(root,'apps/control/public',file),'utf8'));
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.ok(response.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"));
 }
 assert.equal(jwksFetches,3);
 redirectJwks=true;
 assert.equal((await mf.dispatchFetch('https://lab.example/',{headers:{'Cf-Access-Jwt-Assertion':jwt}})).status,401);
 assert.equal(jwksFetches,4);
 redirectJwks=false;
 checks.push('synthetic human JWT verifies against local JWKS; actual ASSETS binding returns all three exact files with security headers');
 let nonce=0;
 async function request(path,body,who='bot') {
  const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),n=(++nonce).toString(16).padStart(32,'0');
  const signature=await sign(who==='runner'?runnerSecret:secret,'runtime-qualification',who,1,method,path,time,n,raw);
  const r=await mf.dispatchFetch('https://lab.example'+path,{method,headers:{'Content-Type':'application/json','X-Lab-Key-Id':who,'X-Lab-Time':time,'X-Lab-Nonce':n,'X-Lab-Signature':signature},...(body===undefined?{}:{body:raw})});
  return {status:r.status,data:await r.json()};
 }
 assert.equal((await request('/api/bootstrap')).status,200);
 assert.equal((await request('/')).status,403);
 const t=Date.now(),command={schema_version:'cloudlab.command.v1',schema_minor:0,workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:ref,parameters:{max_sample_age_seconds:30},idempotency_key:'runtime-one',not_before:iso(t-1000),dispatch_deadline:iso(t+60000),execution_deadline:iso(t+120000),timeout_seconds:10,output_budget_bytes:16384};
 const a=await request('/api/commands',command);assert.equal(a.status,202);
 const retry=await request('/api/commands',command);assert.equal(retry.data.command.command_id,a.data.command.command_id);
 const claim=await request('/api/runner/claim',{},'runner');assert.equal(claim.status,200);
 const assignment=claim.data.assignment;
 const report={command_id:assignment.command_id,attempt_id:assignment.attempt.attempt_id,fence:assignment.attempt.fence,owner_outcome:'succeeded',started_at:iso(Date.now()),finished_at:iso(Date.now()),artifact:JSON.stringify({status:'healthy',sample_age_seconds:0,checks:{collector:'ok'},metrics:{load_1m_milli:100,cpu_count:4,disk_free_percent:70}})};
 const result=await request('/api/runner/report',report,'runner');assert.equal(result.status,200);assert.equal(result.data.command.result.validation.status,'passed');
 assert.equal((await request(`/api/commands/${assignment.command_id}/artifact`)).status,200);
 assert.equal((await request(`/api/commands/${assignment.command_id}/artifact`,undefined,'runner')).status,403);
 checks.push('actual Worker HMAC, dedupe, claim, report, artifact ACL');
 const evidence={status:'passed',scope:'local workerd and D1 only; synthetic identities/collector',miniflare:require('miniflare/package.json').version,checks};
 writeFileSync(join(process.env.AGENT_EVIDENCE_DIR,'runtime.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(evidence));
} finally {await mf.dispose();}
