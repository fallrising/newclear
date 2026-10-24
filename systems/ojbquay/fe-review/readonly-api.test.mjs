import test from 'node:test';
import assert from 'node:assert/strict';
import {apiClient} from './browser-support.mjs';
test('readonly continuation rejects mutation before invoking request fetch',async()=>{
 const previous=process.env.FE_REVIEW_RESUME_READONLY;process.env.FE_REVIEW_RESUME_READONLY='1';let invoked=0;
 const page={request:{get:async()=>({status:()=>200,json:async()=>({code:'OK',data:{headerName:'X-CSRF',token:'synthetic'}})}),fetch:async()=>{invoked++;return {ok:()=>true,status:()=>200,json:async()=>({code:'OK',data:[]})};}}};
 try{const api=await apiClient(page);await assert.rejects(api('POST','/api/v1/topics',{}),/REVIEW_READONLY_SEED_METHOD/);assert.equal(invoked,0);assert.deepEqual(await api('GET','/api/v1/topics'),[]);assert.equal(invoked,1);}finally{if(previous===undefined)delete process.env.FE_REVIEW_RESUME_READONLY;else process.env.FE_REVIEW_RESUME_READONLY=previous;}
});
