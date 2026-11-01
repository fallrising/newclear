const routes=new Map([
 ['/','catalog'],['/login','login'],['/nodes/vps-fe-1','node'],['/nodes/vps-empty','empty-node'],['/services/hello','service'],['/services/empty','empty-service'],['/static/app.css','stylesheet'],['/static/htmx.min.js','htmx'],['/favicon.ico','favicon'],
 ['/api/v1/services/hello/stop','stop'],['/api/v1/services/hello/start','start'],['/api/v1/services/hello/redeploy','redeploy'],['/api/v1/services/hello/deploy','rollback'],['/api/v1/services/missing-review/stop','controlled-missing-stop']
]);
export function routeCategory(value,base) {
 if(typeof value!=='string'||!value)return 'unknown';
 try {const url=new URL(value);if(url.origin!==base)return 'external';if(url.search||url.hash)return 'other';return routes.get(url.pathname)||'other';}catch{return 'unknown';}
}
export function consoleObservation(type,message,location,base) {
 const category=routeCategory(location,base);
 const code=message==='Response Status Error Code 404 from /api/v1/services/missing-review/stop'?'controlled-api-404':/^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/.test(message)?'resource-404':'unclassified';
 return {kind:'console',type:['error','warning'].includes(type)?type:'other',category,code};
}
export function healthCollector(base) {
 const result={events:[],overflow:0};
 const add=event=>{const same=result.events.find(e=>Object.keys(event).every(k=>e[k]===event[k]));if(same){same.count++;return;}if(result.events.length>=100){result.overflow++;return;}result.events.push({...event,count:1});};
 return {result,attach(page){
  page.on('console',m=>{if(['error','warning'].includes(m.type()))add(consoleObservation(m.type(),m.text(),m.location().url,base));});
  page.on('response',r=>{if(r.status()>=400)add({kind:'response',category:routeCategory(r.url(),base),method:['GET','POST'].includes(r.request().method())?r.request().method():'other',status:r.status()});});
  page.on('requestfailed',r=>add({kind:'requestfailed',category:routeCategory(r.url(),base),method:['GET','POST'].includes(r.method())?r.method():'other',code:r.failure()?.errorText==='net::ERR_ABORTED'?'aborted':r.failure()?.errorText==='net::ERR_INTERNET_DISCONNECTED'?'disconnected':'unclassified'}));
 }};
}
