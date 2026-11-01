import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyJourneyHealth,healthPassed} from './journey-health.mjs';
const base=()=>({responses:[],failures:[],consoles:[],controlled:new Set(),blocked:[],pageErrors:[]});
test('401 requires the explicit negative phase, exact origin/path and GET',()=>{
  const valid={status:401,url:'http://127.0.0.1:8080/api/v1/queues',method:'GET',stage:'missing-key'};
  assert(healthPassed(classifyJourneyHealth({...base(),responses:[valid]})));
  for(const delta of [{status:403},{stage:'save-refresh'},{method:'POST'},{url:'http://foreign/api/v1/queues'},{url:valid.url+'?secret=canary'}])assert(!healthPassed(classifyJourneyHealth({...base(),responses:[{...valid,...delta}]})));
});
test('controlled network failure requires the same intercepted Request, path, phase and code',()=>{
  const request={};const valid={request,url:'http://127.0.0.1:8080/api/v1/metrics',method:'GET',stage:'controlled-network-failure',code:'net::ERR_FAILED'};
  const input={...base(),controlled:new Set([request]),failures:[valid]};
  assert(healthPassed(classifyJourneyHealth(input)));
  for(const delta of [{request:{}},{stage:'recovered-refresh'},{code:'net::ERR_ABORTED'},{method:'POST'}])assert(!healthPassed(classifyJourneyHealth({...input,failures:[{...valid,...delta}]})));
});
test('console requires actual matching response or controlled request evidence, never generic suppression',()=>{
  const response={status:401,url:'http://127.0.0.1:8080/api/v1/queues',method:'GET',stage:'invalid-key'};
  const event={type:'error',url:response.url,stage:response.stage,text:'Failed to load resource: the server responded with a status of 401 (Unauthorized)'};
  assert(healthPassed(classifyJourneyHealth({...base(),responses:[response],consoles:[event]})));
  for(const delta of [{stage:'save-refresh'},{text:'Failed to load resource: unknown'},{text:'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'}])assert(!healthPassed(classifyJourneyHealth({...base(),responses:[response],consoles:[{...event,...delta}]})));
  assert(!healthPassed(classifyJourneyHealth({...base(),consoles:[event]})));
});
test('unknown URLs/text are omitted from public summaries while remaining failing evidence',()=>{
  const safe=classifyJourneyHealth({...base(),responses:[{status:500,url:'https://private.invalid/?key=secret-canary',method:'GET',stage:'unknown'}],consoles:[{type:'error',url:'https://private.invalid/',text:'secret-canary',stage:'unknown'}]});
  assert(!healthPassed(safe));assert(!JSON.stringify(safe).includes('secret-canary'));assert(!JSON.stringify(safe).includes('private.invalid'));
});
