// Shipped Fanzloud UI -> real Office HTTP, isolated synthetic records; no provider/deploy.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.cwd(),web=join(root,'platform/fanzloud/apps/control-plane/web');
const out=join(root,'platform/fanzloud/docs/acceptance/evidence/FZ-OFFICE-NAV');await mkdir(out,{recursive:true});
const executable=process.env.NAV_CHROMIUM_EXECUTABLE;assert(executable);
const fixture=spawn('python3',['platform/fanzloud/acceptance/office-navigation-fixture.py'],{stdio:['pipe','pipe','inherit']});
const lines=[],waiters=[];createInterface({input:fixture.stdout}).on('line',line=>{const value=JSON.parse(line);const next=waiters.shift();if(next)next(value);else lines.push(value);});
const nextLine=()=>lines.length?Promise.resolve(lines.shift()):new Promise((resolve,reject)=>{waiters.push(resolve);setTimeout(()=>reject(Error('fixture timeout')),10000).unref();});
const command=async text=>{fixture.stdin.write(text+'\n');return nextLine();};
const {port}=await nextLine(),office=`http://127.0.0.1:${port}`;
let mode='logged-out';const fanzRequests=[],errors=[],downloads=[],downloadProgress=new Map(),sessions=new Map();
const server=createServer(async(req,res)=>{
 fanzRequests.push({method:req.method,path:req.url});
 if(req.url.startsWith('/api/')){res.writeHead(mode==='unavailable'?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify({authenticated:false,csrf_token:''}));return;}
 const file=req.url==='/'?'isolated.html':req.url.replace('/assets/','');
 if(!['isolated.html','isolated.js','candidate.js','p0.css','favicon.ico'].includes(file)){res.writeHead(404);res.end();return;}
 const types={html:'text/html',js:'text/javascript',css:'text/css',ico:'image/x-icon'};
 res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]});res.end(await readFile(join(web,file)));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const fanz=`http://127.0.0.1:${server.address().port}`;
