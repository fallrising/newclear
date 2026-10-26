import test from 'node:test';
import assert from 'node:assert/strict';
import {submitNavigation} from './navigation.mjs';
import {ORIGIN} from './guards.mjs';

test('POST headers cannot settle submission until the newly committed document arrives',async()=>{
  let respond,navigate;const events=[];const finalURL=ORIGIN+'/admin/login?error=invalid';let settled=false;
  const page={waitForResponse(){events.push('response-armed');return new Promise(resolve=>{respond=resolve;});},waitForNavigation(options){events.push('navigation-armed');assert.equal(options.waitUntil,'networkidle');return new Promise(resolve=>{navigate=resolve;});},url:()=>finalURL};
  const task=submitNavigation(page,{requestURL:ORIGIN+'/admin/login',status:303,finalURL},async()=>{events.push('enter');respond({status:()=>303});});task.then(()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['response-armed','navigation-armed','enter']);assert.equal(settled,false);
  navigate({status:()=>200,url:()=>finalURL});assert.equal((await task).documentStatus,200);
});
test('same-URL error and one-time-key documents still require exact status and final URL',async()=>{
  for(const status of [200,400,403]){
    const path=status===200?'/admin/keys/new':'/admin/routes/new';const url=ORIGIN+path;
    const page={waitForResponse:async()=>({status:()=>status}),waitForNavigation:async()=>({status:()=>status,url:()=>url}),url:()=>url};
    assert.equal((await submitNavigation(page,{requestURL:url,status,finalURL:url},async()=>{})).documentStatus,status);
    await assert.rejects(submitNavigation({...page,url:()=>ORIGIN+'/admin'},{requestURL:url,status,finalURL:url},async()=>{}),/REVIEW_FORM_FINAL_URL/);
    await assert.rejects(submitNavigation({...page,waitForNavigation:async()=>({status:()=>500,url:()=>url})},{requestURL:url,status,finalURL:url},async()=>{}),/REVIEW_FORM_DOCUMENT_STATUS/);
  }
});
