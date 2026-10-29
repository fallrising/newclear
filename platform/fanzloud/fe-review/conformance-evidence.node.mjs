import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {scenarios,fixedAssets} from './fixture.mjs';

// SPEC-T006R-conformance-proposal C1-c: evidence oracles over the accepted v7 recapture results.
// The results are private run evidence; FE_REVIEW_RUNS names the directory holding baseline-v7-*-001.
const root=process.env.FE_REVIEW_RUNS;
const phases=['desktop','tablet','mobile'],sizes={desktop:{width:1440,height:900},tablet:{width:834,height:1112},mobile:{width:390,height:844}};
const dirs=root?phases.map(p=>join(root,`baseline-v7-${p}-001`)):[];
const skip=!root?'FE_REVIEW_RUNS is unset; it must name the directory holding the baseline-v7-*-001 results':false;
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=()=>dirs.map((dir,i)=>{const bytes=readFileSync(join(dir,'result.json'));return {dir,phase:phases[i],bytes,result:JSON.parse(bytes)};});
const PRODUCT=['/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css','fixture.mjs','transport.mjs'];

test('review_canonical_capture_keys_are_complete_and_immutable',{skip},()=>{
 for(const dir of dirs)assert(existsSync(join(dir,'result.json')),dir);
 const runs=load();
 const keys=runs.flatMap(r=>r.result.captures.map(c=>c.key));
 assert.deepEqual(keys,phases.flatMap(p=>scenarios.map(s=>`${s}__${p}__dark`)));
 assert.equal(new Set(keys).size,27);
 for(const{phase,result,dir}of runs){
  assert(result.passed===true&&result.stage==='COMPLETE'&&result.mode==='remaining-baseline'&&result.phase===phase&&result.viewport===phase&&result.reuse==='NONE_SOURCE_CHANGED',phase);
  assert.deepEqual(result.retainedDesktopKeys,[],phase);
  for(const c of result.captures){assert.equal(c.png.privatePath,`screenshots/${c.key}.png`);assert.equal(sha(readFileSync(join(dir,c.png.privatePath))),c.png.sha256,c.key);}
  assert(result.cleanup.cancelled===false&&result.cleanup.drainComplete&&result.cleanup.listenerAbsent&&result.cleanup.resources.every(r=>r.closed),phase);
 }
 // One source for all three phases, and the documented desktop -> tablet -> mobile chain.
 for(const key of Object.keys(runs[0].result.sourceHashes))for(const r of runs.slice(1))assert.equal(r.result.sourceHashes[key],runs[0].result.sourceHashes[key],key);
 for(const key of PRODUCT)assert.equal(typeof runs[0].result.sourceHashes[key],'string',key);
 assert.equal(runs[0].result.selection.previousManifestSha256,null);
 assert.equal(runs[1].result.selection.previousManifestSha256,sha(runs[0].bytes));
 assert.equal(runs[2].result.selection.previousManifestSha256,sha(runs[1].bytes));
});

test('review_measured_presentation_is_accessible_at_three_sizes',{skip},()=>{
 for(const{phase,result}of load())for(const c of result.captures){
  assert.deepEqual(c.dom.viewport,sizes[phase],c.key);
  assert.equal(c.dom.overflow,false,c.key);assert.equal(c.dom.document.scroll,c.dom.document.client,c.key);
  assert.deepEqual(c.axe.violations.filter(v=>['critical','serious'].includes(v.impact)),[],c.key);
  assert.deepEqual([...new Set(c.axe.incomplete.map(v=>v.id))].filter(id=>id!=='color-contrast'),[],c.key); // contrast: SPEC-T006R-m2-repair M2-03 bounded evidence
  for(const region of[c.dom.event,c.dom.diff]){assert.equal(region.tabIndex,0,c.key);assert.equal(region.role,'region',c.key);assert.equal(region.labelledBy,true,c.key);}
  if(c.state!=='bootstrap-empty')assert(c.keyboard.length>0,c.key);
 }
});

test('review_secrets_clear_and_diff_is_inert',{skip},()=>{
 for(const{result,bytes}of load()){
  for(const c of result.captures){assert(c.storageSafe===true&&c.dom.bearerEmpty===true&&c.dom.promptEmpty===true&&c.dom.inertDiff===true,c.key);}
  const text=bytes.toString('utf8');
  for(const pattern of[/__Host-codebox_p0=[A-Za-z0-9_-]/,/Bearer [A-Za-z0-9._~+/-]{16,}/,/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/synthetic-review-bootstrap-canary/])assert.doesNotMatch(text,pattern);
 }
});

test('review_evidence_keeps_native_and_mock_boundaries',{skip},()=>{
 const served=new Map([...fixedAssets()].map(([path,asset])=>[path,sha(asset.body)]));
 for(const{phase,result}of load()){
  assert.match(result.scope,/candidate until independent actual review/,phase);assert.doesNotMatch(result.scope,/production|real backend|Cloud acceptance/i,phase);
  assert.equal(result.m2Accepted,false,phase);
  assert.deepEqual([result.tools.node,result.tools.playwright,result.tools.chromium],['v24.18.0','1.63.0','153.0.8010.12'],phase);
  for(const path of served.keys())assert.equal(result.sourceHashes[path],served.get(path),phase+' '+path); // evidence is for exactly the current served assets
 }
 // The mock boundary and native-gate rule come from the governing Round 2 SDD, not from this proposal.
 const sdd=readFileSync(new URL('../../../docs/fe-review/ROUND2-SDD.md',import.meta.url),'utf8');
 assert.match(sdd,/mock 不等於真 backend\/Cloud 驗收；真整合須另有明確範圍/);assert.match(sdd,/無對應 test script 的項目說明原生 gate 適用性/);
});
