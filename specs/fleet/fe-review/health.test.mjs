import test from 'node:test';import assert from 'node:assert/strict';
import { routeCategory,consoleObservation } from './health.mjs';
const base='http://127.0.0.1:18765';
test('route classification requires exact origin and no query or fragment',()=>{
 assert.equal(routeCategory(base+'/api/v1/services/missing-review/stop',base),'controlled-missing-stop');
 for(const value of ['',undefined,'private-token'])assert.equal(routeCategory(value,base),'unknown');
 assert.equal(routeCategory('https://external.invalid/api/v1/services/missing-review/stop',base),'external');
 assert.equal(routeCategory(base+'/favicon.ico?secret=private-token',base),'other');
 assert.equal(routeCategory(base+'/favicon.ico#private-token',base),'other');
});
test('console summary never emits raw unknown message or URL',()=>{
 const event=consoleObservation('error','private-token',base+'/private-token',base);
 assert.equal(event.code,'unclassified');assert.ok(!JSON.stringify(event).includes('private-token'));
 assert.equal(consoleObservation('error','Response Status Error Code 404 from /api/v1/services/missing-review/stop',base+'/static/htmx.min.js',base).code,'controlled-api-404');
});
