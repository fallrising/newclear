import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedRequest, classify, sharedHealth, knownCompatibility, knownModal} from './health.mjs';
test('only explicit source font origins and phase-specific negative requests qualify',()=>{
 assert.equal(expectedRequest('https://fonts.googleapis.com/css2',undefined,'normal'),'existing-google-font');
 assert.equal(expectedRequest('https://fonts.googleapis.com.evil/css2',undefined,'normal'),null);
 assert.equal(expectedRequest('http://127.0.0.1:5173/api/v1/topics',500,'normal'),null);
 assert.equal(expectedRequest('http://127.0.0.1:5173/api/v1/topics',500,'error-supplement'),'controlled-500');
 assert.equal(expectedRequest('http://127.0.0.1:5173/api/v1/auth/me',401,'normal'),null);
});
test('unexpected console and external requests fail; paired font failures stay visible',()=>{
 assert.equal(classify([{kind:'console',text:'unexpected',phase:'normal'}])[0].classification,'unexpected');
 const record={page:'dashboard',failedRequests:['GET https://fonts.googleapis.com/css2 net::ERR_NAME_NOT_RESOLVED'],consoleErrors:['[error] Failed to load resource: net::ERR_NAME_NOT_RESOLVED'],pageErrors:[]};
 assert.equal(sharedHealth(record).passed,true);
 assert.equal(sharedHealth({...record,consoleErrors:['[warning] product warning']}).passed,false);
 assert.equal(sharedHealth({...record,failedRequests:['GET http://127.0.0.1:5173/api/v1/topics HTTP 500']}).passed,false);
});

test('only exact source-confirmed compatibility warning is classified',()=>{
 assert.equal(classify([{kind:'console',text:knownCompatibility,level:'error',phase:'login'}])[0].classification,'existing-antd-react-compatibility-warning');
 assert.equal(classify([{kind:'console',text:knownCompatibility+' extra',phase:'login'}])[0].classification,'unexpected');
});

test('exact source-confirmed Modal deprecation stays visible and other warnings fail',()=>{
 assert.equal(classify([{kind:'console',text:knownModal,level:'error',phase:'drawer'}])[0].classification,'existing-antd-modal-deprecation-warning');
 assert.equal(classify([{kind:'console',text:'Warning: [antd: Modal] another issue',phase:'drawer'}])[0].classification,'unexpected');
});

test('exact axe preload warning requires a correlated known font failure',()=>{
 const warning="[warning] Couldn't load preload assets:  ProgressEvent";
 const record={page:'dashboard',failedRequests:['GET https://fonts.googleapis.com/css2 net::ERR_BLOCKED_BY_CLIENT'],consoleErrors:[warning],pageErrors:[]};
 assert.equal(sharedHealth(record).passed,true);assert.equal(sharedHealth(record).axePreloadIncomplete,true);
 assert.equal(sharedHealth({...record,failedRequests:[]}).passed,false);
 assert.equal(sharedHealth({...record,consoleErrors:[warning+' extra']}).passed,false);
 assert.equal(sharedHealth({...record,failedRequests:[...record.failedRequests,'GET http://127.0.0.1:5173/api/v1/topics HTTP 500']}).passed,false);
});
