import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ORIGIN} from './guards.mjs';
import {api} from './api-fixture.mjs';
import {invalidQueuePath,journeyURL,classifyJourneyHealth,healthPassed} from './journey-health.mjs';

async function tabTo(page, selector) {
  const target=page.locator(selector);
  assert(await target.count()===1,'REVIEW_KEYBOARD_TARGET');
  for(let i=0;i<160;i++) {
    if(await target.evaluate(el=>document.activeElement===el)) {
      assert(await target.evaluate(el=>el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth)>=2),'REVIEW_VISIBLE_FOCUS');
      return target;
    }
    await page.keyboard.press('Tab');
  }
  throw Error('REVIEW_KEYBOARD_UNREACHABLE');
}
async function activate(page,selector){await tabTo(page,selector);await page.keyboard.press('Enter');}
function observed(promise){return promise.then(value=>({value}),error=>({error}));}
async function unwrap(promise){const value=await promise;if(value.error)throw value.error;return value.value;}
export async function journey(browser,key,output,result,check,setStage) {
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',locale:'en-US',serviceWorkers:'block'});
  result.journey=[];
  let stage='missing-key';
  const failures=[], responses=[], consoles=[], blocked=[], pageErrors=[];
  const controlled=new Set();
  const controlledPath=invalidQueuePath;
  const allowed=journeyURL;
  const queue='review_journey';
  const depth=async()=>{const {queues}=await api(key,'GET','/api/v1/queues',undefined,200);return queues.find(q=>q.name===queue)?.depth??0;};
  try {
    await context.route('**/*',route=>{if(!allowed(route.request().url())){blocked.push(true);return route.abort('blockedbyclient');}return route.continue();});
    await context.routeWebSocket('**/*',socket=>{blocked.push(true);socket.close();});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',()=>pageErrors.push(true));
    page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url(),status:r.status(),method:r.request().method(),stage});});
    page.on('requestfailed',r=>failures.push({request:r,url:r.url(),method:r.method(),stage,code:r.failure()?.errorText}));
    page.on('console',m=>{if(['error','warning'].includes(m.type()))consoles.push({type:m.type(),url:m.location().url,text:m.text(),stage});});
    async function record(name,details={}) {
      check();const file='journey-'+name+'.png';await page.screenshot({path:join(output,file),fullPage:true});
      const bytes=await readFile(join(output,file));
      result.journey.push({name,...details,screenshot:{file,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}});
    }
    function phase(name){stage=name;setStage('journey-'+name);}
    async function fill(selector,value){const target=await tabTo(page,selector);await target.fill(value);}
    phase('missing-key');
    const response=await page.goto(ORIGIN+'/ui/',{waitUntil:'networkidle',timeout:15000});
    assert(response.status()===200 && page.url()===ORIGIN+'/ui/','REVIEW_UI_IDENTITY');
    await page.locator('#queuesWrap').filter({hasText:'Failed to list queues (missing or invalid credentials)'}).waitFor();
    await record('missing-key',{apiStatus:401});
    phase('invalid-key');
    await fill('#apiKey','intentionally-invalid-review-key');await activate(page,'#btnSave');
    const invalidKeyResponses=['queues','metrics','cluster'].map(name=>observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/'+name)));
    await activate(page,'#btnRefresh');
    for(const pending of invalidKeyResponses)assert((await unwrap(pending)).status()===401,'REVIEW_INVALID_KEY_STATUS');
    await page.waitForFunction(()=>document.querySelector('#metrics').textContent==='error: missing or invalid credentials');
    await record('invalid-key',{apiStatus:401});
    phase('save-refresh');
    await fill('#apiKey',key);await activate(page,'#btnSave');await activate(page,'#btnRefresh');
    await page.waitForFunction(()=>document.querySelectorAll('#queuesWrap tbody tr').length===14 && document.querySelector('#cluster').textContent.includes('"enabled": false'));
    await record('save-refresh',{authenticated:true,clusterEnabled:false});
    phase('enqueue');
    await fill('#qName',queue);await fill('#qBody','合成佇列訊息 <b>literal</b> & "quoted"');
    const posted=observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/queue/'+queue && r.request().method()==='POST'));
    await activate(page,'#btnEnq');const post=await unwrap(posted);assert(post.status()===201,'REVIEW_ENQUEUE_STATUS');
    assert(await depth()===1,'REVIEW_ENQUEUE_DEPTH');
    await page.locator(`[data-q="${queue}"][data-act="use"]`).waitFor();await record('enqueue',{status:201,depth:1});
    phase('use');await fill('#qName','unused');await activate(page,`[data-q="${queue}"][data-act="use"]`);
    assert(await page.locator('#qName').inputValue()===queue,'REVIEW_USE_QUEUE');await record('use',{queueSelected:true});
    phase('peek');
    const peeked=observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/queue/'+queue+'?peek=true'));
    await activate(page,'#btnPeek');const peek=await unwrap(peeked);assert(peek.status()===200,'REVIEW_PEEK_STATUS');
    const peekBody=await peek.json();assert(peekBody.body==='合成佇列訊息 <b>literal</b> & "quoted"','REVIEW_PEEK_BODY');
    assert(await depth()===1,'REVIEW_PEEK_REMOVED_MESSAGE');await record('peek',{status:200,depth:1,literalBody:true});
    phase('consume');
    const consumed=observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/queue/'+queue && r.request().method()==='GET'));
    await activate(page,'#btnDeq');const consume=await unwrap(consumed);assert(consume.status()===200,'REVIEW_CONSUME_STATUS');
    assert((await consume.json()).id===peekBody.id,'REVIEW_CONSUME_IDENTITY');assert(await depth()===0,'REVIEW_CONSUME_DEPTH');
    await record('consume',{status:200,depth:0,sameMessage:true});
    phase('empty');
    const emptied=observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/queue/'+queue+'?peek=true'));
    await activate(page,'#btnPeek');assert((await unwrap(emptied)).status()===204,'REVIEW_EMPTY_STATUS');
    await page.waitForFunction(()=>document.querySelector('#log').textContent.includes('peek: empty'));
    await record('empty',{status:204,depth:0});
    phase('clear-cancel');
    await api(key,'POST','/api/v1/queue/'+queue,{body:'clear test one'},201);await api(key,'POST','/api/v1/queue/'+queue,{body:'clear test two'},201);
    page.once('dialog',dialog=>dialog.dismiss());await activate(page,'#btnClr');assert(await depth()===2,'REVIEW_CLEAR_CANCEL');
    await record('clear-cancel',{depth:2});
    phase('clear-confirm');
    const cleared=observed(page.waitForResponse(r=>r.url()===ORIGIN+'/api/v1/queue/'+queue && r.request().method()==='DELETE'));
    page.once('dialog',dialog=>dialog.accept());await activate(page,'#btnClr');const clear=await unwrap(cleared);
    assert(clear.status()===200 && (await clear.json()).cleared===2,'REVIEW_CLEAR_COUNT');assert(await depth()===0,'REVIEW_CLEAR_DEPTH');await record('clear-confirm',{cleared:2,depth:0});
    phase('illegal-name');await fill('#qName','review.invalid');
    const invalid=observed(page.waitForResponse(r=>r.url()===ORIGIN+controlledPath && r.request().method()==='POST'));
    await activate(page,'#btnEnq');assert((await unwrap(invalid)).status()===400,'REVIEW_INVALID_NAME_STATUS');
    await page.waitForFunction(()=>document.querySelector('#log').textContent.includes('enqueue failed: invalid queue name'));
    await record('illegal-name',{status:400});
    phase('controlled-network-failure');
    await page.route(ORIGIN+'/api/v1/metrics',route=>{controlled.add(route.request());return route.abort('failed');},{times:1});
    await activate(page,'#btnRefresh');await page.waitForFunction(()=>document.querySelector('#metrics').textContent==='error: Failed to fetch');
    await record('controlled-network-failure',{controlled:true,visibleError:true});
    phase('recovered-refresh');await activate(page,'#btnRefresh');await page.waitForFunction(()=>document.querySelector('#metrics').textContent.startsWith('{'));
    await record('recovered-refresh',{recovered:true});
    phase('five-second-focus');
    const target=`[data-q="${queue}"][data-act="use"]`;await tabTo(page,target);
    const before=await depth();const old=await page.locator(target).elementHandle();
    await page.waitForTimeout(5300);
    const detached=await old.evaluate(el=>!el.isConnected);assert(detached,'REVIEW_AUTOREFRESH_NOT_OBSERVED');
    assert(await page.locator(target).evaluate(el=>document.activeElement===el && el.matches(':focus-visible')),'REVIEW_REFRESH_FOCUS_LOST');
    assert(await depth()===before,'REVIEW_REFRESH_CHANGED_DEPTH');await record('five-second-focus',{replaced:true,focusPreserved:true,depth:before});
    result.journeyHealth=classifyJourneyHealth({responses,failures,consoles,controlled,blocked,pageErrors});
    assert(healthPassed(result.journeyHealth),'REVIEW_JOURNEY_HEALTH');
  } finally {
    result.journeyHealth=classifyJourneyHealth({responses,failures,consoles,controlled,blocked,pageErrors});
    result.journeyObserved={httpErrors:responses.length,requestFailures:failures.length,consoleEvents:consoles.length,blocked:blocked.length,pageErrors:pageErrors.length,lastStage:stage};
    await context.close();
  }
}
