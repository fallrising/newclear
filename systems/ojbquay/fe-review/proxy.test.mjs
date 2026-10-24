import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardedHeaders, frontendOrigin, upstreamPath, validateOrigin} from './loopback-proxy.mjs';

test('only exact loopback frontend and fixed internal upstream accepted', () => {
  assert.equal(validateOrigin(frontendOrigin), frontendOrigin);
  assert.equal(upstreamPath('/api/v1/auth/me'), '/api/v1/auth/me');
  assert.equal(upstreamPath('/internal/health?probe=1'), '/internal/health?probe=1');
  for (const value of ['http://localhost:5173', 'http://0.0.0.0:5173', 'http://127.0.0.1:5173/', 'https://example.invalid', 'http://user@127.0.0.1:5173']) assert.throws(() => validateOrigin(value));
  assert.throws(() => upstreamPath('/api/v1/auth/me', 'http://other-service:8080'));
});

test('reject arbitrary proxy targets and normalized path escape', () => {
  for (const path of ['http://example.invalid/api/x', '//console-api:8080/api/x', '/healthz', '/api/../../admin', '/api/../x', '/api/x#fragment', '/api/\\x', '/api/x\r\nHost: other']) assert.throws(() => upstreamPath(path));
});

test('session CSRF response cookies and status-relevant headers survive hop filtering', () => {
  const request = {cookie:'synthetic-session', 'x-xsrf-token':'synthetic-csrf', origin:frontendOrigin, host:'127.0.0.1:5173', connection:'keep-alive, x-hop', 'x-hop':'remove', 'content-type':'application/json'};
  assert.deepEqual(forwardedHeaders(request), {cookie:request.cookie, 'x-xsrf-token':request['x-xsrf-token'], origin:frontendOrigin, host:request.host, 'content-type':'application/json'});
  assert.deepEqual(forwardedHeaders({'set-cookie':['a=one; HttpOnly', 'b=two; SameSite=Lax'], 'content-type':'application/json', connection:'close'}), {'set-cookie':['a=one; HttpOnly', 'b=two; SameSite=Lax'], 'content-type':'application/json'});
});
