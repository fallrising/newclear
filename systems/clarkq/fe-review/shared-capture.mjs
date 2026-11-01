import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ORIGIN,bounded} from './guards.mjs';
import {viewports} from './baseline.mjs';

export async function reuseShared(component,result) {
  const priorDir=join(component,'fe-review/runs/final-001');
  const receiptBytes=await readFile(join(priorDir,'result.json'));
  const rawBytes=await readFile(join(priorDir,'shared/capture.json'));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert(hash(receiptBytes)==='7ad06de47958e1650f103de2794e8b016dc17ed7ef6d9a438d0be703ea9261f4','REVIEW_PRIOR_RECEIPT_CHANGED');
  assert(hash(rawBytes)==='a40bb7b56af2332cb8d8659c038504c3d24457923279397a5fcb3597dbc21b4f','REVIEW_PRIOR_MANIFEST_CHANGED');
  const prior=JSON.parse(receiptBytes);const raw=JSON.parse(rawBytes);
  assert(prior.failure.code==='REVIEW_SHARED_HEALTH'&&prior.sharedExit.code===0&&prior.sharedDryRun.code===0,'REVIEW_PRIOR_SCOPE');
  assert(result.binarySHA256===prior.binarySHA256&&result.sourceHashes['internal/ui/index.html']===prior.sourceHashes['internal/ui/index.html']&&result.sourceHashes['fe-review/api-fixture.mjs']===prior.sourceHashes['fe-review/api-fixture.mjs'],'REVIEW_REUSE_SOURCE_CHANGED');
  assert.deepEqual(result.fixture,prior.fixture,'REVIEW_REUSE_FIXTURE_CHANGED');
  assert(hash(await readFile(resolve(component,'../../docs/fe-review/capture.mjs')))===prior.sharedCaptureSourceSHA256,'REVIEW_SHARED_TOOL_CHANGED');
  assert(raw.results.length===3,'REVIEW_SHARED_COUNT');
  const pinnedPNGs={desktop:'f874ca61c14ea8cc19cc7437d7da202c0a04fcf90ad3594d1f936bd7cc21bbc4',tablet:'43477d71d9ab58a6d2989e0bb8f1cb59f3dda834b71ce2ccd85eae9f3c7252d5',mobile:'3fc0b2265974243cbd602ea58841ca7761c0fb5bfdf8d11597b38e318c080982'};
  const keys=new Set();const artifacts=[];
  for(const record of raw.results) {
    assert(record.app==='admin'&&record.page==='ui'&&record.colorScheme==='dark'&&viewports.some(v=>v.name===record.viewport),'REVIEW_SHARED_KEY');
    const key=record.app+'/'+record.page+'/'+record.viewport+'/'+record.colorScheme;
    assert(!keys.has(key),'REVIEW_SHARED_DUPLICATE');keys.add(key);
    const file='screenshots/admin__ui__'+record.viewport+'__dark.png';
    assert(record.screenshot===file&&record.url===ORIGIN+'/ui/'&&record.status===200&&!record.error&&!record.horizontalOverflow,'REVIEW_PRIOR_GEOMETRY');
    assert(record.pageErrors.length===0&&record.failedRequests.length===0,'REVIEW_PRIOR_UNEXPECTED_ERROR');
    assert(record.consoleErrors.length===(record.viewport==='desktop'?1:0),'REVIEW_PRIOR_CONSOLE_CHANGED');
    const bytes=await readFile(join(priorDir,'shared',file));
    assert(hash(bytes)===pinnedPNGs[record.viewport],'REVIEW_PRIOR_PNG_CHANGED');
    assert(bytes.readUInt32BE(16)===viewports.find(v=>v.name===record.viewport).width,'REVIEW_PRIOR_WIDTH');
    artifacts.push({key,status:200,horizontalOverflow:false,consoleEvents:record.consoleErrors.length,screenshot:{file:'../final-001/shared/'+file,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}});
  }
  result.reusedShared={attempt:'final-001',receiptSHA256:hash(receiptBytes),manifestSHA256:hash(rawBytes),sourceFixtureBinaryEqual:true,geometryKeys:artifacts,originalHealth:'failed; unchanged; fresh desktop diagnostic required',newSharedCaptureRun:false};
}

