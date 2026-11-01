import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function reuseWeb(component,result){
  const evidence=join(component,'fe-review/tasks/round2/evidence');
  const pinned={
    'presentation-native.json':'cde497aeef05ee4ea89a5b880e54b0bfc43524d749840d5830d39bd7d3722fcd',
    'final-native.json':'badcd321adece9cf79f09401df695c6dac2183399e687b9b1cba697a83d7ac09',
    'final-summary.json':'c26d17616a2021cefed2858b2f01df873f1865b68473adbec1bab622c6034252',
    'final2-native.json':'c4294d5c8af24ac80a010525a305aea87ab67d5eeca8938ddbcb996f0419d2cd',
    'final2-summary.json':'b1a2aff86533e91cbc9c1fe2c609334e843100cdfb08d8c0f0335d4bbeb5e791',
  };
  for(const [name,expected] of Object.entries(pinned))assert(sha(await readFile(join(evidence,name)))===expected,'REVIEW_REUSE_NATIVE_RECEIPT_CHANGED');
  const nativeBefore=JSON.parse(await readFile(join(evidence,'presentation-native.json')));
  const nativeFinal=JSON.parse(await readFile(join(evidence,'final2-native.json')));
  const built=JSON.parse(await readFile(join(evidence,'final2-summary.json')));
  assert(built.binarySHA256===result.binarySHA256&&built.tuiSourceSHA256===result.sourceHashes['src/tui_app.rs'],'REVIEW_REUSE_BUILD_PROVENANCE');
  assert(nativeFinal.checks.every(row=>row.exitCode===0)&&built.passed===127&&built.failed===0,'REVIEW_REUSE_NATIVE_GATE');
  assert(sha(await readFile(join(component,'Cargo.lock')))==='f78f6e833024f261d61b776a95be1230163de4fa600eb64a63955053640b7114','REVIEW_REUSE_LOCK_CHANGED');
  const changed=[];
  assert(JSON.stringify(Object.keys(nativeBefore.sourceHashes).sort())===JSON.stringify(Object.keys(nativeFinal.sourceHashes).sort()),'REVIEW_REUSE_SOURCE_INVENTORY');
  for(const [name,expected] of Object.entries(nativeFinal.sourceHashes)){
    assert(sha(await readFile(join(component,name)))===expected,'REVIEW_REUSE_NATIVE_SOURCE_CHANGED');
    if(nativeBefore.sourceHashes[name]!==expected)changed.push(name);
  }
  assert(changed.length===1&&changed[0]==='src/tui_app.rs','REVIEW_REUSE_UNEXPECTED_NATIVE_DELTA');
  result.nativeProvenance={oldManifestSHA256:sha(await readFile(join(evidence,'presentation-native.json'))),finalManifestSHA256:sha(await readFile(join(evidence,'final2-native.json'))),changedSources:changed,finalBinarySHA256:built.binarySHA256,finalSourceHead:nativeFinal.sourceHead};
  const root=join(component,'fe-review/runs/presentation-001');
  const bytes=await readFile(join(root,'result.json'));
  assert(sha(bytes)==='5bf029dccd3118d796aafa34070194c2508393bebcae5c6df5f421c2ae544814','REVIEW_REUSE_RECEIPT_CHANGED');
  const old=JSON.parse(bytes);
  assert(old.status==='failed'&&old.failure.code==='REVIEW_SHARED_HEALTH'&&old.shared.length===24&&old.captures.length===22,'REVIEW_REUSE_ORIGINAL_SCOPE');
  assert(old.cleanup.length===9&&old.cleanup.every(row=>row.passed),'REVIEW_REUSE_CLEANUP');
  const names=Object.keys(old.sourceHashes).filter(name=>name.startsWith('templates/'));
  names.push('fe-review/guards.mjs','fe-review/fixture.mjs','fe-review/mock-upstream.mjs','fe-review/browser-baseline.mjs','fe-review/shared-capture.mjs');
  for(const name of names)assert(sha(await readFile(join(component,name)))===old.sourceHashes[name],'REVIEW_REUSE_SOURCE_CHANGED');
  assert(sha(await readFile(join(resolve(component,'../..'),'docs/fe-review/capture.mjs')))===old.sharedToolSHA256,'REVIEW_REUSE_TOOL_CHANGED');
  assert(sha(await readFile(join(root,'shared/capture.json')))===old.sharedManifestSHA256,'REVIEW_REUSE_MANIFEST_CHANGED');
  const keys=new Set();
  for(const row of old.shared){
    assert(!keys.has(row.key)&&row.status===200&&!row.horizontalOverflow&&row.pageErrors===0&&row.failedRequests===0,'REVIEW_REUSE_SHARED');keys.add(row.key);
    assert(row.consoleEvents===(row.key==='login/login/desktop/dark'?1:0),'REVIEW_REUSE_HEALTH_CHANGED');
    assert(/^shared\/screenshots\/[a-z-]+__[a-z-]+__(desktop|tablet|mobile)__dark\.png$/.test(row.screenshot.file),'REVIEW_REUSE_IMAGE_PATH');
    const png=await readFile(join(root,row.screenshot.file));assert(sha(png)===row.screenshot.sha256&&png.readUInt32BE(16)===row.screenshot.width,'REVIEW_REUSE_IMAGE_CHANGED');
  }
  assert(keys.size===24,'REVIEW_REUSE_KEY_COUNT');
  assert(old.captures.every(row=>row.geometry.documentWidth<=row.geometry.viewportWidth+1&&row.axe.violations.length===0&&row.health.consoleErrors===0&&row.health.consoleWarnings===0&&row.health.pageErrors===0&&row.health.blocked===0&&!row.health.http.length&&!row.health.failed.length),'REVIEW_REUSE_COMPANION');
  result.reusedWeb={run:'presentation-001',receiptSHA256:sha(bytes),originalStatus:'failed',originalFailure:old.failure,sharedKeys:[...keys],sharedManifestSHA256:old.sharedManifestSHA256,sharedToolSHA256:old.sharedToolSHA256,sharedGeometry:24,strictCompanions:22,unchangedSources:names,incomplete:old.captures.filter(row=>row.axe.incomplete.length).map(row=>({page:row.page,viewport:row.viewport.name,incomplete:row.axe.incomplete})),originalBinarySHA256:old.binarySHA256,currentBinarySHA256:result.binarySHA256,binaryPolicy:'Root rebuilt measured TUI-only presentation changes; all embedded Web templates and fixture/scan/shared sources byte-identical. Original unlocated desktop console404 remains failed; fresh probe is supplemental evidence, not a rewrite.'};
}
