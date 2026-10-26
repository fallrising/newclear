import assert from 'node:assert/strict';
import {ORIGIN,UPSTREAM} from './guards.mjs';

export function requireID(value){assert(typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),'REVIEW_FIXTURE_ID');return value;}
export function adminPath(path){return /^\/admin\/api\/(connections|routes|keys|usage)(?:\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})?$/.test(path);}
export async function authenticate(context,admin,secrets,check) {
  check();const page=await context.newPage();page.setDefaultTimeout(10000);
  const response=await page.goto(ORIGIN+'/admin/login',{waitUntil:'networkidle',timeout:15000});
  assert(response.status()===200&&page.url()===ORIGIN+'/admin/login','REVIEW_LOGIN_PAGE');
  await page.locator('input[name="token"]').fill(admin);
  await Promise.all([page.waitForURL(ORIGIN+'/admin'),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
  const cookies=await context.cookies(ORIGIN);const session=cookies.find(cookie=>cookie.name==='tr_admin');
  assert(session&&session.httpOnly&&session.sameSite==='Strict'&&session.value!==admin,'REVIEW_SESSION_FLAGS');
  secrets.push(session.value);
  const csrf=await page.locator('input[name="csrf"]').first().inputValue();
  assert(typeof csrf==='string'&&csrf.length>=32,'REVIEW_CSRF_MISSING');secrets.push(csrf);
  await page.close();
  return {csrf,sessionFlags:{httpOnly:session.httpOnly,sameSite:session.sameSite,secure:session.secure,loopbackHTTP:true}};
}
export async function adminAPI(context,csrf,method,path,body,status,check) {
  check();assert(adminPath(path),'REVIEW_ADMIN_PATH');
  const response=await context.request.fetch(ORIGIN+path,{method,maxRedirects:0,timeout:5000,headers:{Origin:ORIGIN,...(method==='GET'?{}:{'x-csrf-token':csrf})},...(body===undefined?{}:{data:body})});
  assert(response.status()===status,'REVIEW_ADMIN_STATUS');return response.json();
}
export async function seed(context,csrf,upstreamKey,secrets,result,check) {
  const request=(method,path,body,status)=>adminAPI(context,csrf,method,path,body,status,check);
  const connections=[];
  for(let i=0;i<10;i++) {
    const name=i===0?'review-short':i===1?'合成連線_'+ '長中文'.repeat(18):'review-connection-'+String(i).padStart(2,'0');
    const base=i===1?UPSTREAM+'/synthetic/'+'中文長路徑'.repeat(16)+'/v1':UPSTREAM+'/v1';
    const row=await request('POST','/admin/api/connections',{name,base_url:base,api_key:upstreamKey,default_model:'review-model',priority:100+i,enabled:i!==1,input_price_per_m:0,output_price_per_m:0},201);
    requireID(row.id);assert(row.name===name&&row.api_key_masked!==upstreamKey&&!JSON.stringify(row).includes(upstreamKey),'REVIEW_CONNECTION_SECRET');connections.push({id:row.id,name,enabled:row.enabled});
  }
  const routes=[];
  for(let i=0;i<10;i++) {
    const model=i===0?'review-success':i===1?'review-failure':i===2?'合成模型_'+ '長中文'.repeat(18):'review-route-'+String(i).padStart(2,'0');
    const targets=i===2?[0,2,3,4,5].map(index=>({connection_id:connections[index].id,model_override:'review-model'})):[{connection_id:connections[0].id,model_override:i===1?'review-error':'review-model'}];
    const route=await request('POST','/admin/api/routes',{public_model:model,strategy:'fallback',targets},201);
    requireID(route.id);assert(route.public_model===model,'REVIEW_ROUTE_IDENTITY');routes.push({id:route.id,model,targets:targets.length});
  }
  const created=await request('POST','/admin/api/keys',{name:'review-gateway'},201);
  assert(typeof created.secret==='string'&&created.secret.length>=24,'REVIEW_GATEWAY_SECRET');requireID(created.key.id);secrets.push(created.secret);
  // API response remains in memory; the browser never enters the one-time secret page.
  const keys=await request('GET','/admin/api/keys',undefined,200);
  assert(keys.data.length===1&&!JSON.stringify(keys).includes(created.secret),'REVIEW_KEY_LIST_SECRET');
  for(const [model,status] of [['review-success',200],['review-failure',500]]) {
    check();const r=await context.request.post(ORIGIN+'/v1/chat/completions',{timeout:10000,maxRedirects:0,headers:{Authorization:'Bearer '+created.secret},data:{model,messages:[{role:'user',content:'Synthetic review only'}],stream:false}});
    assert(r.status()===status,'REVIEW_SYNTHETIC_UPSTREAM_STATUS');
    const data=await r.json();if(status===200)assert(data.choices?.[0]?.message?.content==='合成回覆','REVIEW_SYNTHETIC_CONTENT');
  }
  const actualConnections=await request('GET','/admin/api/connections',undefined,200);
  const actualRoutes=await request('GET','/admin/api/routes',undefined,200);
  const usage=await request('GET','/admin/api/usage',undefined,200);
  assert(actualConnections.data.length===10&&actualRoutes.data.length===10,'REVIEW_SEED_COUNT');
  assert(usage.data.length===2&&usage.data.some(row=>row.status===200)&&usage.data.some(row=>row.status===500),'REVIEW_USAGE_READBACK');
  result.fixture={connections,routes,keyCount:1,keyListPrefixOnly:true,usageStatuses:usage.data.map(row=>row.status).sort(),syntheticOnly:true,seedVia:'real session cookie + CSRF admin API',providerCLI:false};
  return {connectionID:connections[1].id,routeID:routes[2].id};
}
