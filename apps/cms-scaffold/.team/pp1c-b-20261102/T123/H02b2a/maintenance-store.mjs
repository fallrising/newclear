import { constants } from 'node:fs';
import { lstat, open, rename, mkdir, readdir, rmdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join, parse } from 'node:path';
const requireSafe = value => { if (!value) throw new Error('QUIESCENCE_NOT_PROVEN'); };
export function rootFor(runId, deps) {
  requireSafe(typeof runId === 'string' && /^[a-f0-9]{32}$/.test(runId));
  return join(resolve(deps.cwd ?? process.cwd()), 'local/pp1', runId);
}
async function pathSafe(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/')) { current = join(current, part); requireSafe(!(await lstat(current)).isSymbolicLink()); }
}
export async function directory(path) {
  await pathSafe(path); const info = await lstat(path);
  requireSafe(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o7777) === 0o700); return info;
}
export async function read(path, strict = false) {
  await directory(parse(path).dir); await pathSafe(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat(); requireSafe(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o7777) === 0o600 && info.size <= 1048576);
    const bytes = await handle.readFile();
    return strict ? parseStrictJson(bytes) : JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}
export async function writeNew(path, value) {
  await directory(parse(path).dir); const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(parse(path).dir);
}
export async function syncDirectory(path) {
  const handle = await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function update(path, value) {
  await read(path); const temp = `${path}.tmp-${randomBytes(16).toString('hex')}`;
  await writeNew(temp, value); await rename(temp, path); await syncDirectory(parse(path).dir);
}


import { isIPv4 } from 'node:net';
import { canonicalBytes, parseStrictJson, sha256, OpsError } from '../ops/recovery-protocol.mjs';
const ensure = (condition, code = 'INPUT_INVALID') => { if (!condition) throw new OpsError(code); };
const isHex = (value, size) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const isImage = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const same = (a, b) => canonicalBytes(a).equals(canonicalBytes(b));
function exact(value, fields) {
  const names = fields.split(' ');
  ensure(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key)));
}
function utc(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}
function privateIp(value) {
  if (!isIPv4(value ?? '')) return false;
  const [a,b] = value.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function connection(value) {
  exact(value, 'jdbcUrl dataGateway');
  ensure(privateIp(value.dataGateway) && typeof value.jdbcUrl === 'string');
  ensure(privateIp(/^jdbc:postgresql:\/\/([^/]+):5432\/cms$/.exec(value.jdbcUrl)?.[1]));
}
export function validateTargetV1(t) {
  exact(t, 'version runId targetId project sourceCommit apiBuild images containerIds networkIds volumeNames databaseOid ingressScriptSha256 nodeBinarySha256 mediaProbeSha256');
  ensure(t.version === 1 && isHex(t.runId,32) && isHex(t.sourceCommit,40)
    && t.targetId === `pp1-local:${t.runId}` && t.project === `cms-pp1-local-${t.runId}`);
  exact(t.apiBuild, 'sourceCommit jarSha256 baseImage');
  ensure(t.apiBuild.sourceCommit === t.sourceCommit && isHex(t.apiBuild.jarSha256,64) && isImage(t.apiBuild.baseImage));
  for (const [key, fields] of [['images','api node postgres'],['containerIds','postgres cms-api ingress'],['networkIds','web data']]) {
    exact(t[key],fields); ensure(Object.values(t[key]).every(v => key === 'images' ? isImage(v) : isHex(v,64)));
  }
  exact(t.volumeNames,'db-data media-data');
  ensure(Object.entries(t.volumeNames).every(([k,v]) => v === `${t.project}_${k}`));
  ensure(Number.isInteger(t.databaseOid) && t.databaseOid > 0 && t.databaseOid <= 4294967295);
  ensure(['ingressScriptSha256','nodeBinarySha256','mediaProbeSha256'].every(k => isHex(t[k],64)));
  return t;
}
export const WORKFLOW_PHASES = Object.freeze({
  BACKUP_LOCAL: Object.freeze(['PRECHECK','SOURCE_QUIESCED','LOCAL_CAPTURED','LOCAL_VERIFIED','COMPLETE']),
  RESTORE_VERIFY_LOCAL: Object.freeze(['PRECHECK','SOURCE_QUIESCED','LOCAL_CAPTURED','LOCAL_VERIFIED','TARGET_RESERVED','TARGET_BLANK',
    'DB_RESTORED','MEDIA_RESTORED','RAW_VERIFIED','SESSIONS_REVOKED','STARTUP_VERIFIED','API_HEALTHY','INGRESS_STARTED',
    'BROWSER_VERIFIED','TARGET_STOPPED','RESTART_VERIFIED','COMPLETE']),
  RECOVER_ADMIN: Object.freeze(['PRECHECK','SOURCE_QUIESCED','PROOF_REVALIDATED','ACCOUNT_PRE_CONNECTION','ACCOUNT_BOUND','ACCOUNT_COMMITTED','COMPLETE'])
});
function backend(b, operationId, address) {
  exact(b,'pid backendStartEpoch db role clientAddr applicationName');
  ensure(Number.isInteger(b.pid) && b.pid > 0 && b.pid <= 2147483647
    && typeof b.backendStartEpoch === 'string' && /^[1-9][0-9]*\.[0-9]+$/.test(b.backendStartEpoch));
  ensure(b.db === 'cms' && b.role === 'cms_local' && privateIp(b.clientAddr)
    && b.clientAddr === address && b.applicationName === operationId);
}
function restoreTarget(t, l) {
  exact(t,'version runId targetId project sourceOperationId creationPhase identity connection preparationSha256 createdResourceSetSha256');
  ensure(t.version === 1 && isHex(t.runId,32) && t.runId !== l.source.runId
    && t.targetId === `pp1-local:${t.runId}` && t.project === `cms-pp1-local-${t.runId}` && t.sourceOperationId === l.operationId);
  ensure(['RESERVED','CREATED','BLANK_VERIFIED'].includes(t.creationPhase));
  const fields = ['identity','connection','preparationSha256','createdResourceSetSha256'];
  if (t.creationPhase === 'RESERVED') ensure(fields.every(k => t[k] === null));
  else {
    validateTargetV1(t.identity); connection(t.connection);
    ensure(t.identity.runId === t.runId && fields.slice(2).every(k => isHex(t[k],64)));
    ensure(t.identity.sourceCommit === l.source.sourceCommit && same(t.identity.apiBuild,l.source.apiBuild));
    ensure(Object.values(t.identity.containerIds).every(id => !Object.values(l.source.containerIds).includes(id))
      && Object.values(t.identity.networkIds).every(id => !Object.values(l.source.networkIds).includes(id)));
  }
}
function helper(h, l) {
  exact(h,'kind side fullContainerId policySha256 state endpoint backend startedAt');
  ensure(['source','target'].includes(h.side) && isHex(h.fullContainerId,64) && isHex(h.policySha256,64)); utc(h.startedAt);
  ensure(['CREATED','RUNNING','READY','PERMITTED','EXITED'].includes(h.state));
  const allowed = h.side === 'source' ? ['INVENTORY','PG_DUMP','MEDIA_PACK'] : ['INVENTORY','PG_RESTORE','MEDIA_RESTORE','REVOKE_SESSIONS','BROWSER'];
  ensure(allowed.includes(h.kind) && (h.side === 'source' || l.target?.identity));
  const identity = h.side === 'source' ? l.source : l.target.identity;
  if (['MEDIA_PACK','MEDIA_RESTORE'].includes(h.kind)) ensure(h.endpoint === null && h.backend === null);
  else {
    if (h.state === 'CREATED') ensure(h.endpoint === null && h.backend === null);
    if (h.endpoint !== null) {
      exact(h.endpoint,'networkId address');
      ensure(h.endpoint.networkId === identity.networkIds[h.kind === 'BROWSER' ? 'web' : 'data'] && privateIp(h.endpoint.address));
    } else ensure(h.state === 'CREATED' || h.state === 'EXITED');
    if (['READY','PERMITTED'].includes(h.state)) ensure(['INVENTORY','REVOKE_SESSIONS'].includes(h.kind) && h.backend !== null);
    if (h.backend !== null) backend(h.backend,l.operationId,h.endpoint?.address);
    if (['INVENTORY','REVOKE_SESSIONS'].includes(h.kind) && ['CREATED','RUNNING'].includes(h.state)) ensure(h.backend === null);
    if (h.kind === 'BROWSER') ensure(h.backend === null);
  }
  ensure(l.phase !== 'PRECHECK' && l.phase !== 'COMPLETE');
  if (h.kind === 'REVOKE_SESSIONS') ensure(l.phase === 'RAW_VERIFIED' || l.phase === 'SESSIONS_REVOKED' || l.phase === 'FAILED_OR_UNKNOWN');
  if (h.kind === 'BROWSER') ensure(['INGRESS_STARTED','BROWSER_VERIFIED','FAILED_OR_UNKNOWN'].includes(l.phase));
}
function proof(p, l) {
  exact(p,'backupId manifestSha256 bundleSetSha256 sourceInventorySha256 sourceIdentitySha256 restoreOperationId restoreTargetId rawComparisonSha256 sessionCommitSha256 smokeSha256 proofSha256');
  ensure(typeof p.backupId === 'string' && /^pp1-\d{8}T\d{9}Z-[0-9a-f]{32}$/.test(p.backupId));
  ensure(isUuid(p.restoreOperationId) && /^pp1-local:[0-9a-f]{32}$/.test(p.restoreTargetId));
  ensure(Object.entries(p).filter(([k]) => k.endsWith('Sha256')).every(([,v]) => isHex(v,64)));
  const { proofSha256, ...preimage } = p;
  ensure(proofSha256 === sha256(canonicalBytes(preimage)) && p.sourceIdentitySha256 === sha256(canonicalBytes(l.source)));
  if (l.purpose === 'RESTORE_VERIFY_LOCAL') ensure(p.restoreOperationId === l.operationId && p.restoreTargetId === l.target.targetId);
}
export function validateLeaseV2(l) {
  try {
    canonicalBytes(l);
    exact(l,'version operationId purpose releaseId phase createdAt requestSha256 source sourceConnection originalApiState completionPolicy target helper proof account');
    ensure(l.version === 2 && isUuid(l.operationId) && Object.hasOwn(WORKFLOW_PHASES,l.purpose));
    const phases = WORKFLOW_PHASES[l.purpose], index = phases.indexOf(l.phase), failed = l.phase === 'FAILED_OR_UNKNOWN';
    ensure(index >= 0 || failed); utc(l.createdAt); ensure(isHex(l.requestSha256,64));
    validateTargetV1(l.source); connection(l.sourceConnection);
    ensure(l.releaseId === `sha256:${l.source.apiBuild.jarSha256}` && ['running','stopped'].includes(l.originalApiState));
    ensure(l.completionPolicy === (l.purpose === 'BACKUP_LOCAL' ? 'RESTORE_ORIGINAL' : 'KEEP_STOPPED'));
    if (l.purpose === 'RECOVER_ADMIN') ensure(l.originalApiState === 'stopped');
    if (l.purpose !== 'RESTORE_VERIFY_LOCAL') ensure(l.target === null);
    else if (!failed) ensure(index < phases.indexOf('TARGET_RESERVED') ? l.target === null : l.target !== null);
    if (l.target !== null) {
      restoreTarget(l.target,l);
      if (!failed && index >= phases.indexOf('TARGET_BLANK')) ensure(l.target.creationPhase === 'BLANK_VERIFIED');
    }
    if (l.helper !== null) helper(l.helper,l);
    if (l.purpose === 'BACKUP_LOCAL') ensure(l.proof === null);
    else if (!failed) {
      const start = phases.indexOf(l.purpose === 'RECOVER_ADMIN' ? 'PROOF_REVALIDATED' : 'RESTART_VERIFIED');
      ensure(index < start ? l.proof === null : l.proof !== null);
    }
    if (l.proof !== null) proof(l.proof,l);
    if (l.purpose !== 'RECOVER_ADMIN') ensure(l.account === null);
    else if (!failed) ensure(index < phases.indexOf('ACCOUNT_PRE_CONNECTION') ? l.account === null : l.account !== null);
    if (l.account !== null) {
      exact(l.account,'operation phase boundBackend');
      ensure(l.account.operation === 'RECOVER_ADMIN' && ['PRE_CONNECTION','BOUND','COMMITTED'].includes(l.account.phase));
      if (l.account.phase === 'PRE_CONNECTION') ensure(l.account.boundBackend === null);
      else backend(l.account.boundBackend,l.operationId,l.sourceConnection.dataGateway);
      if (!failed && l.phase !== 'COMPLETE') ensure(l.phase === `ACCOUNT_${l.account.phase}`);
    }
    if (l.phase === 'COMPLETE') ensure(l.helper === null);
    return l;
  } catch { throw new OpsError('INPUT_INVALID'); }
}

const now = deps => new Date((deps.clock ?? Date.now)()).toISOString();
async function canonicalNew(path, value, deps = {}) {
  await directory(parse(path).dir);
  const handle = await open(path,'wx',0o600);
  try { await handle.writeFile(canonicalBytes(value)); await deps.fault?.('before-file-sync'); await handle.sync(); }
  finally { await handle.close(); }
  await deps.fault?.('before-directory-sync'); await syncDirectory(parse(path).dir);
}
async function canonicalUpdate(path, value, deps, strict = true) {
  await read(path,strict);
  const temp = `${path}.tmp-${randomBytes(16).toString('hex')}`;
  await canonicalNew(temp,value,deps); await deps.fault?.('before-rename');
  await rename(temp,path); await deps.fault?.('before-directory-sync'); await syncDirectory(parse(path).dir);
}
function requestValid(r,l) {
  exact(r,'version operationId sourceRunId purpose targetRunId incidentStartedAt startedAt environment');
  ensure(r.version===1 && r.operationId===l.operationId && r.sourceRunId===l.source.runId && r.purpose===l.purpose);
  utc(r.startedAt);ensure(r.startedAt===l.createdAt);
  if(r.purpose==='RESTORE_VERIFY_LOCAL') {
    ensure(isHex(r.targetRunId,32) && r.targetRunId!==r.sourceRunId && r.environment==='isolated-drill');
    utc(r.incidentStartedAt);ensure(r.incidentStartedAt<=r.startedAt);
    if(l.target)ensure(l.target.runId===r.targetRunId);
  } else ensure(r.targetRunId===null && r.incidentStartedAt===null && r.environment===null);
  ensure(sha256(canonicalBytes(r))===l.requestSha256);
}
export function validateJournalV2(j,l,{allowPending=false}={}) {
  try {
    validateLeaseV2(l);exact(j,'version operationId purpose sourceTargetId releaseId records');
    ensure(j.version===2 && j.operationId===l.operationId && j.purpose===l.purpose
      && j.sourceTargetId===l.source.targetId && j.releaseId===l.releaseId && Array.isArray(j.records));
    const phases=WORKFLOW_PHASES[l.purpose];let phaseIndex=0,pending=false,failed=false,previousAt=l.createdAt;
    j.records.forEach((r,i)=>{
      exact(r,'seq event phase at failureCode leaseSha256 proofSha256');utc(r.at);
      ensure(r.seq===String(i+1) && r.phase===phases[phaseIndex] && !failed && r.at>=previousAt);previousAt=r.at;
      ensure(isHex(r.leaseSha256,64) && (r.proofSha256===null || isHex(r.proofSha256,64)));
      if(r.event==='BEGIN') {ensure(!pending && r.failureCode===null);pending=true;}
      else {
        ensure(pending && ['END','FAIL'].includes(r.event));pending=false;
        if(r.event==='FAIL') {new OpsError(r.failureCode);failed=true;}
        else {ensure(r.failureCode===null);phaseIndex++;}
      }
    });
    const last=j.records.at(-1);
    if(last)ensure((last.event==='BEGIN' || last.leaseSha256===sha256(canonicalBytes(l)))
      && (last.event==='BEGIN' || last.proofSha256===(l.proof?.proofSha256??null))
      && (last.event==='FAIL'?l.phase==='FAILED_OR_UNKNOWN':last.phase===l.phase));
    else ensure(l.phase==='PRECHECK');
    ensure(allowPending || last?.event==='END');
    return j;
  } catch {throw new OpsError('JOURNAL_INCOMPLETE');}
}
export async function reserveWorkflow(inspection, input, deps={}) {
  exact(inspection,'target jdbcUrl dataGateway');validateTargetV1(inspection.target);
  connection({jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway});
  exact(input,'operationId purpose completionPolicy targetRunId incidentStartedAt');
  ensure(isUuid(input.operationId) && Object.hasOwn(WORKFLOW_PHASES,input.purpose));
  const root=rootFor(inspection.target.runId,deps),base=join(root,'maintenance'),operations=join(base,'operations');
  const createdAt=now(deps),request={version:1,operationId:input.operationId,sourceRunId:inspection.target.runId,
    purpose:input.purpose,targetRunId:input.targetRunId,incidentStartedAt:input.incidentStartedAt,startedAt:createdAt,
    environment:input.purpose==='RESTORE_VERIFY_LOCAL'?'isolated-drill':null};
  const lease={version:2,operationId:input.operationId,purpose:input.purpose,releaseId:`sha256:${inspection.target.apiBuild.jarSha256}`,
    phase:'PRECHECK',createdAt,requestSha256:sha256(canonicalBytes(request)),source:inspection.target,
    sourceConnection:{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway},originalApiState:deps.originalApiState,
    completionPolicy:input.completionPolicy,target:null,helper:null,proof:null,account:null};
  validateLeaseV2(lease);requestValid(request,lease);
  await directory(root);await mkdir(base,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await directory(base);
  await mkdir(operations,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await directory(operations);
  const lock=join(base,'operation.lock');
  try{await directory(lock);throw new OpsError('LOCK_BUSY');}catch(e){if(e.code!=='ENOENT')throw e;}
  const prior=await assertPriorReleased(inspection.target.runId,deps);
  try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw new OpsError('LOCK_BUSY');throw e;}
  await syncDirectory(base);const identity=await directory(lock);
  const journal={version:2,operationId:lease.operationId,purpose:lease.purpose,sourceTargetId:lease.source.targetId,releaseId:lease.releaseId,records:[]};
  await canonicalNew(join(operations,`${lease.operationId}.json`),journal,deps);
  await canonicalNew(join(operations,`${lease.operationId}.request.json`),request,deps);
  const targetPath=join(base,'target.json');
  try{ensure(same(await read(targetPath),lease.source));}catch(e){if(e.code!=='ENOENT')throw e;await writeNew(targetPath,lease.source);}
  if(prior)await canonicalUpdate(join(base,'lease.json'),lease,deps,false);
  else await canonicalNew(join(base,'lease.json'),lease,deps);
  return {root,base,lease,journal,identity,request};
}
export async function loadWorkflow(runId,deps={},options={}) {
  try{
    const root=rootFor(runId,deps),base=join(root,'maintenance');await directory(root);await directory(base);
    const lease=validateLeaseV2(await read(join(base,'lease.json'),true));ensure(lease.source.runId===runId);
    ensure(same(await read(join(base,'target.json')),lease.source));
    const request=await read(join(base,'operations',`${lease.operationId}.request.json`),true);requestValid(request,lease);
    const journal=validateJournalV2(await read(join(base,'operations',`${lease.operationId}.json`),true),lease,options);
    let identity=null;try{identity=await directory(join(base,'operation.lock'));}catch(e){if(e.code!=='ENOENT')throw e;}
    ensure(identity || lease.phase==='COMPLETE' && journal.records.at(-1)?.event==='END');
    return {root,base,lease,journal,identity,request};
  }catch{throw new OpsError('JOURNAL_INCOMPLETE');}
}
async function currentRecord(record,deps) {
  const current=await loadWorkflow(record.lease.source.runId,deps,{allowPending:true});
  ensure(current.identity && current.identity.ino===record.identity.ino && current.identity.dev===record.identity.dev
    && same(current.lease,record.lease) && same(current.journal,record.journal),'JOURNAL_INCOMPLETE');
  return current;
}
export async function persistWorkflow(record,event,phase,patch={},deps={}) {
  await currentRecord(record,deps);
  ensure(['BEGIN','END','FAIL'].includes(event),'JOURNAL_INCOMPLETE');
  const {failureCode=null,...changes}=patch;
  ensure(Object.keys(changes).every(k=>['target','helper','proof','account'].includes(k)));
  const lease=validateLeaseV2({...record.lease,...changes,phase:event==='FAIL'?'FAILED_OR_UNKNOWN':phase});
  const entry={seq:String(record.journal.records.length+1),event,phase,at:now(deps),failureCode,
    leaseSha256:sha256(canonicalBytes(lease)),proofSha256:lease.proof?.proofSha256??null};
  const journal={...record.journal,records:[...record.journal.records,entry]};
  validateJournalV2(journal,lease,{allowPending:true});
  await canonicalUpdate(join(record.base,'lease.json'),lease,deps);
  await canonicalUpdate(join(record.base,'operations',`${lease.operationId}.json`),journal,deps);
  Object.assign(record,{lease,journal});return record;
}
export async function releaseWorkflow(record,deps={}) {
  const current=await currentRecord(record,deps);
  ensure(current.lease.phase==='COMPLETE' && current.journal.records.at(-1)?.event==='END'
    && current.lease.helper===null,'JOURNAL_INCOMPLETE');
  const lock=join(record.base,'operation.lock');ensure((await readdir(lock)).length===0);
  const identity=await directory(lock);ensure(identity.dev===record.identity.dev && identity.ino===record.identity.ino);
  await rmdir(lock);await syncDirectory(record.base);
}

// In-flight helper metadata changes only inside an open phase. The immutable BEGIN
// hash identifies its starting lease; END binds the final lease after the adapter.
export async function updatePendingWorkflow(record,patch,deps={}) {
  await currentRecord(record,deps);
  ensure(record.journal.records.at(-1)?.event==='BEGIN','JOURNAL_INCOMPLETE');
  ensure(Object.keys(patch).every(k=>['target','helper','proof','account'].includes(k)));
  const lease=validateLeaseV2({...record.lease,...patch});
  await canonicalUpdate(join(record.base,'lease.json'),lease,deps);
  record.lease=lease;return record;
}

export async function loadRegistry(runId,deps={},options={}) {
  const base=join(rootFor(runId,deps),'maintenance');
  const value=await read(join(base,'lease.json'));
  if(value?.version===2)return loadWorkflow(runId,deps,options);
  ensure(value?.version===1 && value.runId===runId,'JOURNAL_INCOMPLETE');
  const { loadLegacyRegistry }=await import('./maintenance-guard.mjs');
  return loadLegacyRegistry(value,deps);
}
export async function assertPriorReleased(runId,deps={}) {
  const base=join(rootFor(runId,deps),'maintenance');
  try{await directory(join(base,'operation.lock'));throw new OpsError('LOCK_BUSY');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  try{await read(join(base,'lease.json'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const record=await loadRegistry(runId,deps);
  ensure(record.lease.phase==='COMPLETE','JOURNAL_INCOMPLETE');
  if(record.lease.version===2)ensure(record.identity===null && record.journal.records.at(-1)?.event==='END','JOURNAL_INCOMPLETE');
  return record;
}
