import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixedAssets} from './fixture.mjs';

// SPEC-T006R-tablet-mobile-v6 V601/V604: v6 is remaining-baseline plus exactly the V601 substitutions.
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const base=read('remaining-baseline.mjs'),v6=read('remaining-v6-baseline.mjs');
const pins=text=>JSON.parse(text.match(/const expectedSources=(\{[^}]*\})/)[1]);
const fixedSubs=[
  ["/** Root-only remaining19 canonical keys after independently accepted ordering reuse. */","/** T-0433 tablet/mobile v6: nine states per phase on the fixed source; no earlier-cell reuse (SPEC-T006R-tablet-mobile-v6). */"],
  ["import {selectPhase,assertPreviousPhase,assertPreviousPNGs,assertPostReconnect,assertStateCounts,createActionGuard} from './remaining-support.mjs';","import {selectPhase,assertPreviousPhase,assertPreviousPNGs,assertPostReconnect,assertStateCounts,createActionGuard} from './remaining-support.mjs';\nimport {assertPreviousDesktop} from './previous-desktop.mjs';"],
  ["const selection=selectPhase(process.argv.slice(2)),size=selection.viewport,mode=selection.phase;","const selection=(()=>{const selected=selectPhase(process.argv.slice(2));assert(['tablet','mobile'].includes(selected.phase),'REVIEW_V6_PHASE');return selected;})(),size=selection.viewport,mode=selection.phase;"],
  ["scope:'only remaining19 original canonical keys; retained7 plus independently accepted ordering provenance; not M2 acceptance'","scope:'tablet or mobile nine states on the T-0433 source; no reuse of earlier accepted cells; candidate until independent actual review; not M2 acceptance'"],
  ["['remaining-baseline.mjs','remaining-support.mjs'","['remaining-v6-baseline.mjs','previous-desktop.mjs','remaining-support.mjs'"],
  ["const previous=mode==='desktop-recovery'?null:JSON.parse(readFileSync('/previous/result.json','utf8'));assertPreviousPhase(mode,previous,receipt.sourceHashes);if(previous)assertPreviousPNGs(previous,path=>readFileSync('/previous/'+path));","const previous=mode==='mobile'?JSON.parse(readFileSync('/previous/result.json','utf8')):null;if(previous){assertPreviousPhase(mode,previous,receipt.sourceHashes);assertPreviousPNGs(previous,path=>readFileSync('/previous/'+path));}else{const recoveryBytes=readFileSync('/previous-recovery/result.json'),remainingBytes=readFileSync('/previous-remaining/result.json'),recovery=JSON.parse(recoveryBytes),remaining=JSON.parse(remainingBytes);assertPreviousDesktop(recovery,remaining,receipt.sourceHashes);assertPreviousPNGs(recovery,path=>readFileSync('/previous-recovery/'+path));assertPreviousPNGs(remaining,path=>readFileSync('/previous-remaining/'+path));receipt.previousDesktopManifestSha256={recovery:sha(recoveryBytes),remaining:sha(remainingBytes)};}"]
];

test('remaining-baseline stays byte-identical',()=>{
 assert.equal(sha(readFileSync(new URL('remaining-baseline.mjs',import.meta.url))),'10d206062a42e7b62cb629b2998d7bbf33c8f4abfbcfa1f1f95d6d7e6e04f5ba');
});

test('v6 equals remaining-baseline with exactly the V601 substitutions',()=>{
 const lines=base.split('\n');const reuse=lines.slice(32,34).join('\n');
 assert.match(lines[32],/^ const accepted=JSON\.parse\(readFileSync\(new URL\('remaining-accepted\.json'/);
 assert.match(lines[33],/^ const reuseBytes=readFileSync\('\/reuse-acceptance\.json'\)/);
 const oldPins=pins(base),newPins=pins(v6);
 const subs=[...fixedSubs.slice(0,4),
  [`"fixture.mjs":"${oldPins['fixture.mjs']}"`,`"fixture.mjs":"${newPins['fixture.mjs']}"`],
  [`"/assets/p0-client.js":"${oldPins['/assets/p0-client.js']}"`,`"/assets/p0-client.js":"${newPins['/assets/p0-client.js']}"`],
  fixedSubs[4],
  [reuse," receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';"],
  fixedSubs[5]];
 let forward=base;for(const[from,to]of subs){assert.equal(forward.split(from).length,2,from.slice(0,40));forward=forward.replace(from,()=>to);}
 assert.equal(forward,v6);
 let inverse=v6;for(const[from,to]of subs.toReversed()){assert.equal(inverse.split(to).length,2,to.slice(0,40));inverse=inverse.replace(to,()=>from);}
 assert.equal(inverse,base);
 assert.deepEqual(Object.keys(oldPins).filter(k=>oldPins[k]!==newPins[k]).sort(),['/assets/p0-client.js','fixture.mjs']);
});

// SPEC-T006R-m2-repair: v6 is a historical runner accepted on the milestone-1 source; M2 changed only
// the served '/' and '/assets/p0.css', which stay pinned to their milestone-1 bytes.
// SPEC-T006R-harness-repair-c2 T02: the F1-F4 repair changed fixture.mjs and transport.mjs, which stay pinned to their pre-repair bytes.
test('every v6 source pin matches the current source except the two M2-changed assets, the T-0438 client and the two repaired harness files',()=>{
 const MILESTONE1_ASSETS={'/':'2581673709aacd0a31159fbd8f802deec95b60c6cc86bc3dd982eebf4bd13cbf','/assets/p0.css':'96bc727a6bd932175db677f4e2f59afaf370d46bfe61a927469a6f8ca7b0ade6'};
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 // T-0438 P-006-11 changed p0-client.js after this runner ran; the pin stays on the bytes it ran on.
 const T0438={'/assets/p0-client.js':'a7c0fe338f461175901d1758f6092da2e1a56f3061f538c4341753207aa57e8e'};
 const PRE_REPAIR={'fixture.mjs':'53771d00ca5dc0b5de73f131bf22b5dbd60c6e53a85e5414ceca8034a383404d','transport.mjs':'04636827f238869182d0f7084fed9558c31f6a9f1e351d4b1f708188fecafae3'};
 for(const[name,hash]of Object.entries(pins(v6)))assert.equal(Object.hasOwn(MILESTONE1_ASSETS,name)?MILESTONE1_ASSETS[name]:Object.hasOwn(T0438,name)?T0438[name]:Object.hasOwn(PRE_REPAIR,name)?PRE_REPAIR[name]:name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
 for(const name of Object.keys(PRE_REPAIR))assert.notEqual(sha(readFileSync(new URL(name,import.meta.url))),PRE_REPAIR[name],name);
 for(const name of Object.keys(MILESTONE1_ASSETS))assert.notEqual(assets.get(name),MILESTONE1_ASSETS[name],name);
 for(const name of Object.keys(T0438))assert.notEqual(assets.get(name),T0438[name],name);
});

test('v6 reads no reuse input and gates the previous phase per V601',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_','/prior','/supplement','/after-device'])assert.equal(v6.includes(forbidden),false,forbidden);
 assert.equal(v6.split("const previous=mode==='mobile'?JSON.parse(readFileSync('/previous/result.json','utf8')):null;if(previous){assertPreviousPhase(mode,previous,receipt.sourceHashes);").length,2);
 assert.equal(v6.split('assertPreviousDesktop(recovery,remaining,receipt.sourceHashes)').length,2);
 assert.equal(v6.split("assert(['tablet','mobile'].includes(selected.phase),'REVIEW_V6_PHASE')").length,2);
});
