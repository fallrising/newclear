// Explicit live launcher; never use --submit-codex as a health check or retry.
// Private inputs and screenshots stay outside the repository.
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {request} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash, X509Certificate} from 'node:crypto';
import {join} from 'node:path';
const root = process.env.M2_PRIVATE_DIR;
const submit = process.argv.includes('--submit-codex');
const replay = process.argv.find(x => x.startsWith('--read-run='))?.slice(11);
assert.ok(Boolean(submit) !== Boolean(replay), 'choose one explicit submit or read-only run');
const output = process.env.M2_EVIDENCE_DIR;
await mkdir(output, {mode:0o700}); // Existing evidence/intent means stop, never overwrite.
const {chromium} = await import(process.env.M2_PLAYWRIGHT_MODULE);
const config = JSON.parse(await readFile(join(root, 'browser-live.json'), 'utf8'));
const selection = JSON.parse(await readFile(join(root, 'browser-selection.json'), 'utf8'));
assert.equal(config.origin, 'https://localhost:18447');
const cert = await readFile(join(root, 'tls.crt')), key = await readFile(join(root, 'tls.key'));
const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
const server = createServer({key, cert}, (req,res) => {
  const upstream = request({hostname:'127.0.0.1',port:18449,path:req.url,method:req.method,headers:req.headers}, reply => {
    res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
await new Promise(resolve=>server.listen(18447,'127.0.0.1',resolve));
const evidence = {scope:'LIVE Chromium → HTTPS → Rust → AP → VM → official Codex', source:process.env.M2_SOURCE,
  status:'STARTED', task_posts:0, states:[], browser_errors:[], provider_requests:null, tokens:null, cost:null};
let browser;
try {
  browser = await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
  evidence.browser_version=browser.version();evidence.node_version=process.version;
  const page = await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:960}});
  page.on('pageerror',e=>evidence.browser_errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')evidence.browser_errors.push(m.text());});
  page.on('requestfailed',r=>evidence.browser_errors.push(`${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`));
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v1/tasks')evidence.task_posts++;});
  page.on('response',async r=>{
    if(/\/api\/v1\/runs\/[a-f0-9-]+$/.test(new URL(r.url()).pathname)&&r.ok()) {
      const run=await r.json().catch(()=>null);
      if(run&&evidence.states.at(-1)!==run.state)evidence.states.push(run.state);
    }
  });
  await page.goto(config.origin);
  await page.locator('#username').fill(config.operator_name);await page.locator('#password').fill(config.operator_password);
  await page.locator('#login').click();
  await page.waitForFunction(()=>!document.querySelector('#task-panel').hidden&&document.querySelector('#agent').options.length===2);
  evidence.agents=await page.locator('#agent option').allTextContents();
  assert.equal(await page.locator('#password').inputValue(),'');
  assert.equal(await page.locator('#base-sha').textContent(),selection.base_sha);
  if(submit) {
    await page.locator('#agent').selectOption(selection.profiles.codex);
    await page.locator('#title').fill('Codex：修正含尾端的整數加總');
    await page.locator('#prompt').fill('Use fanz_read, fanz_write and fanz_exec for this isolated repository. Read totals.py and test_totals.py. Fix total_inclusive so both endpoints are included. Only modify totals.py and keep the change minimal. Run python3 -m unittest -v. Do not modify tests, access network, publish or delegate. Finish after the repair and checks.');
    await writeFile(join(output,'submission-intent.json'),JSON.stringify({source:evidence.source,profile:selection.profiles.codex,base_sha:selection.base_sha,attempts:1}),{mode:0o600,flag:'wx'});
    await page.locator('#submit-task').click();
    await page.waitForFunction(()=>document.querySelector('#run-id').textContent.length===36,{},{timeout:15000});
    evidence.run_id=await page.locator('#run-id').textContent();
    await writeFile(join(output,'accepted-run.json'),JSON.stringify({run_id:evidence.run_id}),{mode:0o600,flag:'wx'});
  } else {
    evidence.scope='READ_ONLY existing live run in same two-vendor Web; no task submission';evidence.run_id=replay;
    await page.evaluate(id=>sessionStorage.setItem('fanz-current-run',id),replay);await page.reload();
  }
  await page.waitForFunction(()=>['完成','失敗','結果不確定，已停止自動執行','已取消'].includes(document.querySelector('#run-status').textContent),{},{timeout:660000});
  evidence.final_status=await page.locator('#run-status').textContent();
  evidence.run=await page.evaluate(async id=>(await(await fetch(`/api/v1/runs/${id}`)).json()),evidence.run_id);
  await page.screenshot({path:join(output,'final.png'),fullPage:true});
  assert.equal(evidence.final_status,'完成');
  await page.waitForFunction(()=>document.querySelector('#cleanup').textContent==='隔離工作區已停止並清理'&&!document.querySelector('#download-diff').disabled);
  evidence.run=await page.evaluate(async id=>(await(await fetch(`/api/v1/runs/${id}`)).json()),evidence.run_id);
  await page.screenshot({path:join(output,'final.png'),fullPage:true});
  evidence.verification=await page.locator('#verification').textContent();assert.equal(evidence.verification,'檢查通過');
  const diff=await page.locator('#diff-output').textContent();
  const ready=page.waitForEvent('download');await page.locator('#download-diff').click();await(await ready).saveAs(join(output,'final.diff'));
  assert.equal(await readFile(join(output,'final.diff'),'utf8'),diff);
  evidence.diff_sha256=createHash('sha256').update(diff).digest('hex');
  assert.equal(evidence.run.result.diff_sha256,evidence.diff_sha256);
  assert.equal(evidence.run.base_sha,selection.base_sha);
  assert.deepEqual([...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(m=>m[2]),['totals.py']);
  assert.equal(evidence.task_posts,submit?1:0);if(submit)assert.ok(evidence.states.includes('running'));
  assert.deepEqual(evidence.browser_errors,[]);evidence.status='PASS';
} catch(error) { evidence.status='FAIL';evidence.error=String(error);process.exitCode=1; }
finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(join(output,'receipt.json'),JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:evidence.status,run_id:evidence.run_id,diff_sha256:evidence.diff_sha256,error:evidence.error}));
}
