// One-off T047 browser inspection. Run from repository root; see T047.acceptance.md.
// Requires Node >=22 with WebSocket and a caller-provided Chromium executable.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const executable=process.env.NAV_CHROMIUM_EXECUTABLE;
assert.ok(executable, 'Set NAV_CHROMIUM_EXECUTABLE to an existing Chromium binary');
const root=process.cwd(); const web=join(root,'platform/fanzloud/apps/control-plane/web');
const out=join(root,'platform/fanzloud/docs/acceptance/evidence/T047');
let mode='logged-out'; const requests=[],external=[],errors=[],sessions=new Map();
const server=createServer(async(req,res)=>{
 requests.push({method:req.method,path:req.url.split('?')[0]});
 if(req.url.startsWith('/api/')) {res.writeHead(mode==='unavailable'?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(mode==='unavailable'?{error:'unavailable'}:{authenticated:false,csrf_token:''}));return;}
 const file=req.url.split('?')[0]==='/'?'isolated.html':req.url.split('?')[0].replace('/assets/','');
 if(!['isolated.html','p0.css','isolated.js','candidate.js','favicon.ico'].includes(file)){res.writeHead(404);res.end();return;}
 const types={html:'text/html',css:'text/css',js:'text/javascript',ico:'image/x-icon'};
 res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]});res.end(await readFile(join(web,file)));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'fz-nav-chrome-'));
