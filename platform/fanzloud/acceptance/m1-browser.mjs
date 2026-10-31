// Real operator journey: TLS termination only; all product requests reach Rust/AP.
// M1_PRIVATE_DIR holds private browser-live.json plus tls.key/tls.crt. Never commit it.
import assert from 'node:assert/strict';
import {createServer as tlsServer} from 'node:https';
import {request} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash, X509Certificate} from 'node:crypto';
import {join} from 'node:path';
const root = process.env.M1_PRIVATE_DIR;
const {chromium} = await import(process.env.M1_PLAYWRIGHT_MODULE);
const config = JSON.parse(await readFile(join(root, 'browser-live.json'), 'utf8'));
assert.equal(config.origin, 'https://localhost:18447');
const cert = await readFile(join(root, 'tls.crt'));
const key = await readFile(join(root, 'tls.key'));
const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
const server = tlsServer({key, cert}, (req, res) => {
  const upstream = request({hostname:'127.0.0.1',port:18449,path:req.url,method:req.method,headers:req.headers}, reply => {
    res.writeHead(reply.statusCode,reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
await new Promise(resolve => server.listen(18447, '127.0.0.1', resolve));
const evidence = {scope:'real Chromium → TLS → Rust → AP → isolated VM → subscription CLI', states:[], browser_errors:[], task_posts:0, status:'STARTED'};
let browser;
let tearingDown=false;
evidence.teardown_events=[];
try {
  browser = await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
  const page = await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:960}});
  page.on('pageerror', error => (tearingDown ? evidence.teardown_events : evidence.browser_errors).push(error.message));
  page.on('console', msg => {if(msg.type()==='error') (tearingDown ? evidence.teardown_events : evidence.browser_errors).push(msg.text());});
  page.on('requestfailed', req => (tearingDown ? evidence.teardown_events : evidence.browser_errors).push(`${req.method()} ${new URL(req.url()).pathname}: ${req.failure()?.errorText}`));
  page.on('request', req => {if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/v1/tasks') evidence.task_posts++;});
  page.on('response', async response => {
    if (/\/api\/v1\/runs\/[a-f0-9-]+$/.test(new URL(response.url()).pathname) && response.ok()) {
      const run = await response.json().catch(()=>null);
      if (run && evidence.states.at(-1)!==run.state) evidence.states.push(run.state);
    }
  });
  await page.goto(config.origin);
  await page.locator('#username').fill(config.operator_name);
  await page.locator('#password').fill(config.operator_password);
  await page.locator('#login').click();
  await page.waitForFunction(() => !document.querySelector('#task-panel').hidden && document.querySelector('#agent').options.length===1 && !document.querySelector('#submit-task').disabled);
  assert.equal(await page.locator('#password').inputValue(),'');
  if (process.argv.includes('--preflight')) {
    assert.equal(evidence.task_posts,0);
    let mockedSubmissions=0;
    await page.route('**/api/v1/tasks', async route=> {
      if(route.request().method()==='POST') {mockedSubmissions++; await route.fulfill({status:502,contentType:'application/json',body:'{"error":"upstream_outcome_unknown"}'});}
      else await route.continue();
    });
    await page.locator('#title').fill('Mock lost-reply only');
    await page.locator('#prompt').fill('This intercepted browser regression never reaches AP.');
    await page.locator('#submit-task').click();
    await page.waitForFunction(()=>document.querySelector('#submit-status').textContent.includes('尚未確認'));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#agent').options.length===1);
    assert.equal(await page.locator('#submit-task').isDisabled(),true);
    assert.equal(mockedSubmissions,1);
    evidence.mock_lost_reply_reload='PASS; intercepted POST; no AP task';
    evidence.task_posts_real=0;
    const logoutReply=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/session' && r.request().method()==='DELETE');
    await page.locator('#logout').click();
    assert.equal((await logoutReply).status(),204);
    await page.waitForFunction(()=>!document.querySelector('#login-panel').hidden);
    assert.equal(await page.evaluate(async()=> (await (await fetch('/api/v1/session')).json()).authenticated),false);
    // Chromium reports the completed 204 DELETE as ERR_ABORTED; the separate
    // authenticated=false read above verifies the actual logout outcome.
    const expected=new Set(['Failed to load resource: the server responded with a status of 502 (Bad Gateway)','DELETE /api/v1/session: net::ERR_ABORTED']);
    evidence.expected_preflight_diagnostics=evidence.browser_errors.filter(x=>expected.has(x));
    evidence.browser_errors=evidence.browser_errors.filter(x=>!expected.has(x));
    assert.deepEqual(evidence.browser_errors,[]);
    evidence.status='PASS_LOGIN_CATALOG_LOGOUT_AND_MOCK_REFUSAL_NO_REAL_TASK';
  } else {
    await page.locator('#title').fill('修正含尾端的整數加總');
    await page.locator('#prompt').fill('Read totals.py and test_totals.py in this isolated workspace. Fix the off-by-one bug in total_inclusive so both endpoints are included. Keep the change minimal and only modify totals.py. Run python3 -m unittest -v to verify. Do not modify tests, publish, access network or delegate. Finish after the repair and test result.');
    await page.locator('#submit-task').click();
    await page.waitForFunction(()=>document.querySelector('#run-id').textContent.length===36,{},{timeout:15000});
    evidence.run_id = await page.locator('#run-id').textContent();
    await writeFile(join(root,'browser-intent.json'),JSON.stringify(evidence,null,2),{mode:0o600});
    await page.waitForFunction(()=>document.querySelector('#cleanup').textContent==='隔離工作區已停止並清理' && !document.querySelector('#download-diff').disabled,{},{timeout:660000});
    evidence.final_status=await page.locator('#run-status').textContent();
    evidence.verification=await page.locator('#verification').textContent();
    evidence.activity=await page.locator('#activity').textContent();
    const diff=await page.locator('#diff-output').textContent();
    const downloadReady=page.waitForEvent('download');
    await page.locator('#download-diff').click();
    const download=await downloadReady; const target=join(root,'browser-final.diff');
    await download.saveAs(target);
    assert.equal(await readFile(target,'utf8'),diff);
    evidence.diff_sha256=createHash('sha256').update(diff).digest('hex');
    await page.screenshot({path:join(root,'browser-final.png'),fullPage:true});
    assert.equal(evidence.final_status,'完成'); assert.equal(evidence.verification,'檢查通過');
    assert.equal(evidence.task_posts,1); assert.ok(evidence.states.includes('running')); assert.ok(diff.includes('totals.py'));
    const changedPaths=[...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(m=>m[2]);
    assert.deepEqual(changedPaths,['totals.py']);
    const actualRun=await page.evaluate(async id=>(await (await fetch(`/api/v1/runs/${id}`)).json()),evidence.run_id);
    assert.equal(actualRun.result.diff_sha256,evidence.diff_sha256);
    evidence.result=actualRun.result; evidence.cleanup_state=actualRun.cleanup_state;
    assert.deepEqual(evidence.browser_errors,[]);
    evidence.status='PASS_REAL_BROWSER_TASK';
  }
} catch(error) { evidence.status='FAILED'; evidence.error=String(error); throw error; }
finally {
  tearingDown=true;
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
  if(evidence.browser_errors.length) evidence.status='FAILED';
  await writeFile(join(root,process.argv.includes('--preflight')?'browser-preflight.json':'browser-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
  console.log(JSON.stringify(evidence));
  if(evidence.status==='FAILED') process.exitCode=1;
}
