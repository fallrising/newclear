import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { rowsFor, validateEnvelope, formatCell } from './record-frontend.mjs';
const envelope = (command) => ({schemaVersion:1, measuredAt:'2026-10-05T00:00:00.000Z', gitCommit:'a'.repeat(40), dirty:true, node:'v24.18.0', chromium:'149.0', command, artifact:'sample.json', result:'passed'});
const id=(kind,n=1)=>`W5-${kind}-20261005-${String(n).padStart(2,'0')}`;
const bundle=()=>({...envelope('measure:bundle'),chromium:null,apps:['front','back','admin'].map((app,i)=>({recordId:id('BUNDLE',i+1),app,roots:['index.html'],closureKeys:['index.html'],files:[{file:'assets/main.js',gzipBytes:100}],total:100,limit:i===0?92160:163840,delta:100-(i===0?92160:163840),notes:''}))});
const targets=[['front','http://127.0.0.1:4173/album'],['front','http://127.0.0.1:4173/clinic'],['front','http://127.0.0.1:4173/projects'],['back','http://127.0.0.1:4174/'],['admin','http://127.0.0.1:4175/']];
const vitals=()=>({...envelope('measure:vitals'),samples:targets.flatMap(([surface,url])=>Array.from({length:5},(_,i)=>({surface,url,run:i+1,lcpMs:surface==='front'?1000:null,cls:0}))),summaries:targets.map(([surface,url],i)=>({recordId:id('VITALS',i+1),surface,url,viewport:'1280x800',networkCpu:'150ms/1.6Mbps/750Kbps/4x',runs:5,medianLcpMs:surface==='front'?1000:null,maxLcpMs:surface==='front'?1000:null,medianCls:0,maxCls:0,limits:'fixed W5 limits',routeLog:'routes.json',notes:''}))});
const mock=()=>({...envelope('e2e:mock'),recordId:id('MOCK'),repetition:1,playwright:'1.63.0',passed:93,total:93,axePassed:60,axeTotal:60,critical:0,serious:0,notes:''});
const visual=()=>({...envelope('test:visual'),recordId:id('VISUAL'),os:'ubuntu-24.04',desktopCases:52,mobileCases:15,stateCases:3,threshold:0.2,maxDiffPixelRatio:0.001,hashManifest:'hashes.json',authorization:'Owner-approved initial baseline',notes:''});
const real=()=>({...envelope('e2e'),recordId:id('REAL'),attempt:1,os:'linux',jdk:'25',dockerCompose:'v2',stack:'disposable W5',passed:14,total:14,durationSeconds:10,exitCode:0,failureClass:'',notes:''});
for (const [name,make,count,field] of [['bundle',bundle,3,'apps'],['vitals',vitals,5,'samples'],['mock',mock,1,'passed'],['visual',visual,1,'hashManifest'],['real',real,1,'exitCode']]) {
 test(`records ${name} valid schema`,()=>assert.equal(rowsFor(make()).length,count));
 test(`rejects ${name} missing field`,()=>{const x=make();delete x[field];assert.throws(()=>rowsFor(x));});
}
test('invalid envelopes are rejected',()=>{for(const patch of [{schemaVersion:2},{gitCommit:'main'},{dirty:'yes'},{command:'unknown'},{measuredAt:'invalid'},{artifact:'../secret'},{result:'skipped'}])assert.throws(()=>validateEnvelope({...envelope('e2e'),...patch}));});
test('requires exact row counts and sequential unique ids',()=>{const x=bundle();x.apps.pop();assert.throws(()=>rowsFor(x));const y=vitals();y.summaries[1].recordId=y.summaries[0].recordId;assert.throws(()=>rowsFor(y));const z=bundle();z.apps[1].recordId=id('BUNDLE',4);assert.throws(()=>rowsFor(z));});
test('rejects invented successful results and changed budgets',()=>{const x=bundle();x.apps[0].limit++;assert.throws(()=>rowsFor(x));const y=mock();y.passed=92;assert.throws(()=>rowsFor(y));const z=real();z.exitCode=1;assert.throws(()=>rowsFor(z));});
test('records genuine failed budget and real attempts',()=>{const x=bundle();Object.assign(x.apps[0],{total:92161,delta:1,files:[{file:'main.js',gzipBytes:92161}]});x.result='failed';assert.match(rowsFor(x)[0],/failed/);const y=real();Object.assign(y,{passed:0,exitCode:2,result:'failed',failureClass:'preflight'});assert.match(rowsFor(y)[0],/preflight/);});
test('rejects false vitals summaries and missing runs',()=>{const x=vitals();x.summaries[0].medianLcpMs=0;assert.throws(()=>rowsFor(x));const y=vitals();y.samples[0].run=2;assert.throws(()=>rowsFor(y));});
test('escapes pipe and newline without writing markdown',()=>assert.equal(formatCell('a|b\nc\r\nd'),'a\\|b c d'));
test('CLI requires exactly one argument',()=>{for(const args of [[],['a','b']])assert.equal(spawnSync(process.execPath,['scripts/record-frontend.mjs',...args],{encoding:'utf8'}).status,2);});
