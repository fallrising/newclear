/** T-0433 capture-001: the unchanged shared docs/fe-review/capture.mjs against private targets (SPEC-T006R-shared-capture); static bootstrap page only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {createFixture,fixedAssets} from './fixture.mjs';
import {createTransport} from './transport.mjs';
import {Lifecycle,privateState,bounded} from './lifecycle.mjs';
import {installFreshTrust} from './trust.mjs';
import {canaryScan} from './journeys-browser-verdicts.mjs';
import {origin,outDir,targetsVerdict,planVerdict,captureVerdict,pngSize} from './shared-capture-verdicts.mjs';
process.umask(0o077);
const expectedSources={"fixture.mjs":"8c828b21eeb34563ef64c9b81a9bdfca4f9ab0146382c5e43416d560a706e9de","transport.mjs":"9167d04e5b4937ec1aca3a6788b27b6e9b358f738f516bb3861a9877049b988f","lifecycle.mjs":"7f3f1dcda77c0587d57d23a01d8a59567b02ce0bb5e5ef1a366d0783a8d838d9","trust.mjs":"1f5f0f31ad493ccc3866cc18967f237518ed9e798624aafff4344a36ada738f5","journeys-browser-verdicts.mjs":"f99cb2c43746a1f80672cdf7f2cc72becd0f3a90301536f38f4f9567a8be4e48","shared-capture-verdicts.mjs":"4dee667182d8e6c63c9f957154d0b2770ca0486593c717d72227d72698aba7ed","targets.json":"5aa2d64cc694ae398a2f008390ae8057eceb6c2356f7056c85828f2fc92433ce","../../../docs/fe-review/capture.mjs":"d00b6bf71cc68a7a540d0d832b58c9f971905848107d34f970530fe5fe2ba2ee","/":"dd5d6c2ebf00ecf46abaf929c2441f388e02ccee1b85135918d47e01a38e0b2f","/assets/p0-app.js":"a0dcb11ef6ca65c53f7010bd3af2e654de360d9f8d380876900393e14f6adab0","/assets/p0-client.js":"a7c0fe338f461175901d1758f6092da2e1a56f3061f538c4341753207aa57e8e","/assets/p0.css":"1d66f393e4adf2af7266a32feac6fbdb74980825ae0293cce0407607ab78ff8a"};
const life=new Lifecycle(),ports=[8443],sha=b=>createHash('sha256').update(b).digest('hex'),CAP=65536;
const captureScript='/work/docs/fe-review/capture.mjs',privateTargets='/state/targets.json';
const childEnv=Object.freeze({PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/ubuntu',PLAYWRIGHT_MODULE:'/review-tools/node_modules/playwright/index.mjs',AXE_PLAYWRIGHT_MODULE:'/review-tools/node_modules/@axe-core/playwright/dist/index.mjs',CHROMIUM_EXECUTABLE:'/ms-playwright/chromium-1243/chrome-linux64/chrome'});
const receipt={mode:'capture-001',scope:'unchanged shared docs/fe-review/capture.mjs against private targets on the review harness; static bootstrap page at three sizes; not canonical cells; candidate until independent actual review',passed:false,stage:'PRECONDITION',checks:{},sourceHashes:{}};
const handlers=['SIGTERM','SIGINT'].map(name=>[name,()=>life.cancel(name)]);for(const [name,fn]of handlers)process.on(name,fn);const timeout=setTimeout(()=>life.cancel('deadline'),150000);
const safeError=e=>/^REVIEW_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e?.name==='AssertionError'?'ASSERTION_FAILED':'UNCLASSIFIED';
let active=null;
// W05: no shell, fixed argv, minimal environment, capped output, SIGKILL at the limit.
function runChild(args,limitMs){life.check();return new Promise(resolve=>{const child=spawn(process.execPath,[captureScript,privateTargets,...args,'--out',outDir],{cwd:'/work',env:childEnv,stdio:['ignore','pipe','pipe']});active=child;
 const out={stdout:'',stderr:'',truncated:false,timedOut:false};const take=key=>chunk=>{const room=CAP-out[key].length;if(chunk.length>room)out.truncated=true;out[key]+=chunk.toString('utf8',0,Math.max(0,Math.min(room,chunk.length)));};
 child.stdout.on('data',take('stdout'));child.stderr.on('data',take('stderr'));const timer=setTimeout(()=>{out.timedOut=true;child.kill('SIGKILL');},limitMs);
 child.on('error',()=>{out.spawnError=true;});child.on('close',(code,signal)=>{clearTimeout(timer);active=null;resolve({...out,code,signal});});});}
async function main(){
 assert.equal(process.getuid(),1000);assert.equal(homedir(),'/home/ubuntu');assert(!Object.keys(process.env).some(k=>/^(CODEBOX_|CODEX_|OPENAI_|ANTHROPIC_)/.test(k)),'REVIEW_INHERITED_PROVIDER');await privateState('/state');life.check();const output=lstatSync('/output');assert(output.isDirectory()&&!output.isSymbolicLink()&&output.uid===1000&&(output.mode&0o777)===0o700);assert(readdirSync('/output').length===0,'REVIEW_OUTPUT_NOT_EMPTY');
 for(const file of Object.keys(expectedSources).filter(p=>!p.startsWith('/')))receipt.sourceHashes[file]=sha(readFileSync(new URL(file,import.meta.url)));for(const[path,asset]of fixedAssets())receipt.sourceHashes[path]=sha(asset.body);for(const[file,hash]of Object.entries(expectedSources))assert.equal(receipt.sourceHashes[file],hash,'REVIEW_SOURCE_DRIFT');receipt.sourceHashes['shared-capture.mjs']=sha(readFileSync(new URL('shared-capture.mjs',import.meta.url)));
 assert.equal(new URL('../../../docs/fe-review/capture.mjs',import.meta.url).pathname,captureScript,'REVIEW_CAPTURE_PATH');
 const require=createRequire('/review-tools/node_modules/playwright/package.json');assert.equal(require('playwright/package.json').version,'1.63.0');assert.equal(require('@axe-core/playwright/package.json').version,'4.13.0');assert.equal(process.version,'v24.18.0');const {wsServer:WebSocketServer}=require('playwright-core/lib/utilsBundle');receipt.tools={node:process.version,playwright:'1.63.0',axePlaywright:'4.13.0'};life.check();
 // W04: the repository targets must match this runtime; the private copy is byte-identical.
 const targetsBytes=readFileSync(new URL('targets.json',import.meta.url));const targets=targetsVerdict(JSON.parse(targetsBytes));receipt.checks.targets=targets;assert(targets.passed,'REVIEW_TARGETS_MISMATCH');writeFileSync(privateTargets,targetsBytes,{flag:'wx',mode:0o600});
 const tls=installFreshTrust(life,receipt);life.check();receipt.stage='SERVE';
 const bearer=randomBytes(32).toString('base64url'),fixture=createFixture({origin,scenario:'bootstrap-empty',bearer});await life.acquire('fixture',()=>fixture,f=>f.dispose());
 const transport=await life.acquire('https',()=>createTransport({origin,fixture,...tls,WebSocketServer}),t=>t.close());await transport.listen();life.check();
 receipt.stage='PLAN';const plan=await runChild(['--dry-run'],10000);life.check();
 receipt.checks.plan={code:plan.code,signal:plan.signal,timedOut:plan.timedOut,truncated:plan.truncated,stdoutLines:plan.stdout.split('\n').filter(Boolean),stderrBytes:Buffer.byteLength(plan.stderr),stderrHead:plan.stderr.slice(0,2048),outputExists:existsSync(outDir)};
 receipt.checks.plan.verdict=planVerdict({...plan,outputExists:receipt.checks.plan.outputExists});
 receipt.stage='CAPTURE';const run=await runChild([],90000);life.check();
 let manifest=null,manifestText='';try{manifestText=readFileSync(outDir+'/capture.json','utf8');manifest=JSON.parse(manifestText);}catch{}
 const pngs={};for(const r of manifest?.results??[]){if(typeof r.screenshot!=='string'||!/^screenshots\/[A-Za-z0-9._-]+\.png$/.test(r.screenshot))continue;try{const bytes=readFileSync(outDir+'/'+r.screenshot);pngs[r.screenshot]={...pngSize(bytes),sha256:sha(bytes),bytes:bytes.length};}catch{}}
 const counters={transport:transport.summary(),fixture:fixture.summary()};
 receipt.checks.capture={code:run.code,signal:run.signal,timedOut:run.timedOut,truncated:run.truncated,stdoutLines:run.stdout.split('\n').filter(Boolean),stderrBytes:Buffer.byteLength(run.stderr),stderrHead:run.stderr.slice(0,2048),manifestSha256:manifestText?sha(manifestText):null,
  results:(manifest?.results??[]).map(r=>({viewport:r.viewport,status:r.status,title:r.title,horizontalOverflow:r.horizontalOverflow,error:'error' in r,axeViolations:r.axeViolations?.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes}))??null,consoleErrors:r.consoleErrors?.length??null,pageErrors:r.pageErrors?.length??null,failedRequests:r.failedRequests?.length??null,screenshot:r.screenshot})),pngs,...counters};
 receipt.checks.capture.verdict=captureVerdict({...run,manifest,pngs,...counters});
 // D04-style canary: only which source holds the bearer, never the value.
 receipt.checks.canary=canaryScan({planStdout:plan.stdout,planStderr:plan.stderr,captureStdout:run.stdout,captureStderr:run.stderr,manifest:manifestText},[bearer]);
 receipt.verdicts={targets:targets.passed,plan:receipt.checks.plan.verdict.passed,capture:receipt.checks.capture.verdict.passed,canary:receipt.checks.canary.length===0};receipt.stage='COMPLETE';receipt.passed=Object.values(receipt.verdicts).every(Boolean);
}
try{await life.run(main);}catch(error){receipt.failure=safeError(error);}finally{
 clearTimeout(timeout);if(active){active.kill('SIGKILL');receipt.childKilled=true;}receipt.cleanup=await life.finish();
 const absent=port=>bounded(()=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});}),1500,'listener').catch(()=>false);
 receipt.cleanup.listenersAbsent=Object.fromEntries(await Promise.all(ports.map(async p=>[p,await absent(p)])));
 receipt.passed=receipt.passed&&!receipt.childKilled&&!receipt.cleanup.cancelled&&receipt.cleanup.drainComplete&&receipt.cleanup.resources.every(r=>r.closed)&&Object.values(receipt.cleanup.listenersAbsent).every(Boolean);for(const [name,fn]of handlers)process.off(name,fn);writeFileSync('/output/result.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:receipt.passed,stage:receipt.stage,verdicts:receipt.verdicts??null,failure:receipt.failure??null,cleanup:receipt.cleanup}));process.exit(receipt.passed?0:1);
}
