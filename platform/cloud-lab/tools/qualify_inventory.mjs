// Manual local qualification of a real report. No provider, Access or deployment calls.
// Usage via shared launcher: node tools/qualify_inventory.mjs <installed-miniflare-dir> <private-report>
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {open,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {sign,recipeRef} from '../apps/control/worker/protocol.mjs';
import {validateInventory,INVENTORY_LIMIT} from '../apps/control/public/inventory.mjs';

const [toolchain,input]=process.argv.slice(2),out=process.env.AGENT_EVIDENCE_DIR,build=process.env.AGENT_BUILD_DIR;
assert(toolchain&&input&&out&&build,'Use shared launcher, installed toolchain and private report');
const file=await open(input,'r'),buffer=Buffer.alloc(INVENTORY_LIMIT+1);let raw;
try{assert((await file.stat()).isFile());const {bytesRead}=await file.read(buffer,0,buffer.length,0);assert(bytesRead<=INVENTORY_LIMIT,'Report exceeds bound');raw=buffer.subarray(0,bytesRead);}finally{await file.close();}
const report=validateInventory(JSON.parse(raw.toString('utf8'))),root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(resolve(toolchain,'package.json')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const now=Date.now(),iso=t=>new Date(t).toISOString().replace(/\.\d{3}Z$/,'Z');
const identities=['publisher','reader','other'],secret='ab'.repeat(32),keys=Object.fromEntries(identities.map(id=>[id,{principal_id:id,grant_id:id,generation:1,secret_hex:secret,expires_at:iso(now+600000)}]));
const modules=['worker/index.mjs','worker/auth.mjs','worker/protocol.mjs','worker/inventory.mjs','public/inventory.mjs'];
const mf=new Miniflare(convertV4MiniflareOptions({cf:false,telemetry:{enabled:false},modulesRoot:join(root,'apps/control'),modules:modules.map(path=>({type:'ESModule',path:join(root,'apps/control',path)})),compatibilityDate:'2026-10-26',d1Databases:{DB:'inventory'},resourcePersistencePath:join(build,'d1'),resourceTmpPath:process.env.TMPDIR,outboundService:()=>{throw Error('Unexpected external request');},bindings:{PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'inventory-qualification',MACHINE_KEYS:JSON.stringify(keys),ACCESS_CONFIG:'{}'}}));
const checks=[];
try{
 const {DB:db}=await mf.getBindings();
 for(const name of ['0001.sql','0002.sql','0003.sql'])for(const sql of (await readFile(join(root,'apps/control/migrations',name),'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 for(const id of identities){const policy={principal_id:id,workspace_id:id==='other'?'ws_other':'ws_inventory',resource_ref:{resource_id:'node_fixture',generation:1},recipe_ref:await recipeRef(),not_before:iso(now-1000),expires_at:iso(now+600000),capabilities:id==='publisher'?['inventory:read','inventory:publish']:['inventory:read'],max_timeout_seconds:30,max_output_bytes:16384};await db.prepare('INSERT INTO grants VALUES(?,1,0,?)').bind(id,JSON.stringify(policy)).run();}
 let serial=0;
 async function request(id,body){const method=body===undefined?'GET':'POST',text=body===undefined?'':JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),nonce=(++serial).toString(16).padStart(32,'0');return mf.dispatchFetch('https://lab.example/api/inventory',{method,headers:{'Content-Type':'application/json','X-Lab-Key-Id':id,'X-Lab-Time':time,'X-Lab-Nonce':nonce,'X-Lab-Signature':await sign(secret,'inventory-qualification',id,1,method,'/api/inventory',time,nonce,text)},...(body===undefined?{}:{body:text})});}
 assert.equal((await request('publisher',report)).status,201);const stored=await (await request('reader')).json();assert.deepEqual(stored.report,report);checks.push('real report accepted and exactly read back through HMAC/workerd/D1');
 assert.equal((await request('publisher',report)).status,200);assert.equal((await (await request('reader')).json()).received_at,stored.received_at);checks.push('idempotent retry preserves receipt');
 const changed=structuredClone(report);changed.source.revision='sha256:'+(report.source.revision.endsWith('a')?'b':'a').repeat(64);assert.equal((await request('publisher',changed)).status,409);checks.push('same-time conflict rejected');
 assert.equal((await request('reader',report)).status,403);assert.equal((await (await request('other')).json()).report,null);checks.push('read-only capability and workspace isolation');
 await db.prepare("UPDATE grants SET revoked=1 WHERE id='publisher'").run();assert.equal((await request('publisher',report)).status,403);assert.deepEqual((await (await request('reader')).json()).report,stored.report);checks.push('revocation preserves stored report');
 const sources=Object.fromEntries(await Promise.all(modules.map(async p=>[p,createHash('sha256').update(await readFile(join(root,'apps/control',p))).digest('hex')])));
 const result={scope:'real input report; synthetic identities; isolated local workerd/D1, no live publication',checks,report_sha256:createHash('sha256').update(raw).digest('hex'),source_revision:report.source.revision,started_at:report.started_at,observed_at:report.observed_at,sections:report.sections.map(s=>({kind:s.kind,state:s.state,error:s.error,count:s.state==='readable'?s.resources.length:null})),sources};
 await writeFile(join(out,'inventory-runtime.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:checks.length,scope:result.scope}));
}finally{await mf.dispose();}
