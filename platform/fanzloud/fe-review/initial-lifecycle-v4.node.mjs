import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixedAssets} from './fixture.mjs';

// SPEC-T006R-recovery-v4 V05: v4 is v3 plus exactly the V01 substitutions.
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const v3=read('initial-lifecycle-v3-baseline.mjs'),v4=read('initial-lifecycle-v4-baseline.mjs');
const pins=text=>JSON.parse(text.match(/const expectedSources=(\{[^}]*\})/)[1]);

// SPEC-T006R-harness-repair-c2 T02: frozen suite hashes follow the pre-repair transport pin added to the v1 restore test.
test('v1-v3 runners and the v3 suite stay byte-identical',()=>{
 const expected={'initial-lifecycle-baseline.mjs':'3da7aeb4d23bc1405b511004562270baa21ad947e5162bf3520783ef4c8cebea','initial-lifecycle-v2-baseline.mjs':'85a1e4c897e8be8a7f4e58b6128b4e8f4f0d5c09dd35cb7ab24941b76745ce41','initial-lifecycle-v3-baseline.mjs':'721337586d3f407e1fd9656285a17265d54387f9cc4051e4a1b712de25612089','initial-lifecycle-v3.node.mjs':'59fa50bb76e6cc96f06bccd46eb9637c20c754b51b0fa421f94d8fa8f66e0ba4'};
 for(const[name,hash]of Object.entries(expected))assert.equal(sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('v4 equals v3 with exactly the V01 substitutions',()=>{
 const lines=v3.split('\n');const reuse=lines.slice(37,39).join('\n');
 assert.match(lines[37],/^ const accepted=JSON\.parse\(readFileSync\(new URL\('remaining-accepted\.json'/);
 assert.match(lines[38],/^ const reuseBytes=readFileSync\('\/reuse-acceptance\.json'\)/);
 const oldPins=pins(v3),newPins=pins(v4);
 const subs=[
  ['/** NEW desktop-recovery formal candidate; source-only preparation, no runtime authority. */','/** T-0433 desktop-recovery v4: recovery-only capture on the fixed source; no earlier-cell reuse (SPEC-T006R-recovery-v4). */'],
  ["scope:'desktop recovery only; retained7 plus independently accepted ordering provenance; passive recovery control is not canonical evidence; not M2 acceptance'","scope:'desktop recovery only on the T-0433 source; no reuse of earlier accepted cells; candidate until independent actual review; not M2 acceptance'"],
  [`"fixture.mjs":"${oldPins['fixture.mjs']}"`,`"fixture.mjs":"${newPins['fixture.mjs']}"`],
  [`"/assets/p0-client.js":"${oldPins['/assets/p0-client.js']}"`,`"/assets/p0-client.js":"${newPins['/assets/p0-client.js']}"`],
  ["'initial-lifecycle-v3-baseline.mjs','initial-lifecycle-v3-observer.mjs'","'initial-lifecycle-v4-baseline.mjs','initial-lifecycle-v3-observer.mjs'"],
  [reuse," receipt.retainedDesktopKeys=[];receipt.reuse='NONE_SOURCE_CHANGED';"],
 ];
 let forward=v3;for(const[from,to]of subs){assert.equal(forward.split(from).length,2,from.slice(0,40));forward=forward.replace(from,()=>to);}
 assert.equal(forward,v4);
 let inverse=v4;for(const[from,to]of subs.toReversed()){assert.equal(inverse.split(to).length,2,to.slice(0,40));inverse=inverse.replace(to,()=>from);}
 assert.equal(inverse,v3);
 const changed=Object.keys(oldPins).filter(k=>oldPins[k]!==newPins[k]).sort();
 assert.deepEqual(changed,['/assets/p0-client.js','fixture.mjs']);
 assert.deepEqual(Object.keys(newPins),Object.keys(oldPins));
});

// SPEC-T006R-m2-repair: v4 is a historical runner accepted on the milestone-1 source; M2 changed only
// the served '/' and '/assets/p0.css', which stay pinned to their milestone-1 bytes.
// SPEC-T006R-harness-repair-c2 T02: the F1-F4 repair changed fixture.mjs and transport.mjs, which stay pinned to their pre-repair bytes.
test('every v4 source pin matches the current source except the two M2-changed assets and the two repaired harness files',()=>{
 const MILESTONE1_ASSETS={'/':'2581673709aacd0a31159fbd8f802deec95b60c6cc86bc3dd982eebf4bd13cbf','/assets/p0.css':'96bc727a6bd932175db677f4e2f59afaf370d46bfe61a927469a6f8ca7b0ade6'};
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 const PRE_REPAIR={'fixture.mjs':'53771d00ca5dc0b5de73f131bf22b5dbd60c6e53a85e5414ceca8034a383404d','transport.mjs':'04636827f238869182d0f7084fed9558c31f6a9f1e351d4b1f708188fecafae3'};
 for(const[name,hash]of Object.entries(pins(v4)))assert.equal(Object.hasOwn(MILESTONE1_ASSETS,name)?MILESTONE1_ASSETS[name]:Object.hasOwn(PRE_REPAIR,name)?PRE_REPAIR[name]:name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
 for(const name of Object.keys(PRE_REPAIR))assert.notEqual(sha(readFileSync(new URL(name,import.meta.url))),PRE_REPAIR[name],name);
 for(const name of Object.keys(MILESTONE1_ASSETS))assert.notEqual(assets.get(name),MILESTONE1_ASSETS[name],name);
});

test('v4 reads no earlier run, accepted manifest or reuse approval',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_','/prior','/supplement','/after-device'])assert.equal(v4.includes(forbidden),false,forbidden);
 assert.match(v4,/receipt\.retainedDesktopKeys=\[\];receipt\.reuse='NONE_SOURCE_CHANGED';/);
 assert.match(v4,/const selection=selectRecoveryPhase\(process\.argv\.slice\(2\)\)/);
});
