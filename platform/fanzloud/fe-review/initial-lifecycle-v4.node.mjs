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

test('v1-v3 runners and the v3 suite stay byte-identical',()=>{
 const expected={'initial-lifecycle-baseline.mjs':'3da7aeb4d23bc1405b511004562270baa21ad947e5162bf3520783ef4c8cebea','initial-lifecycle-v2-baseline.mjs':'85a1e4c897e8be8a7f4e58b6128b4e8f4f0d5c09dd35cb7ab24941b76745ce41','initial-lifecycle-v3-baseline.mjs':'721337586d3f407e1fd9656285a17265d54387f9cc4051e4a1b712de25612089','initial-lifecycle-v3.node.mjs':'270c4c882849cc5a1e2babfb429014c3c34af69cdd69d76a6283a55d333c85ee'};
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

test('every v4 source pin matches the current file or embedded asset',()=>{
 const assets=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 for(const[name,hash]of Object.entries(pins(v4)))assert.equal(name.startsWith('/')?assets.get(name):sha(readFileSync(new URL(name,import.meta.url))),hash,name);
});

test('v4 reads no earlier run, accepted manifest or reuse approval',()=>{
 for(const forbidden of ["'/reuse-acceptance.json'","/accepted-","new URL('remaining-accepted.json'",'acceptOrderingReuse(','REVIEW_ACCEPTED_','/prior','/supplement','/after-device'])assert.equal(v4.includes(forbidden),false,forbidden);
 assert.match(v4,/receipt\.retainedDesktopKeys=\[\];receipt\.reuse='NONE_SOURCE_CHANGED';/);
 assert.match(v4,/const selection=selectRecoveryPhase\(process\.argv\.slice\(2\)\)/);
});
