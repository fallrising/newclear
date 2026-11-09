import { constants } from 'node:fs';
import { isIPv4 } from 'node:net';
import checkPairDefinitions from '../../docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json' with {type: 'json'};
import { open, lstat, readdir, mkdir, statfs, rename } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalBytes, sha256, parseStrictJson, validateManifest, validateLocalComplete, validateRestoreVerified, OpsError } from './recovery-protocol.mjs';
import { validateInventory } from './local-media.mjs';
import { directory, syncDirectory, validateTargetV1, validateLeaseV2, validateJournalV2, loadWorkflow, assertPriorReleased, rootFor } from '../local/maintenance-store.mjs';
import { verifiedHelperProfile, verifiedInventoryResult, verifiedSessionCommit, runReadonlyInventory,
  verifiedReadonlyInventoryResult, verifiedReadonlyHelperProfile } from '../local/maintenance-helper.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
import { inspectTarget, inspectionDetails } from '../local/maintenance-target.mjs';
const verifiedBundles=new WeakMap(),protectedCopies=new WeakMap(),rawComparisons=new WeakMap();
const ensure=(ok,code='BUNDLE_MISMATCH')=>{if(!ok)throw new OpsError(code);};
const same=(a,b)=>canonicalBytes(a).equals(canonicalBytes(b));
const stable=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs','mode','uid','gid','nlink'].every(k=>a[k]===b[k]);
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
async function privateArtifact(path,expected=null,readBytes=false,limit=null,copyTo=null){
  let fd,out;
  try{
    await directory(dirname(path));fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await fd.stat({bigint:true});ensure(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid())
      &&before.gid===BigInt(process.getgid())&&(before.mode&0o7777n)===0o600n);
    if(limit!==null)ensure(before.size<=BigInt(limit));
    if(expected)ensure(String(before.size)===expected.byteSize);
    if(copyTo)out=await open(copyTo,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const hash=createHash('sha256'),chunks=[];let size=0n;
    for await(const chunk of fd.createReadStream({autoClose:false})){hash.update(chunk);size+=BigInt(chunk.length);if(readBytes)chunks.push(chunk);if(out)await out.writeFile(chunk);}
    const digest=hash.digest('hex');ensure(size===before.size&&stable(before,await fd.stat({bigint:true}))&&stable(before,await lstat(path,{bigint:true})));
    if(expected)ensure(digest===expected.sha256);
    if(out)await out.sync();
    return {sha256:digest,byteSize:String(size),...(readBytes?{bytes:Buffer.concat(chunks)}:{})};
  }catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
  finally{await out?.close();await fd?.close();}
}

// Internal token-bound gate. The caller supplies only the generated backup ID.
export async function verifyCapturedBundle(token,backupId,deps={}){
  try{return await verifyPrivateBundle(token,backupId,deps);}
  catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
}
async function verifyPrivateBundle(token,backupId,deps){
  const wf=deps.workflow??workflow;
  const c=await wf.assertWorkflow(token,{side:'source',stage:'LOCAL_VERIFIED'},deps);
  ensure(c.lease.purpose==='RESTORE_VERIFY_LOCAL','ADAPTER_UNSEALED');
  ensure(typeof backupId==='string'&&/^pp1-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{32}$/.test(backupId),'INPUT_INVALID');
  await directory(c.root);await directory(join(c.root,'bundles'));
  const path=join(c.root,'bundles',backupId);await directory(path);
  ensure(same((await readdir(path)).sort(),['db.dump','inventory.json','local-complete.json','manifest.json','media.package']));
  const manifestFile=await privateArtifact(join(path,'manifest.json'),null,true,1048576);
  const manifest=validateManifest(parseStrictJson(manifestFile.bytes));
  ensure(manifest.backupId===backupId&&manifest.times.startedAt===c.request.startedAt);
  const run=c.target.runId;ensure(manifest.instanceId===`${run.slice(0,8)}-${run.slice(8,12)}-${run.slice(12,16)}-${run.slice(16,20)}-${run.slice(20)}`);
  const completeFile=await privateArtifact(join(path,'local-complete.json'),null,true,1048576);
  const complete=validateLocalComplete(parseStrictJson(completeFile.bytes),manifest);
  let inventory;
  for(const artifact of manifest.artifacts){
    const value=await privateArtifact(join(path,artifact.path),artifact,artifact.path==='inventory.json');
    if(artifact.path==='inventory.json'){
      inventory=parseStrictJson(value.bytes);
      try{validateInventory(inventory);}catch(error){throw new OpsError(error.code??'BUNDLE_MISMATCH');}
      ensure(value.sha256===manifest.inventory.sha256&&inventory.dbSnapshotSha256===manifest.inventory.dbSnapshotSha256);
    }
  }
  await verifyLineage(token,c,manifest,inventory,deps);
  await wf.assertWorkflow(token,{side:'source',stage:'LOCAL_VERIFIED'},deps);
  const result=freeze({path,manifest,inventory,complete,manifestSha256:manifestFile.sha256});
  verifiedBundles.set(result,{token,root:c.root,manifestSha256:manifestFile.sha256,operationId:c.operationId,captureSequence:c.helperSequence});return result;
}

async function verifyLineage(token,c,m,inventory,deps, historical=false,observedProfile=null){
  const file=await privateArtifact(join(c.root,'artifacts.json'),null,true,1048576);
  const a=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(file.bytes)),t=c.target;
  ensure(a.version===1&&a.sourceCommit===t.sourceCommit&&same(a.apiBuild,t.apiBuild),'SOURCE_CHANGED');
  ensure(m.release.sourceCommit===t.sourceCommit&&m.toolchain.inventorySourceCommit===t.sourceCommit
    &&m.release.apiImageDigest===t.images.api&&m.release.postgresImageDigest===t.images.postgres,'SOURCE_CHANGED');
  // Historical preflight reuses proof-bound observations, never starts a probe.
  const profile=historical?{javaRuntimeVersion:m.release.javaRuntimeVersion,postgresServerVersion:m.release.postgresServerVersion,
    pgDumpVersion:m.toolchain.pgDumpVersion,pgRestoreVersion:m.toolchain.pgRestoreVersion}
    :observedProfile??await(deps.helperProfile??verifiedHelperProfile)(token,deps);
  ensure(m.release.javaRuntimeVersion===profile.javaRuntimeVersion&&m.toolchain.inventoryJavaVersion===profile.javaRuntimeVersion
    &&m.release.postgresServerVersion===profile.postgresServerVersion&&m.toolchain.pgDumpVersion===profile.pgDumpVersion
    &&m.toolchain.pgRestoreVersion===profile.pgRestoreVersion,'SOURCE_CHANGED');
  const digest=v=>sha256(canonicalBytes(v));
  const frontend=Object.fromEntries(['front','back','admin'].map(surface=>[surface,{
    artifactSha256:digest(a.dist[surface]),apiBaseConfigSha256:digest({apiOrigin:a.apiOrigin})}]));
  const config={apiOrigin:a.apiOrigin,ingressScriptSha256:a.ingressScriptSha256,nodeBinarySha256:a.nodeBinarySha256,dist:a.dist};
  ensure(same(m.release.frontend,frontend)&&m.release.configSha256===digest(config),'SOURCE_CHANGED');
  const rows=inventory.tables.find(t=>t.tableName==='flyway_schema_history').rows.map(row=>({
    installedRank:row.installed_rank,version:row.version,description:row.description,type:row.type,
    script:row.script,checksum:row.checksum,success:row.success==='true'
  })).sort((a,b)=>BigInt(a.installedRank)<BigInt(b.installedRank)?-1:1);
  ensure(same(m.migration,rows),'SOURCE_CHANGED');
  ensure(m.source.projectRef===t.project&&m.source.dbVolumeRef===t.volumeNames['db-data']&&m.source.mediaVolumeRef===t.volumeNames['media-data']
    &&m.source.writerSetSha256===digest({source:t,apiState:'stopped',backends:[]}),'SOURCE_CHANGED');
  const counts={assetCount:String(inventory.assets.length),referencedFileCount:String(inventory.files.filter(f=>f.classification==='referenced').length),
    orphanFileCount:String(inventory.files.filter(f=>f.classification==='orphan').length),fileCount:String(inventory.files.length),
    fileBytes:String(inventory.files.reduce((n,f)=>n+BigInt(f.byteSize),0n))};
  ensure(Object.entries(counts).every(([key,value])=>m.inventory[key]===value));
  ensure(m.toolchain.mediaPackageAdapterId==='pp1c-node-framed-media'&&m.toolchain.mediaPackageAdapterVersion==='1','SOURCE_CHANGED');
}

