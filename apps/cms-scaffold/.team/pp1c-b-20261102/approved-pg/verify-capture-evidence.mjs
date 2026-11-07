import { readFile, lstat, access, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { parseStrictJson, validateManifest, validateLocalComplete } from '../../../scripts/ops/recovery-protocol.mjs';
const e='.team/pp1c-b-20261102',o=join(e,'approved-pg'),r=JSON.parse(await readFile(join(e,'capture-runtime.json'))),c=JSON.parse(await readFile(join(o,'capture-live.json')));
assert.equal(c.runId,r.runId);assert.equal(c.success,true);assert.equal(c.sourceRestored,true);assert.equal(c.stopped,true);
const hash=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
const m=validateManifest(parseStrictJson(await readFile(join(c.bundlePath,'manifest.json'))));
validateLocalComplete(parseStrictJson(await readFile(join(c.bundlePath,'local-complete.json'))),m);
assert.equal(await hash(join(c.bundlePath,'manifest.json')),c.manifestSha256);assert.equal((await lstat(c.bundlePath)).mode&0o777,0o700);
const artifacts=[];
for(const a of m.artifacts){const path=join(c.bundlePath,a.path),s=await lstat(path),actual=await hash(path);assert.equal(actual,a.sha256);assert.equal(String(s.size),a.byteSize);assert.equal(s.mode&0o777,0o600);assert.equal(s.nlink,1);assert.equal(s.uid,process.getuid());artifacts.push({path:a.path,sha256:actual,byteSize:String(s.size),mode:'0600',nlink:s.nlink});}
const helper=join(r.root,'maintenance/operations',c.operationId,'helper');
const inventoryHash=m.artifacts.find(a=>a.path==='inventory.json').sha256;
assert.equal(await hash(join(helper,'1/output/inventory.json')),inventoryHash);assert.equal(await hash(join(helper,'4/output/inventory.json')),inventoryHash);
const inventory=JSON.parse(await readFile(join(c.bundlePath,'inventory.json')));
assert.equal(inventory.tables.length,20);assert.equal(inventory.dbSnapshotSha256,m.inventory.dbSnapshotSha256);
const lease=parseStrictJson(await readFile(join(r.root,'maintenance/lease.json'))),journal=parseStrictJson(await readFile(join(r.root,'maintenance/operations',c.operationId+'.json')));
assert.equal(lease.phase,'COMPLETE');assert.equal(lease.helper,null);assert.equal(journal.records.at(-1).event,'END');assert.equal(journal.records.at(-1).phase,'COMPLETE');
await assert.rejects(access(join(r.root,'maintenance/operation.lock')),{code:'ENOENT'});await assert.rejects(access(join(c.bundlePath,'failure.json')),{code:'ENOENT'});
const exec=promisify(execFile),containers=JSON.parse((await exec('docker',['inspect',...r.ownedContainers],{timeout:30000})).stdout);
assert.equal(containers.length,3);for(const x of containers){assert.ok(r.ownedContainers.includes(x.Id));assert.equal(x.Config.Labels['com.docker.compose.project'],r.project);assert.equal(x.State.Running,false);}
const sources=JSON.parse(await readFile(join(e,'current-source-hashes.json')));for(const [path,h]of Object.entries(sources))assert.equal(await hash(path),h);
const result={runId:r.runId,operationId:c.operationId,backupId:c.backupId,manifestSha256:c.manifestSha256,scope:'actual B local capture only; no restore/offsite claim',sourceCommit:m.release.sourceCommit,worktreeDirty:true,apiImage:m.release.apiImageDigest,postgresImage:m.release.postgresImageDigest,artifacts,tableCount:inventory.tables.length,tableCounts:inventory.tables.map(t=>({name:t.tableName,rowCount:t.rowCount})),dbSnapshotSha256:inventory.dbSnapshotSha256,media:m.inventory,prePostInventoryEqual:true,completeMarkerValidated:true,journalComplete:true,lockReleased:true,sourceRestoredBeforeDriverStop:true,ownedContainersStopped:r.ownedContainers,sourceFileCount:Object.keys(sources).length,sourceManifestSha256:await hash(join(e,'current-source-hashes.json')),observedAt:new Date().toISOString()};
await writeFile(join(o,'capture-acceptance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({success:true,runId:r.runId,tableCount:20,artifacts:artifacts.length,sourceFileCount:result.sourceFileCount}));
