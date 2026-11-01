import { observed, unwrap } from './pending.mjs';
import { tabTo } from './flow.mjs';
const base='http://127.0.0.1:18765';
export async function focusDiagnostic({page,result,api,operator}) {
 result.diagnosticOnly=true;result.timeline=[];
 await page.goto(base+'/');await page.locator('#act-hello-toggle').waitFor();
 await page.evaluate(()=>{
  const start=performance.now();window.reviewTimeline=[];
  window.reviewObserve=phase=>{
   const active=document.activeElement;const toggle=document.querySelector('#act-hello-toggle');
   const category=active?.id==='act-hello-toggle'?'toggle':active?.tagName==='BODY'?'body':active?.id==='act-hello-redeploy'?'redeploy':'other';
   window.reviewTimeline.push({phase,elapsedMs:Math.round(performance.now()-start),active:category,rowPresent:!!document.querySelector('#row-hello'),togglePresent:!!toggle,disabled:toggle?.disabled??null,action:toggle?.textContent.trim()==='Start'?'start':toggle?.textContent.trim()==='Stop'?'stop':'missing'});
  };
  for(const name of ['htmx:beforeRequest','htmx:beforeSend','htmx:afterRequest','htmx:beforeSwap','htmx:afterSwap','htmx:afterSettle'])document.addEventListener(name,event=>{if(event.detail?.elt?.id==='act-hello-toggle'||event.detail?.target?.id==='row-hello'||event.detail?.target?.id==='catalog'||event.target?.id==='row-hello'||event.target?.id==='catalog')window.reviewObserve(name);});
 });
 result.diagnosticTabCount=await tabTo(page,page.locator('#act-hello-toggle'));
 await page.evaluate(()=>window.reviewObserve('before-enter'));
 const responsePending=observed(page.waitForResponse(r=>r.url()===base+'/api/v1/services/hello/stop'&&r.request().method()==='POST',{timeout:10000}));
 await page.keyboard.press('Enter');const response=await unwrap(responsePending);
 result.diagnosticStopStatus=response.status();
 for(const [phase,ms] of [['response',0],['after-100ms',100],['after-1000ms',900],['after-poll',15000]]) {if(ms)await new Promise(resolve=>setTimeout(resolve,ms));await page.evaluate(phase=>window.reviewObserve(phase),phase);}
 result.timeline=await page.evaluate(()=>window.reviewTimeline);
 result.diagnosticDesired=(await api('GET','/api/v1/services/hello',operator)).desired_state==='stopped';
 result.diagnosticFocusPreserved=await page.locator('#act-hello-toggle').evaluate(e=>e===document.activeElement);
 if(!result.diagnosticFocusPreserved)throw new Error('REVIEW_STOP_FOCUS');
}
