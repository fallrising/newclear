import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('./office_console.js',import.meta.url),'utf8');
async function page({hash='#view=results',stored=[],reply,blockedStorage=false}={}){
 const nodes=new Map(),storage=new Map(stored),requests=[],timers=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:id==='filter'?'all':'',textContent:'',hidden:false,disabled:false,dataset:{},children:[],
 append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this[k]=v;},focus(){},scrollIntoView(){},click(){this.onclick?.();}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:node,createElement:tag=>node(Symbol(tag)),title:''},
 location:{hash,pathname:'/',reload(){context.reloaded=true;}},history:{replaceState(_a,_b,url){context.location.hash='';context.replaced=url;}},
 URLSearchParams,URL,Blob,TextEncoder,crypto:webcrypto,Date,console,addEventListener(type,handler){context.events??={};context.events[type]=handler;},
 sessionStorage:{getItem(k){if(blockedStorage)throw Error('storage blocked');return storage.get(k)??null;},setItem(k,v){if(blockedStorage)throw Error('storage blocked');storage.set(k,v);},removeItem(k){if(blockedStorage)throw Error('storage blocked');storage.delete(k);}},
 setInterval(fn){timers.push(fn);},setTimeout(){},confirm(){throw Error('unexpected confirmation');},
 fetch:async(path,options)=>{requests.push({path,...options});const data=reply?await reply():{results:{runs:[]}};return {ok:!data.error,json:async()=>data};}});
 vm.runInContext(source,context);
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};await flush();
 return {node,nodes,requests,timers,storage,context,flush};
}
test('fresh result tab has source-only login guidance, no request or write controls',async()=>{
 const p=await page();assert.equal(p.node('office-operations').hidden,true);assert.equal(p.node('readonly-info').hidden,false);
 assert.match(p.node('message').textContent,/此.*分頁/);assert.equal(p.requests.length,0);assert.equal(p.timers.length,0);
 for(const id of ['execute','plan','detect','refresh'])assert.equal(p.node(id).onclick,undefined);
 assert.equal(p.storage.get('office-view'),'results');
});
test('same-tab original launch auth keeps result mode; explicit refresh only GET',async()=>{
 const p=await page({hash:'#token=SYNTHETIC',stored:[['office-view','results']]});
 assert.equal(p.context.location.hash,'');assert.equal(p.storage.get('office-token'),'SYNTHETIC');
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].path,'/api/state');assert.equal(p.requests[0].headers.Authorization,'Bearer SYNTHETIC');
 await p.node('readonly-refresh').onclick();await p.flush();assert.equal(p.requests.length,2);
 assert.equal(p.timers.length,0);assert.ok(p.requests.every(r=>r.method==='GET'));
 await assert.rejects(vm.runInContext("api('/api/execute',{})",p.context));assert.equal(p.requests.length,2);
});
test('native status retained, retry suppressed, error clears rows and private detail',async()=>{
 let failed=false;const row={provider:'pi',status:'failed',id:'synthetic',ref:'synthetic-ref',root:1,retry:{attempt:0},artifact:{status:'unavailable'}};
 const p=await page({stored:[['office-token','SYNTHETIC']],reply:()=>failed?{error:'forbidden'}:{results:{runs:[row,{...row,id:'unknown',status:'unknown'}]}}});
 assert.equal(p.node('runs').children.length,2);const actions=p.node('runs').children[0].children[3];assert.equal(actions.children.length,1);
 assert.equal(p.node('runs').children[1].children[2].textContent,'unknown');
 actions.children[0].onclick();assert.equal(p.node('detail').hidden,false);
 failed=true;await p.node('readonly-refresh').onclick();await p.flush();
 assert.equal(p.node('runs').children.length,0);assert.equal(p.node('detail').hidden,true);assert.equal(p.node('detail').children.length,0);
 assert.match(p.node('message').textContent,/登入|連線/);assert.ok(p.requests.every(r=>r.method==='GET'));
});
test('blocked storage fails closed without operational controls or source request',async()=>{
 const p=await page({blockedStorage:true});assert.equal(p.node('office-operations').hidden,true);
 assert.equal(p.requests.length,0);assert.match(p.node('message').textContent,/儲存/);
});
test('explicit return restores original UI mode only, retaining original source token',async()=>{
 const p=await page({stored:[['office-token','SYNTHETIC']]});await p.node('return-console').onclick();
 assert.equal(p.storage.has('office-view'),false);assert.equal(p.storage.get('office-token'),'SYNTHETIC');
 assert.equal(p.context.reloaded,true);assert.ok(p.requests.every(r=>r.method==='GET'));
});

test('same-document original launch URL reloads to existing token parser',async()=>{
 const p=await page();p.context.location.hash='#token=SYNTHETIC';p.context.events.hashchange();
 assert.equal(p.context.reloaded,true);assert.equal(p.requests.length,0);
});
