import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTelemetryReport} from '../backend/src/domain/contract/telemetry.ts';
import {parseStrictJson} from '../backend/src/domain/contract/strictJson.ts';
import {sample} from './mock-agent.mjs';

// The mock Agent must produce exactly the M0 telemetry contract: the same parser the Worker uses,
// and the same key sets as the published JSON Schema. Dependency-free so it runs before npm ci.
const read=p=>JSON.parse(readFileSync(new URL('../contracts/'+p,import.meta.url),'utf8'));
const schema=read('schemas/telemetry-report.v1.schema.json');
const vectors=read('vectors/telemetry.json');
const bytes=o=>new TextEncoder().encode(JSON.stringify(o));
const now=Date.parse('2026-09-28T10:30:00Z');
for (const cpu of [24,88,null]) {
  const body=sample('node_demo01',now,3,'00000000-0000-4000-8000-000000000001',cpu);
  const report=parseTelemetryReport(bytes(body));
  assert.equal(report.node_id,'node_demo01');
  assert.deepEqual(Object.keys(body).sort(),[...schema.required].sort());
  assert.deepEqual(Object.keys(body).sort(),Object.keys(schema.properties).sort());
  assert.deepEqual(Object.keys(body.metrics).sort(),Object.keys(schema.properties.metrics.properties).sort());
}
parseTelemetryReport(bytes(vectors.base));
assert.throws(()=>parseTelemetryReport(bytes({...sample('node_demo01',now),command:'reboot'})));
assert.throws(()=>parseStrictJson(new TextEncoder().encode('{"seq":1,"seq":2}'),1024));
const api=readFileSync(new URL('../contracts/openapi.yaml',import.meta.url),'utf8');
for (const path of ['/agent/v1/enroll:','/agent/v1/telemetry:','/api/v1/nodes:','/api/v1/nodes/{id}:','/api/v1/nodes/{id}/metrics:']) assert.ok(api.includes(`\n  ${path}`),`openapi.yaml lacks ${path}`);
console.log('Mock Agent reports pass the M0 telemetry parser and match the v1 JSON Schema key sets; demo routes exist in openapi.yaml.');
