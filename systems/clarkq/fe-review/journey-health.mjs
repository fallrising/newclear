import {ORIGIN,allowedURL} from './guards.mjs';
export const invalidQueuePath='/api/v1/queue/review.invalid';
export function journeyURL(url){return allowedURL(url)||url===ORIGIN+invalidQueuePath;}
export function classifyJourneyHealth({responses,failures,consoles,controlled,blocked,pageErrors}) {
  const expectedHTTP=r=>(r.status===401 && ['missing-key','invalid-key'].includes(r.stage) && ['/api/v1/queues','/api/v1/metrics','/api/v1/cluster'].some(path=>r.url===ORIGIN+path) && r.method==='GET') || (r.status===400 && r.stage==='illegal-name' && r.url===ORIGIN+invalidQueuePath && r.method==='POST');
  const expectedFailure=r=>controlled.has(r.request) && r.stage==='controlled-network-failure' && r.url===ORIGIN+'/api/v1/metrics' && r.method==='GET' && r.code==='net::ERR_FAILED';
  const expectedConsole=c=>{
    if(c.type!=='error')return false;
    const status=c.text.match(/^Failed to load resource: the server responded with a status of (\d{3}) \([^\n]*\)$/);
    if(status)return responses.some(r=>expectedHTTP(r)&&r.status===Number(status[1])&&r.url===c.url&&r.stage===c.stage);
    return c.text==='Failed to load resource: net::ERR_FAILED'&&failures.some(r=>expectedFailure(r)&&r.url===c.url&&r.stage===c.stage);
  };
  return {http:responses.map(r=>({path:journeyURL(r.url)?new URL(r.url).pathname:'<rejected>',status:r.status,method:r.method,stage:r.stage,expected:expectedHTTP(r)})),requestFailures:failures.map(r=>({path:journeyURL(r.url)?new URL(r.url).pathname:'<rejected>',method:r.method,stage:r.stage,code:/^net::ERR_[A-Z_]+$/.test(r.code??'')?r.code:'UNKNOWN',expected:expectedFailure(r)})),console:consoles.map(c=>({type:c.type,stage:c.stage,expected:expectedConsole(c)})),blocked:blocked.length,pageErrors:pageErrors.length};
}
export function healthPassed(health){return health.blocked===0&&health.pageErrors===0&&[...health.http,...health.requestFailures,...health.console].every(row=>row.expected);}
