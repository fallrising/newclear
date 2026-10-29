import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fixedAssets} from './fixture.mjs';
import {origin,outDir,viewports,planLines,bootstrapConsole,bootstrapFailed,targetsVerdict,planVerdict,captureVerdict,pngSize} from './shared-capture-verdicts.mjs';

// SPEC-T006R-shared-capture V01 and tests: each verdict passes its good row and fails, with one exact reason, on each broken condition.
const sha=b=>createHash('sha256').update(b).digest('hex');
function each(verdict,good,bad){assert.deepEqual(verdict(good),{passed:true,reasons:[]});for(const[name,change,reason]of bad)assert.deepEqual(verdict({...good,...change(structuredClone(good))}).reasons,[reason],name);}
const targets=()=>JSON.parse(readFileSync(new URL('targets.json',import.meta.url),'utf8'));

test('repository targets match the review runtime and stay unverified before capture-001',()=>{
 const t=targets();assert.equal(t.verified,false);assert.equal(t.apps[0].baseUrl,origin);
 each(targetsVerdict,t,[
  ['light scheme',()=>({colorSchemes:['dark','light']}),'TARGETS_SHAPE'],
  ['custom viewports',()=>({viewports:[{name:'desktop',width:1440,height:900}]}),'TARGETS_SHAPE'],
  ['old port',g=>({apps:[{...g.apps[0],baseUrl:'https://127.0.0.1:18443'}]}),'TARGETS_APP'],
  ['start command',g=>({apps:[{...g.apps[0],start:'cargo run'}]}),'TARGETS_APP'],
  ['storage state',g=>({apps:[{...g.apps[0],storageState:'/state/auth.json'}]}),'TARGETS_APP'],
  ['second page',g=>({apps:[{...g.apps[0],pages:[...g.apps[0].pages,{id:'login',path:'/login'}]}]}),'TARGETS_PAGES'],
  ['page wait',g=>({apps:[{...g.apps[0],pages:[{...g.apps[0].pages[0],settleMs:500}]}]}),'TARGETS_PAGES'],
 ]);
});

test('the unchanged shared script prints exactly the expected plan for the repository targets',()=>{
 // Dry run only: capture.mjs returns before resolving Playwright or launching a browser.
 const stdout=execFileSync(process.execPath,['../../docs/fe-review/capture.mjs','fe-review/targets.json','--dry-run','--out',outDir],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});
 assert.deepEqual(stdout.split('\n').filter(Boolean),[...planLines]);
});

test('plan verdict needs the exact three lines, exit 0, no stderr and no output folder',()=>{
 each(planVerdict,{code:0,stdout:planLines.join('\n')+'\n',stderr:'',outputExists:false},[
  ['exit',()=>({code:2}),'EXIT'],['stderr',()=>({stderr:'warning\n'}),'STDERR'],
  ['other port',()=>({stdout:planLines.join('\n').replace('8443','18443')}),'PLAN'],['missing line',()=>({stdout:planLines.slice(0,2).join('\n')}),'PLAN'],
  ['output written',()=>({outputExists:true}),'OUTPUT_WRITTEN'],
 ]);
});

const record=([name],i)=>({app:'control-plane',page:'home',url:origin+'/',viewport:name,colorScheme:'dark',screenshot:`screenshots/control-plane__home__${name}__dark.png`,status:200,loadMs:300,title:'Codebox operator',horizontalOverflow:false,...(i===0?{axeViolations:[{id:'region',impact:'moderate',nodes:1,help:'x'}]}:{}),consoleErrors:[bootstrapConsole],pageErrors:[],failedRequests:[bootstrapFailed]});
const goodCapture=()=>({code:0,stderr:'',stdout:viewports.map(([n])=>`ok   control-plane home ${n} dark`).join('\n')+'\nwrote ../output/capture/capture.json\n',
 manifest:{project:'fanzloud',axe:true,results:viewports.map(record)},pngs:Object.fromEntries(viewports.map(([n,w,h])=>[`screenshots/control-plane__home__${n}__dark.png`,{width:w,height:h+400}])),
 transport:{requests:15,unknownRequests:0,upgrades:0,rejectedUpgrades:0},fixture:{effects:0,turnStarts:0,counts:{'GET /api/p0/v1/session':3}}});
const at=(g,i,change)=>({manifest:{...g.manifest,results:g.manifest.results.map((r,j)=>j===i?{...r,...change}:r)}});

