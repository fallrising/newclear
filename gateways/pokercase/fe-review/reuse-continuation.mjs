import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {classifyProbe} from './desktop-health.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function reuseContinuation(component,result){
  const root=join(component,'fe-review/runs/continuation-001');const bytes=await readFile(join(root,'result.json'));
  assert(sha(bytes)==='d904a79b493bae644ca593036586036743ee83b2ff55ce5300b109d5646bd2d9','REVIEW_REUSE_CONTINUATION_CHANGED');const old=JSON.parse(bytes);
  assert(old.status==='failed'&&old.failure.stage==='journey-invalid-login'&&old.failure.code==='REVIEW_LOGIN_ERROR'&&old.journey.steps.length===0,'REVIEW_REUSE_CONTINUATION_SCOPE');
  assert(old.cleanup.length===9&&old.cleanup.every(row=>row.passed),'REVIEW_REUSE_CONTINUATION_CLEANUP');
  const names=Object.keys(old.sourceHashes).filter(name=>name.startsWith('templates/'));
  names.push(...['guards','fixture','mock-upstream','browser-baseline','shared-capture','desktop-health','contrast-review'].map(name=>'fe-review/'+name+'.mjs'));
  for(const name of names)assert(sha(await readFile(join(component,name)))===old.sourceHashes[name],'REVIEW_REUSE_CONTINUATION_SOURCE');
  assert(old.desktopHealth.anonymous===true&&classifyProbe(old.desktopHealth).passed,'REVIEW_REUSE_DESKTOP_CLASSIFICATION');
  assert(old.contrastReview.length===4,'REVIEW_REUSE_CONTRAST_SETS');
  const nodes=old.contrastReview.flatMap(row=>row.observations.flatMap(observation=>observation.nodes));assert(nodes.length===92&&nodes.every(node=>node.computedPairPass&&node.ratio>=node.threshold),'REVIEW_REUSE_CONTRAST_PAIRS');
  const keys=new Set();assert(old.terminal.captures.length===12,'REVIEW_REUSE_TERMINAL_COUNT');
  for(const capture of old.terminal.captures){
    const key=capture.dataset+'/'+capture.size+'/'+capture.page;assert(!keys.has(key),'REVIEW_REUSE_TERMINAL_DUPLICATE');keys.add(key);
    for(const kind of ['plain','ansi']){const artifact=capture[kind];assert(/^tui-(empty|populated)-(80x24|120x40)-(connections|routes|usage)\.(txt|ansi)$/.test(artifact.file),'REVIEW_REUSE_TERMINAL_PATH');assert(sha(await readFile(join(root,artifact.file)))===artifact.sha256,'REVIEW_REUSE_TERMINAL_BYTES');}
  }
  assert(old.terminal.exits.length===4&&old.terminal.exits.every(row=>row.code===0&&row.sttyRestored&&row.alternateScreenRestored),'REVIEW_REUSE_TERMINAL_EXIT');
  assert(old.tuiCleanup.length===4&&old.tuiCleanup.every(row=>row.serverAbsent&&row.paneGroupAbsent),'REVIEW_REUSE_TERMINAL_ABSENCE');
  result.reusedContinuation={run:'continuation-001',receiptSHA256:sha(bytes),originalBinarySHA256:old.binarySHA256,currentBinarySHA256:result.binarySHA256,originalStatus:old.status,originalFailure:old.failure,originalJourneyHealth:old.journey.health,desktopHealth:old.desktopHealth,contrastReview:old.contrastReview,historicalTerminal:{captures:12,artifacts:24,exitProofs:4,cleanupProofs:4,currentCandidate:false,reason:'A later actual review found normal connection identity suffixes clipped; terminal renderer is repaired and must be captured anew.'},unchangedSources:names,policy:'Reuse only measured exact anonymous favicon classification and computed color pairs; native provenance permits TUI-only binary changes. Original failed login/aborted GET and previous terminal rendering remain immutable history, not current passes.'};
}
