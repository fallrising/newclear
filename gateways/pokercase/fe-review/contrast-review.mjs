import assert from 'node:assert/strict';
import {ORIGIN,allowedURL} from './guards.mjs';
export function contrastViewport(name){
  const sizes={desktop:{width:1440,height:900},tablet:{width:834,height:1112},mobile:{width:390,height:844}};
  assert(Object.hasOwn(sizes,name),'REVIEW_CONTRAST_UNKNOWN_VIEWPORT');return {...sizes[name]};
}
export async function contrastReview(browser,storage,pages,result,check,selected=null){
  result.contrastReview=[];
  const incomplete=selected??(result.mode==='visual'?result.captures.filter(row=>row.axe.incomplete.length).map(row=>({page:row.page,viewport:row.viewport.name,incomplete:row.axe.incomplete})):result.reusedWeb.incomplete);
  result.contrastSource={run:selected?'visual-001':result.id,scope:selected?'one desktop viewport correction; original computed pair retained with invalid scope':result.mode==='visual'?'current visual strict captures':'prior immutable Web captures'};
  for(const item of incomplete){
    check();const {width,height}=contrastViewport(item.viewport);
    const spec=pages.find(page=>page.id===item.page);assert(spec,'REVIEW_CONTRAST_PAGE');
    const context=await browser.newContext({viewport:{width,height},colorScheme:'dark',locale:'zh-TW',storageState:storage,serviceWorkers:'block'});
    let unknown=0;
    try{
      await context.route('**/*',route=>allowedURL(route.request().url())?route.continue():(unknown++,route.abort('blockedbyclient')));
      await context.routeWebSocket('**/*',socket=>{unknown++;socket.close();});
      const page=await context.newPage();page.on('pageerror',()=>unknown++);const r=await page.goto(ORIGIN+spec.path,{waitUntil:'networkidle',timeout:15000});assert(r.status()===200&&page.url()===ORIGIN+spec.path,'REVIEW_CONTRAST_IDENTITY');
      const actualViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
      assert(actualViewport.width===width&&actualViewport.height===height&&page.viewportSize().width===width&&page.viewportSize().height===height,'REVIEW_CONTRAST_VIEWPORT');
      const targets=item.incomplete.filter(rule=>rule.id==='color-contrast').flatMap(rule=>rule.targets);
      const observations=await page.evaluate(selectors=>selectors.map(selector=>{
        const elements=[...document.querySelectorAll(selector)];return {selector,count:elements.length,nodes:elements.map(el=>{
          const style=getComputedStyle(el);let background=null,backgroundImage=false;let cursor=el;
          while(cursor){const css=getComputedStyle(cursor);if(css.backgroundImage!=='none')backgroundImage=true;const value=css.backgroundColor;const parts=value.match(/[\d.]+/g)?.map(Number);if(parts?.length===3||parts?.length===4&&parts[3]===1){background=value;break;}if(parts?.length===4&&parts[3]!==0)break;cursor=cursor.parentElement;}
          return {foreground:style.color,background,backgroundImage,fontSize:parseFloat(style.fontSize),fontWeight:style.fontWeight,textLength:(el.textContent??'').length};
        })};
      }),targets);
      assert(observations.every(row=>row.count>0),'REVIEW_CONTRAST_TARGET_MISSING');
      for(const observation of observations)for(const node of observation.nodes){
        const parse=value=>{const parts=value?.match(/[\d.]+/g)?.map(Number);return parts&&(parts.length===3||parts.length===4&&parts[3]===1)?parts.slice(0,3):null;};
        const fg=parse(node.foreground),bg=parse(node.background);
        const luminance=rgb=>rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
        node.ratio=fg&&bg&&!node.backgroundImage?(Math.max(luminance(fg),luminance(bg))+0.05)/(Math.min(luminance(fg),luminance(bg))+0.05):null;
        node.threshold=node.fontSize>=24||node.fontSize>=18.66&&Number(node.fontWeight)>=700?3:4.5;
        node.computedPairPass=node.ratio!==null&&node.ratio>=node.threshold;
      }
      assert(unknown===0,'REVIEW_CONTRAST_UNKNOWN_ACTIVITY');
      result.contrastReview.push({page:item.page,viewport:item.viewport,actualViewport,observations,scope:'Computed opaque text/background pairs only; source-specific axe incomplete retained. No claim that this calculation alone replaces visual review of clipped or overlaid content.'});
    }finally{await context.close();}
  }
}