export async function sharedCapture(key,component,state,output,result,check,register) {
  const repo=resolve(component,'../..');
  const storage=join(state,'auth.storage.json');
  await writeFile(storage,JSON.stringify({cookies:[],origins:[{origin:ORIGIN,localStorage:[{name:'clarkq.base',value:ORIGIN},{name:'clarkq.apiKey',value:key},{name:'clarkq.tenant',value:''}]}]}),{flag:'wx',mode:0o600});
  const targets=JSON.parse(await readFile(join(component,'fe-review/targets.json'),'utf8'));
  targets.viewports=viewports;targets.colorSchemes=['dark'];
  targets.apps=[{name:'admin',kind:'server',cwd:'systems/clarkq',baseUrl:ORIGIN,ready:'/ui/',storageState:storage,pages:[{id:'ui',path:'/ui/',waitFor:'#queuesWrap tbody tr:nth-child(14) [data-act="use"]',timeoutMs:10000}]}];
  const targetFile=join(state,'capture-targets.json');await writeFile(targetFile,JSON.stringify(targets),{flag:'wx',mode:0o600});
  const capture=join(repo,'docs/fe-review/capture.mjs');
  result.sharedCaptureSourceSHA256=createHash('sha256').update(await readFile(capture)).digest('hex');
  async function run(args,name) {
    check();const log=await open(join(state,name+'.log'),'wx',0o600);
    try {
      const child=spawn(process.execPath,[capture,targetFile,...args],{cwd:repo,detached:true,env:{PATH:process.env.PATH,TMPDIR:state,PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:process.env.CHROMIUM_EXECUTABLE},stdio:['ignore',log.fd,log.fd]});
      register(child);
      const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('REVIEW_CAPTURE_SPAWN')));child.once('exit',(code,signal)=>resolve({code,signal}));});
      const exit=await bounded(()=>done,55000);assert(exit.code===0 && exit.signal===null,'REVIEW_SHARED_CAPTURE_EXIT');return exit;
    } finally {await log.close();}
  }
  const out=join(output,'shared');
  result.sharedDryRun=await run(['--dry-run','--out',out],'shared-dry-run');
  result.sharedExit=await run(['--out',out],'shared-actual');
  const rawBytes=await readFile(join(out,'capture.json'));const raw=JSON.parse(rawBytes);
  assert(raw.results.length===3,'REVIEW_SHARED_COUNT');
  const keys=new Set();result.shared=[];
  for(const record of raw.results) {
    const key=record.app+'/'+record.page+'/'+record.viewport+'/'+record.colorScheme;
    assert(!keys.has(key),'REVIEW_SHARED_DUPLICATE');keys.add(key);
    assert(record.app==='admin'&&record.page==='ui'&&record.colorScheme==='dark'&&viewports.some(v=>v.name===record.viewport),'REVIEW_SHARED_KEY');
    assert(record.url===ORIGIN+'/ui/'&&record.status===200&&!record.error&&record.title==='clarkQ Admin','REVIEW_SHARED_IDENTITY');
    const expected='screenshots/admin__ui__'+record.viewport+'__dark.png';assert(record.screenshot===expected,'REVIEW_SHARED_SCREENSHOT');
    const bytes=await readFile(join(out,record.screenshot));
    const item={key,status:record.status,requestedPath:'/ui/',title:record.title,horizontalOverflow:record.horizontalOverflow,consoleEvents:record.consoleErrors.length,pageErrors:record.pageErrors.length,failedRequests:record.failedRequests.length,screenshot:{file:'shared/'+expected,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}};
    result.shared.push(item);
    assert(!item.horizontalOverflow,'REVIEW_SHARED_OVERFLOW');
    assert(item.consoleEvents===0&&item.pageErrors===0&&item.failedRequests===0,'REVIEW_SHARED_HEALTH');
    assert(item.screenshot.width===viewports.find(v=>v.name===record.viewport).width,'REVIEW_SHARED_WIDTH');
  }
  result.sharedManifestSHA256=createHash('sha256').update(rawBytes).digest('hex');
}
