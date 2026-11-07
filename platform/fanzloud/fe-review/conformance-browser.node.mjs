import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixedAssets} from './fixture.mjs';
import {netError,tlsVerdict,r06Verdict,traversalVerdict,nameVerdict,scrollVerdict,frameRecord} from './conformance-browser-verdicts.mjs';

// SPEC-T006R-harness-repair-c2 T03: pure tests for the C2 driver's verdicts, pins and boundaries.
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const driver=read('conformance-browser.mjs');
const api='/api/p0/v1';

test('TLS verdict accepts the exact refusals and rejects each failed condition',()=>{
 const good={positive:{status:200,streamConnected:true},wrongName:{error:'ERR_CERT_COMMON_NAME_INVALID',requests:0},untrusted:{error:'ERR_CERT_AUTHORITY_INVALID',requests:0},plain:{error:'ERR_EMPTY_RESPONSE',status:null,finalURL:null,requests:0}};
 assert.deepEqual(tlsVerdict(good),{passed:true,reasons:[]});
 assert.equal(netError('page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://127.0.0.1:8445/'),'ERR_CERT_AUTHORITY_INVALID');assert.equal(netError('Timeout'),'OTHER');
 const bad=[[{positive:{status:200,streamConnected:false}},'POSITIVE'],[{wrongName:{error:'ERR_CERT_AUTHORITY_INVALID',requests:0}},'WRONG_NAME'],[{wrongName:{error:'ERR_CERT_COMMON_NAME_INVALID',requests:1}},'WRONG_NAME'],[{untrusted:{error:'ERR_CERT_COMMON_NAME_INVALID',requests:0}},'UNTRUSTED_CA'],[{plain:{error:null,status:200,finalURL:'http://127.0.0.1:8443/',requests:0}},'PLAIN_HTTP'],[{plain:{error:'ERR_EMPTY_RESPONSE',requests:1}},'PLAIN_HTTP'],[{plain:undefined},'PLAIN_HTTP']];
 for(const[change,reason]of bad)assert.deepEqual(tlsVerdict({...good,...change}).reasons,[reason],reason);
 assert.equal(tlsVerdict({...good,plain:{error:null,status:200,finalURL:'https://127.0.0.1:8443/',requests:0}}).passed,true,'an upgraded navigation is not plain HTTP being served');
});

test('R06 verdict requires one bootstrap and turn, GETs after submit, 17 fixture turns and a 68 resubscribe after one exact gap',()=>{
 const requests=[{method:'GET',path:'/',afterSubmit:false},{method:'POST',path:api+'/operator/session',afterSubmit:false},{method:'POST',path:api+'/session/turns',afterSubmit:false},{method:'GET',path:api+'/session',afterSubmit:true}];
 const ws=[{dir:'sent',type:'subscribe',after_seq:0},{dir:'received',type:'replay_end'},{dir:'sent',type:'subscribe',after_seq:2},{dir:'received',type:'error',code:'history_gap',oldest_available:5,latest_available:68},{dir:'sent',type:'subscribe',after_seq:68}];
 const good={requests,ws,fixtureTurns:17};assert.deepEqual(r06Verdict(good),{passed:true,reasons:[]});
 const cases=[[{requests:[...requests,{method:'POST',path:api+'/session/turns',afterSubmit:true}]},['TURN_COUNT','MUTATION_AFTER_SUBMIT']],[{requests:[...requests,{method:'POST',path:api+'/session/cancel',afterSubmit:true}]},['MUTATION_AFTER_SUBMIT']],[{requests:requests.filter(r=>r.path!==api+'/operator/session')},['BOOTSTRAP_COUNT']],[{fixtureTurns:18},['FIXTURE_TURNS']],[{ws:ws.slice(0,3)},['GAP_FRAME']],[{ws:[...ws.slice(0,4),{dir:'sent',type:'subscribe',after_seq:2}]},['RESUBSCRIBE_CURSOR']],[{ws:ws.map(f=>f.code?{...f,oldest_available:4}:f)},['GAP_FRAME']],[{ws:[...ws,ws[3]]},['GAP_FRAME']]];
 for(const[change,reasons]of cases)assert.deepEqual(r06Verdict({...good,...change}).reasons,reasons,JSON.stringify(reasons));
});

