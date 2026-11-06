import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, statfs } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalBytes, sha256, parseStrictJson, validateManifest, validateLocalComplete, OpsError } from './recovery-protocol.mjs';
import { validateInventory } from './local-media.mjs';
import { directory, syncDirectory } from '../local/maintenance-store.mjs';
import { verifiedHelperProfile } from '../local/maintenance-helper.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
const verifiedBundles=new WeakMap(),protectedCopies=new WeakMap();
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
  verifiedBundles.set(result,{token,root:c.root,manifestSha256:manifestFile.sha256,operationId:c.operationId});return result;
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
  return freeze({...record.result,manifest:v.manifest,inventory:v.inventory,sourceRoot:record.owned.root,operationId:c.operationId});
}