test('capture verdict accepts only the exact static bootstrap capture at three sizes',()=>{
 each(captureVerdict,goodCapture(),[
  ['exit',()=>({code:1}),'EXIT'],['stderr',()=>({stderr:'x'}),'STDERR'],
  ['fail line',g=>({stdout:g.stdout.replace('ok   control-plane home tablet dark','FAIL control-plane home tablet dark')}),'STDOUT'],
  ['order',g=>({stdout:g.stdout.replace('desktop','DESK').replace('mobile','desktop').replace('DESK','mobile')}),'STDOUT'],
  ['no wrote line',g=>({stdout:g.stdout.replace(/wrote .*\n/,'')}),'STDOUT'],
  ['axe missing',g=>({manifest:{...g.manifest,axe:false}}),'MANIFEST'],['fourth result',g=>({manifest:{...g.manifest,results:[...g.manifest.results,g.manifest.results[0]]}}),'MANIFEST'],
  ['light',g=>at(g,1,{colorScheme:'light'}),'RECORD_TABLET'],['url',g=>at(g,2,{url:origin+'/login'}),'RECORD_MOBILE'],
  ['status',g=>at(g,0,{status:500}),'LOAD_DESKTOP'],['error',g=>at(g,1,{error:'TimeoutError'}),'LOAD_TABLET'],['title',g=>at(g,2,{title:''}),'LOAD_MOBILE'],['overflow',g=>at(g,2,{horizontalOverflow:true}),'LOAD_MOBILE'],
  ['page error',g=>at(g,0,{pageErrors:['Error: x']}),'HEALTH_DESKTOP'],['extra console',g=>at(g,1,{consoleErrors:[bootstrapConsole,bootstrapConsole]}),'HEALTH_TABLET'],
  ['other failure',g=>at(g,2,{failedRequests:[bootstrapFailed,`GET ${origin}/favicon.ico HTTP 404`]}),'HEALTH_MOBILE'],['no console',g=>at(g,0,{consoleErrors:[]}),'HEALTH_DESKTOP'],
  ['serious axe',g=>at(g,0,{axeViolations:[{id:'color-contrast',impact:'serious',nodes:1}]}),'AXE_DESKTOP'],['critical axe',g=>at(g,0,{axeViolations:[{id:'x',impact:'critical',nodes:1}]}),'AXE_DESKTOP'],
  ['no desktop axe',g=>{const r={...g.manifest.results[0]};delete r.axeViolations;return {manifest:{...g.manifest,results:[r,...g.manifest.results.slice(1)]}};},'AXE_DESKTOP'],['tablet axe',g=>at(g,1,{axeViolations:[]}),'AXE_TABLET'],
  ['png missing',g=>({pngs:{...g.pngs,'screenshots/control-plane__home__tablet__dark.png':undefined}}),'PNG_TABLET'],
  ['png width',g=>({pngs:{...g.pngs,'screenshots/control-plane__home__mobile__dark.png':{width:780,height:2000}}}),'PNG_MOBILE'],
  ['png short',g=>({pngs:{...g.pngs,'screenshots/control-plane__home__desktop__dark.png':{width:1440,height:899}}}),'PNG_DESKTOP'],
  ['extra request',g=>({transport:{...g.transport,requests:16}}),'TRANSPORT'],['unknown request',g=>({transport:{...g.transport,unknownRequests:1}}),'TRANSPORT'],['upgrade',g=>({transport:{...g.transport,upgrades:1}}),'TRANSPORT'],
  ['session count',g=>({fixture:{...g.fixture,counts:{'GET /api/p0/v1/session':4}}}),'FIXTURE'],['login read',g=>({fixture:{...g.fixture,counts:{...g.fixture.counts,'GET /api/p0/v1/login':1}}}),'FIXTURE'],['effect',g=>({fixture:{...g.fixture,effects:1}}),'FIXTURE'],
 ]);
});

test('PNG size reads the IHDR header and rejects anything else',()=>{
 const png=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12,'latin1');png.writeUInt32BE(1440,16);png.writeUInt32BE(1805,20);
 assert.deepEqual(pngSize(png),{width:1440,height:1805});assert.equal(pngSize(Buffer.from('GIF89a')),null);const bad=Buffer.from(png);bad.write('IDAT',12,'latin1');assert.equal(pngSize(bad),null);
});

test('wrapper pins equal the current harness, shared script, targets and served assets',()=>{
 const wrapper=readFileSync(new URL('shared-capture.mjs',import.meta.url),'utf8');const pins=JSON.parse(wrapper.match(/const expectedSources=(\{[^}]*\})/)[1]);const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 assert.deepEqual(Object.keys(pins).sort(),['../../../docs/fe-review/capture.mjs','/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css','fixture.mjs','journeys-browser-verdicts.mjs','lifecycle.mjs','shared-capture-verdicts.mjs','targets.json','transport.mjs','trust.mjs']);
 for(const[name,hash]of Object.entries(pins))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('wrapper keeps TLS validation, runs capture.mjs only by its fixed path and writes no canonical run',()=>{
 const wrapper=readFileSync(new URL('shared-capture.mjs',import.meta.url),'utf8');
 for(const forbidden of ['ignoreHTTPSErrors','shell:','exec(','execSync(','execFileSync(','route(','screenshot(','runs/','chromium.launch','NODE_TLS_REJECT_UNAUTHORIZED','storageState','holdNextResponse','injectFrame','overrideNextInstance','futureNextSubscribe'])assert.equal(wrapper.includes(forbidden),false,forbidden);
 assert.match(wrapper,/captureScript='\/work\/docs\/fe-review\/capture\.mjs'/);assert.equal(wrapper.match(/spawn\(/g).length,1);assert.match(wrapper,/spawn\(process\.execPath,\[captureScript,privateTargets,\.\.\.args,'--out',outDir\]/);
 assert.match(wrapper,/scenario:'bootstrap-empty'/);assert.match(wrapper,/ports=\[8443\]/);assert.match(wrapper,/setTimeout\(\(\)=>life\.cancel\('deadline'\),150000\)/);assert.match(wrapper,/runChild\(\['--dry-run'\],10000\)/);assert.match(wrapper,/runChild\(\[\],90000\)/);
 assert.match(wrapper,/writeFileSync\('\/output\/result\.json'/);assert.match(wrapper,/mode:'capture-001'/);assert.match(wrapper,/not canonical cells/);
});