export async function protectCapturedBundle(token,verified,deps={}) {
  const owned=verifiedBundles.get(verified);ensure(owned?.token===token,'ADAPTER_UNSEALED');
  const fresh=await verifyCapturedBundle(token,verified.manifest.backupId,deps);
  ensure(fresh.manifestSha256===owned.manifestSha256);
  const metadata=[{path:'manifest.json',bytes:canonicalBytes(fresh.manifest)},
    {path:'local-complete.json',bytes:canonicalBytes(fresh.complete)}].map(x=>({path:x.path,sha256:sha256(x.bytes),byteSize:String(x.bytes.length)}));
  const entries=[...fresh.manifest.artifacts,...metadata],fs=await(deps.statfs??statfs)(owned.root,{bigint:true});
  const free=fs.bavail*fs.bsize,reserve=free/10n>536870912n?free/10n:536870912n;
  ensure(entries.reduce((n,x)=>n+BigInt(x.byteSize),0n)<=free-reserve,'CAPTURE_FAILED');
  const parent=join(owned.root,'protected-copy'),path=join(parent,fresh.manifest.backupId);
  try{
    try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await directory(parent);await mkdir(path,{mode:0o700});await directory(path);
    await syncDirectory(parent);await syncDirectory(owned.root);
    for(const entry of entries){
      await privateArtifact(join(fresh.path,entry.path),entry,false,null,join(path,entry.path));
      await syncDirectory(path);
    }
    await(deps.workflow??workflow).assertWorkflow(token,{side:'source',stage:'LOCAL_VERIFIED'},deps);
    for(const entry of entries)await privateArtifact(join(path,entry.path),entry);
    const result=freeze({path,backupId:fresh.manifest.backupId,manifestSha256:fresh.manifestSha256});
    let smokeFixture=null;const fixturePath=join(owned.root,'maintenance','operations',owned.operationId,'smoke-fixture.json');
    try {
      await lstat(fixturePath);const file=await privateArtifact(fixturePath,null,true,65536),value=parseStrictJson(file.bytes);
      authFixture(value);ensure(value.sourceRunId===fresh.manifest.instanceId.replaceAll('-',''),'SOURCE_CHANGED');
      deriveCredentialBindings(value,fresh.inventory);smokeFixture={path:fixturePath,sha256:file.sha256,byteSize:file.byteSize};
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    protectedCopies.set(token,{owned,verified:fresh,result,smokeFixture});return result;
  }catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
}

export async function restoreBundleMaterial(token,deps={}) {
  const record=protectedCopies.get(token);ensure(record,'ADAPTER_UNSEALED');
  const c=await(deps.workflow??workflow).assertWorkflow(token,{side:'source'},deps);
  ensure(c.root===record.owned.root&&c.operationId===record.owned.operationId,'ADAPTER_UNSEALED');
  ensure(['LOCAL_VERIFIED','TARGET_RESERVED','TARGET_BLANK','DB_RESTORED','MEDIA_RESTORED','RAW_VERIFIED','SESSIONS_REVOKED','STARTUP_VERIFIED','API_HEALTHY','INGRESS_STARTED','BROWSER_VERIFIED','TARGET_STOPPED','RESTART_VERIFIED','COMPLETE'].includes(c.lease.phase),'ADAPTER_UNSEALED');
  const v=record.verified,metadata=[{path:'manifest.json',bytes:canonicalBytes(v.manifest)},
    {path:'local-complete.json',bytes:canonicalBytes(v.complete)}].map(x=>({path:x.path,sha256:sha256(x.bytes),byteSize:String(x.bytes.length)}));
  const entries=[...v.manifest.artifacts,...metadata],names=entries.map(x=>x.path).sort();
  for(const root of [v.path,record.result.path]){
    ensure(same((await readdir(root)).sort(),names));
    for(const entry of entries)await privateArtifact(join(root,entry.path),entry);
  }
  await verifyLineage(token,c,v.manifest,v.inventory,deps);
  if(record.smokeFixture)await privateArtifact(record.smokeFixture.path,record.smokeFixture);
  const raw=rawComparisons.get(token);
  if(raw){ensure(raw.targetIdentitySha256===sha256(canonicalBytes(c.lease.target.identity)),'SOURCE_CHANGED');await privateArtifact(raw.path,raw);}
  return freeze({...record.result,manifest:v.manifest,inventory:v.inventory,sourceRoot:record.owned.root,operationId:c.operationId,rawProofSha256:raw?.sha256??null});
}

async function writePrivateNew(path,bytes) {
  await directory(dirname(path));
  const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  await syncDirectory(dirname(path));
}

// Approved exception applies only to source-to-target RAW comparison, never a target baseline.
const checkPairs = freeze(checkPairDefinitions);
function rawSchemaEqual(tableName, source, target, manifest) {
  if (same(source, target)) return true;
  if (checkPairs.status !== 'APPROVED' || checkPairs.pairCount !== 9
      || manifest.release.postgresImageDigest !== checkPairs.postgresImageDigest
      || manifest.release.postgresServerVersion !== checkPairs.postgresServerVersion
      || manifest.toolchain.pgDumpVersion !== checkPairs.pgDumpVersion
      || manifest.toolchain.pgRestoreVersion !== checkPairs.pgRestoreVersion) return false;
  const {constraints: left, ...sourceFields} = source;
  const {constraints: right, ...targetFields} = target;
  if (!same(sourceFields, targetFields) || left.length !== right.length) return false;
  return left.every((constraint, index) => {
    const restored = right[index];
    if (same(constraint, restored)) return true;
    const {definition: sourceDefinition, ...sourceMetadata} = constraint;
    const {definition: restoredDefinition, ...targetMetadata} = restored;
    return checkPairs.pairs.some(pair => pair.tableName === tableName
      && pair.constraintName === constraint.name
      && same(sourceMetadata, pair.constraintMetadata) && same(targetMetadata, pair.constraintMetadata)
      && sourceDefinition === pair.sourceDefinition && restoredDefinition === pair.restoredDefinition);
  });
}

// Pure validation never grants workflow authority. Inventories are revalidated payloads.
export function validateRawComparison(value,manifest,context) {
  try {
    canonicalBytes(value);validateManifest(manifest);
    const exact=(v,keys)=>ensure(v!==null&&typeof v==='object'&&!Array.isArray(v)
      &&same(Object.keys(v).sort(),keys.split(' ').sort()));
    exact(value,'version operationId backupId manifestSha256 releaseId sourceTargetId targetTargetId sourceInventorySha256 targetInventorySha256 sourceIdentitySha256 targetIdentitySha256 schemaVersion comparedAt tables files assetsEqual variantsEqual flywayEqual equal');
    const hash=v=>sha256(canonicalBytes(v)),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
    const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
    const source=validateTargetV1(context.sourceIdentity),target=validateTargetV1(context.targetIdentity);
    validateInventory(context.sourceInventory);validateInventory(context.targetInventory);
    const a=context.sourceInventory,b=context.targetInventory;
    ensure(source.targetId!==target.targetId&&source.runId!==target.runId);
    ensure(same(source.apiBuild,target.apiBuild)&&same(source.images,target.images));
    ensure(manifest.release.sourceCommit === source.sourceCommit
      && manifest.toolchain.inventorySourceCommit === source.sourceCommit
      && manifest.release.postgresImageDigest === source.images.postgres
      && manifest.inventory.dbSnapshotSha256 === a.dbSnapshotSha256);
    const migration = a.tables.find(t => t.tableName === 'flyway_schema_history').rows.map(row => ({
      installedRank: row.installed_rank, version: row.version, description: row.description, type: row.type,
      script: row.script, checksum: row.checksum, success: row.success === 'true'
    })).sort((x, y) => BigInt(x.installedRank) < BigInt(y.installedRank) ? -1 : 1);
    ensure(same(manifest.migration, migration));
    ensure(value.version===1&&value.schemaVersion==='pp1c-inventory-v1'
      &&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(context.operationId)&&value.operationId===context.operationId);
    ensure(value.backupId===manifest.backupId&&value.manifestSha256===hash(manifest)
      &&value.releaseId===`sha256:${source.apiBuild.jarSha256}`&&manifest.release.apiImageDigest===source.images.api);
    ensure(value.sourceTargetId===source.targetId&&value.targetTargetId===target.targetId
      &&value.sourceIdentitySha256===hash(source)&&value.targetIdentitySha256===hash(target));
    ensure(value.sourceInventorySha256===hash(a)&&value.sourceInventorySha256===manifest.inventory.sha256
      &&value.targetInventorySha256===hash(b)&&value.targetInventorySha256===context.targetInventorySha256);
    ensure(typeof value.comparedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.comparedAt)
      &&new Date(value.comparedAt).toISOString()===value.comparedAt&&value.comparedAt>=manifest.times.verifiedLocalAt);
    ensure(Array.isArray(value.tables)&&value.tables.length===20);
    for(const [i,row]of value.tables.entries()) {
      exact(row,'tableName sourceSchemaSha256 targetSchemaSha256 sourceRowsSha256 targetRowsSha256 sourceRowCount targetRowCount schemaEqual rowsEqual');
      const s=a.tables[i],t=b.tables[i];ensure(row.tableName===s.tableName&&row.tableName===t.tableName);
      for(const [prefix,table]of [['source',s],['target',t]]) {
        ensure(hex(row[prefix+'SchemaSha256'])&&row[prefix+'SchemaSha256']===table.schemaSha256);
        ensure(hex(row[prefix+'RowsSha256'])&&row[prefix+'RowsSha256']===table.rowsSha256);
        ensure(decimal(row[prefix+'RowCount'])&&row[prefix+'RowCount']===table.rowCount);
      }
      ensure(row.schemaEqual===rawSchemaEqual(s.tableName,s.schema,t.schema,manifest)&&row.rowsEqual===same(s.rows,t.rows));
    }
    const f=value.files;
    exact(f,'sourceHeaderSha256 targetHeaderSha256 sourceCount targetCount sourceBytes targetBytes missingCount extraCount changedCount equal');
    for(const [prefix,inventory]of [['source',a],['target',b]]) {
      ensure(hex(f[prefix+'HeaderSha256'])&&f[prefix+'HeaderSha256']===inventory.mediaHeaderSha256);
      ensure(decimal(f[prefix+'Count'])&&f[prefix+'Count']===String(inventory.files.length));
      ensure(decimal(f[prefix+'Bytes'])&&f[prefix+'Bytes']===String(inventory.files.reduce((n,file)=>n+BigInt(file.byteSize),0n)));
    }
    const sourceFiles=new Map(a.files.map(file=>[file.objectKey,file])),targetFiles=new Map(b.files.map(file=>[file.objectKey,file]));
    const missing=a.files.filter(file=>!targetFiles.has(file.objectKey)).length;
    const extra=b.files.filter(file=>!sourceFiles.has(file.objectKey)).length;
    const changed=a.files.filter(file=>targetFiles.has(file.objectKey)&&!same(file,targetFiles.get(file.objectKey))).length;
    for(const [key,count]of [['missingCount',missing],['extraCount',extra],['changedCount',changed]])ensure(decimal(f[key])&&f[key]===String(count));
    ensure(f.equal===(missing===0&&extra===0&&changed===0));
    const flyway=value.tables.find(row=>row.tableName==='flyway_schema_history');
    ensure(value.assetsEqual===same(a.assets,b.assets)&&value.variantsEqual===same(a.variants,b.variants)
      &&value.flywayEqual===(flyway.schemaEqual&&flyway.rowsEqual));
    ensure(value.equal===(value.tables.every(row=>row.schemaEqual&&row.rowsEqual)&&f.equal&&value.assetsEqual&&value.variantsEqual&&value.flywayEqual));
    return value;
  } catch { throw new OpsError('BUNDLE_MISMATCH'); }
}

export function verifyRevocationDelta(raw,after,receipt,context) {
  try {
    validateInventory(raw);validateInventory(after);canonicalBytes(receipt);
    ensure(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(context.operationId)
      &&/^pp1-\d{8}T\d{9}Z-[a-f0-9]{32}$/.test(context.backupId)&&/^pp1-local:[a-f0-9]{32}$/.test(context.targetId));
    ensure(receipt&&same(Object.keys(receipt).sort(),['auditEventId','backupId','committed','operationId','revokedCount']));
    ensure(receipt.committed===true&&receipt.operationId===context.operationId&&receipt.backupId===context.backupId
      &&typeof receipt.auditEventId==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.auditEventId)
      &&typeof receipt.revokedCount==='string'&&/^(0|[1-9][0-9]*)$/.test(receipt.revokedCount));
    ensure(same(raw.assets,after.assets)&&same(raw.variants,after.variants)&&same(raw.files,after.files));
    for(const [i,before]of raw.tables.entries()) {
      const current=after.tables[i];ensure(before.tableName===current.tableName&&same(before.schema,current.schema));
      if(!['cms_session','cms_audit_event'].includes(before.tableName))ensure(same(before.rows,current.rows));
    }
    const rows=(inventory,name)=>inventory.tables.find(table=>table.tableName===name).rows;
    const beforeAudits=rows(raw,'cms_audit_event'),afterAudits=rows(after,'cms_audit_event');
    ensure(!beforeAudits.some(row=>row.id===receipt.auditEventId)&&afterAudits.length===beforeAudits.length+1);
    const added=afterAudits.filter(row=>row.id===receipt.auditEventId);ensure(added.length===1);
    ensure(same(afterAudits.filter(row=>row.id!==receipt.auditEventId),beforeAudits));
    const audit=added[0],{at,detail_json,...fields}=audit;
    ensure(typeof at==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/.test(at)&&Number.isFinite(Date.parse(at)));
    ensure(new Date(at).toISOString().slice(0,19).replace('T',' ')===at.slice(0,19));
    ensure(same(fields,{id:receipt.auditEventId,actor_principal_id:null,category:'AUTH',
      action:'PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE',target_type:'restore',target_id:null,surface:'admin',outcome:'ok',ip:null}));
    ensure(typeof detail_json==='string'&&same(JSON.parse(detail_json),{operationId:context.operationId,backupId:context.backupId,
      targetRef:context.targetId,revokedCount:receipt.revokedCount}));
    const beforeSessions=rows(raw,'cms_session'),afterSessions=rows(after,'cms_session');
    const byId=new Map(afterSessions.map(row=>[row.id,row]));
    ensure(byId.size===afterSessions.length&&new Set(beforeSessions.map(row=>row.id)).size===beforeSessions.length&&beforeSessions.length===afterSessions.length);
    let revoked=0n;
    for(const row of beforeSessions) {
      const expected={...row};if(row.revoked_at===null){expected.revoked_at=at;revoked++;}
      ensure(same(expected,byId.get(row.id)));
    }
    ensure(String(revoked)===receipt.revokedCount);return true;
  } catch {throw new OpsError('SESSION_REVOKE_FAILED');}
}

