import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialFlags,expectedFavicon,classifyProbe,safePath} from './desktop-health.mjs';
const valid=()=>({id:'request-1',path:'/favicon.ico',exactURL:true,method:'GET',initiator:'other',status:404,extraHeadersSeen:true,headers:credentialFlags(),extraHeaders:credentialFlags(),failed:false});
test('favicon finding requires actual exact GET404 other initiator and both credential-free header proofs',()=>{
  assert(expectedFavicon(valid()));
  for(const delta of [{exactURL:false},{path:'/other'},{status:200},{method:'POST'},{initiator:'unknown'},{extraHeadersSeen:false},{failed:true},{headers:credentialFlags({'X-API-Key':'canary'})},{extraHeaders:credentialFlags({COOKIE:'canary'})}])assert(!expectedFavicon({...valid(),...delta}));
});
test('console and CDP logs must match the same proven favicon request; other errors fail',()=>{
  const p={requests:[valid()],console:[{type:'error',path:'/favicon.ico',code:'HTTP_404'}],networkLog:[{source:'network',level:'error',path:'/favicon.ico',code:'HTTP_404',request:'request-1'}],pageErrors:0};
  assert(classifyProbe(p).passed);
  assert(!classifyProbe({...p,console:[{type:'error',path:'/api/v1/queues',code:'HTTP_404'}]}).passed);
  assert(!classifyProbe({...p,networkLog:[{...p.networkLog[0],request:'request-2'}]}).passed);
  assert(!classifyProbe({...p,requests:[]}).passed);
});
test('safe diagnostics omit header values and unknown URL payloads',()=>{
  assert.deepEqual(credentialFlags({'X-API-Key':'private-canary',Cookie:'private-canary'}),{apiKey:true,cookie:true,authorization:false});
  assert.equal(safePath('http://127.0.0.1:8080/favicon.ico?secret=private-canary'),'<rejected>');
  assert.equal(safePath('https://foreign.invalid/favicon.ico'),'<rejected>');
  assert(!JSON.stringify(credentialFlags({Authorization:'private-canary'})).includes('private-canary'));
});
