import {existsSync,appendFileSync} from 'node:fs';
import {basename} from 'node:path';
import assert from 'node:assert/strict';
import {maskCoverage,pngPixels} from './png-mask.mjs';
import {createRequire} from 'node:module';
import {privateJSON} from './browser-support.mjs';
import {localOrigin} from './health.mjs';
const require=createRequire(new URL('../console-web/package.json',import.meta.url));
const pinned=createRequire(require.resolve('@playwright/test/package.json'));
const actual=pinned('playwright');
const secured=new WeakSet();
export function screenshotMasks(page,secrets) {return secrets.flatMap(secret=>[page.getByText(secret,{exact:true}),page.locator('code').filter({hasText:secret})]);}
export async function visibleSecretRectangles(page,secrets,fullPage) {
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollY,scrollX,documentHeight:document.documentElement.scrollHeight,deviceScale:devicePixelRatio}));
  assert(metrics.deviceScale===1,'REVIEW_MASK_DEVICE_SCALE');
  const rectangles=[];
  for(const secret of secrets)for(const locator of await page.locator('code').filter({hasText:secret}).all()) {
    if(!(await locator.isVisible()))continue;
    const rect=await locator.boundingBox();if(!rect)continue;
    const maxY=fullPage?metrics.documentHeight:metrics.height;
    const x=Math.max(0,rect.x),y=Math.max(0,rect.y+(fullPage?metrics.scrollY:0));
    const right=Math.min(metrics.width,rect.x+rect.width),bottom=Math.min(maxY,rect.y+(fullPage?metrics.scrollY:0)+rect.height);
    if(right-x>2&&bottom-y>2)rectangles.push({x,y,width:right-x,height:bottom-y});
  }
  return {metrics,rectangles};
}
function protectPage(page) {
  const screenshot=page.screenshot.bind(page);
  page.screenshot=async(options={})=>{
    const fixture=existsSync('/state/fixture.json')?privateJSON('fixture.json'):null;
    const secrets=fixture?.secrets.filter(Boolean)??[];
    const key=basename(String(options.path??'unnamed.png'));
    const drawerSecret=/^(desktop|tablet|mobile)-(group|topic-configuration)\.png$/.test(key)||key.startsWith('baseline-group');
    if(drawerSecret) {
      await page.waitForFunction(()=>[...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(element=>element.getBoundingClientRect().width>0&&getComputedStyle(element).visibility!=='hidden').some(element=>{const box=element.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&!element.getAnimations().some(animation=>animation.playState==='running');}));
      const first=await visibleSecretRectangles(page,secrets,!!options.fullPage);
      await new Promise(resolve=>setTimeout(resolve,100));
      const second=await visibleSecretRectangles(page,secrets,!!options.fullPage);
      assert.deepEqual(second,first,'REVIEW_MASK_RECT_STABLE');
      assert(second.rectangles.length>0,'REVIEW_VISIBLE_SECRET_MASK_REQUIRED');
    }
    const before=await visibleSecretRectangles(page,secrets,!!options.fullPage);
    const masks=screenshotMasks(page,secrets);
    const buffer=await screenshot({...options,animations:'disabled',maskColor:'#FF00FF',mask:[...(options.mask??[]),...masks]});
    const coverage=maskCoverage(buffer,before.rectangles),image=pngPixels(buffer);
    const after=await visibleSecretRectangles(page,secrets,!!options.fullPage);
    const stable=JSON.stringify(after)===JSON.stringify(before);
    const passed=stable&&coverage.every(item=>item.coverage>=0.99);
    appendFileSync('/state/mask-coverage.jsonl',JSON.stringify({key,deviceScale:before.metrics.deviceScale,image:{width:image.width,height:image.height},visibleSecretRectangles:before.rectangles.length,coverage,stable,passed})+'\n',{mode:0o600});
    assert(passed,'REVIEW_SCREENSHOT_MASK_COVERAGE');
    return buffer;
  };
}
export async function secureContext(context) {
  if(secured.has(context))return context;
  secured.add(context);
  await context.route('**/*',async route=>{
    let allowed=false;
    try{allowed=new URL(route.request().url()).origin===localOrigin;}catch{}
    if(allowed)await route.continue();else await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*',async socket=>{
    let allowed=false;
    try{allowed=new URL(socket.url()).origin==='ws://127.0.0.1:5173';}catch{}
    if(allowed)socket.connectToServer();else await socket.close({code:1008,reason:'Review loopback policy'});
  });
  context.on('page',protectPage);
  context.pages().forEach(protectPage);
  return context;
}
export const chromium={launch:async options=>{
  const browser=await actual.chromium.launch(options);
  const newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>secureContext(await newContext({...options,serviceWorkers:'block'}));
  return browser;
}};
