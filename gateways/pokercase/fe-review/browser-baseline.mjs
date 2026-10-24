import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ORIGIN,allowedURL} from './guards.mjs';

export const viewports=[{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}];
export async function capturePages(browser,storage,pages,output,secrets,result,check,stage,selected=viewports,{strict=false,images=true,tableReadability=false}={}) {
  const {default:AxeBuilder}=await import(process.env.AXE_MODULE);
  result.captures??=[];
  for(const viewport of selected) {
    for(const spec of pages) {
      check();stage('baseline-'+spec.id+'-'+viewport.name);
      const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},colorScheme:'dark',locale:'zh-TW',...(storage?{storageState:storage}:{}),serviceWorkers:'block'});
      const health={consoleErrors:0,consoleWarnings:0,pageErrors:0,blocked:0,http:[],failed:[]};
      try {
        await context.route('**/*',route=>{if(!allowedURL(route.request().url())){health.blocked++;return route.abort('blockedbyclient');}return route.continue();});
        await context.routeWebSocket('**/*',socket=>{health.blocked++;socket.close();});
        const page=await context.newPage();page.setDefaultTimeout(10000);
        page.on('console',message=>{if(message.type()==='error')health.consoleErrors++;if(message.type()==='warning')health.consoleWarnings++;});
        page.on('pageerror',()=>{health.pageErrors++;});
        page.on('response',response=>{if(response.status()>=400)health.http.push({path:allowedURL(response.url())?new URL(response.url()).pathname:'<rejected>',status:response.status()});});
        page.on('requestfailed',request=>{health.failed.push({path:allowedURL(request.url())?new URL(request.url()).pathname:'<rejected>'});});
        const response=await page.goto(ORIGIN+spec.path,{waitUntil:'networkidle',timeout:15000});
        assert(response.status()===200&&page.url()===ORIGIN+spec.path,'REVIEW_PAGE_IDENTITY');
        assert(await page.locator('h1').textContent()===spec.heading,'REVIEW_PAGE_HEADING');
        if(spec.rows!==undefined)assert(await page.locator('tbody tr').count()===spec.rows,'REVIEW_PAGE_ROWS');
        if(spec.text)assert(await page.getByText(spec.text,{exact:true}).count()===1,'REVIEW_EMPTY_STATE');
        assert(await page.evaluate(values=>values.every(secret=>!document.body.innerText.includes(secret)),secrets),'REVIEW_SCREENSHOT_SECRET');
        const geometry=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth,regions:[...document.querySelectorAll('.content,.panel,.form-grid,table,.sidebar')].map((el,index)=>({index,tag:el.tagName,kind:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))}));
        if(tableReadability)geometry.tables=await page.evaluate(()=>[...document.querySelectorAll('.table-scroll')].map(region=>({name:region.getAttribute('aria-label'),clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,tableWidth:region.querySelector('table').getBoundingClientRect().width,rows:[...region.querySelectorAll('tbody tr')].map(row=>({height:row.getBoundingClientRect().height,cells:[...row.children].map(cell=>({width:cell.getBoundingClientRect().width,height:cell.getBoundingClientRect().height,actions:cell.classList.contains('actions')}))}))})));
        const axe=await new AxeBuilder({page}).analyze();
        const summary=items=>items.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length,targets:nodes.flatMap(node=>node.target).filter(target=>typeof target==='string'&&!secrets.some(secret=>target.includes(secret)))}));
        let screenshot=null;
        if(images){const filename=spec.id+'-'+viewport.name+'.png';await page.screenshot({path:join(output,filename),fullPage:true});const bytes=await readFile(join(output,filename));screenshot={file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};}
        result.captures.push({page:spec.id,path:spec.path,heading:spec.heading,viewport,status:200,geometry,health,axe:{violations:summary(axe.violations),incomplete:summary(axe.incomplete)},screenshot});
        if(tableReadability){
          assert(geometry.tables.length>0,'REVIEW_DATA_TABLE_MISSING');
          for(const table of geometry.tables){
            assert(table.tableWidth>=767&&table.rows.length>0,'REVIEW_TABLE_READABLE_WIDTH');
            for(const row of table.rows){
              assert(row.height>0&&row.height<=320,'REVIEW_SYNTHETIC_ROW_TOO_TALL');
              assert(row.cells.every(cell=>cell.width>=71)&&row.cells[0].width>=191,'REVIEW_TABLE_CELL_READABILITY');
              if(['Connections table','Routes table'].includes(table.name))assert(row.cells[2].width>=319,'REVIEW_LONG_TEXT_COLUMN_WIDTH');
              if(table.name==='Recent usage table')assert(row.cells[0].width>=223&&row.cells[2].width>=223,'REVIEW_USAGE_ID_WIDTH');
              if(table.name==='API keys table')assert(row.cells[3].width>=223,'REVIEW_KEY_DATE_WIDTH');
              assert(row.cells.filter(cell=>cell.actions).every(cell=>cell.width>=159),'REVIEW_ACTION_COLUMN_WIDTH');
            }
          }
        }
        assert(health.blocked===0&&health.pageErrors===0,'REVIEW_BASELINE_UNEXPECTED_ACTIVITY');
        if(strict){assert(geometry.documentWidth<=geometry.viewportWidth+1,'REVIEW_PAGE_OVERFLOW');assert(!axe.violations.some(row=>['critical','serious'].includes(row.impact)),'REVIEW_AXE_SERIOUS');assert(health.consoleErrors===0&&health.consoleWarnings===0&&!health.http.length&&!health.failed.length,'REVIEW_NORMAL_HEALTH');}
      } finally {await context.close();}
    }
  }
}
