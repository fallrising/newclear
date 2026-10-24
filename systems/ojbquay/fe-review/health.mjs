import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
export const knownCompatibility='Warning: [antd: compatible] antd v5 support React is 16 ~ 18. see https://u.ant.design/v5-for-19 for compatible.';
export const knownModal='Warning: [antd: Modal] `destroyOnClose` is deprecated. Please use `destroyOnHidden` instead.';
export const localOrigin='http://127.0.0.1:5173';
export function fontURL(value) {
  try {const url=new URL(value);return (url.origin==='https://fonts.googleapis.com'&&url.pathname==='/css2')||(url.origin==='https://fonts.gstatic.com'&&url.pathname.startsWith('/s/'));}catch{return false;}
}
export function expectedRequest(value, status, phase) {
  if(fontURL(value))return 'existing-google-font';
  const url=new URL(value);
  if(url.origin!==localOrigin)return null;
  if(status===401&&url.pathname==='/api/v1/auth/me'&&['login','bad-password'].includes(phase))return 'anonymous-session';
  if(status===401&&url.pathname==='/api/v1/auth/login'&&phase==='bad-password')return 'real-bad-password';
  if(status===404&&url.pathname==='/api/v1/delay/missing-review-id'&&phase==='missing-delay')return 'real-missing-delay';
  if(status===500&&url.pathname==='/api/v1/topics'&&phase==='error-supplement')return 'controlled-500';
  return null;
}
export function observeHealth(page, getPhase) {
  const events=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.origin!==localOrigin)events.push({kind:'external',url:request.url(),phase:getPhase()});});
  page.on('pageerror',()=>events.push({kind:'pageerror',phase:getPhase()}));
  page.on('requestfailed',request=>events.push({kind:'requestfailed',url:request.url(),phase:getPhase()}));
  page.on('response',response=>{if(response.status()>=400)events.push({kind:'http',url:response.url(),status:response.status(),phase:getPhase()});});
  page.on('console',message=>{if(['error','warning'].includes(message.type())){const event={kind:'console',level:message.type(),text:message.text(),url:message.location().url,phase:getPhase()};events.push(event);appendFileSync('/state/console.jsonl',JSON.stringify(event)+'\n',{mode:0o600});}});
  return ()=>classify(events);
}
export function classify(events) {
  return events.map(event=>{
    let classification=null;
    if(['external','requestfailed','http'].includes(event.kind))classification=expectedRequest(event.url,event.status,event.phase);
    if(event.kind==='console'&&event.text===knownCompatibility)classification='existing-antd-react-compatibility-warning';
    if(event.kind==='console'&&event.text===knownModal)classification='existing-antd-modal-deprecation-warning';
    if(event.kind==='console'&&/^Failed to load resource:/.test(event.text)) {
      classification=fontURL(event.url)?'existing-google-font':null;
      if(!classification) {const related=events.find(e=>e.kind==='http'&&e.url===event.url&&e.phase===event.phase&&expectedRequest(e.url,e.status,e.phase));if(related)classification=expectedRequest(related.url,related.status,related.phase);}
    }
    const url=event.url?new URL(event.url):null;
    return {kind:event.kind,phase:event.phase,...(event.level?{consoleMethod:event.level}:{}),...(url?{origin:url.origin,path:url.pathname}:{}),...(event.status?{status:event.status}:{}),...(event.text?{messageSha256:createHash('sha256').update(event.text).digest('hex')}:{}),classification:classification??'unexpected'};
  });
}
export function sharedHealth(record) {
  const phase=record.page==='login'?'login':'normal';
  const failures=record.failedRequests.map(text=>{const match=text.match(/^\S+ (\S+)(?: HTTP (\d+))?/);return match?{url:match[1],status:match[2]?Number(match[2]):undefined}:null;});
  const expected=failures.every(item=>item&&expectedRequest(item.url,item.status,phase));
  // Shared capture lacks console source locations. Only standard resource-error
  // lines paired one-for-one with classified failing requests may be accepted.
  const preload="[warning] Couldn't load preload assets:  ProgressEvent";
  const correlatedFontFailure=failures.some(item=>item&&fontURL(item.url));
  const preloadIncomplete=correlatedFontFailure&&record.consoleErrors.includes(preload);
  const resourceConsole=record.consoleErrors.filter(text=>text!=='[error] '+knownCompatibility&&text!=='[warning] '+knownCompatibility&&text!=='[error] '+knownModal&&text!=='[warning] '+knownModal&&!(preloadIncomplete&&text===preload));
  const consoleExpected=resourceConsole.length<=failures.length&&resourceConsole.every(text=>/^\[error\] Failed to load resource:/.test(text));
  return {passed:expected&&consoleExpected&&record.pageErrors.length===0,axePreloadIncomplete:preloadIncomplete,classifiedFailures:failures.map(item=>item?expectedRequest(item.url,item.status,phase)??'unexpected':'unparsed'),consoleCount:record.consoleErrors.length};
}