test('traversal, name and scroll verdicts reject each failed condition',()=>{
 const step=id=>({id,focusVisible:true,outlineStyle:'auto',outlineWidth:1});
 assert.equal(traversalVerdict([step('prompt'),step('event-list'),step('diff-output')]).passed,true);
 assert.deepEqual(traversalVerdict([step('event-list')]).reasons,['NOT_REACHED_diff-output']);
 assert.deepEqual(traversalVerdict([step('event-list'),{...step('diff-output'),focusVisible:false}]).reasons,['NO_FOCUS_RING_diff-output']);
 assert.deepEqual(traversalVerdict([{...step('event-list'),outlineStyle:'none'},{...step('diff-output'),outlineWidth:0}]).reasons,['NO_FOCUS_RING_event-list','NO_FOCUS_RING_diff-output']);
 const region={id:'diff-output',expected:'Final diff',playwrightId:'diff-output',axRole:'region',axName:'Final diff'};
 assert.equal(nameVerdict([region]).passed,true);
 assert.deepEqual(nameVerdict([{...region,playwrightId:null}]).reasons,['PLAYWRIGHT_NAME_diff-output']);
 assert.deepEqual(nameVerdict([{...region,axName:''}]).reasons,['AX_NAME_diff-output']);
 assert.deepEqual(nameVerdict([{...region,axRole:'generic'}]).reasons,['AX_NAME_diff-output']);
 assert.deepEqual(nameVerdict([{...region,expected:'',axName:''}]).reasons,['NO_HEADING_diff-output']);
 assert.equal(scrollVerdict({overflowing:true,before:0,afterArrow:40,afterPage:300}).passed,true);
 assert.deepEqual(scrollVerdict({overflowing:false,before:0,afterArrow:0,afterPage:0}).reasons,['NOT_OVERFLOWING']);
 assert.deepEqual(scrollVerdict({overflowing:true,before:0,afterArrow:0,afterPage:0}).reasons,['ARROW_DID_NOT_SCROLL','PAGE_DID_NOT_SCROLL']);
 assert.deepEqual(scrollVerdict({overflowing:true,before:0,afterArrow:40,afterPage:40}).reasons,['PAGE_DID_NOT_SCROLL']);
});

test('frame records keep only type, error code and numeric fields',()=>{
 const sid='11111111-2222-4333-8444-555555555555';
 assert.deepEqual(frameRecord('sent',JSON.stringify({type:'subscribe',protocol_version:1,session_id:sid,after_seq:2})),{dir:'sent',type:'subscribe',after_seq:2});
 assert.deepEqual(frameRecord('received',JSON.stringify({type:'event',envelope:{schema_version:1,session_id:sid,seq:3,turn_id:null,payload:{type:'turn_accepted',prompt:'secret'}}})),{dir:'received',type:'event',seq:3});
 assert.deepEqual(frameRecord('received',JSON.stringify({type:'error',code:'history_gap',message:'requested session history is no longer retained',oldest_available:5,latest_available:68})),{dir:'received',type:'error',code:'history_gap',oldest_available:5,latest_available:68});
 assert.deepEqual(frameRecord('received','{'),{dir:'received',type:'UNPARSEABLE'});
 assert.deepEqual(frameRecord('received',JSON.stringify({type:'error',code:'Bearer secret value'})),{dir:'received',type:'error'});
});

test('driver pins equal the current harness, support files and served assets, except the historical transport pin',()=>{
 const pins=JSON.parse(driver.match(/const expectedSources=(\{[^}]*\})/)[1]);const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 // SPEC-T006R-focused-journeys H06: C2 ran on this transport.mjs; the journey seams changed the current file after it.
 const historical={'transport.mjs':'fcc6aba78681b3d4446d6b71ef8f20d9fa77d83dc0c4dd246c254c523bab10d4','/assets/p0-client.js':'a7c0fe338f461175901d1758f6092da2e1a56f3061f538c4341753207aa57e8e','/assets/p0.css':'1d66f393e4adf2af7266a32feac6fbdb74980825ae0293cce0407607ab78ff8a'}; // T-0438 changed the two assets after this run
 for(const[name,hash]of Object.entries(historical)){assert.equal(pins[name],hash,name);assert.notEqual(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);delete pins[name];}
 assert.deepEqual(Object.keys(pins).sort(),['/','/assets/p0-app.js','baseline-support.mjs','conformance-browser-verdicts.mjs','fixture.mjs','lifecycle.mjs','remaining-support.mjs','trust.mjs']);
 for(const[name,hash]of Object.entries(pins))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('canonical runners are unchanged and the driver writes no canonical cell or earlier run',()=>{
 const runners={'remaining-baseline.mjs':'10d206062a42e7b62cb629b2998d7bbf33c8f4abfbcfa1f1f95d6d7e6e04f5ba','remaining-v7-baseline.mjs':'bc47bd3cb8f4e7a7c57514fbc755bde006dc4e09707247df95a2ff1781fd5753'};
 for(const[name,hash]of Object.entries(runners))assert.equal(sha(readFileSync(new URL(name,import.meta.url))),hash,name);
 for(const forbidden of ['/previous','remaining-accepted.json','captures.push','runs/','allHeaders(','.body()','postData','headers()'])assert.equal(driver.includes(forbidden),false,forbidden);
 assert.match(driver,/writeFileSync\('\/output\/result\.json'/);assert.match(driver,/mode:'conformance-c2'/);assert.match(driver,/not canonical cells/);
 for(const port of ['8443','8444','8445'])assert(driver.includes(port),port);
});
