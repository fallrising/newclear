import { constants } from 'node:fs';
import { open, lstat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalBytes, sha256, parseStrictJson, validateManifest, validateLocalComplete, OpsError } from './recovery-protocol.mjs';
import { validateInventory } from './local-media.mjs';
import { directory } from '../local/maintenance-store.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
const ensure=(ok,code='BUNDLE_MISMATCH')=>{if(!ok)throw new OpsError(code);};
const same=(a,b)=>canonicalBytes(a).equals(canonicalBytes(b));
const stable=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs','mode','uid','gid','nlink'].every(k=>a[k]===b[k]);
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
async function privateArtifact(path,expected=null,readBytes=false,limit=null){
  let fd;
  try{
    await directory(dirname(path));fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await fd.stat({bigint:true});ensure(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid())
      &&before.gid===BigInt(process.getgid())&&(before.mode&0o7777n)===0o600n);
    if(limit!==null)ensure(before.size<=BigInt(limit));
    if(expected)ensure(String(before.size)===expected.byteSize);
    const hash=createHash('sha256'),chunks=[];let size=0n;
    for await(const chunk of fd.createReadStream({autoClose:false})){hash.update(chunk);size+=BigInt(chunk.length);if(readBytes)chunks.push(chunk);}
    const digest=hash.digest('hex');ensure(size===before.size&&stable(before,await fd.stat({bigint:true}))&&stable(before,await lstat(path,{bigint:true})));
    if(expected)ensure(digest===expected.sha256);
    return {sha256:digest,byteSize:String(size),...(readBytes?{bytes:Buffer.concat(chunks)}:{})};
  }catch(error){if(error instanceof OpsError)throw error;throw new OpsError('BUNDLE_MISMATCH');}
  finally{await fd?.close();}
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
  await wf.assertWorkflow(token,{side:'source',stage:'LOCAL_VERIFIED'},deps);
  return freeze({path,manifest,inventory,complete,manifestSha256:manifestFile.sha256});
}
