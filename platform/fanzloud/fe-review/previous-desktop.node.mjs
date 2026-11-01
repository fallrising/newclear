import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scenarios} from './fixture.mjs';
import {assertPreviousDesktop,PRODUCT_SOURCE_KEYS} from './previous-desktop.mjs';

// SPEC-T006R-tablet-mobile-v6 P01.
const hashes=Object.fromEntries([...PRODUCT_SOURCE_KEYS,'remaining-support.mjs'].map(k=>[k,'h-'+k]));
const row=state=>({key:state+'__desktop__dark',semanticPassed:true,assetStatus:200,storageSafe:true,dom:{bearerEmpty:true,promptEmpty:true,inertDiff:true},png:{sha256:'png-'+state},health:[{expected:true}],...(state==='disconnected'?{reconnectedWithoutMutation:true,postReconnectHealth:[{expected:true}]}:{})});
const result=(phase,states,extra={})=>({passed:true,stage:'COMPLETE',mode:'remaining-baseline',phase,viewport:'desktop',reuse:'NONE_SOURCE_CHANGED',captures:states.map(row),sourceHashes:{...hashes,[phase+'-runner.mjs']:'runner'},tools:{node:'v24.18.0',playwright:'1.63.0',chromium:'153.0.8010.12'},cleanup:{cancelled:false,drainComplete:true,listenerAbsent:true,resources:[{closed:true}]},...extra});
const valid=()=>[result('desktop-recovery',['recovery-required']),result('desktop-remaining',scenarios.slice(0,8))];
const current={...hashes,'v6-runner.mjs':'v6'};

test('accepts the two accepted desktop results on the same product source',()=>{
 const[recovery,remaining]=valid();assert.doesNotThrow(()=>assertPreviousDesktop(recovery,remaining,current));
});

test('rejects each failed P01 condition',()=>{
 const cases=[
  ['not passed',(r,m)=>{r.passed=false;}],
  ['stage',(r,m)=>{m.stage='PRECONDITION';}],
  ['mode',(r,m)=>{r.mode='other';}],
  ['viewport',(r,m)=>{m.viewport='tablet';}],
  ['reuse',(r,m)=>{m.reuse=undefined;}],
  ['phase',(r,m)=>{r.phase='desktop-remaining';}],
  ['missing key',(r,m)=>{m.captures.pop();}],
  ['duplicate key',(r,m)=>{m.captures[1]=m.captures[0];}],
  ['row semantic',(r,m)=>{m.captures[2].semanticPassed=false;}],
  ['row health',(r,m)=>{r.captures[0].health=[{expected:false}];}],
  ['empty health',(r,m)=>{m.captures[0].health=[];}],
  ['inert diff',(r,m)=>{m.captures[4].dom.inertDiff=false;}],
  ['png hash',(r,m)=>{m.captures[3].png={};}],
  ['disconnected reconnect',(r,m)=>{m.captures[7].reconnectedWithoutMutation=false;}],
  ['shared source drift',(r,m)=>{m.sourceHashes['remaining-support.mjs']='old';}],
  ['product key missing',(r,m)=>{delete r.sourceHashes['/assets/p0-client.js'];}],
  ['product key drift',(r,m)=>{r.sourceHashes['fixture.mjs']='old';}],
  ['tools',(r,m)=>{m.tools.chromium='other';}],
  ['cleanup',(r,m)=>{r.cleanup.listenerAbsent=false;}],
 ];
 for(const[name,mutate]of cases){const[recovery,remaining]=valid();mutate(recovery,remaining);assert.throws(()=>assertPreviousDesktop(recovery,remaining,current),/REVIEW_PREVIOUS_DESKTOP/,name);}
});

test('accepts the actual accepted desktop runs when present',()=>{
 const read=dir=>{try{return JSON.parse(readFileSync(new URL('runs/'+dir+'/result.json',import.meta.url),'utf8'));}catch{return null;}};
 const recovery=read('baseline-desktop-recovery-008'),remaining=read('baseline-desktop-remaining-001');
 if(!recovery||!remaining)return;
 const shared=Object.fromEntries(PRODUCT_SOURCE_KEYS.map(k=>[k,remaining.sourceHashes[k]]));
 assert.doesNotThrow(()=>assertPreviousDesktop(recovery,remaining,shared));
});
