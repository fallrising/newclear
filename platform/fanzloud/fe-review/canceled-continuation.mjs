import assert from 'node:assert/strict';
import {selectContinuation} from './continuation.mjs';
export function selectCanceledContinuation({viewport,prior,supplement,afterDevice,currentHashes,states}){
 const selected=selectContinuation({mode:'after-device',viewport,prior,supplement,currentHashes,states});
 assert(afterDevice?.passed===false&&afterDevice.failure==='REVIEW_BASELINE_HEALTH'&&afterDevice.stage==='canceled-local'&&afterDevice.viewport===viewport,'REVIEW_AFTER_DEVICE_FAILURE');
 assert.equal(afterDevice.selection?.mode,'after-device','REVIEW_AFTER_DEVICE_MODE');assert.deepEqual(afterDevice.selection.requestedStates,states.slice(3),'REVIEW_AFTER_DEVICE_SELECTION');
 for(const file of ['fixture.mjs','transport.mjs','lifecycle.mjs','trust.mjs','baseline-support.mjs','/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css'])assert.equal(currentHashes[file],afterDevice.sourceHashes[file],'REVIEW_AFTER_DEVICE_SOURCE');
 for(const tool of ['node','playwright','chromium'])assert.equal(afterDevice.tools[tool],prior.tools[tool],'REVIEW_AFTER_DEVICE_TOOL');
 assert.equal(afterDevice.captures.length,4,'REVIEW_AFTER_DEVICE_KEYS');
 assert(afterDevice.cleanup.drainComplete&&afterDevice.cleanup.listenerAbsent&&afterDevice.cleanup.resources.every(r=>r.closed),'REVIEW_AFTER_DEVICE_CLEANUP');
 for(const state of states.slice(3,6)){
  const key=state+'__'+viewport+'__dark',rows=afterDevice.captures.filter(r=>r.key===key);assert.equal(rows.length,1,'REVIEW_AFTER_DEVICE_KEY');const r=rows[0];
  assert(r.semanticPassed&&r.assetStatus===200&&r.storageSafe&&r.dom.bearerEmpty&&r.dom.promptEmpty&&r.png?.sha256&&r.health.every(e=>e.expected),'REVIEW_AFTER_DEVICE_ROW');
  selected.reused.push({key,manifest:'after-device',png:r.png.sha256,originalBaselineHash:afterDevice.sourceHashes['baseline.mjs']});
 }
 const failed=afterDevice.captures[3];assert.equal(failed.key,'canceled-local__desktop__dark','REVIEW_AFTER_DEVICE_FAILED_KEY');assert.equal(failed.semanticPassed,false,'REVIEW_AFTER_DEVICE_FAILED_ROW');
 return {states:states.slice(6),reused:selected.reused,originalPassed:false};
}
