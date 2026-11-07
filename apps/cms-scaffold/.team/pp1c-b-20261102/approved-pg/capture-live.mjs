import {inspectTarget} from '../../../scripts/local/maintenance-target.mjs';
import {captureLocal} from '../../../scripts/ops/local-bundle.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {join} from 'node:path';
const exec=promisify(execFile),p=process.cwd(),e=join(p,'.team/pp1c-b-20261102'),r=JSON.parse(await readFile(join(e,'capture-runtime.json'))),operationId=randomUUID();
const summary={runId:r.runId,operationId,startedAt:new Date().toISOString(),scope:'real B source capture only; no restore acceptance',calls:[]},owned=[];
const command=async(file,args,opts={})=>{try{return await exec(file,args,opts);}catch(error){summary.lastNonzero={file,action:args[2]??args[0],code:error.code};throw error;}};
const docker=async args=>(await command('docker',['--host','unix:///var/run/docker.sock',...args],{timeout:60000})).stdout;
try{
 for(const id of (r.stoppedContainers??r.ownedContainers)){const c=JSON.parse(await docker(['inspect',id]))[0];if(c.Id!==id||c.Config.Labels['com.docker.compose.project']!==r.project)throw Error('OWNERSHIP');owned.push(id);}
 await docker(['start',...owned]);
 let ready=false;for(let i=0;i<120;i++){const rows=JSON.parse(await docker(['inspect',...owned]));if(rows.every(c=>c.State.Running&&(!c.State.Health||c.State.Health.Status==='healthy'))){ready=true;break;}await new Promise(x=>setTimeout(x,1000));}if(!ready)throw Error('READINESS');
 const inspection=await inspectTarget(r.root,{}, {apiState:'running'});summary.initialInspection=true;
 const result=await captureLocal(inspection,{operationId,purpose:'BACKUP_LOCAL',completionPolicy:'RESTORE_ORIGINAL',targetRunId:null,incidentStartedAt:null},{command});
 summary.success=true;summary.backupId=result.backupId;summary.manifestSha256=createHash('sha256').update(await readFile(join(result.path,'manifest.json'))).digest('hex');summary.bundlePath=result.path;summary.artifacts=result.manifest.artifacts;summary.sourceRestored=JSON.parse(await docker(['inspect',inspection.target.containerIds['cms-api']]))[0].State.Running;
}catch(error){summary.success=false;summary.code=error.code??error.message;process.exitCode=1;}
finally{if(owned.length)await docker(['stop','--time','30',...owned]);summary.stopped=true;summary.endedAt=new Date().toISOString();await writeFile(join(e,'approved-pg/capture-live.json'),JSON.stringify(summary,null,2)+'\n');}
console.log(JSON.stringify({success:summary.success,code:summary.code,backupId:summary.backupId}));
