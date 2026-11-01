// Optional browser verification: use an existing Playwright module and Chromium; no installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
import assert from 'node:assert/strict';
import { writeFile, copyFile } from 'node:fs/promises';
const evidence=process.env.AGENT_EVIDENCE_DIR;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
await page.route('https://**/*',r=>r.abort());await page.route('http://**/*',r=>r.abort());
const text=async id=>await page.locator('#'+id).textContent();
const state=async()=>await page.locator('#learning-status').getAttribute('data-state');
const click=async id=>await page.locator('#'+id).click();
const countRows=async()=>await page.locator('#learning-history tr').count();
try {
 await page.goto('file://'+process.env.AGENT_ARTIFACTS_DIR+'/handwired.html');
 assert.equal(await state(),'ready');assert.equal(await text('learning-count'),'0');
 assert.equal(await text('learning-a'),'1');assert.equal(await text('learning-b'),'0');
 assert.equal(await page.locator('#a-number').inputValue(),'1.25');assert.equal(await page.locator('#b-number').inputValue(),'-2');
 assert.equal(await countRows(),1);
 // Independent learner, manual comparison edits and x are preserved until accepted updates.
 await page.locator('#x-number').fill('42.5');await page.locator('#a-number').fill('0.5');await page.locator('#b-number').fill('-10');
 assert.equal(await text('learning-count'),'0');assert.equal(await text('learning-a'),'1');
 await click('learning-step');assert.equal(await text('learning-count'),'1');assert.equal(await countRows(),2);
 assert.equal(await page.locator('#x-number').inputValue(),'42.5');
 assert.equal(await page.locator('#a-number').inputValue(),await text('learning-a'));
 assert.equal(await page.locator('#b-number').inputValue(),await text('learning-b'));
 const single={a:Number(await text('learning-a')),b:Number(await text('learning-b')),loss:Number(await text('learning-loss'))};
 assert.ok(Math.abs(single.a-1.0141666666666667)<1e-6);assert.ok(Math.abs(single.b-.3)<1e-6);
 await click('learning-run');assert.equal(await state(),'complete');assert.equal(await text('learning-count'),'500');assert.equal(await countRows(),501);
 const final={a:Number(await text('learning-a')),b:Number(await text('learning-b')),loss:Number(await text('learning-loss')),maxError:Number(await text('learning-max-error'))};
 assert.ok(final.maxError<=.05);assert.ok(final.loss<single.loss);
 assert.equal(await page.locator('#learning-step').isDisabled(),true);assert.equal(await page.locator('#learning-run').isDisabled(),true);
 assert.equal(await page.locator('#x-number').inputValue(),'42.5');
 const points=[];
 for(const x of [-20,-10,0,10,20,30,40,50,60]){
  await page.locator('#x-number').fill(String(x));const graph=Number(await text('graph'));
  assert.ok(Math.abs(graph-(1.25*x-2))<=.05);assert.equal(await page.locator('#status').getAttribute('data-state'),'pass');points.push({x,graph,error:Math.abs(graph-(1.25*x-2))});
 }
 // History is actually inspectable and aligned with the displayed final state.
 await page.locator('details').filter({has:page.locator('#learning-history')}).locator('summary').click();
 assert.equal(await page.locator('#learning-history tr').last().locator('td').first().textContent(),'500');
 assert.equal(Number(await page.locator('#learning-history tr').last().locator('td').nth(1).textContent()),final.a);
 await page.screenshot({path:evidence+'/desktop.png',fullPage:true});
 await click('learning-fast');assert.equal(await state(),'stopped');assert.equal(await text('learning-count'),'0');assert.equal(await countRows(),1);
 const stop=await text('learning-status');assert.match(stop,/b=12/);assert.equal(await text('learning-a'),'1');assert.equal(await text('learning-b'),'0');
 assert.equal(await page.locator('#b-number').inputValue(),'0');assert.equal(await page.locator('#learning-run').isDisabled(),true);
 await click('learning-reset');assert.equal(await state(),'ready');assert.equal(await countRows(),1);assert.equal(await text('learning-count'),'0');assert.equal(await page.locator('#learning-run').isDisabled(),false);
 // Training cannot rescue an invalid x by changing it or leaving an old pass.
 await page.locator('#x-number').fill('');await click('learning-step');assert.equal(await page.locator('#x-number').inputValue(),'');assert.equal(await page.locator('#status').getAttribute('data-state'),'error');assert.equal(await text('graph'),'—');
 await page.locator('#x-number').fill('61');await click('learning-reset');assert.equal(await page.locator('#status').getAttribute('data-state'),'error');assert.equal(await text('graph'),'—');
 await page.locator('#x-number').fill('20');await click('learning-run');assert.equal(await state(),'complete');assert.equal(await countRows(),501);assert.equal(Number(await text('learning-a')),final.a);assert.equal(Number(await text('learning-b')),final.b);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:evidence+'/mobile.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 const result={browser:browser.version(),single,final,ninePoints:points,lr2Stop:stop,historyRows:501,resetRepeat:'PASS',invalidXPreserved:'PASS',desktopMobile:'PASS',pageErrors:errors,networkRequests:requests};
 await writeFile(evidence+'/browser.json',JSON.stringify(result,null,2));await copyFile(process.argv[1],evidence+'/browser.mjs');console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
