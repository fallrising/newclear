import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyURL} from './journeys.mjs';
import {ORIGIN} from './guards.mjs';
test('key-delete extension is exact local UI path, with no provider/API/query bypass',()=>{
  const path='/admin/keys/12345678-1234-1234-1234-123456789abc/delete';
  assert(journeyURL(ORIGIN+path));
  for(const url of ['https://example.invalid'+path,ORIGIN+path+'?secret=canary',ORIGIN+path+'#canary',ORIGIN+'/admin/api/connections/oauth/import',ORIGIN+'/admin/keys/not-a-uuid/delete',ORIGIN+'/v1/chat/completions'])assert(!journeyURL(url));
});
