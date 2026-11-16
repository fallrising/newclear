// Real loopback server + real Blob downloads. Synthetic saved runs, zero model calls.
// Usage: node scripts/check_result_redaction_http_browser.mjs private-server.json private-output-dir
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
assert.equal(process.argv.length, 4);
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
const entry=new URL(config.url),origin=entry.origin;
assert.equal(entry.hostname,'127.0.0.1');
const token=new URLSearchParams(entry.hash.slice(1)).get('token');assert(token);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const sentinel=/(?<![A-Za-z0-9])SYNTHSECRET_[0-9a-f]{16}(?![A-Za-z0-9])/;
const safe=text=>assert(!sentinel.test(text),'synthetic sentinel escaped output boundary');
const api=await fetch(origin+'/api/state',{headers:{Authorization:`Bearer ${token}`}});
assert.equal(api.status,200);const raw=await api.text();safe(raw);const state=JSON.parse(raw);
fs.mkdirSync(out,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={status:'starting',product_model_requests:0,download_count:0};
try{
 const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'}),errors=[],external=[],posts=[];
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin===origin){if(route.request().method()==='POST')posts.push(u.pathname);return route.continue();}
  if(u.protocol==='file:'||u.protocol==='blob:')return route.continue();
  external.push(u.origin);return route.abort();
 });
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.name)));
 const page=await context.newPage();await page.goto(config.url);
 await page.locator('#runs tr').first().waitFor();
 safe(await page.locator('body').innerText());
 const completed=state.results.runs.filter(r=>r.status==='completed'&&r.artifact.status==='verified');
 assert(completed.length>=2);
 for(const row of completed){
  await page.locator(`#runs tr[data-ref="${row.ref}"]`).getByRole('button',{name:'查看結果'}).click();
  safe(await page.locator('#detail').innerText());
  const expected=row.artifact.text??row.artifact.export_text;
  const button=page.locator('#detail button.download');
  await page.waitForFunction(()=>{const b=document.querySelector('#detail button.download');return b&&!b.disabled;});
  const pending=page.waitForEvent('download');await button.click();const download=await pending;
  safe(download.suggestedFilename());
  const file=path.join(out,row.ref+'.download');await download.saveAs(file);const bytes=fs.readFileSync(file);
  assert.equal(bytes.toString('utf8'),expected);assert.equal(sha(bytes),row.artifact.display_sha256);safe(bytes.toString('utf8'));
  assert((await page.locator('#detail').innerText()).includes(row.artifact.sha256));
  report.download_count++;
 }
 const secretOnly=completed.find(r=>r.artifact.kind==='revision'&&r.artifact.changed&&!r.artifact.display_changed);
 assert(secretOnly);await page.locator(`#runs tr[data-ref="${secretOnly.ref}"] button`).first().click();
 assert((await page.locator('#detail').innerText()).includes('secret-only'));
 await page.screenshot({path:path.join(out,'http-result.png'),fullPage:true});
 await page.reload();await page.locator('#runs tr').first().waitFor();
 assert.equal(await page.locator('#runs tr').count(),state.results.runs.length);
 const offline=await context.newPage();await offline.goto(pathToFileURL(config.html).href);
 const embedded=await offline.locator('#data').textContent();safe(embedded);
 const offlineRow=completed[0];await offline.locator(`#runs tr[data-ref="${offlineRow.ref}"] button`).click();
 await offline.waitForFunction(()=>[...document.querySelectorAll('#detail button')].some(b=>b.textContent.startsWith('下載 ')&&!b.disabled));
 const pending=offline.waitForEvent('download');await offline.getByRole('button',{name:/^下載 /}).click();const downloaded=await pending;
 const file=path.join(out,'offline.download');await downloaded.saveAs(file);assert.equal(sha(fs.readFileSync(file)),offlineRow.artifact.display_sha256);
 report.download_count++;
 assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 report.status='passed';report.external_requests=0;report.browser_errors=0;report.dispatch_requests=0;report.refresh_without_dispatch=true;
 console.log(JSON.stringify(report));
}finally{
 await browser.close();fs.writeFileSync(path.join(out,'http-browser.json'),JSON.stringify(report,null,2)+'\n');
}
