import test from 'node:test';
import assert from 'node:assert/strict';
import {secureContext,screenshotMasks} from './browser-policy.mjs';
test('context allows exact loopback only, blocking external before network',async()=>{
 let handler,websocketHandler;const context={route:async(pattern,callback)=>{assert.equal(pattern,'**/*');handler=callback;},routeWebSocket:async(pattern,callback)=>{assert.equal(pattern,'**/*');websocketHandler=callback;},on:()=>{},pages:()=>[]};
 await secureContext(context);
 for(const [url,expected] of [['http://127.0.0.1:5173/api/v1/topics','continue'],['https://fonts.googleapis.com/css2','blockedbyclient'],['http://127.0.0.1.evil:5173/','blockedbyclient'],['http://console-api:8080/','blockedbyclient']]) {let result;await handler({request:()=>({url:()=>url}),continue:async()=>result='continue',abort:async value=>result=value});assert.equal(result,expected);}
 for(const [url,expected] of [['ws://127.0.0.1:5173/','connected'],['ws://console-api:8080/','closed'],['wss://127.0.0.1:5173/','closed'],['ws://127.0.0.1.evil:5173/','closed']]){let result;await websocketHandler({url:()=>url,connectToServer:()=>result='connected',close:async options=>{assert.equal(options.code,1008);result='closed';}});assert.equal(result,expected);}
});
test('screenshot masks exact token and nested audit code without rewriting data',()=>{
 const calls=[];const page={getByText:(text,options)=>{calls.push({text,options});return 'exact';},locator:selector=>({filter:options=>{calls.push({selector,options});return 'nested-code';}})};
 assert.deepEqual(screenshotMasks(page,['synthetic-secret']),['exact','nested-code']);assert.deepEqual(calls[1],{selector:'code',options:{hasText:'synthetic-secret'}});
});