export async function verifyRevokedBundle(token,results,deps={}) {
  try {
    ensure(results&&same(Object.keys(results).sort(),['commit','inventory']),'INPUT_INVALID');
    const wf=deps.workflow??workflow,material=await restoreBundleMaterial(token,deps);
    const c=await wf.assertWorkflow(token,{side:'source',stage:'SESSIONS_REVOKED'},deps);
    const child=await wf.assertWorkflow(token,{side:'target',stage:'SESSIONS_REVOKED'},deps);
    const raw=rawComparisons.get(token);ensure(raw&&c.lease.helper===null,'ADAPTER_UNSEALED');
    const authority=await(deps.commitAuthority??verifiedSessionCommit)(token,results.commit);
    ensure(authority.kind==='REVOKE_SESSIONS'&&authority.side==='target'&&authority.operationId===c.operationId
      &&authority.targetId===child.target.targetId&&authority.releaseId===`sha256:${child.target.apiBuild.jarSha256}`
      &&authority.backupId===material.backupId&&authority.rawProofSha256===raw.sha256,'ADAPTER_UNSEALED');
    ensure(/^[1-9][0-9]*$/.test(authority.seq)&&Number.isSafeInteger(Number(authority.seq)),'ADAPTER_UNSEALED');
    const helperRoot=join(c.base,'operations',c.operationId,'helper',authority.seq);
    ensure(authority.path===join(helperRoot,'commit-receipt.json'),'ADAPTER_UNSEALED');
    const requestFile=await privateArtifact(join(helperRoot,'request.json'),null,true,65536);
    const expected={version:1,mode:'REVOKE_SESSIONS',operationId:c.operationId,side:'target',targetId:child.target.targetId,
      releaseId:`sha256:${child.target.apiBuild.jarSha256}`,jdbcUrl:child.connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
      mediaRoot:null,outputFile:null,backupId:material.backupId,rawProofSha256:raw.sha256};
    ensure(requestFile.sha256===authority.requestSha256&&same(parseStrictJson(requestFile.bytes),expected),'ADAPTER_UNSEALED');
    const receiptFile=await privateArtifact(authority.path,authority,true,16384),receipt=parseStrictJson(receiptFile.bytes);
    ensure(same(receipt,results.commit.receipt),'ADAPTER_UNSEALED');
    const post=await readOwnedInventory(token,results.inventory,'target',c,child.target,child.connection,deps);
    ensure(Number(authority.seq)>raw.rawSequence&&post.sequence>Number(authority.seq)&&post.sequence===c.helperSequence,'ADAPTER_UNSEALED');
    const root=join(c.base,'operations',c.operationId,'inventories');
    const before=await privateArtifact(join(root,'target-raw.json'),{sha256:raw.targetInventorySha256,byteSize:raw.targetInventoryBytes},true);
    verifyRevocationDelta(parseStrictJson(before.bytes),post.inventory,receipt,
      {operationId:c.operationId,backupId:material.backupId,targetId:child.target.targetId});
    const audit=post.inventory.tables.find(t=>t.tableName==='cms_audit_event').rows.find(row=>row.id===receipt.auditEventId);
    ensure(Date.parse(audit.at)>=Date.parse(c.request.startedAt),'SESSION_REVOKE_FAILED');
    const path=join(root,'target-revoked.json');await writePrivateNew(path,post.bytes);
    await wf.assertWorkflow(token,{side:'source',stage:'SESSIONS_REVOKED'},deps);
    await wf.assertWorkflow(token,{side:'target',stage:'SESSIONS_REVOKED'},deps);
    raw.revoked={path,sha256:post.sha256,byteSize:post.byteSize,sequence:post.sequence,commitPath:authority.path,commitSha256:receiptFile.sha256};
    raw.verifiedThrough='SESSIONS_REVOKED';
    return freeze({...receipt,targetInventorySha256:post.sha256});
  } catch(error) {if(error instanceof OpsError)throw error;throw new OpsError('SESSION_REVOKE_FAILED');}
}
async function readOwnedInventory(token,result,side,c,identity,connection,deps) {
  const authority=await(deps.inventoryAuthority??verifiedInventoryResult)(token,result);
  ensure(authority.kind==='INVENTORY'&&authority.side===side&&authority.operationId===c.operationId,'ADAPTER_UNSEALED');
  ensure(/^[1-9][0-9]*$/.test(authority.seq)&&authority.targetId===identity.targetId&&authority.releaseId===`sha256:${identity.apiBuild.jarSha256}`,'ADAPTER_UNSEALED');
  const root=join(c.base,'operations',c.operationId,'helper',authority.seq);
  ensure(authority.path===join(root,'output/inventory.json'),'ADAPTER_UNSEALED');
  const requestFile=await privateArtifact(join(root,'request.json'),null,true,65536);
  ensure(requestFile.sha256===authority.requestSha256,'ADAPTER_UNSEALED');
  const expected={version:1,mode:'INVENTORY',operationId:c.operationId,side,targetId:identity.targetId,
    releaseId:`sha256:${identity.apiBuild.jarSha256}`,jdbcUrl:connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
    mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  ensure(same(parseStrictJson(requestFile.bytes),expected),'ADAPTER_UNSEALED');
  const file=await privateArtifact(authority.path,authority,true),inventory=parseStrictJson(file.bytes);
  try{validateInventory(inventory);}catch(error){throw new OpsError(error.code??'BUNDLE_MISMATCH');}
  return {...file,inventory,sequence:Number(authority.seq)};
}
export async function compareRestoredBundle(token,results,deps={}) {
  try{return await compareRaw(token,results,deps);}
  catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
}
async function compareRaw(token,results,deps) {
  ensure(results&&same(Object.keys(results).sort(),['source','target']),'INPUT_INVALID');
  const wf=deps.workflow??workflow,material=await restoreBundleMaterial(token,deps),record=protectedCopies.get(token);
  const c=await wf.assertWorkflow(token,{side:'source',stage:'RAW_VERIFIED'},deps);
  const child=await wf.assertWorkflow(token,{side:'target',stage:'RAW_VERIFIED'},deps);
  ensure(c.lease.helper===null&&child.lease.helper===null,'ADAPTER_UNSEALED');
  const sourceIdentity=validateTargetV1(c.target),targetIdentity=validateTargetV1(child.target);
  ensure(same(sourceIdentity,c.lease.source)&&same(targetIdentity,c.lease.target.identity),'SOURCE_CHANGED');
  ensure(sourceIdentity.targetId!==targetIdentity.targetId&&sourceIdentity.runId!==targetIdentity.runId,'TARGET_NOT_BLANK');
  ensure(same(sourceIdentity.apiBuild,targetIdentity.apiBuild)&&same(sourceIdentity.images,targetIdentity.images),'SOURCE_CHANGED');
  const target=await readOwnedInventory(token,results.target,'target',c,targetIdentity,child.connection,deps);
  const source=await readOwnedInventory(token,results.source,'source',c,sourceIdentity,c.lease.sourceConnection,deps);
  ensure(Number.isSafeInteger(record.owned.captureSequence)&&target.sequence>record.owned.captureSequence
    &&source.sequence>target.sequence&&source.sequence===c.helperSequence,'ADAPTER_UNSEALED');
  const m=material.manifest,before=await privateArtifact(join(record.verified.path,'inventory.json'),m.artifacts.find(a=>a.path==='inventory.json'),true);
  ensure(source.sha256===before.sha256&&source.bytes.equals(before.bytes),'WRITER_NOT_QUIESCED');
  const a=source.inventory,b=target.inventory,hash=value=>sha256(canonicalBytes(value));
  const tables=a.tables.map((s,i)=>{
    const t=b.tables[i];ensure(s.tableName===t.tableName);
    return {tableName:s.tableName,sourceSchemaSha256:s.schemaSha256,targetSchemaSha256:t.schemaSha256,
      sourceRowsSha256:s.rowsSha256,targetRowsSha256:t.rowsSha256,sourceRowCount:s.rowCount,targetRowCount:t.rowCount,
      schemaEqual:rawSchemaEqual(s.tableName,s.schema,t.schema,m),rowsEqual:same(s.rows,t.rows)};
  });
  const sourceFiles=new Map(a.files.map(f=>[f.objectKey,f])),targetFiles=new Map(b.files.map(f=>[f.objectKey,f]));
  let missing=0,extra=0,changed=0;
  for(const [key,file]of sourceFiles){if(!targetFiles.has(key))missing++;else if(!same(file,targetFiles.get(key)))changed++;}
  for(const key of targetFiles.keys())if(!sourceFiles.has(key))extra++;
  const bytes=files=>String(files.reduce((n,f)=>n+BigInt(f.byteSize),0n));
  const files={sourceHeaderSha256:hash({version:1,files:a.files}),targetHeaderSha256:hash({version:1,files:b.files}),
    sourceCount:String(a.files.length),targetCount:String(b.files.length),sourceBytes:bytes(a.files),targetBytes:bytes(b.files),
    missingCount:String(missing),extraCount:String(extra),changedCount:String(changed),equal:missing===0&&extra===0&&changed===0};
  const assetsEqual=same(a.assets,b.assets),variantsEqual=same(a.variants,b.variants);
  const flywayEqual=same(a.tables.find(t=>t.tableName==='flyway_schema_history'),b.tables.find(t=>t.tableName==='flyway_schema_history'));
  const comparedAt=(deps.now?.()??new Date()).toISOString();ensure(comparedAt>=m.times.verifiedLocalAt,'INPUT_INVALID');
  const receipt={version:1,operationId:c.operationId,backupId:m.backupId,manifestSha256:material.manifestSha256,releaseId:`sha256:${c.target.apiBuild.jarSha256}`,
    sourceTargetId:sourceIdentity.targetId,targetTargetId:targetIdentity.targetId,sourceInventorySha256:source.sha256,targetInventorySha256:target.sha256,
    sourceIdentitySha256:hash(sourceIdentity),targetIdentitySha256:hash(targetIdentity),schemaVersion:'pp1c-inventory-v1',comparedAt,tables,files,
    assetsEqual,variantsEqual,flywayEqual,equal:tables.every(t=>t.schemaEqual&&t.rowsEqual)&&files.equal&&assetsEqual&&variantsEqual&&flywayEqual};
  validateRawComparison(receipt,m,{operationId:c.operationId,sourceIdentity,targetIdentity,
    sourceInventory:a,targetInventory:b,targetInventorySha256:target.sha256});
  const root=join(c.base,'operations',c.operationId),inventories=join(root,'inventories');
  await directory(root);await mkdir(inventories,{mode:0o700});await syncDirectory(root);
  for(const [name,data]of [['source-before',before.bytes],['source-after',source.bytes],['target-raw',target.bytes]])
    await writePrivateNew(join(inventories,name+'.json'),data);
  const path=join(root,'raw-comparison.json'),receiptBytes=canonicalBytes(receipt);
  await writePrivateNew(path,receiptBytes);
  await wf.assertWorkflow(token,{side:'source',stage:'RAW_VERIFIED'},deps);
  await wf.assertWorkflow(token,{side:'target',stage:'RAW_VERIFIED'},deps);
  ensure(receipt.equal,'RAW_MISMATCH');
  rawComparisons.set(token,{path,sha256:sha256(receiptBytes),byteSize:String(receiptBytes.length),targetIdentitySha256:receipt.targetIdentitySha256,
    rawSequence:source.sequence,targetInventorySha256:target.sha256,targetInventoryBytes:target.byteSize});
  return freeze(receipt);
}

// D owns complete persisted-proof revalidation. Never silently succeed before it seals.
// Pure predicates never confer live browser or workflow authority.
const authActors=['admin','operator'];
const authUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const authHex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function authExact(value,fields) {
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),fields.split(' ').sort()));
}
function authUtc(value) {
  ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);return BigInt(Date.parse(value))*1000n;
}
function authPgMicros(value) {
  ensure(typeof value==='string');const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?\+00$/.exec(value);ensure(match);
  const second=`${match[1]}T${match[2]}.000Z`;return authUtc(second)+BigInt((match[3]??'').padEnd(6,'0'));
}
function authFixture(f) {
  authExact(f,'version sourceRunId adminPrincipalId operatorPrincipalId oldSessionIds publishedEntryId revisionNo refEntryId media expected sessionAbsoluteSeconds sessionMaxSeconds');
  ensure(f.version===1&&typeof f.sourceRunId==='string'&&/^[a-f0-9]{32}$/.test(f.sourceRunId)&&f.revisionNo===1);
  ensure(['adminPrincipalId','operatorPrincipalId','publishedEntryId','refEntryId'].every(key=>authUuid(f[key]))
    &&f.adminPrincipalId!==f.operatorPrincipalId&&f.publishedEntryId!==f.refEntryId);
  authExact(f.oldSessionIds,'admin operator');ensure(Object.values(f.oldSessionIds).every(authUuid)&&f.oldSessionIds.admin!==f.oldSessionIds.operator);
  authExact(f.media,'publicImageId publicPdfId draftImageId privateImageId replacedImageId deletedImageId');
  ensure(Object.values(f.media).every(authUuid)&&new Set(Object.values(f.media)).size===6);
  authExact(f.expected,'privateEntrySha256 operatorEntrySha256 publicEntrySha256 revisionListSha256 publicOriginalSha256 publicThumbnailSha256 publicWebSha256 publicPdfSha256 draftOriginalSha256 privateOriginalSha256 replacedOriginalSha256');
  ensure(Object.values(f.expected).every(authHex)&&['sessionAbsoluteSeconds','sessionMaxSeconds'].every(key=>
    typeof f[key]==='string'&&/^[1-9][0-9]*$/.test(f[key])&&BigInt(f[key])<=BigInt(Number.MAX_SAFE_INTEGER)));
}
function authIdMap(rows) {
  ensure(rows.every(row=>authUuid(row.id)));const map=new Map(rows.map(row=>[row.id,row]));ensure(map.size===rows.length);return map;
}
function authDecodeToken(value) {
  ensure(typeof value==='string'&&/^\\x[a-f0-9]{64}$/.test(value));const bytes=Buffer.from(value.slice(2),'hex');
  ensure(bytes.length===32);return bytes.toString('hex');
}
const authRows=(inventory,name)=>inventory.tables.find(table=>table.tableName===name).rows;
function authAddedRows(before,after) {
  const previous=authIdMap(before),current=authIdMap(after);
  for(const [id,row]of previous)ensure(current.has(id)&&same(row,current.get(id)));
  const added=after.filter(row=>!previous.has(row.id));ensure(added.length===2);return added;
}
export function verifyAuthDelta(baseline,after,context) {
  try {
    canonicalBytes(context);authExact(context,'operationId targetRunId fixture observations assertions ingressWebAddress baselineInventorySha256 afterInventorySha256 fixtureSha256');
    validateInventory(baseline);validateInventory(after);const hash=value=>sha256(canonicalBytes(value));
    const {operationId,targetRunId,fixture,observations,assertions,ingressWebAddress}=context;
    ensure(authUuid(operationId)&&typeof targetRunId==='string'&&/^[a-f0-9]{32}$/.test(targetRunId));authFixture(fixture);
    ensure(context.baselineInventorySha256===hash(baseline)&&context.afterInventorySha256===hash(after)&&context.fixtureSha256===hash(fixture));
    const parts=typeof ingressWebAddress==='string'?ingressWebAddress.split('.').map(Number):[];
    ensure(isIPv4(ingressWebAddress??'')&&(parts[0]===10||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168));
    authExact(observations,'version operationId targetRunId admin operator');
    authExact(assertions,'version operationId targetRunId fixtureSha256 startedAt finishedAt checks loginCount credentialDeliveries');
    for(const value of [observations,assertions])ensure(value.version===1&&value.operationId===operationId&&value.targetRunId===targetRunId);
    ensure(assertions.fixtureSha256===context.fixtureSha256&&assertions.loginCount==='2'&&assertions.credentialDeliveries==='1');
    authExact(assertions.checks,'oldAdminRejected oldOperatorRejected adminLogin operatorLogin publishedBytes privateIsolation restoredContent originTls');
    ensure(Object.values(assertions.checks).every(value=>value===true));const start=authUtc(assertions.startedAt),finish=authUtc(assertions.finishedAt);
    ensure(start<=finish&&same(baseline.assets,after.assets)&&same(baseline.variants,after.variants)&&same(baseline.files,after.files));
    for(const [i,table]of baseline.tables.entries()) {
      const current=after.tables[i];ensure(table.tableName===current.tableName&&same(table.schema,current.schema));
      if(!['cms_principal','cms_session','cms_audit_event'].includes(table.tableName))ensure(same(table.rows,current.rows));
    }
    const oldPrincipals=authIdMap(authRows(baseline,'cms_principal')),principals=authIdMap(authRows(after,'cms_principal'));
    ensure(oldPrincipals.size===principals.size);const sessions=authAddedRows(authRows(baseline,'cms_session'),authRows(after,'cms_session'));
    const audits=authAddedRows(authRows(baseline,'cms_audit_event'),authRows(after,'cms_audit_event'));
    const oldSessions=authIdMap(authRows(baseline,'cms_session')),userAgent=`CMS-PP1C-RESTORE/${operationId}`,actors=[];
    ensure(new Set(authRows(after,'cms_session').map(row=>row.token_hash)).size===authRows(after,'cms_session').length);
    for(const actor of authActors) {
      const observation=observations[actor];authExact(observation,'principalId sessionTokenSha256 loginStartedAt loginFinishedAt oldRejectedAt');
      const principalId=fixture[`${actor}PrincipalId`],surface=actor==='admin'?'admin':'back';
      ensure(observation.principalId===principalId&&authHex(observation.sessionTokenSha256));
      const loginStart=authUtc(observation.loginStartedAt),loginFinish=authUtc(observation.loginFinishedAt),rejected=authUtc(observation.oldRejectedAt);
      ensure(start<=rejected&&rejected<loginStart&&loginStart<=loginFinish&&loginFinish<=finish);
      const old=oldSessions.get(fixture.oldSessionIds[actor]);ensure(old?.principal_id===principalId&&old.revoked_at!==null);
      authPgMicros(old.revoked_at);ensure(rejected<authPgMicros(old.expires_at));
      const matching=sessions.filter(row=>row.principal_id===principalId);ensure(matching.length===1);const session=matching[0];
      ensure(authDecodeToken(session.token_hash)===observation.sessionTokenSha256&&session.created_surface===surface
        &&session.revoked_at===null&&session.ip===ingressWebAddress&&session.user_agent===userAgent);
      const created=authPgMicros(session.created_at),seen=authPgMicros(session.last_seen_at),expires=authPgMicros(session.expires_at);
      ensure(created>=loginStart&&created<loginFinish+1000n&&seen>=created&&seen<finish+1000n);
      const absolute=seen+BigInt(fixture.sessionAbsoluteSeconds)*1000000n,maximum=created+BigInt(fixture.sessionMaxSeconds)*1000000n;
      ensure(expires===(absolute<maximum?absolute:maximum));
      const principal=oldPrincipals.get(principalId),current=principals.get(principalId);
      ensure(principal&&current&&principal.status==='active'&&principal.failed_login_count==='0'&&principal.locked_until===null);
      authPgMicros(current.last_login_at);authPgMicros(current.updated_at);
      ensure(same({...principal,last_login_at:session.created_at,updated_at:session.created_at},current)&&!same(principal,current));
      const matchingAudits=audits.filter(row=>row.actor_principal_id===principalId);ensure(matchingAudits.length===1);const audit=matchingAudits[0],at=authPgMicros(audit.at);
      ensure(at>=created&&at<loginFinish+1000n&&same(audit,{id:audit.id,at:audit.at,actor_principal_id:principalId,category:'AUTH',action:'LOGIN_SUCCESS',
        target_type:'principal',target_id:principalId,surface,outcome:'ok',ip:ingressWebAddress,detail_json:null}));
      actors.push({actor,principalId,oldSessionId:fixture.oldSessionIds[actor],sessionId:session.id,auditEventId:audit.id,
        loginStartedAt:observation.loginStartedAt,loginFinishedAt:observation.loginFinishedAt,oldRejectedAt:observation.oldRejectedAt});
    }
    for(const [id,row]of oldPrincipals)if(!actors.some(actor=>actor.principalId===id))ensure(principals.has(id)&&same(row,principals.get(id)));
    return freeze({version:1,operationId,targetRunId,baselineInventorySha256:context.baselineInventorySha256,afterInventorySha256:context.afterInventorySha256,
      fixtureSha256:context.fixtureSha256,authObservationsSha256:hash(observations),browserAssertionsSha256:hash(assertions),ingressWebAddress,expectedUserAgent:userAgent,
      actors,changedPrincipalCount:'2',insertedSessionCount:'2',insertedAuditCount:'2',otherRowsEqual:true,filesEqual:true});
  } catch {throw new OpsError('SMOKE_FAILED');}
}
export function revalidateAuthDelta(baseline,after,proof,assertions,fixture) {
  try {
    canonicalBytes(proof);authExact(proof,'version operationId targetRunId baselineInventorySha256 afterInventorySha256 fixtureSha256 authObservationsSha256 browserAssertionsSha256 ingressWebAddress expectedUserAgent actors changedPrincipalCount insertedSessionCount insertedAuditCount otherRowsEqual filesEqual');
    ensure(proof.version===1&&Array.isArray(proof.actors)&&proof.actors.length===2);
    const observations={version:1,operationId:proof.operationId,targetRunId:proof.targetRunId};
    for(const [i,actor]of proof.actors.entries()) {
      authExact(actor,'actor principalId oldSessionId sessionId auditEventId loginStartedAt loginFinishedAt oldRejectedAt');
      ensure(actor.actor===authActors[i]&&['principalId','oldSessionId','sessionId','auditEventId'].every(key=>authUuid(actor[key])));
      const sessions=authRows(after,'cms_session').filter(row=>row.id===actor.sessionId);ensure(sessions.length===1);
      observations[actor.actor]={principalId:actor.principalId,sessionTokenSha256:authDecodeToken(sessions[0].token_hash),
        loginStartedAt:actor.loginStartedAt,loginFinishedAt:actor.loginFinishedAt,oldRejectedAt:actor.oldRejectedAt};
    }
    const actual=verifyAuthDelta(baseline,after,{operationId:proof.operationId,targetRunId:proof.targetRunId,fixture,observations,assertions,
      ingressWebAddress:proof.ingressWebAddress,baselineInventorySha256:proof.baselineInventorySha256,
      afterInventorySha256:proof.afterInventorySha256,fixtureSha256:proof.fixtureSha256});
    ensure(same(actual,proof));return actual;
  } catch {throw new OpsError('SMOKE_FAILED');}
}