const scratch=await mkdtemp(join(tmpdir(),'office-nav-browser-')),downloadPath=join(scratch,'downloads');await mkdir(downloadPath);
const chrome=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${join(scratch,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,seq=0,eventFailure;const pending=new Map();
const until=async fn=>{for(let i=0;i<240;i++){if(eventFailure)throw eventFailure;const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('browser assertion timeout');};
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';chrome.stderr.on('data',c=>{output+=c;const m=output.match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1]);});chrome.on('exit',c=>reject(Error('Chrome exit '+c)));setTimeout(()=>reject(Error('Chrome startup timeout')),10000).unref();});
 socket=new WebSocket(endpoint);await new Promise(r=>socket.onopen=r);
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 socket.onmessage=async({data})=>{try{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);return;}
  if(m.method==='Target.attachedToTarget'){const sid=m.params.sessionId;await call('Runtime.runIfWaitingForDebugger',{},sid);if(m.params.targetInfo.type!=='page')return;await call('Runtime.enable',{},sid);await call('Page.enable',{},sid);sessions.set(m.params.targetInfo.targetId,sid);}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  if(m.method==='Browser.downloadWillBegin')downloads.push(m.params);
  if(m.method==='Browser.downloadProgress')downloadProgress.set(m.params.guid,m.params.state);
 }catch(e){eventFailure=e;}};
 await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
 await call('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true});
 const makePage=async url=>{const {targetId}=await call('Target.createTarget',{url:'about:blank'});const sid=await until(()=>sessions.get(targetId));await call('Page.navigate',{url},sid);return {targetId,sid};};
 const evaluate=async(sid,expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const click=async(sid,selector)=>{const pt=await evaluate(sid,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView();const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pt},sid);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pt},sid);};
 const typePort=async(sid,value)=>{await evaluate(sid,'document.getElementById("office-port").focus();document.getElementById("office-port").select()');await call('Input.insertText',{text:value},sid);};
 const screenshot=async(sid,name,width)=>{await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sid);await evaluate(sid,'window.scrollTo(0,0)');const shot=await call('Page.captureScreenshot',{format:'png'},sid);await writeFile(join(out,name),Buffer.from(shot.data,'base64'));assert(await evaluate(sid,'document.documentElement.scrollWidth <= innerWidth'));};
 const main=await makePage(fanz+'/');await until(()=>evaluate(main.sid,'!!document.getElementById("office-port") && document.getElementById("connection-status").textContent.includes("登入")'));
 await click(main.sid,'.result-entry-nav summary');assert.equal(await evaluate(main.sid,'document.getElementById("office-open").hasAttribute("href")'),false);
 await typePort(main.sid,'abc');assert.equal(await evaluate(main.sid,'document.getElementById("office-open").hasAttribute("href")'),false);
 await typePort(main.sid,String(port));assert.equal(await evaluate(main.sid,'document.getElementById("office-open").href'),office+'/#view=results');
 await screenshot(main.sid,'fanzloud-1280.png',1280);await screenshot(main.sid,'fanzloud-390.png',390);
 const before=new Set(sessions.keys());await evaluate(main.sid,'document.getElementById("office-open").focus()');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},main.sid);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},main.sid);
 const popupId=await until(()=>[...sessions.keys()].find(id=>!before.has(id)));const sid=sessions.get(popupId);
 await until(()=>evaluate(sid,'document.getElementById("message")?.textContent.includes("尚未登入")'));
 assert.equal(await evaluate(sid,'window.opener===null && document.referrer===""'),true);
 assert.equal(await evaluate(sid,'document.getElementById("office-operations").hidden'),true);
 // Native original launch URL, source tab only; this synthetic token never enters Fanzloud.
 await call('Page.navigate',{url:office+'/#token=SYNTHETIC-NAV-TOKEN'},sid);
 await until(()=>evaluate(sid,'document.querySelectorAll("#runs tr").length===3'));
 assert.equal(await evaluate(sid,'location.hash'), '');assert.equal(await evaluate(sid,'document.getElementById("office-operations").hidden'),true);
 assert.equal(await evaluate(sid,'[...document.querySelectorAll("#runs button")].some(n=>n.textContent.includes("重試"))'),false);
 const row=await evaluate(sid,'[...document.querySelectorAll("#runs tr")].find(r=>r.textContent.includes("local-work-nav")).dataset.ref');
 await click(sid,`#runs tr[data-ref="${row}"] button`);await until(()=>evaluate(sid,'document.querySelector("#detail button.download") && !document.querySelector("#detail button.download").disabled'));
 assert.equal(await evaluate(sid,'document.getElementById("detail").textContent.includes("secret-only change")'),true);
 assert.equal(await evaluate(sid,'/SYNTHSECRET_[0-9a-f]{16}/.test(document.body.textContent)'),false);
 await click(sid,'#detail button.download');await until(()=>downloads.length===1);await until(()=>downloadProgress.get(downloads[0].guid)==='completed');
 const bytes=await readFile(join(downloadPath,downloads[0].guid));assert.equal(bytes.toString(),'安全 café 😀\nSYNTHSECRET_REDACTED\n');
 const digest=createHash('sha256').update(bytes).digest('hex');assert.equal(await evaluate(sid,`document.getElementById('detail').textContent.includes(${JSON.stringify(digest)})`),true);
 await screenshot(sid,'office-1280.png',1280);await screenshot(sid,'office-390.png',390);
 await click(sid,'#readonly-refresh');await until(()=>evaluate(sid,'document.querySelectorAll("#runs tr").length===3 && document.getElementById("detail").hidden'));
 await call('Page.reload',{},sid);await until(()=>evaluate(sid,'document.querySelectorAll("#runs tr").length===3'));
 assert((await command('check')).ok);
 await command('deny');await click(sid,'#readonly-refresh');await until(()=>evaluate(sid,'document.getElementById("message").textContent.includes("無法讀取")'));
 assert.equal(await evaluate(sid,'document.querySelectorAll("#runs tr").length===0 && document.getElementById("detail").children.length===0'),true);
 await command('restore');await click(sid,'#readonly-refresh');await until(()=>evaluate(sid,'document.querySelectorAll("#runs tr").length===3'));
 await command('tamper');await click(sid,'#readonly-refresh');await until(()=>evaluate(sid,'document.querySelectorAll("#runs tr").length===3'));
 await click(sid,`#runs tr[data-ref="${row}"] button`);assert.equal(await evaluate(sid,'document.querySelectorAll("#detail button.download").length'),0);
 await click(sid,'#return-console');await until(()=>evaluate(sid,'document.getElementById("office-operations") && !document.getElementById("office-operations").hidden'));
 assert.equal(await evaluate(sid,'typeof document.getElementById("plan").onclick'), 'function');
 await call('Target.closeTarget',{targetId:popupId});
 const reopened=await makePage(office+'/#view=results');await until(()=>evaluate(reopened.sid,'document.getElementById("message")?.textContent.includes("尚未登入")'));
 await command('offline');await call('Page.navigate',{url:office+'/#token=SYNTHETIC-NAV-TOKEN'},reopened.sid);
 // Browser owns top-level offline error; the original Fanzloud tab remains untouched.
 assert.equal(await evaluate(main.sid,'location.href'),fanz+'/');
 mode='unavailable';await call('Page.reload',{},main.sid);await until(()=>evaluate(main.sid,'document.getElementById("error-message")?.textContent.includes("503")'));
 assert.equal(await evaluate(main.sid,'document.getElementById("office-port").value'), '');assert.equal(await evaluate(main.sid,'document.getElementById("office-open").hasAttribute("href")'),false);
 assert.equal(await evaluate(main.sid,'Object.keys(sessionStorage).some(k=>k.startsWith("office-"))'),false);
 const receipt=await command('finish');assert(receipt.source_unchanged);assert.equal(receipt.spawn_count,0);assert(receipt.requests.every(r=>r.method==='GET'));assert(receipt.requests.filter(r=>r.path==='/').every(r=>!r.has_referrer));
 assert(fanzRequests.every(r=>r.method==='GET'&&!r.path.includes('token')&&!r.path.includes('ref=')));assert.deepEqual(errors,[]);
 const hashes={};for(const file of ['platform/fanzloud/apps/control-plane/web/isolated.html','platform/fanzloud/apps/control-plane/web/isolated.js','platform/fanzloud/apps/control-plane/web/p0.css','labs/agent-office-lab/scripts/office_console.html','labs/agent-office-lab/scripts/office_console.js','labs/agent-office-lab/scripts/office_console.css','labs/agent-office-lab/scripts/office_console.py'])hashes[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
 await writeFile(join(out,'browser.json'),JSON.stringify({status:'passed',date:new Date().toISOString(),scope:'Shipped Fanzloud UI with synthetic session; actual Office HTTP/auth/result reader with isolated synthetic records. No live private deployment/provider/owner acceptance.',browser:await call('Browser.getVersion'),scenarios:['unset/invalid/change/reload','keyboard popup/no opener/no referrer','source-only original launch auth/reload/fresh-tab denial','failed/incomplete preserved','secret-only raw/display and native verified download','expired auth clears rows/detail','source artifact tamper suppresses download','explicit original-console return','offline original-tab preservation','Fanzloud session503'],download:{bytes:bytes.length,sha256:digest},office:receipt,fanzloud:fanzRequests,page_errors:errors,source_hashes:hashes,inspector_sha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')},null,2)+'\n');
 console.log('PASS: actual Office HTTP/browser navigation, original source auth, zero POST/spawn, source bytes/mtime unchanged; synthetic records only');
 await call('Browser.close');
}catch(error){console.error(error);throw error;}finally{
 socket?.close();if(chrome.exitCode===null)chrome.kill('SIGTERM');fixture.stdin.end();if(fixture.exitCode===null)fixture.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await Promise.all([chrome,fixture].map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(r=>child.once('exit',r))));await rm(scratch,{recursive:true,force:true,maxRetries:2,retryDelay:100});
}
