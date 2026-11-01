import assert from 'node:assert/strict';
import {ORIGIN,allowedURL} from './guards.mjs';

export function safePath(value){return allowedURL(value)?new URL(value).pathname:'<rejected>';}
export function credentialFlags(headers={}) {
  const names=Object.keys(headers).map(name=>name.toLowerCase());
  return {apiKey:names.includes('x-api-key'),cookie:names.includes('cookie'),authorization:names.includes('authorization'),adminToken:names.includes('x-admin-token'),csrf:names.includes('x-csrf-token')};
}
export function expectedFavicon(request) {
  return request.path==='/favicon.ico'&&request.exactURL===true&&request.method==='GET'&&request.initiator==='other'&&request.status===404&&request.extraHeadersSeen===true&&
    request.headers.apiKey===false&&request.headers.cookie===false&&request.headers.authorization===false&&request.headers.adminToken===false&&request.headers.csrf===false&&
    request.extraHeaders.apiKey===false&&request.extraHeaders.cookie===false&&request.extraHeaders.authorization===false&&request.extraHeaders.adminToken===false&&request.extraHeaders.csrf===false&&!request.failed;
}
export function classifyProbe(probe) {
  const favicon=probe.requests.filter(expectedFavicon);
  const expectedConsole=entry=>entry.type==='error'&&entry.path==='/favicon.ico'&&entry.code==='HTTP_404'&&favicon.length===1;
  const expectedNetwork=entry=>entry.source==='network'&&entry.level==='error'&&entry.path==='/favicon.ico'&&entry.code==='HTTP_404'&&favicon.some(request=>request.id===entry.request);
  const unknownRequests=probe.requests.filter(request=>request.path==='<rejected>'||request.failed||request.status==null||(request.status>=400&&!expectedFavicon(request)));
  return {favicon404:favicon.length,consoleEvents:probe.console.length,networkLogEvents:probe.networkLog.length,
    unknownRequests:unknownRequests.length,unknownConsole:probe.console.filter(entry=>!expectedConsole(entry)).length,
    unknownNetworkLogs:probe.networkLog.filter(entry=>!expectedNetwork(entry)).length,pageErrors:probe.pageErrors,
    classification:favicon.length===1?'existing-browser-favicon-404':'unresolved',
    passed:favicon.length===1&&probe.console.length===1&&unknownRequests.length===0&&probe.console.every(expectedConsole)&&probe.networkLog.every(expectedNetwork)&&probe.pageErrors===0};
}
function errorCode(text){const match=String(text).match(/(?:status of |status code: )(\d{3})/);return match?'HTTP_'+match[1]:'UNKNOWN';}
export async function desktopHealth(browser,result,check) {
  check();const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',locale:'zh-TW'});
  const probe={conditions:'fresh context; no route interception, matching original shared capture',requests:[],console:[],networkLog:[],pageErrors:0};
  result.desktopHealth=probe;
  const requests=new Map();
  const request=id=>{if(!requests.has(id)){const value={id:'request-'+(requests.size+1),path:'<rejected>',exactURL:false,method:'UNKNOWN',initiator:'unknown',status:null,headers:{apiKey:false,cookie:false,authorization:false,adminToken:false,csrf:false},extraHeadersSeen:false,extraHeaders:{apiKey:false,cookie:false,authorization:false,adminToken:false,csrf:false},failed:false};requests.set(id,value);probe.requests.push(value);}return requests.get(id);};
  try {
    const page=await context.newPage();const cdp=await context.newCDPSession(page);
    cdp.on('Network.requestWillBeSent',event=>Object.assign(request(event.requestId),{path:safePath(event.request.url),exactURL:event.request.url===ORIGIN+'/favicon.ico',method:['GET','POST','DELETE'].includes(event.request.method)?event.request.method:'UNKNOWN',initiator:['parser','script','other','preflight'].includes(event.initiator?.type)?event.initiator.type:'unknown',headers:credentialFlags(event.request.headers)}));
    cdp.on('Network.requestWillBeSentExtraInfo',event=>Object.assign(request(event.requestId),{extraHeadersSeen:true,extraHeaders:credentialFlags(event.headers)}));
    cdp.on('Network.responseReceived',event=>{const item=request(event.requestId);item.status=event.response.status;item.responsePath=safePath(event.response.url);if(item.path!==item.responsePath)item.path='<rejected>';});
    cdp.on('Network.loadingFailed',event=>{request(event.requestId).failed=true;});
    cdp.on('Log.entryAdded',({entry})=>{if(['error','warning'].includes(entry.level))probe.networkLog.push({source:['network','javascript'].includes(entry.source)?entry.source:'unknown',level:entry.level,path:safePath(entry.url??''),code:errorCode(entry.text),request:entry.networkRequestId?request(entry.networkRequestId).id:null});});
    await cdp.send('Network.enable');await cdp.send('Log.enable');
    page.on('console',message=>{if(['error','warning'].includes(message.type()))probe.console.push({type:message.type(),path:safePath(message.location().url),code:errorCode(message.text())});});
    page.on('pageerror',()=>{probe.pageErrors++;});
    const response=await page.goto(ORIGIN+'/admin/login',{waitUntil:'networkidle',timeout:15000});
    assert(response.status()===200&&page.url()===ORIGIN+'/admin/login','REVIEW_DIAGNOSTIC_IDENTITY');
    await page.waitForSelector('form[action="/admin/login"] input[name="token"]',{timeout:10000});
    await page.waitForTimeout(500);
    probe.finalPath='/admin/login';probe.anonymous=(await context.cookies()).length===0;assert(probe.anonymous,'REVIEW_ANONYMOUS_PROBE');
    probe.classification=classifyProbe(probe);
  } finally {await context.close();}
}
