import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyObservation } from './route-guard.mjs';
const contract = { baseUrl: 'http://127.0.0.1:5174', finalPath: '/entries/album?mockUser=seed-operator-album', identity: 'seed-operator-album' };
const good = { finalUrl: contract.baseUrl + contract.finalPath, status: 200, identity: contract.identity, loaded: true, pageErrors: 0 };
test('loaded authorized page accepted', () => assert.equal(verifyObservation(contract, good), true));
for (const [name, patch] of Object.entries({
  loginRedirect: { finalUrl: contract.baseUrl + '/sign-in' },
  otherOrigin: { finalUrl: 'http://untrusted.invalid' + contract.finalPath },
  wrongQuery: { finalUrl: contract.baseUrl + '/entries/album?mockUser=seed-admin' },
  fragment: { finalUrl: good.finalUrl + '#unexpected' },
  staleIdentity: { identity: 'seed-admin' },
  skeleton: { loaded: false },
  httpError: { status: 403 },
  pageError: { pageErrors: 1 },
})) test(`reject ${name} without disclosing URL`, () => {
  assert.throws(() => verifyObservation(contract, { ...good, ...patch }), /^Error: REVIEW_[A-Z_]+$/);
});
test('intentional logout only accepts exact anonymous selector', () => {
  const logout = { baseUrl: contract.baseUrl, finalPath: '/', identity: null };
  assert.equal(verifyObservation(logout, { ...good, finalUrl: contract.baseUrl+'/', identity: null }), true);
  assert.throws(() => verifyObservation(logout, { ...good, finalUrl: contract.baseUrl+'/' }), /REVIEW_IDENTITY/);
});
