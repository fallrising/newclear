#!/usr/bin/env node
// Audit original and optional explicitly repaired captures; never rewrite raw manifests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRecords } from './capture-selection.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const originalDir = path.resolve(process.argv[2]);
const repairDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const targets = load(path.join(here, 'targets.json'));
const originalTargets = repairDir ? load(path.join(originalDir, '../source-targets.json')) : targets;
const dimensions = { desktop: [1440, 900], tablet: [834, 1112], mobile: [390, 844] };
function expectations(inventory) {
  const result = new Map();
  for (const app of inventory.apps) for (const page of app.pages) for (const viewport of Object.keys(dimensions)) {
    const key=`${app.name}/${page.id}/${viewport}/light`;
    assert.equal(result.has(key), false, 'REVIEW_DUPLICATE_TARGET');
    result.set(key, { url: new URL(page.path, app.baseUrl).href, contract: JSON.stringify(page) });
  }
  return result;
}
const expected = expectations(targets);
const previous = expectations(originalTargets);
const replacementKeys = repairDir ? ['entry-new','album-composer','projects-board'].flatMap((page) => Object.keys(dimensions).map((viewport) => `web-back/${page}/${viewport}/light`)) : [];
assert.equal(expected.size,153,'REVIEW_CAPTURE_COUNT');
assert.equal(previous.size,expected.size,'REVIEW_PRIOR_COUNT');
for (const [key,value] of previous) {
  assert.equal(expected.has(key),true,'REVIEW_PRIOR_KEY');
  if (!replacementKeys.includes(key)) assert.equal(value.contract === expected.get(key).contract,true,'REVIEW_UNRELATED_TARGET_CHANGE');
}
function records(directory, contracts) {
  const manifest = load(path.join(directory, 'capture.json'));
  return manifest.results.map((value) => {
    const key=`${value.app}/${value.page}/${value.viewport}/${value.colorScheme}`;
    assert.equal(contracts.has(key),true,'REVIEW_CAPTURE_IDENTITY');
    assert.equal(value.url === contracts.get(key).url,true,'REVIEW_REQUESTED_URL');
    return { key, value, directory };
  });
}
const original = records(originalDir,previous);
const repair = repairDir ? records(repairDir,expected) : [];
const selected = selectRecords(original,repair,[...expected.keys()],replacementKeys);
const audited=[];
for (const selectedRecord of selected) {
  const { value: record, directory, key, attempt } = selectedRecord;
  assert.equal(record.status,200,'REVIEW_CAPTURE_STATUS');
  assert.equal(record.error === undefined,true,'REVIEW_CAPTURE_ERROR');
  assert.equal(record.pageErrors?.length,0,'REVIEW_CAPTURE_PAGE_ERRORS');
  assert.equal(/^screenshots\/[a-zA-Z0-9_.-]+\.png$/.test(record.screenshot),true,'REVIEW_SCREENSHOT_PATH');
  const file=path.join(directory,record.screenshot);
  const png=readFileSync(file);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','REVIEW_PNG');
  const [width,minimumHeight]=dimensions[record.viewport];
  assert.equal(png.readUInt32BE(16),width,'REVIEW_PNG_WIDTH');
  assert.ok(png.readUInt32BE(20)>=minimumHeight,'REVIEW_PNG_HEIGHT');
  audited.push({key,attempt,status:200,pageErrors:0,consoleErrors:record.consoleErrors?.length??null,failedRequests:record.failedRequests?.length??null,horizontalOverflow:record.horizontalOverflow,width,height:png.readUInt32BE(20),sha256:hash(file)});
}
const receipt={passed:true,captureCount:audited.length,originalCaptureSha256:hash(path.join(originalDir,'capture.json')),repairCaptureSha256:repairDir?hash(path.join(repairDir,'capture.json')):null,originalTargetsSha256:repairDir?hash(path.join(originalDir,'../source-targets.json')):hash(path.join(here,'targets.json')),currentTargetsSha256:hash(path.join(here,'targets.json')),explicitReplacements:replacementKeys,originalFailedRecords:original.filter((x)=>x.value.error).length,scope:'R2 M1/M2 only; original failures retained. Console/request/overflow observations are not full R3 acceptance.',results:audited};
writeFileSync(path.join(repairDir||originalDir,'capture-audit.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(`PASS ${audited.length} unique captures; ${replacementKeys.length} explicit replacements; original failures retained`);
