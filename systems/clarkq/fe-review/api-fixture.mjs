import assert from 'node:assert/strict';
import {ORIGIN} from './guards.mjs';

export const longQueue = 'review_' + 'q'.repeat(57);
export const longBody = '合成中文 <script>literal & "quoted"</script> ' + '無空格長文字'.repeat(120);
export async function api(key, method, path, body, expected) {
  const response = await fetch(ORIGIN + path, {method, redirect:'error', signal:AbortSignal.timeout(5000), headers:{...(key ? {'X-API-Key':key} : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  assert(response.status === expected, 'REVIEW_API_STATUS');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function seed(key, check) {
  check();
  const publicUI = await fetch(ORIGIN + '/ui/', {redirect:'error', signal:AbortSignal.timeout(5000)});
  assert(publicUI.status === 200, 'REVIEW_UI_PUBLIC_STATUS'); await publicUI.arrayBuffer();
  await api(null, 'GET', '/api/v1/queues', undefined, 401);
  await api('intentionally-invalid-review-key', 'GET', '/api/v1/queues', undefined, 401);
  const initial = await api(key, 'GET', '/api/v1/queues', undefined, 200);
  assert(initial.queues.length === 0, 'REVIEW_NOT_EMPTY_SERVICE');
  const expected = [];
  for (const [name, count] of [[longQueue,3], ['review_empty',1], ...Array.from({length:12}, (_, i) => [`review_${String(i).padStart(2,'0')}`, i % 3 + 1])]) {
    for (let i = 0; i < count; i++) {check(); await api(key,'POST','/api/v1/queue/' + name, {body:i === 0 ? longBody : 'synthetic ' + i},201);}
    if (name === 'review_empty') await api(key, 'GET', '/api/v1/queue/' + name, undefined, 200);
    expected.push({name, depth:name === 'review_empty' ? 0 : count});
  }
  const actual = await api(key, 'GET', '/api/v1/queues', undefined, 200);
  assert.deepEqual(actual.queues.map(({name,depth})=>({name,depth})).sort((a,b)=>a.name.localeCompare(b.name)), expected.sort((a,b)=>a.name.localeCompare(b.name)), 'REVIEW_SEED_READBACK');
  return {publicUI:200, missingKey:401, invalidKey:401, authenticated:200, queues:expected, syntheticBody:true};
}
