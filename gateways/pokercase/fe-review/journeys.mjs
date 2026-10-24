import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ORIGIN,UPSTREAM,allowedURL} from './guards.mjs';
import {adminAPI,requireID} from './fixture.mjs';
import {submitNavigation} from './navigation.mjs';

export function journeyURL(value){
  if(allowedURL(value))return true;
  try{const u=new URL(value);return u.origin===ORIGIN&&!u.username&&!u.password&&!u.hash&&!u.search&&/^\/admin\/keys\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/delete$/.test(u.pathname);}catch{return false;}
}
export async function journeys(browser,admin,upstreamKey,secrets,output,result,check,stage){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',locale:'zh-TW',serviceWorkers:'block'});
  const health={blocked:0,pageErrors:0,http:[],failed:[],console:[]};
  const steps=[];result.journey={steps,health};let current='login',csrf;const expectedHTTP=[];
  try{
    await context.route('**/*',route=>{if(!journeyURL(route.request().url())){health.blocked++;return route.abort('blockedbyclient');}return route.continue();});
    await context.routeWebSocket('**/*',socket=>{health.blocked++;socket.close();});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const safePath=url=>journeyURL(url)?new URL(url).pathname:'<rejected>';
    page.on('pageerror',()=>health.pageErrors++);
    page.on('response',response=>{if(response.status()>=400)health.http.push({step:current,path:safePath(response.url()),method:response.request().method(),status:response.status()});});
    page.on('requestfailed',request=>health.failed.push({step:current,path:safePath(request.url()),method:request.method(),code:request.failure()?.errorText==='net::ERR_ABORTED'?'ERR_ABORTED':'OTHER'}));
    page.on('console',message=>{if(['error','warning'].includes(message.type())){const match=message.text().match(/(?:status of |status code: )(\d{3})/);health.console.push({step:current,type:message.type(),path:safePath(message.location().url),code:match?'HTTP_'+match[1]:'UNKNOWN'});}});
    const go=async path=>{check();const r=await page.goto(ORIGIN+path,{waitUntil:'networkidle'});assert(r.status()===200&&page.url()===ORIGIN+path,'REVIEW_JOURNEY_PAGE');};
    async function focus(locator){
      assert(await locator.count()===1,'REVIEW_KEYBOARD_TARGET');
      let tabs=0;while(!(await locator.evaluate(el=>el===document.activeElement))&&tabs<200){check();await page.keyboard.press('Tab');tabs++;}
      const visible=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return el===document.activeElement&&el.matches(':focus-visible')&&parseFloat(s.outlineWidth)>=2&&s.outlineStyle!=='none'&&r.left>=-1&&r.right<=document.documentElement.clientWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;});
      assert(visible,'REVIEW_KEYBOARD_VISIBLE_FOCUS');return tabs;
    }
    async function submit(button,path,status=303,finalPath=null){
      const tabs=await focus(button);
      const target=finalPath??(status===303?(path==='/admin/logout'?'/admin/login':'/admin/'+path.split('/')[2]):path);
      const settlement=await submitNavigation(page,{requestURL:ORIGIN+path,status,finalURL:ORIGIN+target},()=>page.keyboard.press('Enter'));
      (result.journey.settlements??=[]).push({step:current,tabs,...settlement});return tabs;
    }

    async function record(id,details={}){
      check();assert(await page.evaluate(values=>values.every(secret=>!document.body.innerText.includes(secret)),secrets),'REVIEW_JOURNEY_SCREENSHOT_SECRET');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'REVIEW_JOURNEY_OVERFLOW');
      const file='journey-'+id+'.png';await page.screenshot({path:join(output,file),fullPage:true});const bytes=await readFile(join(output,file));
      steps.push({id,...details,screenshot:{file,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}});
    }
    const begin=value=>{current=value;stage('journey-'+value);};
    begin('invalid-login');await go('/admin/login');await page.locator('[name=token]').fill('synthetic-invalid-token');
    await submit(page.getByRole('button',{name:'Sign in',exact:true}),'/admin/login',303,'/admin/login?error=invalid');
    assert(page.url()===ORIGIN+'/admin/login?error=invalid'&&await page.getByText('Invalid token.',{exact:true}).isVisible(),'REVIEW_LOGIN_ERROR');
    assert(!(await context.cookies()).some(cookie=>cookie.name==='tr_admin'),'REVIEW_INVALID_LOGIN_SESSION');await record('invalid-login');
    begin('keyboard-login');await page.locator('[name=token]').fill(admin);await submit(page.getByRole('button',{name:'Sign in',exact:true}),'/admin/login',303,'/admin');
    assert(page.url()===ORIGIN+'/admin','REVIEW_LOGIN_REDIRECT');const session=(await context.cookies()).find(cookie=>cookie.name==='tr_admin');assert(session?.httpOnly&&session.sameSite==='Strict'&&session.value!==admin,'REVIEW_LOGIN_COOKIE');secrets.push(session.value);
    csrf=await page.locator('[name=csrf]').first().inputValue();assert(csrf.length>=32,'REVIEW_JOURNEY_CSRF');secrets.push(csrf);await record('keyboard-login',{httpOnly:true,sameSite:'Strict'});
    begin('required-field');await go('/admin/connections');const connectionForm=page.locator('form[action="/admin/connections/new"]');await focus(connectionForm.getByRole('button',{name:'Create',exact:true}));await page.keyboard.press('Enter');
    assert(await connectionForm.locator('[name=name]').evaluate(el=>!el.validity.valid&&el===document.activeElement),'REVIEW_REQUIRED_FIELD');await record('required-field');
    begin('connection-create');await connectionForm.locator('[name=name]').fill('journey-connection');await connectionForm.locator('[name=base_url]').fill(UPSTREAM+'/v1');await connectionForm.locator('[name=api_key]').fill(upstreamKey);await connectionForm.locator('[name=default_model]').fill('review-model');
    await submit(connectionForm.getByRole('button',{name:'Create',exact:true}),'/admin/connections/new');
    let rows=(await adminAPI(context,csrf,'GET','/admin/api/connections',undefined,200,check)).data;let conn=rows.find(row=>row.name==='journey-connection');requireID(conn?.id);assert(rows.length===11,'REVIEW_CONNECTION_CREATE_COUNT');
    const row=page.locator('tbody tr').filter({has:page.getByText('journey-connection',{exact:true})});const edit=row.getByRole('link',{name:'Edit',exact:true});const scroll=page.getByRole('region',{name:'Connections table',exact:true});
    await scroll.evaluate(el=>{el.scrollLeft=0;});const offscreen=await edit.evaluate(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth);
    const editTabs=await focus(edit);assert(await scroll.evaluate(el=>el.scrollLeft>0),'REVIEW_LOCAL_ACTION_SCROLL');await record('offscreen-actions-keyboard',{originallyOffscreen:offscreen,tabs:editTabs,localScroll:true});await page.keyboard.press('Enter');await page.waitForURL(ORIGIN+'/admin/connections/'+conn.id+'/edit');
    begin('connection-edit');const update=page.locator('form[action$="/update"]');await update.locator('[name=name]').fill('journey-edited');await submit(update.getByRole('button',{name:'Save',exact:true}),'/admin/connections/'+conn.id+'/update');
    rows=(await adminAPI(context,csrf,'GET','/admin/api/connections',undefined,200,check)).data;assert(rows.find(item=>item.id===conn.id)?.name==='journey-edited','REVIEW_CONNECTION_UPDATE');await record('connection-edit');
    begin('invalid-route');await go('/admin/routes');let routeForm=page.locator('form[action="/admin/routes/new"]');await routeForm.locator('[name=public_model]').fill('journey-route');expectedHTTP.push({step:current,path:'/admin/routes/new',method:'POST',status:400});await submit(routeForm.getByRole('button',{name:'Create',exact:true}),'/admin/routes/new',400);
    assert((await page.locator('body').innerText()).includes('at least one target required'),'REVIEW_ROUTE_ERROR');await record('invalid-route',{expectedStatus:400});
    begin('route-create');await go('/admin/routes');routeForm=page.locator('form[action="/admin/routes/new"]');await routeForm.locator('[name=public_model]').fill('journey-route');await routeForm.locator('[name=t0_conn]').selectOption(conn.id);await submit(routeForm.getByRole('button',{name:'Create',exact:true}),'/admin/routes/new');
    let routes=(await adminAPI(context,csrf,'GET','/admin/api/routes',undefined,200,check)).data;const route=routes.find(item=>item.public_model==='journey-route');requireID(route?.id);assert(routes.length===11,'REVIEW_ROUTE_CREATE_COUNT');await record('route-create');
    begin('route-edit');const routeEdit=page.locator('a[href="/admin/routes/'+route.id+'/edit"]');await focus(routeEdit);await page.keyboard.press('Enter');await page.waitForURL(ORIGIN+'/admin/routes/'+route.id+'/edit');await page.locator('[name=public_model]').fill('journey-route-edited');await submit(page.getByRole('button',{name:'Save',exact:true}),'/admin/routes/'+route.id+'/update');
    routes=(await adminAPI(context,csrf,'GET','/admin/api/routes',undefined,200,check)).data;assert(routes.find(item=>item.id===route.id)?.public_model==='journey-route-edited','REVIEW_ROUTE_UPDATE');await record('route-edit');
    begin('csrf-rejection');const deleteRoute=page.locator('form[action="/admin/routes/'+route.id+'/delete"]');await deleteRoute.locator('[name=csrf]').evaluate(el=>{el.value='synthetic-wrong-csrf';});page.once('dialog',dialog=>dialog.accept());expectedHTTP.push({step:current,path:'/admin/routes/'+route.id+'/delete',method:'POST',status:403});await submit(deleteRoute.getByRole('button',{name:'Delete',exact:true}),'/admin/routes/'+route.id+'/delete',403);
    assert((await adminAPI(context,csrf,'GET','/admin/api/routes',undefined,200,check)).data.some(item=>item.id===route.id),'REVIEW_CSRF_MUTATED');await record('csrf-rejection',{expectedStatus:403,routePreserved:true});
    begin('route-delete');await go('/admin/routes');const deleteRoute2=page.locator('form[action="/admin/routes/'+route.id+'/delete"]');page.once('dialog',dialog=>dialog.accept());await submit(deleteRoute2.getByRole('button',{name:'Delete',exact:true}),'/admin/routes/'+route.id+'/delete');assert(!(await adminAPI(context,csrf,'GET','/admin/api/routes',undefined,200,check)).data.some(item=>item.id===route.id),'REVIEW_ROUTE_DELETE');await record('route-delete');
    begin('key-once');await go('/admin/keys');await page.locator('form[action="/admin/keys/new"] [name=name]').fill('journey-key');await submit(page.getByRole('button',{name:'Create',exact:true}),'/admin/keys/new',200);const oneTime=await page.locator('.codeblock').textContent();assert(oneTime&&oneTime.length>=24,'REVIEW_KEY_ONCE');secrets.push(oneTime);
    // Never screenshot the one-time secret page. Reload ordinary list first.
    await go('/admin/keys');const keys=(await adminAPI(context,csrf,'GET','/admin/api/keys',undefined,200,check)).data;const key=keys.find(item=>item.name==='journey-key');requireID(key?.id);assert(keys.length===2&&!JSON.stringify(keys).includes(oneTime)&&await page.locator('.codeblock').count()===0,'REVIEW_PREFIX_ONLY');await record('key-prefix-only',{oneTimeObservedInRAM:true,oneTimeNeverCaptured:true,prefixOnly:true});
    begin('key-delete');page.once('dialog',dialog=>dialog.accept());await submit(page.locator('form[action="/admin/keys/'+key.id+'/delete"]').getByRole('button',{name:'Delete',exact:true}),'/admin/keys/'+key.id+'/delete');assert((await adminAPI(context,csrf,'GET','/admin/api/keys',undefined,200,check)).data.length===1,'REVIEW_KEY_DELETE');await record('key-delete');
    begin('connection-delete');await go('/admin/connections');const deleteConnection=page.locator('form[action="/admin/connections/'+conn.id+'/delete"]');page.once('dialog',dialog=>dialog.dismiss());await focus(deleteConnection.getByRole('button',{name:'Delete',exact:true}));await page.keyboard.press('Enter');assert((await adminAPI(context,csrf,'GET','/admin/api/connections',undefined,200,check)).data.some(item=>item.id===conn.id),'REVIEW_DELETE_CANCEL');page.once('dialog',dialog=>dialog.accept());await submit(deleteConnection.getByRole('button',{name:'Delete',exact:true}),'/admin/connections/'+conn.id+'/delete');assert((await adminAPI(context,csrf,'GET','/admin/api/connections',undefined,200,check)).data.length===10,'REVIEW_CONNECTION_DELETE');await record('connection-delete',{cancelPreserved:true});
    begin('logout');await submit(page.getByRole('button',{name:'Logout',exact:true}),'/admin/logout');assert(page.url()===ORIGIN+'/admin/login'&&!(await context.cookies()).some(cookie=>cookie.name==='tr_admin'),'REVIEW_LOGOUT');const denied=await context.request.get(ORIGIN+'/admin/api/connections',{maxRedirects:0});assert(denied.status()===401,'REVIEW_LOGOUT_SESSION_ALIVE');await record('logout',{sessionCookieAbsent:true,adminAPI:401});
    assert(health.blocked===0&&health.pageErrors===0&&health.failed.length===0,'REVIEW_JOURNEY_UNKNOWN_ACTIVITY');
    const matching=row=>expectedHTTP.some(expected=>row.step===expected.step&&row.path===expected.path&&row.method===expected.method&&row.status===expected.status);
    assert(health.http.length===2&&health.http.every(matching),'REVIEW_JOURNEY_HTTP');
    assert(health.console.every(row=>row.type==='error'&&expectedHTTP.some(expected=>row.step===expected.step&&row.path===expected.path&&row.code==='HTTP_'+expected.status)),'REVIEW_JOURNEY_CONSOLE');
    result.journey.expectedHTTP=expectedHTTP;result.journey.classification='Only actual controlled empty-target400 and wrong-CSRF403; unknown requests/console/abort remain failures';result.journey.passed=true;
  }finally{await context.close();}
}
