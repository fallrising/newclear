import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ORIGIN,bounded} from './guards.mjs';
import {viewports} from './browser-baseline.mjs';

export async function sharedCapture(component,state,storage,pages,output,result,check,register) {
  const repo=resolve(component,'../..');const auth=join(state,'auth.storage.json');
  await writeFile(auth,JSON.stringify(storage),{flag:'wx',mode:0o600});
  const targets={project:'pokercase',verified:false,locale:'zh-TW',colorSchemes:['dark'],viewports,apps:[
    {name:'login',kind:'server',baseUrl:ORIGIN,pages:[{id:'login',path:'/admin/login',waitFor:'form[action="/admin/login"] input[name="token"]',timeoutMs:10000}]},
    {name:'admin',kind:'server',baseUrl:ORIGIN,storageState:auth,pages:pages.map(page=>({id:page.id,path:page.path,waitFor:page.rows?'tbody tr:nth-child('+page.rows+')':'main h1',timeoutMs:10000}))},
  ]};
  // Usage has two tables (one daily + two events); its total row assertion is in the strict companion.
  targets.apps[1].pages.find(page=>page.id==='usage').waitFor='section:last-child tbody tr:nth-child(2)';
  const target=join(state,'capture-targets.json');await writeFile(target,JSON.stringify(targets),{flag:'wx',mode:0o600});
  const script=join(repo,'docs/fe-review/capture.mjs');result.sharedToolSHA256=createHash('sha256').update(await readFile(script)).digest('hex');
  const out=join(output,'shared');
  async function run(args,name,timeout){
    check();const log=await open(join(state,name+'.log'),'wx',0o600);
    try{
      const child=spawn(process.execPath,[script,target,...args,'--out',out],{cwd:repo,env:{PATH:process.env.PATH,TMPDIR:state,PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:process.env.CHROMIUM_EXECUTABLE},detached:true,stdio:['ignore',log.fd,log.fd]});register(child);
      const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('REVIEW_CAPTURE_SPAWN')));child.once('exit',(code,signal)=>resolve({code,signal}));});
      const exit=await bounded(()=>done,timeout);assert(exit.code===0&&exit.signal===null,'REVIEW_SHARED_EXIT');return exit;
    }finally{await log.close();}
  }
  result.sharedDryRun=await run(['--dry-run'],'shared-dryrun',5000);
  result.sharedExit=await run([],'shared-actual',180000);
  const bytes=await readFile(join(out,'capture.json'));const raw=JSON.parse(bytes);result.sharedManifestSHA256=createHash('sha256').update(bytes).digest('hex');
  const expected=new Map(targets.apps.flatMap(app=>app.pages.flatMap(page=>viewports.map(viewport=>[app.name+'/'+page.id+'/'+viewport.name+'/dark',{path:page.path,width:viewport.width}]))));
  assert(raw.results.length===24&&expected.size===24,'REVIEW_SHARED_COUNT');const seen=new Set();result.shared=[];
  for(const row of raw.results){
    const key=row.app+'/'+row.page+'/'+row.viewport+'/'+row.colorScheme;assert(expected.has(key)&&!seen.has(key),'REVIEW_SHARED_KEY');seen.add(key);
    const item=expected.get(key);assert(row.status===200&&row.url===ORIGIN+item.path&&!row.error,'REVIEW_SHARED_IDENTITY');
    const name='screenshots/'+row.app+'__'+row.page+'__'+row.viewport+'__dark.png';assert(row.screenshot===name,'REVIEW_SHARED_IMAGE');
    const png=await readFile(join(out,name));
    result.shared.push({key,status:200,path:item.path,horizontalOverflow:row.horizontalOverflow,consoleEvents:row.consoleErrors.length,pageErrors:row.pageErrors.length,failedRequests:row.failedRequests.length,screenshot:{file:'shared/'+name,sha256:createHash('sha256').update(png).digest('hex'),width:png.readUInt32BE(16),height:png.readUInt32BE(20)}});
    assert(png.readUInt32BE(16)===item.width&&!row.horizontalOverflow,'REVIEW_SHARED_OVERFLOW');
  }
  // Preserve all 24 records before rejecting an unknown health event.
  assert(result.shared.every(row=>row.consoleEvents===0&&row.pageErrors===0&&row.failedRequests===0),'REVIEW_SHARED_HEALTH');
}
