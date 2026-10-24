import test from 'node:test';
import assert from 'node:assert/strict';
import {requireID,adminPath} from './fixture.mjs';
test('actual fixture IDs cannot inject routes, queries or external targets',()=>{
  const id='01234567-89ab-cdef-0123-456789abcdef';assert.equal(requireID(id),id);
  for(const value of ['', '../secret','https://foreign/',id+'?token=canary',id+'/refresh'])assert.throws(()=>requireID(value),/REVIEW_FIXTURE_ID/);
});
test('fixture API allowlist excludes import, refresh, providers and unrelated endpoint families',()=>{
  for(const path of ['/admin/api/connections','/admin/api/routes','/admin/api/keys','/admin/api/usage'])assert(adminPath(path));
  for(const path of ['/admin/api/connections/oauth/import','/admin/api/connections/oauth/refresh-all','/admin/api/providers','/v1/chat/completions','/admin/api/keys?secret=x'])assert(!adminPath(path));
});
