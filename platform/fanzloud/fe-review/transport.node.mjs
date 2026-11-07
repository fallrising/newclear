import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHeaders,decodeBody,allowedRequest} from './transport.mjs';
test('transport rejects duplicate sensitive headers, invalid UTF8 and nonexact routes',()=>{
 assert.deepEqual(requestHeaders(['Origin','https://127.0.0.1:8443']),{origin:'https://127.0.0.1:8443'});
 for(const name of ['Cookie','Origin','Authorization','Codebox-Instance-Id','Idempotency-Key','Content-Type'])assert.throws(()=>requestHeaders([name,'a',name.toLowerCase(),'b']),/REVIEW_DUPLICATE_HEADER/);
 assert.throws(()=>decodeBody([Buffer.from([0xc3,0x28])]),/REVIEW_UTF8/);
 assert.throws(()=>decodeBody([Buffer.alloc(40961)]),/REVIEW_BODY_LIMIT/);
 for(const path of ['/assets/p0.css?secret=x','/../p0.css','https://evil.invalid/','/api/p0/v1/session#x'])assert.equal(allowedRequest('GET',path),false);
 assert.equal(allowedRequest('GET','/assets/p0.css'),true);assert.equal(allowedRequest('DELETE','/api/p0/v1/operator/session'),true);
});
