import test from 'node:test';
import assert from 'node:assert/strict';
import {Lifecycle,bounded} from './lifecycle.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('a stalled browser close does not prevent other owned resources closing',async()=>{
 const life=new Lifecycle({drainMs:100,closeMs:20});const closed=[];
 await life.acquire('browser',async()=>({}),()=>new Promise(()=>{}));
 await life.acquire('vite',async()=>({}),async()=>closed.push('vite'));
 await life.acquire('proxy',async()=>({}),async()=>closed.push('proxy'));
 const result=await life.finish();assert.deepEqual(closed.sort(),['proxy','vite']);assert.equal(result.resources.find(r=>r.name==='browser').state,'close-timeout');assert.equal(result.resources.every(r=>r.closed),false);
});
test('signal cancellation drains and closes a late acquisition before receipt',async()=>{
 const life=new Lifecycle({drainMs:100,closeMs:20});let closed=false;
 const work=life.run(()=>life.acquire('browser',async()=>{await pause(15);return {};},async()=>{closed=true;}));
 await pause(1);life.cancel('SIGTERM');await assert.rejects(work,/REVIEW_CANCELLED/);
 const result=await life.finish();assert.equal(closed,true);assert.equal(result.drainComplete,true);assert.equal(result.resources[0].closed,true);assert.equal(result.reason,'SIGTERM');
});
test('never-settling acquisition is bounded and explicitly unknown',async()=>{
 const life=new Lifecycle({drainMs:15,closeMs:10});const acquisition=life.acquire('browser',()=>new Promise(()=>{}),async()=>{});life.cancel('SIGINT');await assert.rejects(acquisition,/REVIEW_CANCELLED/);
 const result=await life.finish();assert.equal(result.drainComplete,false);assert.equal(result.resources[0].state,'acquiring');assert.equal(result.resources[0].closed,false);
});
test('rejected close remains failed while later close still runs',async()=>{
 const life=new Lifecycle({drainMs:50,closeMs:10});let later=false;await life.acquire('browser',async()=>({}),async()=>{throw Error('close failed');});await life.acquire('proxy',async()=>({}),async()=>{later=true;});const result=await life.finish();assert.equal(later,true);assert.equal(result.resources[0].state,'close-failed');
});
