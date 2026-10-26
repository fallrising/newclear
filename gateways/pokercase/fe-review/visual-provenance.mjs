import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function desktopContrastPrior(component,result){
  const bytes=await readFile(join(component,'fe-review/runs/visual-001/result.json'));
  assert(sha(bytes)==='9e2d93c9ed6250fb906d4d4ee1619de5670c97b3429bc0141a6dade299633d46','REVIEW_DESKTOP_PRIOR_RECEIPT');
  const prior=JSON.parse(bytes);assert(prior.status==='passed'&&prior.mode==='visual'&&prior.binarySHA256===result.binarySHA256,'REVIEW_DESKTOP_PRIOR_BINARY');
  assert(prior.captures.length===18&&new Set(prior.captures.map(row=>row.page+'/'+row.viewport.name)).size===18&&prior.captures.every(row=>row.status===200&&row.axe.violations.length===0&&row.geometry.documentWidth<=row.geometry.viewportWidth+1),'REVIEW_DESKTOP_PRIOR_MATRIX');
  assert(prior.journey.passed&&prior.journey.steps.length===14&&prior.cleanup.length===9&&prior.cleanup.every(row=>row.passed),'REVIEW_DESKTOP_PRIOR_GATES');
  for(const name of ['fe-review/browser-baseline.mjs','fe-review/journeys.mjs','fe-review/navigation.mjs','fe-review/fixture.mjs','fe-review/guards.mjs','fe-review/mock-upstream.mjs'])assert(sha(await readFile(join(component,name)))===prior.sourceHashes[name],'REVIEW_DESKTOP_PRIOR_SOURCE');
  const selected=prior.captures.filter(row=>row.viewport.name==='desktop'&&row.axe.incomplete.length).map(row=>({page:row.page,viewport:row.viewport.name,incomplete:row.axe.incomplete}));
  assert(selected.length===1&&selected[0].page==='usage'&&selected[0].incomplete.length===1&&selected[0].incomplete[0].id==='color-contrast'&&selected[0].incomplete[0].nodes===1,'REVIEW_DESKTOP_CORRECTION_SCOPE');
  result.desktopContrastProvenance={run:'visual-001',receiptSHA256:sha(bytes),originalStatus:'passed',retainedMatrix:18,retainedJourneys:14,retainedContrastSets:12,invalidOriginalComputedPair:{page:'usage',labeledViewport:'desktop',actualWidth:390,actualHeight:844,reason:'old helper treated non-tablet names as mobile'},correction:'Only this one computed contrast set is repeated at1440x900; original receipt remains unchanged.'};
  return selected;
}
export async function visualProvenance(component,result){
  const evidence=join(component,'fe-review/tasks/round2/evidence');
  const pins={'final2-native.json':'c4294d5c8af24ac80a010525a305aea87ab67d5eeca8938ddbcb996f0419d2cd','visual-native.json':'a6e66e64c92bb48aab651fb1189580aad80b74b58338066014be277c61629ee7','visual-summary.json':'c70134ed537957b31fb1fdae7d8e8a8ef132028c176f6b12945d563f08e899e7'};
  for(const [name,expected] of Object.entries(pins))assert(sha(await readFile(join(evidence,name)))===expected,'REVIEW_VISUAL_NATIVE_RECEIPT');
  const before=JSON.parse(await readFile(join(evidence,'final2-native.json'))),after=JSON.parse(await readFile(join(evidence,'visual-native.json'))),built=JSON.parse(await readFile(join(evidence,'visual-summary.json')));
  assert(built.binarySHA256===result.binarySHA256&&built.passed===127&&built.failed===0&&after.checks.every(row=>row.exitCode===0),'REVIEW_VISUAL_BUILD');
  assert(JSON.stringify(Object.keys(before.sourceHashes).sort())===JSON.stringify(Object.keys(after.sourceHashes).sort()),'REVIEW_VISUAL_SOURCE_INVENTORY');
  const changed=[];for(const [name,expected] of Object.entries(after.sourceHashes)){assert(sha(await readFile(join(component,name)))===expected,'REVIEW_VISUAL_NATIVE_SOURCE');if(before.sourceHashes[name]!==expected)changed.push(name);}
  assert(changed.length===1&&changed[0]==='templates/style.css','REVIEW_VISUAL_ONLY_CSS');
  const css=await readFile(join(component,'templates/style.css'),'utf8');assert(sha(css.split('\n/* R2 visual repair:')[0])==='31830116d37bd69c979e5786d020d15f98e9afecffd8b0874dc2d9dd09ced87d','REVIEW_VISUAL_CSS_PREFIX');
  assert(sha(css)==='66ac524ba5844cf62caf2cec425afc5075a80c710898259e88ff064b57e2cd98','REVIEW_VISUAL_CSS_REPAIR');
  for(const name of ['login.html','dashboard.html'])assert(!(await readFile(join(component,'templates',name),'utf8')).includes('table-scroll'),'REVIEW_VISUAL_UNAFFECTED_PAGE');
  const priorRoot=join(component,'fe-review/runs/presentation-001'),priorBytes=await readFile(join(priorRoot,'result.json'));assert(sha(priorBytes)==='5bf029dccd3118d796aafa34070194c2508393bebcae5c6df5f421c2ae544814','REVIEW_VISUAL_PRIOR_WEB');const prior=JSON.parse(priorBytes);
  assert(sha(await readFile(join(resolve(component,'../..'),'docs/fe-review/capture.mjs')))===prior.sharedToolSHA256,'REVIEW_VISUAL_SHARED_TOOL');
  const unaffected=prior.shared.filter(row=>row.key.startsWith('login/login/')||row.key.startsWith('admin/dashboard/'));assert(unaffected.length===6&&new Set(unaffected.map(row=>row.key)).size===6,'REVIEW_VISUAL_SIX_KEYS');
  for(const row of unaffected){assert(row.status===200&&!row.horizontalOverflow&&!row.pageErrors&&!row.failedRequests,'REVIEW_VISUAL_UNAFFECTED_GEOMETRY');assert(/^shared\/screenshots\/(login__login|admin__dashboard)__(desktop|tablet|mobile)__dark\.png$/.test(row.screenshot.file),'REVIEW_VISUAL_PRIOR_IMAGE');assert(sha(await readFile(join(priorRoot,row.screenshot.file)))===row.screenshot.sha256,'REVIEW_VISUAL_PRIOR_IMAGE_CHANGED');}
  const terminalRoot=join(component,'fe-review/runs/repair-001'),terminalBytes=await readFile(join(terminalRoot,'result.json'));assert(sha(terminalBytes)==='388640075e6b6385a8b35e3d6d32e4b3b1fd63898b74906b0d0c99ccde6a52ab','REVIEW_VISUAL_REPAIR_RECEIPT');const repair=JSON.parse(terminalBytes);
  assert(repair.status==='passed'&&repair.terminal.captures.length===12&&repair.cleanup.every(row=>row.passed),'REVIEW_VISUAL_PRIOR_TUI');
  for(const name of ['src/tui_app.rs','fe-review/tui-capture.mjs','fe-review/fixture.mjs','fe-review/mock-upstream.mjs','fe-review/guards.mjs'])assert(sha(await readFile(join(component,name)))===repair.sourceHashes[name],'REVIEW_VISUAL_TUI_SOURCE_CHANGED');
  const terminalKeys=new Set();for(const capture of repair.terminal.captures){const key=capture.dataset+'/'+capture.size+'/'+capture.page;assert(!terminalKeys.has(key),'REVIEW_VISUAL_TUI_DUPLICATE');terminalKeys.add(key);for(const kind of ['plain','ansi']){const artifact=capture[kind];assert(/^tui-(empty|populated)-(80x24|120x40)-(connections|routes|usage)\.(txt|ansi)$/.test(artifact.file),'REVIEW_VISUAL_TUI_PATH');assert(sha(await readFile(join(terminalRoot,artifact.file)))===artifact.sha256,'REVIEW_VISUAL_TUI_ARTIFACT');}}
  assert(repair.terminal.exits.length===4&&repair.terminal.exits.every(row=>row.code===0&&row.sttyRestored&&row.alternateScreenRestored)&&repair.tuiCleanup.length===4&&repair.tuiCleanup.every(row=>row.serverAbsent&&row.paneGroupAbsent),'REVIEW_VISUAL_TUI_RESTORE');
  result.visualProvenance={nativeBeforeSHA256:sha(await readFile(join(evidence,'final2-native.json'))),nativeCurrentSHA256:sha(await readFile(join(evidence,'visual-native.json'))),changedNativeSources:changed,sharedOriginalRun:'presentation-001',sharedOriginalReceiptSHA256:sha(priorBytes),unaffectedShared:unaffected,priorSharedFailure:prior.failure,terminalOriginalRun:'repair-001',terminalOriginalReceiptSHA256:sha(terminalBytes),terminalOriginalBinarySHA256:repair.binarySHA256,currentBinarySHA256:result.binarySHA256,terminal:repair.terminal,tuiCleanup:repair.tuiCleanup,policy:'Current18 affected table pages are recaptured with actual geometry/axe and14 journeys rerun. Only6 login/dashboard shared keys use original images: added CSS selectors do not occur on those pages. Old shared console404 remains unlocated; separate CDP is corroboration, not proof of that event. TUI12 retains original binary provenance with identical TUI/backend/fixture source and verified24 artifacts; it is not rerun.'};
}