export function parseArgs(argv) {
  ensure(Array.isArray(argv)&&argv.length===6&&argv.every(v=>typeof v==='string'),'INPUT_INVALID');
  const values=new Map();
  for(let i=0;i<argv.length;i+=2){ensure(['--run-id','--backup-id','--restore-operation-id'].includes(argv[i])&&!values.has(argv[i]),'INPUT_INVALID');values.set(argv[i],argv[i+1]);}
  const runId=values.get('--run-id'),backupId=values.get('--backup-id'),operationId=values.get('--restore-operation-id');
  ensure(/^[a-f0-9]{32}$/.test(runId)&&/^pp1-\d{8}T\d{9}Z-[a-f0-9]{32}$/.test(backupId)
    &&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId),'INPUT_INVALID');
  return Object.freeze({runId,backupId,operationId});
}
export async function run(argv,deps={}) {
  let operationId=null,backupId=null,token,owner;
  const controller=new AbortController(),cancel=()=>controller.abort(),output=deps.stdout??process.stdout;
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {
    const selected=parseArgs(argv);({operationId,backupId}=selected);
    const signal=deps.signal?AbortSignal.any([controller.signal,deps.signal]):controller.signal;deps={...deps,signal};
    if(signal.aborted)throw new OpsError('INTERRUPTED');
    owner=await import('../local/maintenance-observation.mjs');
    token=await owner.beginReadonlyObservation({runId:selected.runId,backupId,restoreOperationId:operationId},deps);
    const context=await owner.observationContext(token,deps);
    ensure(context.operationId===operationId&&context.target.runId===selected.runId
      &&context.material.proof.backupId===backupId,'SOURCE_CHANGED');
    const result=await runReadonlyInventory(token,deps);
    await verifyReadonlyObservationResult(token,result,deps);
    await owner.finishObservation(token,deps);
    // Finish keeps watchers live; no await is allowed between this gate and stdout.
    const bytes=canonicalBytes({operationId,backupId,phase:'COMPLETE',code:null,exitCode:0});
    owner.assertObservationGate(token);output.write(bytes);return 0;
  }catch(error) {
    const failure=error instanceof OpsError?error:new OpsError('CAPTURE_FAILED');
    if(token)try{await owner.failObservation(token,failure.code,deps);}catch{/* Preserve the primary safe failure. */}
    output.write(canonicalBytes({operationId,backupId,phase:null,code:failure.code,exitCode:failure.exitCode}));return failure.exitCode;
  }finally {
    if(token)owner.closeObservation(token);
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  run(process.argv.slice(2)).then(code=>{process.exitCode=code;},()=>{process.exitCode=5;});

// Pure literal source-to-source comparison; this function grants no observation authority.
export function validateCurrentSourceInventory(baseline,current) {
  try {validateInventory(baseline);validateInventory(current);ensure(same(baseline,current),'RAW_MISMATCH');return true;}
  catch {throw new OpsError('RAW_MISMATCH');}
}
async function verifyReadonlyObservationResult(token,result,deps={}) {
  const owner=await import('../local/maintenance-observation.mjs'),c=await owner.observationContext(token,deps);
  const authority=verifiedReadonlyInventoryResult(token,result),t=c.target;
  ensure(Object.getOwnPropertySymbols(authority).length===0&&same(Object.getOwnPropertyNames(authority).sort(),
    'side kind seq operationId targetId releaseId path sha256 byteSize requestSha256 source helperSequence helperRoot profile fullContainerId policySha256'.split(' ').sort()),'ADAPTER_UNSEALED');
  const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const parent=join(c.base,'verification',c.operationId),nonce=c.helperRoot.slice(parent.length+1);
  ensure(c.base===join(c.root,'maintenance')&&c.runRoot===c.root&&c.root===rootFor(t.runId,deps)
    &&c.helperRoot===join(parent,nonce)&&/^[a-f0-9]{32}$/.test(nonce),'ADAPTER_UNSEALED');
  ensure(authority.kind==='INVENTORY'&&authority.side==='source'&&authority.operationId===c.operationId
    &&authority.seq===c.seq&&/^[1-9][0-9]*$/.test(authority.seq)
    &&authority.helperSequence===c.helperSequence&&Number(authority.seq)===c.helperSequence
    &&authority.targetId===t.targetId&&authority.releaseId===`sha256:${t.apiBuild.jarSha256}`
    &&same(authority.source,t)&&authority.helperRoot===c.helperRoot
    &&hex(authority.fullContainerId)&&hex(authority.policySha256)
    &&authority.path===join(c.helperRoot,'output/inventory.json')&&hex(authority.sha256)
    &&typeof authority.byteSize==='string'&&/^[1-9][0-9]*$/.test(authority.byteSize)&&hex(authority.requestSha256),'ADAPTER_UNSEALED');
  const requestFile=await privateArtifact(join(c.helperRoot,'request.json'),null,true,65536);
  const request={version:1,mode:'INVENTORY',operationId:c.operationId,side:'source',targetId:t.targetId,
    releaseId:`sha256:${t.apiBuild.jarSha256}`,jdbcUrl:c.connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
    mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  ensure(requestFile.sha256===authority.requestSha256&&same(parseStrictJson(requestFile.bytes),request),'ADAPTER_UNSEALED');
  const file=await privateArtifact(authority.path,authority,true),current=parseStrictJson(file.bytes);
  validateCurrentSourceInventory(c.material.inventory,current);
  const profile=await verifiedReadonlyHelperProfile(token,deps),keys=['javaRuntimeVersion','pgDumpVersion','pgRestoreVersion','postgresServerVersion'];
  ensure(same(authority.profile,Object.fromEntries(keys.map(key=>[key,profile[key]]))),'SOURCE_CHANGED');
  await verifyLineage(token,{root:c.root,target:t},c.material.manifest,current,deps,false,profile);
  await owner.assertObservation(token,deps);owner.assertObservationGate(token);
  return freeze({inventory:current,metadata:authority});
}
export function verifyZeroDelta(baseline,after) {
  try {validateInventory(baseline);validateInventory(after);ensure(same(baseline,after));return true;}
  catch {throw new OpsError('STARTUP_MUTATION');}
}
export async function restoreLifecycleContext(token,deps={}) {
  const raw=rawComparisons.get(token);ensure(raw?.revoked,'ADAPTER_UNSEALED');
  await restoreBundleMaterial(token,deps);await privateArtifact(raw.revoked.path,raw.revoked);
  if(raw.startup)await privateArtifact(raw.startup.path,raw.startup);
  if(raw.afterBrowser)await privateArtifact(raw.afterBrowser.path,raw.afterBrowser);
  if(raw.afterRestart)await privateArtifact(raw.afterRestart.path,raw.afterRestart);
  if(raw.finalProof)await revalidateFinalArtifacts(token,deps);
  return freeze({verifiedThrough:raw.verifiedThrough,...(raw.finalProof?{finalProof:structuredClone(raw.finalProof)}:{})});
}
export async function verifyLifecycleInventory(token,result,deps={}) {
  const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'source'},deps),phase=c.lease.phase;
  ensure(['STARTUP_VERIFIED','RESTART_VERIFIED'].includes(phase),'ADAPTER_UNSEALED');
  const child=await wf.assertWorkflow(token,{side:'target',stage:phase},deps),raw=rawComparisons.get(token);
  await restoreBundleMaterial(token,deps);ensure(raw?.revoked&&c.lease.helper===null,'ADAPTER_UNSEALED');
  const startup=phase==='STARTUP_VERIFIED',key=startup?'startup':'afterRestart',baseline=startup?raw.revoked:raw.afterBrowser;
  ensure(!raw[key]&&baseline&&raw.verifiedThrough===(startup?'SESSIONS_REVOKED':'TARGET_STOPPED'),'ADAPTER_UNSEALED');
  const current=await readOwnedInventory(token,result,'target',c,child.target,child.connection,deps);
  ensure(current.sequence>baseline.sequence&&current.sequence===c.helperSequence,'ADAPTER_UNSEALED');
  const previous=await privateArtifact(baseline.path,baseline,true);verifyZeroDelta(parseStrictJson(previous.bytes),current.inventory);
  const path=join(c.base,'operations',c.operationId,'inventories',startup?'target-startup.json':'target-after-restart.json');
  await writePrivateNew(path,current.bytes);await wf.assertWorkflow(token,{side:'source',stage:phase},deps);
  await wf.assertWorkflow(token,{side:'target',stage:phase},deps);
  raw[key]={path,sha256:current.sha256,byteSize:current.byteSize,sequence:current.sequence};raw.verifiedThrough=phase;
  return freeze({sha256:current.sha256});
}

function deriveCredentialBindings(fixture,inventory) {
  const bindings={};authFixture(fixture);
  for(const actor of authActors) {
    const principalId=fixture[actor+'PrincipalId'],principals=authRows(inventory,'cms_principal').filter(row=>row.id===principalId);
    const sessions=authRows(inventory,'cms_session').filter(row=>row.id===fixture.oldSessionIds[actor]);
    ensure(principals.length===1&&sessions.length===1,'SMOKE_FAILED');const principal=principals[0],session=sessions[0];
    ensure(principal.status==='active'&&principal.failed_login_count==='0'&&principal.locked_until===null&&principal.deleted_at===null
      &&typeof principal.username==='string'&&principal.username.length>0&&session.principal_id===principalId&&session.revoked_at===null
      &&session.created_surface===(actor==='admin'?'admin':'back'),'SMOKE_FAILED');
    authPgMicros(session.expires_at);
    bindings[actor]={principalId,username:principal.username,oldSessionId:session.id,
      oldSessionTokenSha256:authDecodeToken(session.token_hash),oldSessionExpiresAt:session.expires_at};
  }
  return bindings;
}
export async function restoreSmokeContext(token,deps={}) {
  const wf=deps.workflow??workflow,material=await restoreBundleMaterial(token,deps),record=protectedCopies.get(token),raw=rawComparisons.get(token);
  const c=await wf.assertWorkflow(token,{side:'source'},deps),child=await wf.assertWorkflow(token,{side:'target'},deps);
  ensure(['API_HEALTHY','INGRESS_STARTED','BROWSER_VERIFIED','TARGET_STOPPED'].includes(c.lease.phase)
    &&record.smokeFixture&&raw?.startup,'ADAPTER_UNSEALED');
  const file=await privateArtifact(record.smokeFixture.path,record.smokeFixture,true),fixture=parseStrictJson(file.bytes);
  await privateArtifact(raw.startup.path,raw.startup);authFixture(fixture);
  const credentialBindings=deriveCredentialBindings(fixture,material.inventory);
  const input={version:1,stage:'RESTORE_SMOKE_READY',operationId:c.operationId,sourceRunId:c.target.runId,
    targetRunId:child.target.runId,releaseId:`sha256:${child.target.apiBuild.jarSha256}`,rawComparisonSha256:raw.sha256,
    sessionCommitSha256:raw.revoked.commitSha256,startupInventorySha256:raw.startup.sha256,fixtureSha256:file.sha256,fixture};
  return freeze({input,credentialBindings});
}

export async function beginRestoreSmoke(token,deps={}) {
  const c=await(deps.workflow??workflow).assertWorkflow(token,{side:'target',stage:'BROWSER_VERIFIED'},deps),raw=rawComparisons.get(token);
  ensure(raw?.verifiedThrough==='STARTUP_VERIFIED'&&raw.browserStartedAt===undefined&&c.lease.helper===null,'ADAPTER_UNSEALED');
  await restoreSmokeContext(token,deps);raw.browserStartedAt=authUtc((deps.now?.()??new Date()).toISOString());
  raw.browserStartSequence=c.helperSequence;
}
async function browserEvidence(token,result,deps) {
  const get=deps.browserAuthority??(await import('./local-restore-smoke.mjs')).verifiedRestoreSmoke;
  ensure(typeof get==='function','ADAPTER_UNSEALED');return get(token,result,deps);
}
export async function verifyBrowserResult(token,result,deps={}) {
  try {
    const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'target',stage:'BROWSER_VERIFIED'},deps),raw=rawComparisons.get(token);
    const context=await restoreSmokeContext(token,deps),authority=await browserEvidence(token,result,deps);
    ensure(raw?.browserStartedAt!==undefined&&!raw.browser&&raw.verifiedThrough==='STARTUP_VERIFIED'&&c.lease.helper===null,'ADAPTER_UNSEALED');
    ensure(authority.operationId===c.operationId&&authority.targetRunId===c.target.runId&&authority.fixtureSha256===context.input.fixtureSha256
      &&authority.inputSha256===sha256(canonicalBytes(context.input))&&authority.deliveredOnce===true&&authority.eof===true&&authority.exitCode===0
      &&/^[a-f0-9]{64}$/.test(authority.helperId)&&/^[1-9][0-9]*$/.test(authority.helperSequence)
      &&Number(authority.helperSequence)===raw.browserStartSequence+1&&Number(authority.helperSequence)===c.helperSequence,'SMOKE_FAILED');
    const start=authUtc(authority.assertions.startedAt),finish=authUtc(authority.assertions.finishedAt),now=authUtc((deps.now?.()??new Date()).toISOString());
    ensure(start>=raw.browserStartedAt&&finish>=start&&finish<=now,'SMOKE_FAILED');
    const inspect=deps.inspectionDetails??(await import('../local/maintenance-target.mjs')).inspectionDetails;
    const ingressWebAddress=inspect(c.inspection).ingressWebAddress;ensure(isIPv4(ingressWebAddress),'SMOKE_FAILED');
    raw.browser={result,authority:freeze(structuredClone(authority)),ingressWebAddress};raw.verifiedThrough='BROWSER_VERIFIED';
    return freeze({browserAssertionsSha256:sha256(canonicalBytes(authority.assertions))});
  } catch(error) {if(error instanceof OpsError)throw error;throw new OpsError('SMOKE_FAILED');}
}
export async function verifyAuthInventory(token,results,deps={}) {
  try {
    ensure(results&&same(Object.keys(results).sort(),['browser','inventory']),'INPUT_INVALID');
    const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'source',stage:'TARGET_STOPPED'},deps);
    const child=await wf.assertWorkflow(token,{side:'target',stage:'TARGET_STOPPED'},deps),raw=rawComparisons.get(token);
    const context=await restoreSmokeContext(token,deps);ensure(raw?.browser?.result===results.browser&&!raw.afterBrowser
      &&raw.verifiedThrough==='BROWSER_VERIFIED'&&c.lease.helper===null,'ADAPTER_UNSEALED');
    const browser=await browserEvidence(token,results.browser,deps);ensure(same(browser,raw.browser.authority),'ADAPTER_UNSEALED');
    const current=await readOwnedInventory(token,results.inventory,'target',c,child.target,child.connection,deps);
    ensure(current.sequence===Number(browser.helperSequence)+1&&current.sequence===c.helperSequence,'ADAPTER_UNSEALED');
    const previous=await privateArtifact(raw.startup.path,raw.startup,true),baseline=parseStrictJson(previous.bytes);
    const proof=verifyAuthDelta(baseline,current.inventory,{operationId:c.operationId,targetRunId:child.target.runId,fixture:context.input.fixture,
      observations:browser.observations,assertions:browser.assertions,ingressWebAddress:raw.browser.ingressWebAddress,
      baselineInventorySha256:raw.startup.sha256,afterInventorySha256:current.sha256,fixtureSha256:context.input.fixtureSha256});
    const root=join(c.base,'operations',c.operationId),path=join(root,'inventories/target-after-browser.json');
    await wf.assertWorkflow(token,{side:'source',stage:'TARGET_STOPPED'},deps);await wf.assertWorkflow(token,{side:'target',stage:'TARGET_STOPPED'},deps);
    await writePrivateNew(path,current.bytes);
    const deltaBytes=canonicalBytes(proof),assertionBytes=canonicalBytes(browser.assertions);
    await writePrivateNew(join(root,'auth-delta.json'),deltaBytes);await writePrivateNew(join(root,'browser-assertions.json'),assertionBytes);
    raw.afterBrowser={path,sha256:current.sha256,byteSize:current.byteSize,sequence:current.sequence};
    raw.delta={path:join(root,'auth-delta.json'),sha256:sha256(deltaBytes),byteSize:String(deltaBytes.length)};
    raw.assertions={path:join(root,'browser-assertions.json'),sha256:sha256(assertionBytes),byteSize:String(assertionBytes.length)};
    raw.verifiedThrough='TARGET_STOPPED';return proof;
  } catch(error) {if(error instanceof OpsError)throw error;throw new OpsError('SMOKE_FAILED');}
}

