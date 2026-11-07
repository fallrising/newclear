import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { inspectTarget, observedSessionConfig } from '../../../scripts/local/maintenance-target.mjs';
const execute=promisify(execFile),record=JSON.parse(await readFile(new URL('./source-runtime.json',import.meta.url)));
const receipt={runId:record.runId,scope:'actual fixed session-config accessor on root-created controlled fresh C source',
  controlledFreshLifecycle:record.controlledFreshLifecycle,startedAt:new Date().toISOString(),commands:[]};
const command=async(file,args,options)=>{
  const started=performance.now();let result;
  try {result=await execute(file,args,options);return result;}
  catch(error){result=error;throw error;}
  finally {receipt.commands.push({tool:file.endsWith('/java')?'jdk25':file,action:file==='docker'?args[2]:'source-probe',
    ...(args[2]==='cp'?{fixedPath:args[3].split(':').slice(1).join(':')}:{}),
    exitCode:result?.code??0,stdoutBytes:Buffer.byteLength(result?.stdout??''),stderrBytes:Buffer.byteLength(result?.stderr??''),
    milliseconds:Math.round(performance.now()-started)});}
};
try {
  if(record.healthy!==true||record.controlledFreshLifecycle!==true)throw Error('SOURCE_NOT_FRESH');
  const inspection=await inspectTarget(record.root,{command},{apiState:'running'});
  receipt.settings=await observedSessionConfig(inspection,{command});receipt.success=true;
  receipt.targetId=inspection.target.targetId;receipt.jarSha256=inspection.target.apiBuild.jarSha256;
}catch(error){receipt.success=false;receipt.code=error.code??'CONFIG_OBSERVATION_FAILED';process.exitCode=1;}
finally {receipt.endedAt=new Date().toISOString();await writeFile(new URL('./config-observation.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');}
console.log(JSON.stringify({success:receipt.success,code:receipt.code,settings:receipt.settings}));