const chrome=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;let seq=0;const pending=new Map();let eventFailure;
const until=async(fn)=>{for(let i=0;i<150;i++){if(eventFailure)throw eventFailure;const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,30));}throw Error('inspection timeout');};
try{
 const endpoint=await new Promise((resolve,reject)=>{let s='';chrome.stderr.on('data',c=>{s+=c;const m=s.match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1]);});chrome.on('exit',c=>reject(Error('Chrome exit '+c)));setTimeout(()=>reject(Error('Chrome startup timeout')),10000).unref();});
 socket=new WebSocket(endpoint);await new Promise(r=>socket.onopen=r);
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 socket.onmessage=async({data})=>{try{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);return;}
  if(m.method==='Target.attachedToTarget'){
   const sid=m.params.sessionId;const target=m.params.targetInfo; if(target.type!=='page'){await call('Runtime.runIfWaitingForDebugger',{},sid).catch(()=>{});return;}
   await call('Fetch.enable',{patterns:[{urlPattern:'*'}]},sid);
   await call('Runtime.runIfWaitingForDebugger',{},sid);
   await call('Runtime.enable',{},sid);await call('Page.enable',{},sid);sessions.set(target.targetId,sid);
  }
  if(m.method==='Fetch.requestPaused'){
   const {request,requestId}=m.params;
   if(request.url.startsWith('https://github.com/')){
    if(m.params.resourceType==='Document') external.push({url:request.url,method:request.method,referrer:request.headers.Referer??request.headers.referer??null});
    await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<title>Intercepted public instructions</title><p>Document navigation fixture</p>').toString('base64')},m.sessionId);
   }else if(request.url.startsWith('http://127.0.0.1:'))await call('Fetch.continueRequest',{requestId},m.sessionId);
   else await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},m.sessionId);
  }
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
 }catch(e){eventFailure=e;}};
 await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page'},{exclude:true}]});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const sid=await until(()=>sessions.get(targetId));
 const evaluate=async(expression,session=sid)=>(await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session)).result.value;
 const url=`http://127.0.0.1:${server.address().port}/?synthetic-private-marker=do-not-forward#synthetic-session`;
 await call('Page.navigate',{url},sid);await until(()=>evaluate('document.getElementById("connection-status")?.textContent === "請登入私人工作區"'));
 const links=await evaluate('Array.from(document.querySelectorAll(".result-entry-nav a"),a=>({text:a.textContent,href:a.href,target:a.target,rel:a.rel,policy:a.referrerPolicy}))');assert.equal(links.length,3);
 const paths=['platform/fanzloud/docs/isolated-operator.md','platform/agent-platform/docs/RESULT-ARCHIVE.md','labs/agent-office-lab/docs/RESULTS.md'];
 for(let i=0;i<3;i++)assert.equal(links[i].href,'https://github.com/fallrising/newclear/blob/main/'+paths[i]);
 for(const a of links){assert.match(a.text,/操作說明（新分頁）/);assert.equal(a.target,'_blank');assert.equal(a.policy,'no-referrer');assert.match(a.rel,/noopener/);assert.match(a.rel,/noreferrer/);}
 assert.equal(await evaluate('document.querySelector(".result-entry-nav").open'),false);
 // Keyboard navigation, including activation of the first link.
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);
 assert.equal(await evaluate('document.activeElement.tagName'),'SUMMARY');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sid);
 assert.equal(await evaluate('document.querySelector(".result-entry-nav").open'),true);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);
 assert.equal(await evaluate('document.activeElement.href'),links[0].href);
 for(let i=0;i<3;i++){
  const before=new Set(sessions.keys());
  if(i===0){await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sid);}
  else {const point=await evaluate(`(()=>{const a=document.querySelectorAll('.result-entry-nav a')[${i}];a.scrollIntoView();const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point},sid);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point},sid);}
  const popup=await until(()=>[...sessions.keys()].find(k=>!before.has(k))).catch(async e=>{console.log(JSON.stringify({linkIndex:i,external,targets:await call('Target.getTargets')}));throw e;});const ps=sessions.get(popup);
  await until(()=>evaluate('document.title === "Intercepted public instructions"',ps));assert.equal(await evaluate('window.opener === null',ps),true);
  assert.equal(await evaluate('location.href'),url);assert.equal(external.at(-1).referrer,null);
  await call('Target.closeTarget',{targetId:popup});
 }
 const layouts=[];
 for(const width of [1280,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sid);
  await evaluate('document.querySelector(".result-entry-nav").open=false; window.scrollTo(0,0)');
  const collapsed=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sid);await writeFile(join(out,`navigation-collapsed-${width}.png`),Buffer.from(collapsed.data,'base64'));
  await evaluate('document.querySelector(".result-entry-nav").open=true');
  const measures=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,links:[...document.querySelectorAll(".result-entry-nav a")].map(a=>{const r=a.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height}})})');
  assert.ok(measures.scroll<=width);for(const r of measures.links)assert.ok(r.x>=0&&r.x+r.width<=width&&r.height>=32);layouts.push(measures);
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sid);await writeFile(join(out,`navigation-${width}.png`),Buffer.from(shot.data,'base64'));
 }
 mode='unavailable';await call('Page.reload',{},sid);await until(()=>evaluate('document.getElementById("error-message")?.textContent.includes("503")'));assert.equal(await evaluate('document.querySelectorAll(".result-entry-nav a").length'),3);
 await call('Emulation.setScriptExecutionDisabled',{value:true},sid);await call('Page.reload',{},sid);await until(()=>evaluate('document.readyState === "complete"'));assert.equal(await evaluate('document.querySelectorAll(".result-entry-nav a").length'),3);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);
 assert.equal(await evaluate('document.activeElement.tagName'),'SUMMARY');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sid);
 assert.equal(await evaluate('document.querySelector(".result-entry-nav").open'),true);
 assert.deepEqual(requests.filter(r=>r.method!=='GET'),[]);assert.deepEqual(errors,[]);assert.equal(external.length,3);
 const hashes={};for(const file of ['isolated.html','p0.css','isolated.js','candidate.js'])hashes[file]=createHash('sha256').update(await readFile(join(web,file))).digest('hex');
 await writeFile(join(out,'browser.json'),JSON.stringify({status:'passed',date:new Date().toISOString(),scope:'Actual shipped HTML/CSS/JS; synthetic logged-out/503 HTTP session; external document responses intercepted. No Rust/AP/provider/live acceptance.',browser:await call('Browser.getVersion'),links,external,layouts,requests,page_errors:errors,keyboard_activation:true,native_disclosure:true,default_collapsed:true,opener_null:true,source_page_preserved:true,no_js_links_present:true,no_js_disclosure_activated:true,unavailable_links_present:true,inspection_sha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),source_hashes:hashes},null,2)+'\n');
 console.log('PASS: Chromium links/keyboard/opener/referrer, 1280/390 layouts,503/no-JS; zero mutation requests; three intercepted documents; zero page errors');
 await call('Browser.close');
}finally{socket?.close();if(chrome.exitCode===null)chrome.kill('SIGTERM');await new Promise(r=>server.close(r));await new Promise(r=>{if(chrome.exitCode!==null)r();else chrome.once('exit',r);});await rm(profile,{recursive:true,force:true});}
