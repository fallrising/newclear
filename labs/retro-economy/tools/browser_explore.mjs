// UI-only exploration recorder. Node built-ins; never exposes CDP/eval/API to the explorer.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile, appendFile, rename} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateCommand(c) {
  assert.ok(c && typeof c === 'object' && !Array.isArray(c), 'Object required');
  const fields = {observe:[], click:['id'], type:['id','text'], select:['id','option'], scroll:['dy'], switch:['actor'], finish:[]}[c.op];
  assert.ok(fields, 'Unsupported UI operation');
  assert.deepEqual(Object.keys(c).sort(), ['op',...fields].sort(), 'Unexpected fields');
  const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
  if ('id' in c) assert.ok(integer(c.id,0,999),'Invalid visible control id');
  if ('text' in c) assert.ok(typeof c.text==='string' && c.text.length<=100 && !/[\x00-\x1f]/.test(c.text),'Invalid input text');
  if ('option' in c) assert.ok(integer(c.option,0,99),'Invalid option');
  if ('actor' in c) assert.ok(integer(c.actor,0,1),'Invalid actor');
  if ('dy' in c) assert.ok(integer(c.dy,-1000,1000),'Invalid scroll');
  return c;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class CDP {
  constructor(ws) {
    this.ws=ws; this.seq=0; this.pending=new Map();
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=this.pending.get(m.id);if(!p)return;
      this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);});
  }
  send(method,params={},sessionId) {
    return new Promise((resolve,reject)=>{const id=++this.seq;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout '+method));},10000);
      this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  }
  async evaluate(session,expression) {
    const r=await this.send('Runtime.evaluate',{expression,returnByValue:true},session);
    if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;
  }
}
async function stop(child) {
  if(!child || child.exitCode!==null || child.signalCode!==null)return;
  const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
  try{await ended;}finally{clearTimeout(timer);}
}
export async function run() {
  assert.ok(process.env.AGENT_BUILD_DIR && process.env.AGENT_EVIDENCE_DIR,'Use workspace launcher');
  const build=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'explore-'));
  const evidence=await mkdtemp(join(process.env.AGENT_EVIDENCE_DIR,'explore-'));
  const control=join(build,'control');await mkdir(control);
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  let server,browser,cdp,actor=0,steps=0;const logs={server:'',browser:''},sessions=[];
  const started=Date.now();let lastId=null;
  const atomic=async(path,data)=>{await writeFile(path+'.tmp',JSON.stringify(data,null,2));await rename(path+'.tmp',path);};
  const shutdown=()=>{process.exitCode=1;};
  // Signals leave cleanup to finally; a bounded loop checks the flag.
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
  try {
    server=spawn(process.env.PYTHON||'python3',[join(root,'server.py'),'--port','0','--db',join(build,'game.sqlite3')],{stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',b=>logs.server+=b);server.stderr.on('data',b=>logs.server+=b);server.on('error',e=>logs.server+=e);
    let base;
    for(let i=0;i<200;i++){base=logs.server.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(base)break;if(server.exitCode!==null)break;await pause(50);}
    assert.ok(base,'Server startup failed: '+logs.server);
    browser=spawn(process.env.CHROME||'google-chrome',['--headless','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0','--user-data-dir='+join(build,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,...(process.env.CHROME_LIBRARY_PATH?{LD_LIBRARY_PATH:process.env.CHROME_LIBRARY_PATH}:{})}});
    browser.stderr.on('data',b=>logs.browser+=b);browser.on('error',e=>logs.browser+=e);
    let address;
    for(let i=0;i<1200;i++){address=logs.browser.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];if(address)break;if(browser.exitCode!==null)break;await pause(50);}
    assert.ok(address,'Chromium startup failed: '+logs.browser);
    const ws=new WebSocket(address);await once(ws,'open');cdp=new CDP(ws);
    for(let i=0;i<2;i++) {
      const {browserContextId}=await cdp.send('Target.createBrowserContext');
      const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',browserContextId});
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});sessions.push(sessionId);
      await cdp.send('Page.enable',{},sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
      await cdp.send('Page.navigate',{url:base},sessionId);
    }
    await pause(500);
    const observe=async()=>{
      const session=sessions[actor];await cdp.send('Page.bringToFront',{},session);await pause(150);
      const visible=await cdp.evaluate(session,`(() => {
        const visible=e=>!!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
        const els=Array.from(document.querySelectorAll('button,input,select')).filter(visible);
        window.__explorerControls=els;
        return {text:document.body.innerText, controls:els.map((e,id)=>({id,tag:e.tagName.toLowerCase(),type:e.type,disabled:e.disabled,label:e.labels?.[0]?.innerText||e.getAttribute('aria-label')||e.innerText,value:e.value, ...(e.tagName==='SELECT'?{options:Array.from(e.options).map(o=>o.text)}:{})}))};
      })()`);
      const {cssContentSize:size}=await cdp.send('Page.getLayoutMetrics',{},session);
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}},session);
      const screenshot=join(evidence,`step-${String(steps).padStart(3,'0')}-actor-${actor}.png`);
      await writeFile(screenshot,Buffer.from(shot.data,'base64'));
      return {actor,steps,elapsed_ms:Date.now()-started,...visible,screenshot};
    };
    await atomic(join(control,'ready.json'),{control,evidence,initial:await observe()});
    console.log(JSON.stringify({control,evidence}));
    while(Date.now()-started<20*60*1000 && steps<200 && !process.exitCode) {
      let request;try{request=JSON.parse(await readFile(join(control,'request.json'),'utf8'));}catch{await pause(100);continue;}
      if(typeof request.id!=='string'||request.id===lastId){await pause(100);continue;}lastId=request.id;
      let result;
      try {
        const c=validateCommand(request.command);steps++;
        if(c.op==='finish'){result={finished:true,steps,elapsed_ms:Date.now()-started};await atomic(join(control,'response.json'),{id:lastId,...result});await appendFile(join(evidence,'actions.jsonl'),JSON.stringify({command:c,...result})+'\n');break;}
        if(c.op==='switch')actor=c.actor;
        const session=sessions[actor];await cdp.send('Page.bringToFront',{},session);
        if(c.op==='scroll')await cdp.evaluate(session,`window.scrollBy(0,${c.dy})`);
        if(['click','type','select'].includes(c.op)) {
          const target=await cdp.evaluate(session,`(() => {const e=window.__explorerControls?.[${c.id}];if(!e||!e.getClientRects().length||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type,options:e.options?.length,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
          assert.ok(target,'Control unavailable; observe again');
          assert.ok(c.op!=='type'||target.tag==='INPUT'&&['text','number'].includes(target.type),'Not a text/number input');
          assert.ok(c.op!=='select'||target.tag==='SELECT'&&c.option<target.options,'Not an offered option');
          await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1},session);
          await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1},session);
          if(c.op==='type') {
            await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65},session);
            await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65},session);
            await cdp.send('Input.insertText',{text:c.text},session);
          }
          if(c.op==='select')await cdp.evaluate(session,`(() => {const e=window.__explorerControls[${c.id}];e.selectedIndex=${c.option};e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();})()`);
          await pause(200);
        }
        result={ok:true,...await observe()};
      }catch(e){result={ok:false,error:String(e),steps,elapsed_ms:Date.now()-started};}
      await appendFile(join(evidence,'actions.jsonl'),JSON.stringify({id:lastId,command:request.command,result})+'\n');
      await atomic(join(control,'response.json'),{id:lastId,...result});
    }
    await atomic(join(evidence,'summary.json'),{steps,elapsed_ms:Date.now()-started,budget_exhausted:steps>=200||Date.now()-started>=20*60*1000,kind:'automated UI exploration; not human playtest'});
  } finally {
    cdp?.ws.close();await stop(browser);await stop(server);
    await writeFile(join(evidence,'server.log'),logs.server);await writeFile(join(evidence,'browser.log'),logs.browser);
    process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await run();
