import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {run,call,sample} from '../../scripts/mock-agent.mjs';
const exec=promisify(execFile),cwd=fileURLToPath(new URL('../',import.meta.url)),cli=resolve(cwd,'node_modules/wrangler/bin/wrangler.js');
const env={...process.env,WRANGLER_SEND_METRICS:'false',CI:'true'};
const schema=JSON.parse(readFileSync(new URL('../../contracts/schemas/telemetry-report.v1.schema.json',import.meta.url),'utf8'));
// The mock Agent's reports must satisfy the published M0 JSON Schema, not only the runtime parser.
const ajv=new Ajv2020({strict:false,validateFormats:false});const validate=ajv.compile(schema);
const fixture=sample('node_demo01',Date.parse('2026-09-28T10:30:00Z'));
assert.equal(validate(fixture),true);assert.equal(validate(sample('node_demo03',Date.parse('2026-09-28T10:30:00Z'),0,undefined,null)),true);
assert.equal(validate({...fixture,command:'reboot'}),false);
await exec(process.execPath,[cli,'d1','migrations','apply','edge-ops-demo','--local'],{cwd,env,timeout:90_000});
const child=spawn(process.execPath,[cli,'dev','--local','--var','MODE:demo','--ip','127.0.0.1','--port','8788'],{cwd,env,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>{logs=(logs+x).slice(-12000);});child.stderr.on('data',x=>{logs=(logs+x).slice(-12000);});
try {
 let ready=false;
 for(let i=0;i<120;i++) {
   if(child.exitCode!==null) throw new Error(`Wrangler exited: ${logs}`);
   try {const r=await fetch('http://127.0.0.1:8788/healthz',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}
   await delay(500);
 }
 assert.ok(ready,`Local workerd did not start: ${logs}`);
 const base='http://127.0.0.1:8788';await run('reset',base,()=>{});await run('seed',base,()=>{});
 let nodes=(await call(base,'/api/v1/nodes')).data.nodes;assert.equal(nodes.length,3);assert.equal(nodes[0].sample_count,12);
 await run('replay',base,()=>{});await run('offline',base,()=>{});assert.ok((await call(base,'/api/v1/nodes')).data.nodes.every(n=>n.connectivity==='offline'));
 await run('recover',base,()=>{});nodes=(await call(base,'/api/v1/nodes')).data.nodes;assert.equal(nodes[0].connectivity,'online');assert.equal(nodes[0].sample_count,13);assert.equal(nodes[1].connectivity,'offline');
 const history=await call(base,'/api/v1/nodes/node_demo01/metrics?limit=2');assert.equal(history.data.truncated,true);
 console.log('PASS: real local workerd + local D1 (M0 migrations), M0 telemetry reports from the HTTP mock Agent: seed/replay/offline/recover/history. No remote Cloudflare resources.');
} finally {
 child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),delay(3000)]);
 if(child.exitCode===null) child.kill('SIGKILL');
}
