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

test('every v6 source pin matches the current file or embedded asset',()=>{
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 for(const[name,hash]of Object.entries(pins(v6)))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('v6 reads no reuse input and gates the previous phase per V601',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_','/prior','/supplement','/after-device'])assert.equal(v6.includes(forbidden),false,forbidden);
 assert.equal(v6.split("const previous=mode==='mobile'?JSON.parse(readFileSync('/previous/result.json','utf8')):null;if(previous){assertPreviousPhase(mode,previous,receipt.sourceHashes);").length,2);
 assert.equal(v6.split('assertPreviousDesktop(recovery,remaining,receipt.sourceHashes)').length,2);
 assert.equal(v6.split("assert(['tablet','mobile'].includes(selected.phase),'REVIEW_V6_PHASE')").length,2);
});
