import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {request} from 'node:https';
import {healthVerdict,layoutVerdict,streamVerdict} from './followup-browser-verdicts.mjs';
import {createFixture,api,staticHeaders} from './fixture.mjs';
import {createTransport} from './transport.mjs';
const goodHealth=()=>({pageErrors:0,requestFailed:[],responses:[{method:'GET',path:api+'/session',status:401,phase:'bootstrap'}],console:[{type:'error',text:'Failed to load resource: the server responded with a status of 401 (Unauthorized)',path:api+'/session'}]});
test('F04 accepts only the initial session 401 and its exact console attribution',()=>{
 assert.equal(healthVerdict(goodHealth()).passed,true);
 for(const mutate of [x=>x.pageErrors++,x=>x.requestFailed.push({path:'/favicon.ico'}),x=>x.responses.push({...x.responses[0]}),x=>x.responses[0].phase='authenticated',x=>x.responses[0].path='/favicon.ico',x=>x.console[0].path='/favicon.ico',x=>x.console[0].text+=' injected',x=>x.console[0].type='warning',x=>x.console.push({...x.console[0]}),x=>x.console.push({type:'error',text:'CSP violation',path:'/'})]){const x=goodHealth();mutate(x);assert.equal(healthVerdict(x).passed,false);}
});
const goodLayout=()=>({gap:12,scrollWidth:390,innerWidth:390,bearerEmpty:true,screenshotBeforeBearer:true,favicon:{gets:1,heads:0,rejected:0,status:200,sha256:'a'.repeat(64)},iconSha256:'a'.repeat(64)});
test('F02 rejects missing automatic favicon, incorrect bytes, overflow and unsafe captures',()=>{
 assert.equal(layoutVerdict(goodLayout()).passed,true);
 for(const mutate of [x=>x.gap=11.9,x=>x.gap=NaN,x=>x.scrollWidth++,x=>x.bearerEmpty=false,x=>x.screenshotBeforeBearer=false,x=>x.favicon.gets=0,x=>x.favicon.status=404,x=>x.favicon.sha256='b'.repeat(64),x=>x.favicon.rejected=1]){const x=goodLayout();mutate(x);assert.equal(layoutVerdict(x).passed,false);}
});
const goodStream=()=>({injected:1,malformedReceived:1,closesBeforeRefresh:1,clientsBeforeRefresh:0,disconnected:true,errorText:'The session stream returned an invalid frame.',quietMs:1500,quietUpgrades:0,quietMutations:0,quietClients:0,refreshClicks:1,refreshUpgrades:1,refreshSubscribes:1,connectedAfterRefresh:true,mutationsAfterRefresh:0,turnStarts:0,cancels:0});
test('F03 rejects absent close, short quiet window, automatic reconnect and mutation',()=>{
 assert.equal(streamVerdict(goodStream()).passed,true);
 for(const [key,value] of Object.entries({injected:0,malformedReceived:0,closesBeforeRefresh:0,clientsBeforeRefresh:1,disconnected:false,errorText:'',quietMs:1499,quietUpgrades:1,quietMutations:1,quietClients:1,refreshClicks:2,refreshUpgrades:2,refreshSubscribes:0,connectedAfterRefresh:false,mutationsAfterRefresh:1,turnStarts:1,cancels:1})){const x=goodStream();x[key]=value;assert.equal(streamVerdict(x).passed,false,key);}
});
const modules=process.env.REVIEW_MODULES;
test('F04 opt-in favicon serves GET/HEAD with static headers; rejects other methods and preserves default 404',{skip:modules?false:'REVIEW_MODULES unset'},async()=>{
 const req=createRequire(join(modules,'playwright','package.json'));assert.equal(req('playwright/package.json').version,'1.63.0');const {wsServer:WebSocketServer}=req('playwright-core/lib/utilsBundle');
 const dir=mkdtempSync(join(tmpdir(),'fanz-followup-test-'));let transport;
 try{execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',dir+'/key','-out',dir+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const cert=readFileSync(dir+'/cert'),key=readFileSync(dir+'/key');const icon=Buffer.from([0,0,1,0,1,0]);
 for(const enabled of [false,true]){const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});const origin=`https://127.0.0.1:${port}`,fixture=createFixture({origin,scenario:'bootstrap-empty',bearer:'synthetic-review-bootstrap-canary-0001'});
 transport=createTransport({origin,fixture,key,cert,WebSocketServer,...(enabled?{favicon:icon}:{})});await transport.listen();
 const call=(method,path)=>new Promise((resolve,reject)=>{const r=request({host:'127.0.0.1',port,method,path,ca:cert},res=>{const data=[];res.on('data',b=>data.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(data)}));});r.on('error',reject);r.end();});
 for(const method of ['GET','HEAD','POST','PUT','DELETE','OPTIONS']){const r=await call(method,'/favicon.ico');assert.equal(r.status,enabled?(['GET','HEAD'].includes(method)?200:405):404,method);if(enabled&&['GET','HEAD'].includes(method)){assert.deepEqual(r.body,method==='GET'?icon:Buffer.alloc(0));for(const[k,v]of Object.entries(staticHeaders(origin,'image/x-icon')))assert.equal(r.headers[k],v,k);}}
 assert.equal((await call('GET','/favicon.ico/unknown')).status,404);assert.equal((await call('GET','/favicon.ico?x=1')).status,404);assert.deepEqual(fixture.summary().counts,{});
 if(enabled){assert.equal(transport.summary().favicon.gets,1);assert.equal(transport.summary().favicon.heads,1);assert.equal(transport.summary().favicon.rejected,4);assert.equal(transport.summary().unknownFavicon,0);}else{assert.equal(transport.summary().unknownFavicon,1);assert.equal(transport.summary().favicon,undefined);}
 await transport.close();transport=null;}
 }finally{await transport?.close();rmSync(dir,{recursive:true,force:true});}
});

test('F05 freeze interface covers all imports and assets; browser boundaries remain explicit',()=>{
 const driver=readFileSync(new URL('followup-browser.mjs',import.meta.url),'utf8');
 for(const forbidden of ['.route(','.routeWebSocket(','.fulfill(','.fetch(','ignoreHTTPSErrors','window.WebSocket=','window.WebSocket =','addInitScript','allHeaders(','headers()','postData('])assert.equal(driver.includes(forbidden),false,forbidden);
 const hashes=JSON.parse(execFileSync(process.execPath,[new URL('followup-browser.mjs',import.meta.url).pathname,'--source-hashes'],{encoding:'utf8'}));
 assert.deepEqual(Object.keys(hashes).sort(),['followup-browser.mjs','followup-browser-verdicts.mjs','fixture.mjs','transport.mjs','lifecycle.mjs','trust.mjs','/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css','/favicon.ico'].sort());
 for(const hash of Object.values(hashes))assert.match(hash,/^[a-f0-9]{64}$/);
 assert.match(driver,/assert.deepEqual\(receipt.sourceHashes,JSON.parse/);assert.match(driver,/assert.deepEqual\(sourceHashes\(\),receipt.sourceHashes/);
 assert.match(driver,/await privateState\('\/state'\);await privateState\('\/output'\)/);
 assert.match(driver,/setTimeout\(\(\)=>life.cancel\('deadline'\),200000\)/);
});
