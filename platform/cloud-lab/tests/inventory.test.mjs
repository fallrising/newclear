import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handle} from '../apps/control/worker/index.mjs';
import {sign} from '../apps/control/worker/protocol.mjs';
const sample=()=>JSON.parse(readFileSync(new URL('./fixtures/inventory.json',import.meta.url),'utf8'));
const T=Date.parse('2026-11-02T11:00:00Z'), iso=t=>new Date(t).toISOString().replace('.000Z','Z');
function fixture(){
 const db=new DatabaseSync(':memory:');
 const dir=new URL('../apps/control/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL(f,dir),'utf8'));
 const DB={prepare(sql){return {bind(...params){return {async first(){return db.prepare(sql).get(...params)||null},async run(){return {meta:{changes:db.prepare(sql).run(...params).changes}}},sql,params}},sql,params:[]}},async batch(stmts){db.exec('BEGIN');try{const out=stmts.map(s=>({meta:{changes:db.prepare(s.sql).run(...s.params).changes}}));db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}};
 const keys={};
 for(const [id,workspace,caps] of [['owner','ws_one',['commands:read','inventory:read','inventory:publish']],['reader','ws_one',['inventory:read']],['other','ws_two',['inventory:read','inventory:publish']],['bot','ws_one',['commands:read']]]){
  keys[id]={principal_id:id,grant_id:id,generation:1,secret_hex:'ab'.repeat(32),expires_at:iso(T+172800000)};
  db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run(id,JSON.stringify({principal_id:id,workspace_id:workspace,capabilities:caps,not_before:iso(T-1000),expires_at:iso(T+172800000)}));
 }
 const env={DB,PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'test',MACHINE_KEYS:JSON.stringify(keys)};let n=0;
 async function req(who='owner',report,now=T,raw){const method=report===undefined?'GET':'POST',body=raw??(report===undefined?'':JSON.stringify(report)),time=String(now/1000),nonce=(++n).toString(16).padStart(32,'0');const signature=await sign('ab'.repeat(32),'test',who,1,method,'/api/inventory',time,nonce,body);const res=await handle(new Request('https://lab.example/api/inventory',{method,headers:{'Content-Type':'application/json','X-Lab-Key-Id':who,'X-Lab-Time':time,'X-Lab-Nonce':nonce,'X-Lab-Signature':signature},...(method==='POST'?{body}:{})}),env,now);return {status:res.status,audit:res.headers.get('X-Cloud-Lab-Audit'),data:await res.json()};}
 return {db,req,env};
}
test('grant revocation or revision between authentication and SQL prevents publication',async()=>{
 for(const change of ["revoked=1","revision=revision+1"]){
  for(const existing of [false,true]){const f=fixture();if(existing)await f.req('owner',sample());
   const report=sample();report.observed_at=iso(T+1000);
   const oldPrepare=f.env.DB.prepare;let hit=false;
   f.env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO inventory_snapshots')&&!hit){hit=true;f.db.exec(`UPDATE grants SET ${change} WHERE id='owner'`);}return oldPrepare(sql);};
   assert.equal((await f.req('owner',report,T+1000)).status,403);
   assert.equal(f.db.prepare('SELECT observed_at FROM inventory_snapshots').get()?.observed_at,existing?T:undefined);
  }
 }
});
test('inventory explicit capabilities, workspace isolation and empty report',async()=>{
 const f=fixture();const denied=await f.req('bot');assert.equal(denied.status,403);assert.equal(denied.audit,'persisted');assert.equal((await f.req('reader',sample())).status,403);
 assert.equal((await f.req('reader')).data.report,null);
 assert.equal((await f.req('owner',sample())).status,201);
 const read=await f.req('reader');assert.equal(read.status,200);assert.equal(read.data.report.sections[3].state,'unreadable');assert.equal(read.data.report.sections[1].resources[0].name,'demo-worker');
 assert.equal((await f.req('other')).data.report,null);
 assert.equal((await f.req('owner',null)).status,422);
 assert.equal((await f.req('reader',null)).status,403);
 f.db.exec("UPDATE grants SET revoked=1 WHERE id='reader'");assert.equal((await f.req('reader')).status,403);
});

test('wire bounds, missing state and code points are enforced',async()=>{
 const {validateInventory}=await import('../apps/control/public/inventory.mjs');
 let r=sample();r.sections[1].resources[0].name='😀'.repeat(253);assert.doesNotThrow(()=>validateInventory(r));
 r.sections[1].resources[0].name+='😀';assert.throws(()=>validateInventory(r));
 r=sample();r.sections[1].resources[0].present=false;assert.throws(()=>validateInventory(r));
 r=sample();r.sections[1].resources[0].drift=['unexpected','unexpected'];assert.throws(()=>validateInventory(r));
 r=sample();r.sections[1].resources=Array.from({length:201},(_,i)=>({name:'worker-'+i,use:'',present:true,status:null,drift:[]}));assert.throws(()=>validateInventory(r));
 r=sample();r.sections[1].resources=Array.from({length:160},(_,i)=>({name:'worker-'+i,use:'x'.repeat(160),present:true,status:null,drift:[]}));assert.throws(()=>validateInventory(r));
});

function panelFixture(client){
 class Element{constructor(tag='div'){this.tagName=tag;this.children=[];this.value='';this.disabled=false;this.events={};this.text='';}set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.text='';this.children=xs;}addEventListener(k,v){this.events[k]=v;}}
 const nodes=new Map(),document={createElement:t=>new Element(t),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 const context={bootstrap:{workspace_id:'ws_one',capabilities:['inventory:read','inventory:publish']},revision:1,now:iso(T),confirmed:true};
 return {document,nodes,context,client};
}
test('panel rejects late scope responses, clears revoked data and preserves unconfirmed old report',async()=>{
 const {inventoryPanel}=await import('../apps/control/public/inventory.mjs');let resolve;
 const f=panelFixture({inventory:()=>new Promise(r=>resolve=r)});
 const panel=inventoryPanel(f.document,f.client,()=>f.context,()=>{f.context.bootstrap=null;panel.clear();panel.render();});
 panel.render();const first=panel.refresh();f.context.bootstrap.workspace_id='ws_two';panel.render();
 resolve({schema_version:'cloudlab.inventory-snapshot.v1',workspace_id:'ws_one',report:sample(),received_at:iso(T),digest:'sha256:'+'a'.repeat(64),now:iso(T)});await first;assert.doesNotMatch(f.nodes.get('inventory').textContent,/demo-worker/);
 f.client.inventory=async()=>({schema_version:'cloudlab.inventory-snapshot.v1',workspace_id:'ws_two',report:sample(),received_at:iso(T),digest:'sha256:'+'a'.repeat(64),now:iso(T)});
 await panel.refresh();assert.match(f.nodes.get('inventory').textContent,/demo-worker/);
 for(const report of [undefined,false,0,'']){f.client.inventory=async()=>({schema_version:'cloudlab.inventory-snapshot.v1',workspace_id:'ws_two',report,received_at:null,digest:null,now:iso(T)});await panel.refresh();assert.match(f.nodes.get('inventory').textContent,/demo-worker/);assert.match(f.nodes.get('inventory').textContent,/連線未確認/);}
 f.client.inventory=async()=>{throw new Error('offline')};await panel.refresh();assert.match(f.nodes.get('inventory').textContent,/連線未確認/);assert.match(f.nodes.get('inventory').textContent,/demo-worker/);
 f.client.inventory=async()=>{throw Object.assign(new Error('revoked'),{status:403})};await panel.refresh();assert.doesNotMatch(f.nodes.get('inventory').textContent,/demo-worker/);
});
test('panel requires explicit upload, keeps original raw JSON and renders markup as text',async()=>{
 const {inventoryPanel}=await import('../apps/control/public/inventory.mjs');let sent=null;
 const report=sample();report.sections[1].resources[0].name='<img src=x onerror=alert(1)>';
 const raw=JSON.stringify(report),f=panelFixture({publishInventory:async bytes=>{sent=bytes;return {schema_version:'cloudlab.inventory-snapshot.v1',workspace_id:'ws_one',report,received_at:iso(T),digest:'sha256:'+'a'.repeat(64),now:iso(T)}}});
 const panel=inventoryPanel(f.document,f.client,()=>f.context,()=>{});panel.render();
 f.nodes.get('inventory-file').files=[{size:raw.length,text:async()=>raw}];assert.equal(sent,null);await panel.publish();assert.equal(sent,raw);
 assert.match(f.nodes.get('inventory').textContent,/<img src=x/);
 const walk=e=>[e,...e.children.flatMap(walk)];assert.equal(walk(f.nodes.get('inventory')).some(e=>e.tagName==='img'),false);
 sent=null;f.nodes.get('inventory-file').files=[{size:24577,text:async()=>{throw new Error('must not read')}}];await panel.publish();assert.equal(sent,null);
});
test('snapshot same-report retry preserves receipt; old/conflicting report cannot overwrite',async()=>{
 const f=fixture(),a=sample();const first=await f.req('owner',a);assert.equal(first.status,201);
 const repeat=await f.req('owner',a,T+1000);assert.equal(repeat.status,200);assert.equal(repeat.data.received_at,first.data.received_at);
 const reorder={sections:a.sections,observed_at:a.observed_at,started_at:a.started_at,source:a.source,schema_version:a.schema_version};assert.equal((await f.req('owner',reorder,T+2000)).status,200);
 const conflict=sample();conflict.sections[1].resources[0].use='changed';assert.equal((await f.req('owner',conflict,T+3000)).status,409);
 const newer=sample();newer.observed_at=iso(T+5000);assert.equal((await f.req('owner',newer,T+5000)).status,201);assert.equal((await f.req('owner',a,T+6000)).status,409);
 assert.equal((await f.req('reader',undefined,T+6000)).data.report.observed_at,newer.observed_at);
});
test('invalid/version/extra/private fields, duplicate keys and future report rejected without snapshot mutation',async()=>{
 const f=fixture();await f.req('owner',sample());const original=(await f.req('reader')).data.digest;
 const bad=[];let r=sample();r.schema_version='unknown';bad.push(r);r=sample();r.account_id='secret';bad.push(r);r=sample();r.observed_at=iso(T+31000);bad.push(r);r=sample();r.sections[3].resources=[sample().sections[1].resources[0]];bad.push(r);r=sample();r.sections[1].resources[0].name='bad\u0000name';bad.push(r);r=sample();r.sections.push(r.sections[0]);bad.push(r);r=sample();r.sections[1].resources[0].use='x'.repeat(161);bad.push(r);
 for(const report of bad)assert.equal((await f.req('owner',report)).status,422);
 assert.equal((await f.req('owner',{},T,'{"schema_version":"x","schema_version":"y"}')).status,422);
 assert.equal((await f.req('owner',{},T,' '.repeat(32769))).status,413);
 assert.equal((await f.req('reader')).data.digest,original);
});
test('view distinguishes unknown/partial/stale/future and never equates inventory with health',async()=>{
 const {inventoryView,validateInventory}=await import('../apps/control/public/inventory.mjs');
 const r=validateInventory(sample());assert.equal(r.source.id,'cf-inventory');
 assert.equal(inventoryView(null,iso(T)).state,'empty');
 const envelope={report:r,received_at:iso(T),now:iso(T)};
 assert.equal(inventoryView(envelope,iso(T)).state,'partial');
 assert.equal(inventoryView(envelope,iso(T+86401000)).state,'stale');
 assert.equal(inventoryView(envelope,iso(T-60000)).state,'unknown');
 assert.equal(inventoryView(envelope,iso(T),false).state,'unconfirmed');
 assert.equal(inventoryView(envelope,iso(T)).driftCount,1);
 assert.equal(inventoryView(envelope,iso(T)).unreadableCount,1);
 assert.throws(()=>validateInventory({...r,sections:r.sections.slice(1)}));
});
