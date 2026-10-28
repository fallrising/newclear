import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixedAssets,scenarios} from './fixture.mjs';
import {selectPhase} from './remaining-support.mjs';

// SPEC-T006R-recapture-v7 R701/R705: v7 is remaining-baseline plus exactly the R701 substitutions.
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const base=read('remaining-baseline.mjs'),v7=read('remaining-v7-baseline.mjs');
const pins=text=>JSON.parse(text.match(/const expectedSources=(\{[^}]*\})/)[1]);
const M2_CHANGED=['/','/assets/p0-client.js','/assets/p0.css','fixture.mjs'];
const fixedSubs=[
  ["/** Root-only remaining19 canonical keys after independently accepted ordering reuse. */","/** T-0433 recapture v7: all nine states per phase on the M2-repaired source; no earlier-cell reuse (SPEC-T006R-recapture-v7). */"],
  ["import {selectPhase,assertPreviousPhase,assertPreviousPNGs,assertPostReconnect,assertStateCounts,createActionGuard} from './remaining-support.mjs';","import {selectPhase,assertPreviousPhase,assertPreviousPNGs,assertPostReconnect,assertStateCounts,createActionGuard} from './remaining-support.mjs';\nimport {assertPreviousDesktopFull} from './previous-desktop-full.mjs';"],
  ["const selection=selectPhase(process.argv.slice(2)),size=selection.viewport,mode=selection.phase;","const selection=(()=>{const args=process.argv.slice(2);assert(args.length===1&&['desktop','tablet','mobile'].includes(args[0]),'REVIEW_V7_PHASE');if(args[0]!=='desktop')return selectPhase(args);const desktop=selectPhase(['desktop-recovery']);return {phase:'desktop',viewport:desktop.viewport,size:desktop.size,states:[...scenarios]};})(),size=selection.viewport,mode=selection.phase;"],
  ["scope:'only remaining19 original canonical keys; retained7 plus independently accepted ordering provenance; not M2 acceptance'","scope:'all nine dark states for one viewport on the M2-repaired T-0433 source; no reuse of earlier accepted cells; candidate until independent actual review'"],
  ["['remaining-baseline.mjs','remaining-support.mjs'","['remaining-v7-baseline.mjs','previous-desktop-full.mjs','remaining-support.mjs'"],
  ["const previous=mode==='desktop-recovery'?null:JSON.parse(readFileSync('/previous/result.json','utf8'));assertPreviousPhase(mode,previous,receipt.sourceHashes);if(previous)assertPreviousPNGs(previous,path=>readFileSync('/previous/'+path));","const previous=mode==='desktop'?null:JSON.parse(readFileSync('/previous/result.json','utf8'));if(mode==='tablet')assertPreviousDesktopFull(previous,receipt.sourceHashes);else if(mode==='mobile')assertPreviousPhase(mode,previous,receipt.sourceHashes);if(previous)assertPreviousPNGs(previous,path=>readFileSync('/previous/'+path));"]
];

test('remaining-baseline stays byte-identical',()=>{
 assert.equal(sha(readFileSync(new URL('remaining-baseline.mjs',import.meta.url))),'10d206062a42e7b62cb629b2998d7bbf33c8f4abfbcfa1f1f95d6d7e6e04f5ba');
});

test('v7 equals remaining-baseline with exactly the R701 substitutions',()=>{
 const lines=base.split('\n');const reuse=lines.slice(32,34).join('\n');
 assert.match(lines[32],/^ const accepted=JSON\.parse\(readFileSync\(new URL\('remaining-accepted\.json'/);
 assert.match(lines[33],/^ const reuseBytes=readFileSync\('\/reuse-acceptance\.json'\)/);
 const oldPins=pins(base),newPins=pins(v7);
 const subs=[...fixedSubs.slice(0,4),
  ...M2_CHANGED.map(k=>[`"${k}":"${oldPins[k]}"`,`"${k}":"${newPins[k]}"`]).sort((a,b)=>base.indexOf(a[0])-base.indexOf(b[0])),
  fixedSubs[4],
  [reuse," receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';"],
  fixedSubs[5]];
 let forward=base;for(const[from,to]of subs){assert.equal(forward.split(from).length,2,from.slice(0,40));forward=forward.replace(from,()=>to);}
 assert.equal(forward,v7);
 let inverse=v7;for(const[from,to]of subs.toReversed()){assert.equal(inverse.split(to).length,2,to.slice(0,40));inverse=inverse.replace(to,()=>from);}
 assert.equal(inverse,base);
 assert.deepEqual(Object.keys(oldPins).filter(k=>oldPins[k]!==newPins[k]).sort(),[...M2_CHANGED].sort());
});

test('every v7 source pin matches the current file or embedded asset',()=>{
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 for(const[name,hash]of Object.entries(pins(v7)))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('v7 reads no reuse input and chains desktop, tablet, mobile per R701',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_','/prior','/supplement','/after-device','/previous-recovery','/previous-remaining'])assert.equal(v7.includes(forbidden),false,forbidden);
 assert.equal(v7.split("const previous=mode==='desktop'?null:JSON.parse(readFileSync('/previous/result.json','utf8'));if(mode==='tablet')assertPreviousDesktopFull(previous,receipt.sourceHashes);else if(mode==='mobile')assertPreviousPhase(mode,previous,receipt.sourceHashes);").length,2);
 assert.deepEqual(selectPhase(['desktop-recovery']).size,{width:1440,height:900});
 assert.equal(scenarios.length,9);
 assert.deepEqual(selectPhase(['tablet']).states,[...scenarios]);
 assert.deepEqual(selectPhase(['mobile']).states,[...scenarios]);
});
