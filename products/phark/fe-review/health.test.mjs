import test from 'node:test';
import assert from 'node:assert/strict';
import {safePath, expectedAbort, classifyConsoles, expectedLogoutAbort} from './health.mjs';
const event = {sameOrigin: true, path: '/api/search', method: 'GET', errorCode: 'net::ERR_ABORTED', navigationId: 1, timeMs: 15};
const navigation = [{id: 1, observed: true, startedMs: 10, endedMs: 20}];
test('only same-origin GET abort during observed navigation or completed teardown qualifies', () => {
  assert(expectedAbort(event, navigation, false));
  assert(expectedAbort({...event, navigationId: null, teardown: true}, [], true));
  for (const patch of [{sameOrigin: false}, {method: 'POST'}, {errorCode: 'net::ERR_FAILED'}, {path: 'unrecognized-path'}, {timeMs: 30}, {navigationId: 2}]) assert(!expectedAbort({...event, ...patch}, navigation, false));
  assert(!expectedAbort(event, [{...navigation[0], observed: false}], false));
  assert(!expectedAbort({...event, navigationId: null, teardown: true}, [], false));
});
test('console 500 needs its exact observed response and cannot consume it twice', () => {
  const item = {sameOrigin: true, path: '/api/posts', status: 500};
  const result = classifyConsoles([item, item, {...item, path: '/api/search'}], [{path: '/api/posts', status: 500}]);
  assert.deepEqual(result.map(x => x.classification), ['controlled-500-response','unclassified','unclassified']);
  assert.equal(classifyConsoles([{...item, sameOrigin: false}], [{path: '/api/posts', status: 500}])[0].classification, 'unclassified');
});
test('safe URL projection never retains query or unrecognized path payload', () => {
  assert.deepEqual(safePath('http://127.0.0.1:5173/api/search?q=private-canary', 'http://127.0.0.1:5173'), {sameOrigin: true, path: '/api/search'});
  assert.equal(safePath('http://127.0.0.1:5173/private-canary', 'http://127.0.0.1:5173').path, 'unrecognized-path');
});
test('logout POST abort requires same actual Request, 204, successful null session readback and signed-out UI', () => {
  const event = {sameOrigin: true, path: '/api/auth/logout', method: 'POST', errorCode: 'net::ERR_ABORTED'};
  const proof = {sameRequest: true, status204: true, session200: true, accountNull: true, signedOutUI: true};
  assert(expectedLogoutAbort(event, proof));
  for (const field of Object.keys(proof)) assert(!expectedLogoutAbort(event, {...proof, [field]: false}));
  for (const patch of [{method: 'GET'}, {path: '/api/posts'}, {sameOrigin: false}, {errorCode: 'net::ERR_FAILED'}]) assert(!expectedLogoutAbort({...event, ...patch}, proof));
});
