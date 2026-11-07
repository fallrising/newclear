#!/usr/bin/env node
// Real Chromium, local HTTP at a nested path, real Clipboard API; no stubs or mocks.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=createRequire(import.meta.url)(process.env.MP_PLAYWRIGHT || 'playwright');
const prefix='/nested/tools/motion-prompt/';
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
 const relative=pathname.startsWith(prefix)?pathname.slice(prefix.length):pathname.slice(1);
 let file=path.resolve(ROOT,relative||'index.html');
 if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const types={'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};
 res.setHeader('Content-Type',(types[path.extname(file)]||'text/plain')+'; charset=utf-8');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+prefix;
const evidence=path.resolve(process.env.MP_EVIDENCE || path.join(ROOT,'evidence'));
fs.mkdirSync(evidence,{recursive:true});
const issues=[],external=[],checks=[];
const acceptance = msg => /clipboard|copy language|multi-pick|share link|shared selection|clear selection/.test(msg)?'AC-07-clipboard':/search |exact ID|filter|no results/.test(msg)?'AC-05-search':/deep link|detail navigation/.test(msg)?'AC-06-detail':/reduced|paused|focus|mobile|theme/.test(msg)?'AC-09-accessibility':/errors|requests|HTTP|root path/.test(msg)?'AC-10-static':/actually plays|animated tiles/.test(msg)?'AC-08-animation':'AC-04-language';
const ok=(v,msg)=>{const label=acceptance(msg)+': '+msg;assert.ok(v,label);checks.push(label);};
let browser;
function observe(p){
 p.on('pageerror',e=>issues.push(e.message));
 p.on('console',m=>{if(m.type()==='error')issues.push(m.text());});
 p.on('response',r=>{if(r.status()>=400)issues.push(`${r.status()} ${new URL(r.url()).pathname}`);});
 p.on('requestfailed',r=>issues.push(r.failure().errorText+' '+new URL(r.url()).pathname));
 p.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('data:'))external.push(r.url());});
}
try {
 browser=await chromium.launch(process.env.MP_BROWSER_OPTIONS?JSON.parse(fs.readFileSync(process.env.MP_BROWSER_OPTIONS,'utf8')):{});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
 const page=await ctx.newPage();observe(page);
 await page.goto(base);await page.waitForFunction(()=>Object.keys(MotionPrompt.packs).length>=10);
 ok(await page.locator('html').getAttribute('lang')==='zh-Hant','Traditional Chinese default');
 ok(await page.locator('.tile').count()===120,'all 120 animated tiles');
 ok(await page.locator('#play').getAttribute('aria-pressed')==='false','reduced motion starts paused');
 const still=await page.locator('.tile canvas').first().evaluate(c=>c.toDataURL());
 await page.waitForTimeout(150);
 ok(await page.locator('.tile canvas').first().evaluate(c=>c.toDataURL())===still,'paused canvas stays still');
 await page.screenshot({path:path.join(evidence,'desktop-zh.png')});
 const q=page.locator('#q'),visible=page.locator('.tile-box:visible');
 for(const term of ['遮罩','Mask reveal','#005','005','5']){
  await q.fill(term);await page.waitForTimeout(20);
  ok(await page.locator('.tile[data-id="005"]').isVisible(),`search ${term}`);
  if(term.includes('005')||term==='5')ok(await visible.count()===1,`exact ID ${term}`);
 }
 await q.fill('zzzz-no-such-effect');ok(await page.locator('#empty').isVisible(),'localized no results');
 await q.fill('');await page.locator('#packs .chip').nth(2).click();ok(await visible.count()===24,'camera pack filter');
 await page.locator('#cats .chip').nth(1).click();ok(await visible.count()===8,'camera category filter');
 await page.locator('#packs .chip').first().click();
 await q.fill('Mask');await page.locator('[data-pick="005"]').click();
 await page.locator('#tray-note').fill('Use for opening title');
 await page.locator('.top [data-lang="en"]').click();
 ok(await q.inputValue()==='Mask','search survives language switch');
 ok((await page.locator('#tray-list').innerText()).includes('#005'),'picks survive language switch');
 ok(await page.locator('#tray-note').inputValue()==='Use for opening title','note survives language switch');
 await q.fill('');await page.locator('.tile[data-id="005"]').focus();await page.keyboard.press('Enter');
 await page.waitForSelector('#detail[open]');
 ok((await page.locator('#d-name').innerText())==='Mask reveal','English detail name');
 ok(!/[\u3040-\u30ff\u3400-\u9fff]/.test(await page.locator('.d-head').innerText()),'English detail contains no CJK prose');
 await page.locator('#detail [data-copy-lang]').selectOption('en');await page.locator('#d-copy-prompt').click();
 let clip=await page.evaluate(()=>navigator.clipboard.readText());
 ok(clip.includes('Mask reveal')&&clip.includes(base+'api/v1/en/e/005.txt')&&!clip.includes('上游'),'real English clipboard and local subpath URLs');
 await page.locator('#detail [data-copy-lang]').selectOption('zh-Hant');await page.locator('#d-copy-prompt').click();
 clip=await page.evaluate(()=>navigator.clipboard.readText());ok(clip.includes('遮罩')&&clip.includes('/zh-Hant/e/005.txt'),'real Chinese clipboard without switching UI');
 ok(await page.locator('html').getAttribute('lang')==='en','copy language independent of interface');
 await page.locator('#detail [data-lang="zh-Hant"]').click();
 ok((await page.locator('#d-name').innerText()).includes('Mask reveal'),'Chinese detail includes English term');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail').open);
 ok(await page.locator('.tile[data-id="005"]').evaluate(n=>document.activeElement===n),'Escape restores keyboard focus');
 await page.locator('[data-pick="027"]').click();await page.locator('#tray [data-copy-lang]').selectOption('en');
 await page.locator('#tray-main').click();clip=await page.evaluate(()=>navigator.clipboard.readText());
 ok(clip.includes('#005')&&clip.includes('#027')&&clip.includes('Demo specification')&&clip.includes('Use for opening title'),'real multi-pick clipboard contains full specifications and note');
 await page.locator('#tray-share').click();const shared=await page.evaluate(()=>navigator.clipboard.readText());
 ok(shared.startsWith(base+'?pick=005,027'),'share link stays on local gallery');
 await page.goto(base+'?lang=en#028');await page.waitForSelector('#detail[open]');
 ok(await page.locator('#d-name').innerText()==='Zoom in','direct deep link with English locale');
 await page.reload();await page.waitForSelector('#detail[open]');
 ok(await page.locator('#d-name').innerText()==='Zoom in','deep link survives reload');
 await page.locator('#detail [data-copy-lang]').selectOption('en');
 await page.screenshot({path:path.join(evidence,'desktop-en-detail.png')});
 await page.locator('#d-next').focus();await page.keyboard.press('ArrowRight');
 ok((await page.locator('#d-id').innerText())==='#029','keyboard detail navigation');
 const before=await page.locator('#d-canvas').evaluate(c=>c.toDataURL());
 await page.locator('#d-play').click();await page.waitForTimeout(180);
 ok(await page.locator('#d-canvas').evaluate(c=>c.toDataURL())!==before,'animation actually plays');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(100);await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.querySelector('#d-play').getAttribute('aria-pressed')==='false');
 ok(await page.locator('#d-play').getAttribute('aria-pressed')==='false','live reduced-motion change pauses playback');
 await page.goto(shared);ok(await page.locator('#tray-list li').count()===2,'shared selection restores');
 await page.locator('#tray-clear').click();ok(await page.locator('#tray').isHidden(),'clear selection');
 // Verify every generated local API endpoint through HTTP, not merely filesystem checks.
 const cat=await (await ctx.request.get(base+'api/v1/catalog.json')).json();
 for(const lang of ['zh-Hant','en'])for(const e of cat.elements){
  for(const type of ['e','p']){const r=await ctx.request.get(`${base}api/v1/${lang}/${type}/${e.id}.txt`);assert.equal(r.status(),200);}
 }
 checks.push('AC-10-static: 480 localized element/prompt API endpoints return 200');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 const mp=await mobile.newPage();observe(mp);await mp.goto(base);await mp.waitForFunction(()=>Object.keys(MotionPrompt.packs).length>=10);
 ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile gallery has no horizontal overflow');
 await mp.screenshot({path:path.join(evidence,'mobile-zh.png')});
 await mp.goto(base+'#049');await mp.waitForSelector('#detail[open]');
 ok(await mp.evaluate(()=>document.querySelector('#detail').scrollWidth<=document.querySelector('#detail').clientWidth),'mobile detail has no horizontal overflow');
 await mp.screenshot({path:path.join(evidence,'mobile-zh-detail.png')});
 await mp.locator('#d-pick').click();await mp.locator('#d-close').click();
 await mp.locator('#tray-toggle').click();ok(await mp.locator('#tray-note').isVisible(),'mobile tray expands');
 await mp.locator('#tray [data-copy-lang]').selectOption('zh-Hant');await mp.locator('#tray-main').click();
 ok((await mp.evaluate(()=>navigator.clipboard.readText())).includes('#049'),'mobile real clipboard');
 await mp.locator('#theme').click();ok(await mp.locator('html').getAttribute('data-theme')==='dark','theme toggle');
 const rootPage=await ctx.newPage();observe(rootPage);await rootPage.goto(origin+'/?lang=zh-Hant#005');await rootPage.waitForSelector('#detail[open]');
 ok((await rootPage.locator('#d-name').innerText()).includes('遮罩'),'root path serves localized detail');
 await rootPage.locator('#detail [data-copy-lang]').selectOption('en');await rootPage.locator('#d-copy-prompt').click();
 ok((await rootPage.evaluate(()=>navigator.clipboard.readText())).includes(origin+'/api/v1/en/e/005.txt'),'root path clipboard URLs');
 await rootPage.close();
 await page.goto(base+'?lang=zh-Hant');await page.waitForFunction(()=>Object.keys(MotionPrompt.packs).length>=10);
 for(const [pack,index] of [['lp',4],['photo',5]]){
  await page.locator('#packs .chip').nth(index).click();
  await page.locator('.tile-box:visible').first().scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  await page.screenshot({path:path.join(evidence,'desktop-'+pack+'.png')});
 }
 ok(!issues.length,'no console errors, unhandled rejections, failed resources or HTTP errors: '+issues.join(';'));
 ok(!external.length,'no external runtime requests: '+external.join(';'));
 const result={date:new Date().toISOString(),acceptance:['AC-04','AC-05','AC-06','AC-07','AC-08','AC-09','AC-10'],browser:browser.version(),checks:checks.length,passed:checks,errors:issues,externalRequests:external};
 fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify(result,null,2)+'\n');
 console.log(`PASS: ${checks.length} browser checks; Chromium ${result.browser}; real clipboard, desktop/mobile, subpath, 480 API resources, zero errors/external requests.`);
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