async function lifecycleEvidence(token,deps) {
  const material=await restoreBundleMaterial(token,deps),raw=rawComparisons.get(token),record=protectedCopies.get(token);
  ensure(raw?.revoked&&raw.startup&&raw.afterBrowser&&raw.afterRestart&&raw.delta&&raw.assertions&&record.smokeFixture,'ADAPTER_UNSEALED');
  const readInventory=async ref=>{const file=await privateArtifact(ref.path,ref,true),value=parseStrictJson(file.bytes);validateInventory(value);return value;};
  const targetRaw=await readInventory({path:join(dirname(raw.path),'inventories/target-raw.json'),sha256:raw.targetInventorySha256,byteSize:raw.targetInventoryBytes});
  const revoked=await readInventory(raw.revoked),startup=await readInventory(raw.startup),afterBrowser=await readInventory(raw.afterBrowser),afterRestart=await readInventory(raw.afterRestart);
  const comparison=parseStrictJson((await privateArtifact(raw.path,raw,true)).bytes);
  const commitFile=await privateArtifact(raw.revoked.commitPath,null,true,16384);ensure(commitFile.sha256===raw.revoked.commitSha256);
  const commit=parseStrictJson(commitFile.bytes),delta=parseStrictJson((await privateArtifact(raw.delta.path,raw.delta,true)).bytes);
  const assertions=parseStrictJson((await privateArtifact(raw.assertions.path,raw.assertions,true)).bytes);
  const fixture=parseStrictJson((await privateArtifact(record.smokeFixture.path,record.smokeFixture,true)).bytes);
  const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'source'},deps),child=await wf.assertWorkflow(token,{side:'target'},deps);
  validateRawComparison(comparison,material.manifest,{operationId:c.operationId,sourceIdentity:c.target,targetIdentity:child.target,
    sourceInventory:material.inventory,targetInventory:targetRaw,targetInventorySha256:raw.targetInventorySha256});
  ensure(comparison.equal===true,'RAW_MISMATCH');
  verifyRevocationDelta(targetRaw,revoked,commit,{operationId:c.operationId,backupId:material.backupId,targetId:child.target.targetId});
  verifyZeroDelta(revoked,startup);revalidateAuthDelta(startup,afterBrowser,delta,assertions,fixture);verifyZeroDelta(afterBrowser,afterRestart);
  return{material,raw,record,c,child,targetRaw,delta,assertions,fixture};
}
export async function completeRestoreVerification(token,result,deps={}) {
  const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'source',stage:'RESTART_VERIFIED'},deps);
  const raw=rawComparisons.get(token);ensure(raw?.afterRestart&&!raw.finalProof&&raw.verifiedThrough==='RESTART_VERIFIED'&&c.lease.helper===null,'ADAPTER_UNSEALED');
  const current=await readOwnedInventory(token,result,'source',c,c.target,c.lease.sourceConnection,deps);
  ensure(current.sequence>raw.afterRestart.sequence&&current.sequence===c.helperSequence,'ADAPTER_UNSEALED');
  const evidence=await lifecycleEvidence(token,deps),{material,record,child,targetRaw}=evidence;
  const captured=await privateArtifact(join(record.verified.path,'inventory.json'),material.manifest.artifacts.find(a=>a.path==='inventory.json'),true);
  ensure(current.sha256===captured.sha256&&current.bytes.equals(captured.bytes),'SOURCE_CHANGED');
  const root=join(c.base,'operations',c.operationId),sourcePath=join(root,'inventories/source-final.json');
  await writePrivateNew(sourcePath,current.bytes);await privateArtifact(sourcePath,current);
  await wf.assertWorkflow(token,{side:'source',stage:'RESTART_VERIFIED'},deps);await wf.assertWorkflow(token,{side:'target',stage:'RESTART_VERIFIED'},deps);
  const getTiming=deps.workflowTimingContext??wf.workflowTimingContext;ensure(typeof getTiming==='function','OBJECTIVE_UNKNOWN');
  let timing;try{timing=await getTiming(token,deps);}catch{throw new OpsError('OBJECTIVE_UNKNOWN');}
  authExact(timing,'startedAt availableAt elapsedMs');authUtc(timing.availableAt);
  ensure(timing.startedAt===c.request.startedAt&&typeof timing.elapsedMs==='string'&&/^(0|[1-9][0-9]*)$/.test(timing.elapsedMs),'OBJECTIVE_UNKNOWN');
  const smoke={version:1,operationId:c.operationId,backupId:material.backupId,targetTargetId:child.target.targetId,
    fixtureSha256:record.smokeFixture.sha256,rawComparisonSha256:raw.sha256,sessionCommitSha256:raw.revoked.commitSha256,
    startupInventorySha256:raw.startup.sha256,afterBrowserInventorySha256:raw.afterBrowser.sha256,afterRestartInventorySha256:raw.afterRestart.sha256,
    browserAssertionsSha256:raw.assertions.sha256,deltaProofSha256:raw.delta.sha256,
    checks:{startupZero:true,oldSessionsRejected:true,authDeltaExact:true,contentMediaUnchanged:true,restartZero:true,sourceUnchanged:true},availableAt:timing.availableAt};
  const smokeBytes=canonicalBytes(smoke),smokeSha256=sha256(smokeBytes);
  const receipt=validateRestoreVerified({version:1,runId:c.target.runId,backupId:material.backupId,manifestSha256:material.manifestSha256,
    targetRef:child.target.targetId,rawSnapshotSha256:targetRaw.dbSnapshotSha256,mediaInventorySha256:targetRaw.mediaHeaderSha256,
    smokeReceiptSha256:smokeSha256,environment:c.request.environment,incidentStartedAt:c.request.incidentStartedAt,startedAt:timing.startedAt,
    availableAt:timing.availableAt,elapsedMs:timing.elapsedMs,rtoBudgetMs:'14400000',withinRto:BigInt(timing.elapsedMs)<=14400000n},material.manifest);
  const proof={backupId:material.backupId,manifestSha256:material.manifestSha256,bundleSetSha256:sha256(canonicalBytes(material.manifest.artifacts)),
    sourceInventorySha256:material.manifest.inventory.sha256,sourceIdentitySha256:sha256(canonicalBytes(c.target)),restoreOperationId:c.operationId,
    restoreTargetId:child.target.targetId,rawComparisonSha256:raw.sha256,sessionCommitSha256:raw.revoked.commitSha256,smokeSha256};
  proof.proofSha256=sha256(canonicalBytes(proof));
  await writePrivateNew(join(root,'smoke.json'),smokeBytes);await writePrivateNew(join(root,'restore-verified.json'),canonicalBytes(receipt));
  const path=join(c.base,'operations',c.operationId+'.proof.json'),proofBytes=canonicalBytes(proof);await writePrivateNew(path,proofBytes);
  await privateArtifact(path,{sha256:sha256(proofBytes),byteSize:String(proofBytes.length)});
  raw.finalSource={path:sourcePath,sha256:current.sha256,byteSize:current.byteSize,sequence:current.sequence};raw.finalProof=freeze(proof);
  raw.finalReceipt=freeze(receipt);raw.finalSmoke=freeze(smoke);
  raw.finalSourceBinding=freeze({root:c.root,base:c.base,target:structuredClone(c.target),connection:structuredClone(c.lease.sourceConnection)});
  return freeze({proof,receipt,smoke});
}


