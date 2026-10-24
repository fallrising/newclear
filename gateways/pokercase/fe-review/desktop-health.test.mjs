import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedFavicon,classifyProbe} from './desktop-health.mjs';
const headers={apiKey:false,cookie:false,authorization:false,adminToken:false,csrf:false};
const request={id:'request-3',path:'/favicon.ico',exactURL:true,method:'GET',initiator:'other',status:404,extraHeadersSeen:true,headers,extraHeaders:headers,failed:false};
test('only actual exact anonymous browser favicon 404 is classifiable',()=>{
  assert(expectedFavicon(request));
  for(const delta of [{exactURL:false},{method:'POST'},{initiator:'unknown'},{status:null},{status:200},{failed:true},{extraHeadersSeen:false},{headers:{...headers,adminToken:true}},{extraHeaders:{...headers,cookie:true}},{extraHeaders:{...headers,csrf:true}}])assert(!expectedFavicon({...request,...delta}));
});
test('unknown console/request and mismatched CDP request identity still fail',()=>{
  const probe={requests:[request],console:[{type:'error',path:'/favicon.ico',code:'HTTP_404'}],networkLog:[{source:'network',level:'error',path:'/favicon.ico',code:'HTTP_404',request:'request-3'}],pageErrors:0};
  assert(classifyProbe(probe).passed);
  assert(!classifyProbe({...probe,pageErrors:1}).passed);
  assert(!classifyProbe({...probe,networkLog:[{...probe.networkLog[0],request:'request-4'}]}).passed);
  assert(!classifyProbe({...probe,requests:[request,{...request,id:'request-4',path:'<rejected>'}]}).passed);
  assert(!classifyProbe({...probe,console:[...probe.console,{type:'error',path:'/admin/login',code:'UNKNOWN'}]}).passed);
});
