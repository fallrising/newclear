import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarios} from './fixture.mjs';
import {assertPreviousDesktopFull} from './previous-desktop-full.mjs';

// SPEC-T006R-recapture-v7 R702.
const hashes={'fixture.mjs':'f','/':'i','/assets/p0-client.js':'c','/assets/p0.css':'s','remaining-v7-baseline.mjs':'r'};
const row=state=>({key:state+'__desktop__dark',semanticPassed:true,assetStatus:200,storageSafe:true,dom:{bearerEmpty:true,promptEmpty:true,inertDiff:true},png:{sha256:'png-'+state},health:[{expected:true}],...(state==='disconnected'?{reconnectedWithoutMutation:true,postReconnectHealth:[{expected:true}]}:{})});
const valid=()=>({passed:true,stage:'COMPLETE',mode:'remaining-baseline',phase:'desktop',viewport:'desktop',captures:scenarios.map(row),sourceHashes:{...hashes,'extra-only-in-previous.mjs':'x'},tools:{node:'v24.18.0',playwright:'1.63.0',chromium:'153.0.8010.12'},cleanup:{cancelled:false,drainComplete:true,listenerAbsent:true,resources:[{closed:true}]}});

test('accepts a passing nine-key desktop result on the same source',()=>{
 assert.doesNotThrow(()=>assertPreviousDesktopFull(valid(),hashes));
});

test('rejects each failed R702 condition',()=>{
 const cases=[
  ['null',()=>null],
  ['not passed',p=>{p.passed=false;return p;}],
  ['stage',p=>{p.stage='PRECONDITION';return p;}],
  ['mode',p=>{p.mode='other';return p;}],
  ['phase',p=>{p.phase='desktop-recovery';return p;}],
  ['viewport',p=>{p.viewport='tablet';return p;}],
  ['missing key',p=>{p.captures.pop();return p;}],
  ['order',p=>{p.captures.reverse();return p;}],
  ['row semantic',p=>{p.captures[0].semanticPassed=false;return p;}],
  ['row asset',p=>{p.captures[1].assetStatus=500;return p;}],
  ['row storage',p=>{p.captures[2].storageSafe=false;return p;}],
  ['row bearer',p=>{p.captures[3].dom.bearerEmpty=false;return p;}],
  ['row png',p=>{p.captures[4].png={};return p;}],
  ['row health',p=>{p.captures[5].health=[{expected:false}];return p;}],
  ['disconnected reconnect',p=>{p.captures[7].reconnectedWithoutMutation=false;return p;}],
  ['source drift',p=>{p.sourceHashes['/assets/p0.css']='old';return p;}],
  ['source missing',p=>{delete p.sourceHashes['remaining-v7-baseline.mjs'];return p;}],
  ['tools',p=>{p.tools.chromium='other';return p;}],
  ['cleanup',p=>{p.cleanup.drainComplete=false;return p;}],
 ];
 for(const[name,mutate]of cases)assert.throws(()=>assertPreviousDesktopFull(mutate(valid()),hashes),undefined,name);
});