const recoveryCandidates = new WeakMap(), recoveredTokens = new WeakMap();
async function jsonArtifact(path, expected=null,limit=1048576) {
  const file=await privateArtifact(path,expected,true,limit);
  return {...file,value:parseStrictJson(file.bytes)};
}
function recoverySource(inspection,deps) {
  const details=(deps.inspectionDetails??inspectionDetails)(inspection);
  ensure(details.apiState==='stopped','WRITER_NOT_QUIESCED');
  validateTargetV1(inspection.target);
  ensure(details.runRoot===rootFor(inspection.target.runId,deps),'SOURCE_CHANGED');
  return {root:details.runRoot,base:join(details.runRoot,'maintenance'),target:inspection.target,
    connection:{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway}};
}
async function persistedRecovery(source,deps,publicationLocator=null) {
  const {root,base,target,connection}=source;
  const locatorFile=publicationLocator?{value:publicationLocator,sha256:sha256(canonicalBytes(publicationLocator))}
    :await jsonArtifact(join(base,'recovery-candidate.json')),locator=locatorFile.value;
  authExact(locator,'version sourceRunId backupId restoreOperationId proofSha256');
  ensure(locator.version===1&&locator.sourceRunId===target.runId
    &&/^pp1-\d{8}T\d{9}Z-[0-9a-f]{32}$/.test(locator.backupId)
    &&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(locator.restoreOperationId));
  const operationId=locator.restoreOperationId,opRoot=join(base,'operations',operationId);
  const proofFile=await jsonArtifact(join(base,'operations',operationId+'.proof.json')),proof=proofFile.value;
  ensure(proof.proofSha256===locator.proofSha256&&proof.backupId===locator.backupId&&proof.restoreOperationId===operationId);
  const requestFile=await jsonArtifact(join(base,'operations',operationId+'.request.json')),request=requestFile.value;
  authExact(request,'version operationId sourceRunId purpose targetRunId incidentStartedAt startedAt environment');
  ensure(request.version===1&&request.operationId===operationId&&request.sourceRunId===target.runId
    &&request.purpose==='RESTORE_VERIFY_LOCAL'&&request.environment==='isolated-drill');
  authUtc(request.startedAt);authUtc(request.incidentStartedAt);ensure(request.incidentStartedAt<=request.startedAt);
  const childRoot=rootFor(request.targetRunId,deps),marker=(await jsonArtifact(join(childRoot,'restore-target.json'))).value;
  const journal=(await jsonArtifact(join(base,'operations',operationId+'.json'))).value;
  const terminal={version:2,operationId,purpose:'RESTORE_VERIFY_LOCAL',releaseId:`sha256:${target.apiBuild.jarSha256}`,
    phase:'COMPLETE',createdAt:request.startedAt,requestSha256:requestFile.sha256,source:target,sourceConnection:connection,
    completionPolicy:'KEEP_STOPPED',target:marker,helper:null,proof,account:null};
  const matches=[];
  for(const originalApiState of ['running','stopped']) {
    const lease={...terminal,originalApiState};validateLeaseV2(lease);
    if(journal.records?.at(-1)?.leaseSha256===sha256(canonicalBytes(lease)))matches.push(lease);
  }
  ensure(matches.length===1&&journal.records.at(-1).event==='END'&&journal.records.at(-1).phase==='COMPLETE','JOURNAL_INCOMPLETE');
  validateJournalV2(journal,matches[0]);
  const preparation={receipt:JSON.parse(new TextDecoder('utf8',{fatal:true}).decode((await privateArtifact(join(childRoot,'receipt.json'),null,true,1048576)).bytes)),
    artifacts:JSON.parse(new TextDecoder('utf8',{fatal:true}).decode((await privateArtifact(join(childRoot,'artifacts.json'),null,true,1048576)).bytes))};
  ensure(marker.creationPhase==='BLANK_VERIFIED'&&marker.sourceOperationId===operationId&&marker.runId===request.targetRunId
    &&proof.restoreTargetId===marker.targetId&&same(marker.identity.images,target.images)
    &&marker.preparationSha256===sha256(canonicalBytes(preparation))
    &&marker.createdResourceSetSha256===sha256(canonicalBytes({containerIds:marker.identity.containerIds,
      networkIds:marker.identity.networkIds,volumeNames:marker.identity.volumeNames})));
  const paths=[join(root,'bundles',proof.backupId),join(root,'protected-copy',proof.backupId)];
  const manifestFile=await jsonArtifact(join(paths[0],'manifest.json')),manifest=validateManifest(manifestFile.value);
  ensure(manifestFile.sha256===proof.manifestSha256&&manifest.backupId===proof.backupId
    &&manifest.instanceId.replaceAll('-','')===target.runId&&manifest.times.startedAt===request.startedAt
    &&proof.bundleSetSha256===sha256(canonicalBytes(manifest.artifacts))&&proof.sourceInventorySha256===manifest.inventory.sha256);
  let captured;
  const completeFile=await jsonArtifact(join(paths[0],'local-complete.json'));validateLocalComplete(completeFile.value,manifest);
  const entries=[...manifest.artifacts,{path:'manifest.json',...manifestFile},{path:'local-complete.json',...completeFile}];
  for(const path of paths) {
    await directory(path);ensure(same((await readdir(path)).sort(),entries.map(e=>e.path).sort()));
    for(const entry of entries) {
      const file=await privateArtifact(join(path,entry.path),entry,entry.path==='inventory.json');
      if(entry.path==='inventory.json')captured=parseStrictJson(file.bytes);
    }
  }
  validateInventory(captured);ensure(captured.dbSnapshotSha256===manifest.inventory.dbSnapshotSha256);
  await verifyLineage(null,{root,target},manifest,captured,deps,true);
  const inventory=async name=>{const file=await jsonArtifact(join(opRoot,'inventories',name+'.json'),null,null);validateInventory(file.value);return file;};
  for(const name of ['source-before','source-after','source-final']) {
    const file=await inventory(name);ensure(file.sha256===manifest.inventory.sha256&&same(file.value,captured),'SOURCE_CHANGED');
  }
  const raw=await jsonArtifact(join(opRoot,'raw-comparison.json'));
  ensure(raw.sha256===proof.rawComparisonSha256);
  const targetRaw=await inventory('target-raw'),revoked=await inventory('target-revoked'),startup=await inventory('target-startup'),
    afterBrowser=await inventory('target-after-browser'),afterRestart=await inventory('target-after-restart');
  validateRawComparison(raw.value,manifest,{operationId,sourceIdentity:target,targetIdentity:marker.identity,
    sourceInventory:captured,targetInventory:targetRaw.value,targetInventorySha256:targetRaw.sha256});
  ensure(raw.value.equal===true,'RAW_MISMATCH');
  const commits=[];
  for(const seq of await readdir(join(opRoot,'helper'))) {
    ensure(/^[1-9][0-9]*$/.test(seq));
    try {
      const commitPath=join(opRoot,'helper',seq,'commit-receipt.json');
      await lstat(commitPath);const file=await jsonArtifact(commitPath);
      if(file.sha256===proof.sessionCommitSha256)commits.push({file,seq});
    } catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  ensure(commits.length===1);const commit=commits[0];
  const commitRequest=(await jsonArtifact(join(opRoot,'helper',commit.seq,'request.json'))).value;
  ensure(same(commitRequest,{version:1,mode:'REVOKE_SESSIONS',operationId,side:'target',targetId:marker.targetId,
    releaseId:`sha256:${target.apiBuild.jarSha256}`,jdbcUrl:marker.connection.jdbcUrl,dbUser:'cms_local',
    passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:null,outputFile:null,backupId:proof.backupId,rawProofSha256:raw.sha256}));
  verifyRevocationDelta(targetRaw.value,revoked.value,commit.file.value,{operationId,backupId:proof.backupId,targetId:marker.targetId});
  const audit=revoked.value.tables.find(t=>t.tableName==='cms_audit_event').rows.find(r=>r.id===commit.file.value.auditEventId);
  ensure(Date.parse(audit.at)>=Date.parse(request.startedAt));verifyZeroDelta(revoked.value,startup.value);
  const fixture=await jsonArtifact(join(opRoot,'smoke-fixture.json')),delta=await jsonArtifact(join(opRoot,'auth-delta.json')),
    assertions=await jsonArtifact(join(opRoot,'browser-assertions.json'));
  authFixture(fixture.value);deriveCredentialBindings(fixture.value,captured);
  revalidateAuthDelta(startup.value,afterBrowser.value,delta.value,assertions.value,fixture.value);verifyZeroDelta(afterBrowser.value,afterRestart.value);
  const smoke=await jsonArtifact(join(opRoot,'smoke.json')),receipt=await jsonArtifact(join(opRoot,'restore-verified.json'));
  ensure(smoke.sha256===proof.smokeSha256);
  const expectedSmoke={version:1,operationId,backupId:proof.backupId,targetTargetId:marker.targetId,fixtureSha256:fixture.sha256,
    rawComparisonSha256:raw.sha256,sessionCommitSha256:commit.file.sha256,startupInventorySha256:startup.sha256,
    afterBrowserInventorySha256:afterBrowser.sha256,afterRestartInventorySha256:afterRestart.sha256,
    browserAssertionsSha256:assertions.sha256,deltaProofSha256:delta.sha256,
    checks:{startupZero:true,oldSessionsRejected:true,authDeltaExact:true,contentMediaUnchanged:true,restartZero:true,sourceUnchanged:true},availableAt:receipt.value.availableAt};
  ensure(same(smoke.value,expectedSmoke));validateRestoreVerified(receipt.value,manifest);
  ensure(same(receipt.value,{version:1,runId:target.runId,backupId:proof.backupId,manifestSha256:proof.manifestSha256,
    targetRef:marker.targetId,rawSnapshotSha256:targetRaw.value.dbSnapshotSha256,mediaInventorySha256:targetRaw.value.mediaHeaderSha256,
    smokeReceiptSha256:smoke.sha256,environment:request.environment,incidentStartedAt:request.incidentStartedAt,startedAt:request.startedAt,
    availableAt:receipt.value.availableAt,elapsedMs:receipt.value.elapsedMs,rtoBudgetMs:'14400000',withinRto:BigInt(receipt.value.elapsedMs)<=14400000n}));
  return {source,proof,manifest,inventory:captured,locatorSha256:locatorFile.sha256};
}
// Static released material only. Fresh rows/files observation is a separate capability.
export async function readReadonlyMaterial(ids,deps={}) {
  ensure(ids&&typeof ids==='object'&&!Array.isArray(ids)&&Object.getOwnPropertySymbols(ids).length===0
    &&same(Object.getOwnPropertyNames(ids).sort(),['backupId','restoreOperationId','runId'])
    &&Object.values(ids).every(value=>typeof value==='string'),'INPUT_INVALID');
  const {runId,backupId,operationId}=parseArgs(['--run-id',ids.runId,'--backup-id',ids.backupId,'--restore-operation-id',ids.restoreOperationId]);
  const root=rootFor(runId,deps),prior=await assertPriorReleased(runId,deps);ensure(prior?.lease,'JOURNAL_INCOMPLETE');
  const inspection=await inspectTarget(root,deps,{apiState:'stopped'}),details=inspectionDetails(inspection);
  ensure(details.runRoot===root&&details.apiState==='stopped','SOURCE_CHANGED');
  const source={root,base:join(root,'maintenance'),target:inspection.target,
    connection:{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway}};
  const evidence=await persistedRecovery(source,deps);
  ensure(evidence.proof.backupId===backupId&&evidence.proof.restoreOperationId===operationId,'BUNDLE_MISMATCH');
  const after=await assertPriorReleased(runId,deps);
  ensure(after&&same(after.lease,prior.lease)&&same(after.journal,prior.journal)&&same(after.request,prior.request),'JOURNAL_INCOMPLETE');
  const fresh=await inspectTarget(root,deps,{apiState:'stopped'});inspectionDetails(fresh);
  ensure(same(fresh,inspection),'SOURCE_CHANGED');const final=await assertPriorReleased(runId,deps);
  ensure(final&&same(final.lease,prior.lease)&&same(final.journal,prior.journal)&&same(final.request,prior.request),'JOURNAL_INCOMPLETE');
  return freeze(evidence);
}
export async function preflightRecovery(inspection,deps={}) {
  const source=recoverySource(inspection,deps);await assertPriorReleased(source.target.runId,deps);
  const evidence=await persistedRecovery(source,deps);await assertPriorReleased(source.target.runId,deps);
  const candidate=Object.freeze({});
  recoveryCandidates.set(candidate,freeze(evidence));return candidate;
}

const candidateLocks = new WeakMap();
async function candidateEvidence(candidate,source,deps) {
  const prior=recoveryCandidates.get(candidate);ensure(prior&&same(prior.source,source),'ADAPTER_UNSEALED');
  const current=await persistedRecovery(source,deps);
  ensure(current.locatorSha256===prior.locatorSha256&&same(current.proof,prior.proof),'SOURCE_CHANGED');
  return current;
}
function recoverLease(lease,source,proof) {
  ensure(lease.purpose==='RECOVER_ADMIN'&&lease.originalApiState==='stopped'&&lease.completionPolicy==='KEEP_STOPPED'
    &&lease.target===null&&same(lease.source,source.target)&&same(lease.sourceConnection,source.connection),'SOURCE_CHANGED');
  if(lease.proof!==null)ensure(same(lease.proof,proof),'SOURCE_CHANGED');
}
function sameLock(a,b) {return a&&b&&a.ino===b.ino&&a.dev===b.dev;}
export async function recoveryCandidateContext(candidate,inspection,deps={}) {
  const source=recoverySource(inspection,deps),evidence=await candidateEvidence(candidate,source,deps);
  const current=await loadWorkflow(source.target.runId,deps,{allowPending:true}),bound=candidateLocks.get(candidate);
  if(current.identity) {
    recoverLease(current.lease,source,evidence.proof);
    ensure(current.lease.operationId!==evidence.proof.restoreOperationId,'ADAPTER_UNSEALED');
    if(bound)ensure(bound.operationId===current.lease.operationId&&sameLock(bound.identity,current.identity),'ADAPTER_UNSEALED');
    else candidateLocks.set(candidate,{operationId:current.lease.operationId,identity:current.identity});
  } else ensure(!bound,'ADAPTER_UNSEALED');
  return freeze({proof:structuredClone(evidence.proof)});
}
async function activeRecovery(c,source,proof,deps) {
  const record=await loadWorkflow(source.target.runId,deps,{allowPending:true});
  ensure(record.identity&&c.root===record.root&&c.base===record.base&&c.operationId===record.lease.operationId
    &&same(c.lease,record.lease)&&same(c.request,record.request),'ADAPTER_UNSEALED');
  recoverLease(record.lease,source,proof);ensure(record.lease.helper===null&&same(record.lease.proof,proof),'ADAPTER_UNSEALED');
  return record;
}
export async function verifyRecoveryProof(token,{candidate,inventory}={},deps={}) {
  ensure(!recoveredTokens.has(token),'ADAPTER_UNSEALED');
  const wf=deps.workflow??workflow,c=await wf.assertWorkflow(token,{side:'source',stage:'PROOF_REVALIDATED'},deps);
  const source=recoverySource(c.inspection,deps),evidence=await candidateEvidence(candidate,source,deps);
  await recoveryCandidateContext(candidate,c.inspection,deps);
  const record=await activeRecovery(c,source,evidence.proof,deps);
  const current=await readOwnedInventory(token,inventory,'source',c,c.target,c.lease.sourceConnection,deps);
  ensure(current.sequence===c.helperSequence,'ADAPTER_UNSEALED');
  ensure(current.sha256===evidence.manifest.inventory.sha256&&current.bytes.equals(canonicalBytes(evidence.inventory)),'SOURCE_CHANGED');
  await verifyLineage(token,{root:source.root,target:source.target},evidence.manifest,current.inventory,deps);
  const path=join(c.base,'operations',c.operationId,'inventories','source-revalidated.json');
  await mkdir(dirname(path),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await directory(dirname(path));
  await writePrivateNew(path,current.bytes);await privateArtifact(path,current);
  const fresh=await wf.assertWorkflow(token,{side:'source',stage:'PROOF_REVALIDATED'},deps);
  const latest=await activeRecovery(fresh,source,evidence.proof,deps);ensure(sameLock(record.identity,latest.identity),'ADAPTER_UNSEALED');
  recoveredTokens.set(token,{candidate,source,operationId:c.operationId,identity:record.identity,
    requestSha256:record.lease.requestSha256,path,sha256:current.sha256,byteSize:current.byteSize,sequence:current.sequence});
  return freeze({proof:structuredClone(evidence.proof)});
}
export async function revalidatedRecoveryContext(token,deps={}) {
  const sealed=recoveredTokens.get(token);ensure(sealed,'ADAPTER_UNSEALED');
  const c=await(deps.workflow??workflow).assertWorkflow(token,{side:'source'},deps);
  const source=recoverySource(c.inspection,deps),evidence=await candidateEvidence(sealed.candidate,source,deps);
  const record=await activeRecovery(c,source,evidence.proof,deps);
  ensure(same(sealed.source,source)&&record.lease.operationId===sealed.operationId&&sameLock(record.identity,sealed.identity)
    &&record.lease.requestSha256===sealed.requestSha256&&c.helperSequence===sealed.sequence,'ADAPTER_UNSEALED');
  await privateArtifact(sealed.path,sealed);return freeze({proof:structuredClone(evidence.proof)});
}
export async function revalidateRecoveryGuard(record,deps={}) {
  ensure(record?.lease?.source,'ADAPTER_UNSEALED');
  const current=await loadWorkflow(record.lease.source.runId,deps,{allowPending:true});
  ensure(current.identity&&sameLock(current.identity,record.identity)&&same(current.lease,record.lease)
    &&same(current.request,record.request)&&same(current.journal,record.journal)&&current.root===record.root&&current.base===record.base,'ADAPTER_UNSEALED');
  const lease=current.lease,last=current.journal.records.at(-1);
  ensure(['ACCOUNT_PRE_CONNECTION','ACCOUNT_BOUND','ACCOUNT_COMMITTED'].includes(lease.phase)
    &&lease.account?.operation==='RECOVER_ADMIN'&&last?.event==='BEGIN'&&last.phase===lease.phase
    &&last.leaseSha256===sha256(canonicalBytes(lease))&&last.proofSha256===lease.proof?.proofSha256,'ADAPTER_UNSEALED');
  const source={root:current.root,base:current.base,target:lease.source,connection:lease.sourceConnection};
  const evidence=await persistedRecovery(source,deps);recoverLease(lease,source,evidence.proof);
  ensure(lease.helper===null&&same(lease.proof,evidence.proof),'ADAPTER_UNSEALED');
  // The earlier full snapshot was made under this lock. The caller independently
  // proves current writer quiescence; no second backend is opened during account.
  const file=await privateArtifact(join(current.base,'operations',lease.operationId,'inventories/source-revalidated.json'),
    {sha256:evidence.manifest.inventory.sha256,byteSize:String(canonicalBytes(evidence.inventory).length)},true);
  ensure(file.bytes.equals(canonicalBytes(evidence.inventory)),'SOURCE_CHANGED');return true;
}


async function revalidateFinalArtifacts(token,deps) {
  const {raw,material,c}=await lifecycleEvidence(token,deps);
  ensure(raw.finalSource&&raw.finalProof&&raw.finalReceipt&&raw.finalSmoke,'ADAPTER_UNSEALED');
  const source=await privateArtifact(raw.finalSource.path,raw.finalSource,true);
  ensure(source.sha256===material.manifest.inventory.sha256&&source.bytes.equals(canonicalBytes(material.inventory)),'SOURCE_CHANGED');
  const root=join(c.base,'operations',c.operationId);
  const proof=await jsonArtifact(join(c.base,'operations',c.operationId+'.proof.json'));
  ensure(same(proof.value,raw.finalProof));
  const smoke=await jsonArtifact(join(root,'smoke.json'),{sha256:raw.finalProof.smokeSha256,byteSize:String(canonicalBytes(raw.finalSmoke).length)});
  ensure(same(smoke.value,raw.finalSmoke));
  const receipt=await jsonArtifact(join(root,'restore-verified.json'));ensure(same(receipt.value,raw.finalReceipt));
  validateRestoreVerified(receipt.value,material.manifest);
}
export async function publishRecoveryCandidate(token,proof,deps={}) {
  const raw=rawComparisons.get(token),record=protectedCopies.get(token);
  ensure(raw?.finalProof&&proof===raw.finalProof&&record&&raw.finalSourceBinding&&!raw.published,'ADAPTER_UNSEALED');
  const source=raw.finalSourceBinding;
  ensure(source.root===record.owned.root&&proof.restoreOperationId===record.owned.operationId
    &&source.root===rootFor(source.target.runId,deps),'ADAPTER_UNSEALED');
  const released=await assertPriorReleased(source.target.runId,deps);
  ensure(released?.lease.version===2&&released.lease.purpose==='RESTORE_VERIFY_LOCAL'
    &&released.lease.operationId===proof.restoreOperationId&&same(released.lease.proof,proof)
    &&same(released.lease.source,source.target)&&same(released.lease.sourceConnection,source.connection),'ADAPTER_UNSEALED');
  const locator={version:1,sourceRunId:source.target.runId,backupId:proof.backupId,
    restoreOperationId:proof.restoreOperationId,proofSha256:proof.proofSha256};
  const evidence=await persistedRecovery(source,deps,locator);ensure(same(evidence.proof,proof),'SOURCE_CHANGED');
  const path=join(source.base,'recovery-candidate.json');
  try {await lstat(path);await privateArtifact(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(source.base,'recovery-candidate.next');
  await writePrivateNew(temporary,canonicalBytes(locator));
  // Recheck the released registry immediately before atomic publication.
  const fresh=await assertPriorReleased(source.target.runId,deps);
  ensure(same(fresh.lease,released.lease)&&same(fresh.journal,released.journal),'JOURNAL_INCOMPLETE');
  await rename(temporary,path);await syncDirectory(source.base);raw.published=true;
  return freeze(locator);
}
