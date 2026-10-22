import { chromium } from '/home/ckc/test/codex/agent-workspace/data/projects/kith/tasks/phase1-toolchain/build/deps-e2e/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { writeFile, copyFile } from 'node:fs/promises';
const artifacts = process.env.AGENT_ARTIFACTS_DIR;
const evidence = process.env.AGENT_EVIDENCE_DIR;
const browser = await chromium.launch({executablePath:'/home/ckc/test/codex/agent-workspace/data/projects/kernel/tasks/desk-verify-1-pp-browser-native/build/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'});
const page = await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[], requests=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request', r=>{if (/^https?:/.test(r.url())) requests.push(r.url());});
await page.route('https://**/*',r=>r.abort());
await page.route('http://**/*',r=>r.abort());
try {
 await page.goto('file://'+artifacts+'/handwired.html');
 await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='pass');
 assert.equal(await page.locator('#graph').textContent(),'23');
 for(const x of [-20,-10,0,10,20,30,40,50,60]) {
  await page.locator('#x-number').fill(String(x));
  assert.equal(await page.locator('#status').getAttribute('data-state'),'pass');
  assert.equal(Number(await page.locator('#graph').textContent()),1.25*x-2);
 }
 for(const [field,bad] of [['x','61'],['x','-21'],['a','2.1'],['a','0.49'],['b','11'],['b','-11'],['x','']]) {
  const input=page.locator('#'+field+'-number'); const previous=await input.inputValue();
  await input.fill(bad);
  assert.equal(await page.locator('#status').getAttribute('data-state'),'error');
  for(const id of ['reference','graph','difference','tolerance','formula-value']) assert.equal(await page.locator('#'+id).textContent(),'—');
  assert.equal(await input.getAttribute('aria-invalid'),'true');
  await input.fill(previous);
  assert.equal(await page.locator('#status').getAttribute('data-state'),'pass');
 }
 // A browser's number input sanitizes nonnumeric text to empty; that too must clear success.
 await page.locator('#x-number').evaluate(el=>{el.value='NaN';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator('#status').getAttribute('data-state'),'error');
 await page.locator('#x-range').evaluate(el=>{el.value='20';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator('#x-number').inputValue(),'20');
 assert.equal(await page.locator('#status').getAttribute('data-state'),'pass');
 // Keyboard-driven slider must update on input, not blur.
 await page.locator('#x-range').focus(); await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('#x-number').inputValue(),'20.1');
 assert.equal(Number(await page.locator('#reference').textContent()),23.125);
 await page.locator('#x-number').fill('1.234567');
 await page.locator('#a-number').fill('1.333333');
 await page.locator('#b-number').fill('0.1234567');
 assert.equal(await page.locator('#status').getAttribute('data-state'),'pass');
 assert.ok(Number(await page.locator('#difference').textContent())>0);
 await page.screenshot({path:evidence+'/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:evidence+'/mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 const result={browser:browser.version(),url:page.url(),ninePoints:'PASS',invalidClearsAllResults:'PASS',numberSanitization:'PASS',keyboardSliderImmediate:'PASS',fractionalComparison:'PASS',desktopMobile:'PASS',pageErrors:errors,networkRequests:requests};
 await writeFile(evidence+'/browser.json',JSON.stringify(result,null,2));
 await copyFile(process.argv[1],evidence+'/browser.mjs');
 console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
