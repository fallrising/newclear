import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, statfs } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalBytes, sha256, parseStrictJson, validateManifest, validateLocalComplete, OpsError } from './recovery-protocol.mjs';
import { validateInventory } from './local-media.mjs';
import { directory, syncDirectory, validateTargetV1 } from '../local/maintenance-store.mjs';
import { verifiedHelperProfile, verifiedInventoryResult } from '../local/maintenance-helper.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
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

async function verifyLineage(token,c,m,inventory,deps){
  const file=await privateArtifact(join(c.root,'artifacts.json'),null,true,1048576);
  const a=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(file.bytes)),t=c.target;
  ensure(a.version===1&&a.sourceCommit===t.sourceCommit&&same(a.apiBuild,t.apiBuild),'SOURCE_CHANGED');
  ensure(m.release.sourceCommit===t.sourceCommit&&m.toolchain.inventorySourceCommit===t.sourceCommit
    &&m.release.apiImageDigest===t.images.api&&m.release.postgresImageDigest===t.images.postgres,'SOURCE_CHANGED');
  const profile=await(deps.helperProfile??verifiedHelperProfile)(token,deps);
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
    protectedCopies.set(token,{owned,verified:fresh,result});return result;
  }catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
}

export async function restoreBundleMaterial(token,deps={}) {
  const record=protectedCopies.get(token);ensure(record,'ADAPTER_UNSEALED');
  const c=await(deps.workflow??workflow).assertWorkflow(token,{side:'source'},deps);
  ensure(c.root===record.owned.root&&c.operationId===record.owned.operationId,'ADAPTER_UNSEALED');
  ensure(['LOCAL_VERIFIED','TARGET_RESERVED','TARGET_BLANK','DB_RESTORED','MEDIA_RESTORED','RAW_VERIFIED','SESSIONS_REVOKED'].includes(c.lease.phase),'ADAPTER_UNSEALED');
  const v=record.verified,metadata=[{path:'manifest.json',bytes:canonicalBytes(v.manifest)},
    {path:'local-complete.json',bytes:canonicalBytes(v.complete)}].map(x=>({path:x.path,sha256:sha256(x.bytes),byteSize:String(x.bytes.length)}));
  const entries=[...v.manifest.artifacts,...metadata],names=entries.map(x=>x.path).sort();
  for(const root of [v.path,record.result.path]){
    ensure(same((await readdir(root)).sort(),names));
    for(const entry of entries)await privateArtifact(join(root,entry.path),entry);
  }
  await verifyLineage(token,c,v.manifest,v.inventory,deps);
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
    ensure(value.version===1&&value.schemaVersion==='pp1c-inventory-v1'
      &&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(context.operationId)&&value.operationId===context.operationId);
    ensure(value.backupId===manifest.backupId&&value.manifestSha256===hash(manifest)
      &&value.releaseId===manifest.release.apiImageDigest&&value.releaseId===source.images.api);
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
      ensure(row.schemaEqual===same(s.schema,t.schema)&&row.rowsEqual===same(s.rows,t.rows));
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
async function readOwnedInventory(token,result,side,c,identity,connection,deps) {
  const authority=await(deps.inventoryAuthority??verifiedInventoryResult)(token,result);
  ensure(authority.kind==='INVENTORY'&&authority.side===side&&authority.operationId===c.operationId,'ADAPTER_UNSEALED');
  ensure(/^[1-9][0-9]*$/.test(authority.seq)&&authority.targetId===identity.targetId&&authority.releaseId===identity.images.api,'ADAPTER_UNSEALED');
  const root=join(c.base,'operations',c.operationId,'helper',authority.seq);
  ensure(authority.path===join(root,'output/inventory.json'),'ADAPTER_UNSEALED');
  const requestFile=await privateArtifact(join(root,'request.json'),null,true,65536);
  ensure(requestFile.sha256===authority.requestSha256,'ADAPTER_UNSEALED');
  const expected={version:1,mode:'INVENTORY',operationId:c.operationId,side,targetId:identity.targetId,
    releaseId:identity.images.api,jdbcUrl:connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
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
      schemaEqual:same(s.schema,t.schema),rowsEqual:same(s.rows,t.rows)};
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
  const receipt={version:1,operationId:c.operationId,backupId:m.backupId,manifestSha256:material.manifestSha256,releaseId:m.release.apiImageDigest,
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
  rawComparisons.set(token,{path,sha256:sha256(receiptBytes),byteSize:String(receiptBytes.length),targetIdentitySha256:receipt.targetIdentitySha256});
  return freeze(receipt);
}

// D owns complete persisted-proof revalidation. Never silently succeed before it seals.
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
  let operationId=null,backupId=null,code='ADAPTER_UNSEALED',exitCode=7;
  try {({operationId,backupId}=parseArgs(argv));}
  catch {code='INPUT_INVALID';exitCode=2;}
  (deps.stdout??process.stdout).write(canonicalBytes({operationId,backupId,phase:null,code,exitCode}));return exitCode;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await run(process.argv.slice(2));
