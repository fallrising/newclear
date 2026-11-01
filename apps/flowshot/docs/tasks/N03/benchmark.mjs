import { build } from 'vite';
import { cpus, platform, release, totalmem } from 'node:os';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
// Browser-condition entity decoder uses an inert DOM at module initialization.
globalThis.document = new JSDOM('').window.document;
const output = process.env.AGENT_BUILD_DIR;
const evidence = process.env.AGENT_EVIDENCE_DIR;
if (!output || !evidence) throw new Error('Run through the shared workspace launcher');
const nodeConditions = process.env.N03_NODE_CONDITIONS === '1';
const label = process.env.N03_BENCH_LABEL ?? (nodeConditions ? 'node-diagnostic' : 'browser');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid benchmark evidence label');
const bundleDir = join(output,nodeConditions ? 'n03-node-diagnostic' : 'n03-production-benchmark');
mkdirSync(bundleDir,{recursive:true});
await build({ configFile:false, logLevel:'warn', ...(nodeConditions ? { resolve: { conditions: ['node','production'], mainFields: ['module','main'] } } : {}), build:{ ...(nodeConditions ? { rolldownOptions: { external: [/^node:/] } } : {}), target:'es2022', minify:true, outDir:bundleDir, emptyOutDir:false, lib:{ entry:resolve('src/lib/document-model/model.ts'), formats:['es'], fileName:()=>'model.mjs' } } });
const { buildModel } = await import(pathToFileURL(join(bundleDir,'model.mjs')).href);
// Repeated mixed semantic blocks, with no oversized code fence hiding parser work.
const unit = '# Synthetic 中文 heading\n\nProse **bold** e*́* 😀 中文 text with [local](notes.md).\n\n| Name | Value |\n| --- | --- |\n| 中文 | synthetic |\n\n- [x] synthetic task\n- ordinary list\n\n```typescript\nconst answer: number = 42;\nconsole.log(answer);\n```\n\n';
const targetBytes = 1024*1024;
const unitBytes = Buffer.byteLength(unit);
const repetitions = Math.floor((targetBytes-1)/unitBytes);
let fixture = unit.repeat(repetitions);
fixture += '\n' + 'x'.repeat(targetBytes - Buffer.byteLength(fixture)-1);
assert.equal(Buffer.byteLength(fixture),targetBytes);
const fixtureHash = createHash('sha256').update(fixture).digest('hex');
const fixturePath = join(evidence,'benchmark-1mib.md');
if (existsSync(fixturePath)) assert.equal(readFileSync(fixturePath,'utf8'),fixture);
else writeFileSync(fixturePath,fixture);
// Warm compiler/runtime on representative blocks, without caching a complete document.
for (let i=0;i<3;i++) buildModel(unit.repeat(10));
const runs=[];
for (let pair=0;pair<3;pair++) for (const hints of [false,true]) {
  const phases={}; let previous=performance.now(); const start=previous;
  const model=buildModel(fixture,hints,name=>{const now=performance.now(); phases[name]=now-previous; previous=now;});
  const elapsedMs=performance.now()-start;
  const canonicalBytes=Buffer.byteLength(model.canonicalText);
  let end=0;
  for (const segment of model.segments) { assert(segment.canonicalStart>=end); assert(segment.canonicalEnd<=canonicalBytes); end=segment.canonicalEnd; }
  assert(model.toc.length>0); assert(model.segments.length>0);
  console.log(JSON.stringify({ pair, hints, elapsedMs, phases }));
  runs.push({pair,hints,elapsedMs,phases,htmlBytes:Buffer.byteLength(model.html),modelBytes:Buffer.byteLength(JSON.stringify(model)),canonicalBytes,segments:model.segments.length,toc:model.toc.length});
}
const baseline=runs.filter(r=>!r.hints).map(r=>r.elapsedMs).sort((a,b)=>a-b)[1];
const mapped=runs.filter(r=>r.hints).map(r=>r.elapsedMs).sort((a,b)=>a-b)[1];
const result={node:process.version,diagnosticOnly:nodeConditions,conditions:nodeConditions?'node/production':'browser/production with jsdom entity DOM',mode:'Vite production minified ES2022 ESM; Node runtime; complete synchronous model',hardware:{cpu:cpus()[0]?.model,cpuCount:cpus().length,platform:platform(),release:release(),memoryBytes:totalmem(),dockerCpuLimit:4,dockerMemoryGiB:12},fixture:{bytes:Buffer.byteLength(fixture),sha256:fixtureHash,unitBytes,repetitions,description:'repeated heading/prose/emphasis/link/table/task-list/explicit-TypeScript-code/CJK/emoji; residual ASCII prose padding'},runs,medianBaselineMs:baseline,medianMappedMs:mapped,sourceMapRatio:mapped/baseline,thresholdMs:300,passed:runs.every(r=>r.elapsedMs<300)&&mapped/baseline<=2};
writeFileSync(join(evidence,`benchmark-${label}.json`),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
assert(result.passed,'Unchanged N03 oracle failed: every 1MiB full model <300ms and mapped/no-map median <=2');
