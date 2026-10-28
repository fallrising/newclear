import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixedAssets,scenarios} from './fixture.mjs';
import {selectPhase} from './remaining-support.mjs';

// SPEC-T006R-desktop-remaining-v5 D05: v5 is remaining-baseline plus exactly the D01 substitutions.
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const base=read('remaining-baseline.mjs'),v5=read('remaining-desktop-v5-baseline.mjs');
const pins=text=>JSON.parse(text.match(/const expectedSources=(\{[^}]*\})/)[1]);
const selectionSource="const selection=(()=>{assert.deepEqual(process.argv.slice(2),['desktop-remaining'],'REVIEW_REMAINING_SELECTION');const desktop=selectPhase(['desktop-recovery']);return {phase:'desktop-remaining',viewport:desktop.viewport,size:desktop.size,states:scenarios.slice(0,8)};})(),size=selection.viewport,mode=selection.phase;";

test('remaining-baseline stays byte-identical',()=>{
 assert.equal(sha(readFileSync(new URL('remaining-baseline.mjs',import.meta.url))),'10d206062a42e7b62cb629b2998d7bbf33c8f4abfbcfa1f1f95d6d7e6e04f5ba');
});

test('v5 equals remaining-baseline with exactly the D01 substitutions',()=>{
 const lines=base.split('\n');const reuse=lines.slice(32,34).join('\n');
 assert.match(lines[32],/^ const accepted=JSON\.parse\(readFileSync\(new URL\('remaining-accepted\.json'/);
 assert.match(lines[33],/^ const reuseBytes=readFileSync\('\/reuse-acceptance\.json'\)/);
 const oldPins=pins(base),newPins=pins(v5);
 const subs=[
  ['/** Root-only remaining19 canonical keys after independently accepted ordering reuse. */','/** T-0433 desktop-remaining v5: eight non-recovery desktop states on the fixed source; no earlier-cell reuse (SPEC-T006R-desktop-remaining-v5). */'],
  ['const selection=selectPhase(process.argv.slice(2)),size=selection.viewport,mode=selection.phase;',selectionSource],
  ["scope:'only remaining19 original canonical keys; retained7 plus independently accepted ordering provenance; not M2 acceptance'","scope:'eight non-recovery desktop states on the T-0433 source; no reuse of earlier accepted cells; candidate until independent actual review; not M2 acceptance'"],
  [`"fixture.mjs":"${oldPins['fixture.mjs']}"`,`"fixture.mjs":"${newPins['fixture.mjs']}"`],
  [`"/assets/p0-client.js":"${oldPins['/assets/p0-client.js']}"`,`"/assets/p0-client.js":"${newPins['/assets/p0-client.js']}"`],
  ["['remaining-baseline.mjs','remaining-support.mjs'","['remaining-desktop-v5-baseline.mjs','remaining-support.mjs'"],
  [reuse," receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';"],
  ["const previous=mode==='desktop-recovery'?null:JSON.parse(readFileSync('/previous/result.json','utf8'));assertPreviousPhase(mode,previous,receipt.sourceHashes);",'const previous=null;'],
  ["receipt.fullViewportFresh=mode!=='desktop-recovery';",'receipt.fullViewportFresh=false;'],
 ];
 let forward=base;for(const[from,to]of subs){assert.equal(forward.split(from).length,2,from.slice(0,40));forward=forward.replace(from,()=>to);}
 assert.equal(forward,v5);
 let inverse=v5;for(const[from,to]of subs.toReversed()){assert.equal(inverse.split(to).length,2,to.slice(0,40));inverse=inverse.replace(to,()=>from);}
 assert.equal(inverse,base);
 assert.deepEqual(Object.keys(oldPins).filter(k=>oldPins[k]!==newPins[k]).sort(),['/assets/p0-client.js','fixture.mjs']);
});

// SPEC-T006R-m2-repair: v5 is a historical runner accepted on the milestone-1 source; M2 changed only
// the served '/' and '/assets/p0.css', which stay pinned to their milestone-1 bytes.
test('every v5 source pin matches the current source except the two M2-changed assets',()=>{
 const MILESTONE1_ASSETS={'/':'2581673709aacd0a31159fbd8f802deec95b60c6cc86bc3dd982eebf4bd13cbf','/assets/p0.css':'96bc727a6bd932175db677f4e2f59afaf370d46bfe61a927469a6f8ca7b0ade6'};
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 for(const[name,hash]of Object.entries(pins(v5)))assert.equal(Object.hasOwn(MILESTONE1_ASSETS,name)?MILESTONE1_ASSETS[name]:name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
 for(const name of Object.keys(MILESTONE1_ASSETS))assert.notEqual(assets.get(name),MILESTONE1_ASSETS[name],name);
});

test('v5 reads no earlier run, accepted manifest, reuse approval or previous result',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_',"readFileSync('/previous/result.json','utf8')",'assertPreviousPhase(','/prior','/supplement','/after-device'])assert.equal(v5.includes(forbidden),false,forbidden);
 assert.equal(v5.split('const previous=null;if(previous)assertPreviousPNGs(').length,2);
 assert.equal(v5.split("previousManifestSha256:previous?sha(readFileSync('/previous/result.json')):null").length,2);
 assert.equal(v5.split('/previous/').length,3);
});

test('selection yields the eight non-recovery states at the desktop viewport',()=>{
 const desktop=selectPhase(['desktop-recovery']);
 assert.deepEqual(desktop.size,{width:1440,height:900});
 assert.deepEqual(scenarios.slice(0,8),['bootstrap-empty','authenticated-ready','device-pending','turn-busy','success-diff','action-rejected','canceled-local','disconnected']);
 assert.equal(scenarios[8],'recovery-required');
 assert.equal(v5.split(selectionSource).length,2);
});
