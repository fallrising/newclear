import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, parse, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTarget } from './maintenance-target.mjs';
import { acquire, finish } from './maintenance-guard.mjs';
const execute=promisify(execFile), cleanEnv=()=>({PATH:'/usr/bin:/bin',LANG:'C.UTF-8'});
const codes={INPUT_INVALID:2,SECRET_INPUT_INVALID:2,DUPLICATE_OPERATION:3,MAINTENANCE_BUSY:4,MAINTENANCE_INTERNAL_ERROR:5,COMMITTED_HOST_RESTORE_FAILED:5,QUIESCENCE_NOT_PROVEN:6,RECOVERY_BACKUP_REQUIRED:6};
const fail=name=>{throw new Error(name);}, requireSafe=value=>{if(!value)fail('QUIESCENCE_NOT_PROVEN');};
const blank=v=>typeof v!=='string'||/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function parseArgs(argv) {
  const bad=()=>fail('INPUT_INVALID'), separator=argv.indexOf('--');
  if(separator<0||separator!==argv.lastIndexOf('--')||separator!==6)bad();
  const outer={};
  for(let i=0;i<separator;i+=2){const flag=argv[i],value=argv[i+1];if(!['--run-id','--java-bin','--jar'].includes(flag)||Object.hasOwn(outer,flag)||blank(value)||value.startsWith('--'))bad();outer[flag]=value;}
  if(!/^[a-f0-9]{32}$/.test(outer['--run-id']))bad();
  const maintenanceArgs=argv.slice(separator+1), verb=maintenanceArgs[0], operation={ 'fresh-init':'FRESH_INIT','recover-admin':'RECOVER_ADMIN' }[verb];
  if(!operation)bad();
  const allowed=operation==='FRESH_INIT'?['--username','--display-name','--target-id','--operation-id','--confirm']:['--principal-id','--target-id','--operation-id','--confirm','--reenable'], values={};
  for(let i=1;i<maintenanceArgs.length;i++){
    const flag=maintenanceArgs[i];if(!allowed.includes(flag)||Object.hasOwn(values,flag))bad();
    const value=flag==='--reenable'?'true':maintenanceArgs[++i];if(blank(value)||value.startsWith('--'))bad();values[flag]=value;
  }
  if(allowed.some(k=>k!=='--reenable'&&!Object.hasOwn(values,k))||values['--confirm']!==operation||!uuid(values['--operation-id']))bad();
  if(operation==='FRESH_INIT'){
    const name=values['--username'].toLowerCase();if(!/^[a-z0-9._-]{3,32}$/.test(name)||name.startsWith('seed-')||[...values['--display-name']].length>80)bad();
  }else if(!uuid(values['--principal-id']))bad();
  return {runId:outer['--run-id'],javaBin:outer['--java-bin'],jar:outer['--jar'],maintenanceArgs,operation,operationId:values['--operation-id'],targetId:values['--target-id']};
}
async function ancestors(path) {
  requireSafe(isAbsolute(path)&&resolve(path)===path&&!/[\r\n\0]/.test(path));let current=parse(path).root;
  for(const part of path.slice(current.length).split('/')){current=join(current,part);requireSafe(!(await lstat(current)).isSymbolicLink());}
}
async function file(path,privateFile=false,executable=false) {
  await ancestors(path);const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=await handle.stat();requireSafe(info.isFile()&&info.nlink===1&&info.size<=268435456);
    if(privateFile)requireSafe(info.uid===process.getuid()&&(info.mode&0o7777)===0o600);
    if(executable)requireSafe(Boolean(info.mode&0o111));return await handle.readFile();
  }finally{await handle.close();}
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function privateDirectory(path){await ancestors(path);const info=await lstat(path);requireSafe(info.isDirectory()&&info.uid===process.getuid()&&(info.mode&0o7777)===0o700);}
const fixedError=(name,operationId)=>{process.stderr.write(JSON.stringify({code:name,operationId:operationId??null})+'\n');return codes[name];};
function childEnvironment(options,inspection,guardSha,password) {
  return {...cleanEnv(),CMS_RUNTIME_PRODUCTION_REQUIRED:'true',CMS_SITE_DOMAIN:'cms.test',CMS_API_ORIGIN:'https://api.cms.test:8443',
    CMS_CORS_ORIGINS:'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
    CMS_SURFACE_ORIGINS:'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
    CMS_IDENTITY_SEED_ENABLED:'false',CMS_IDENTITY_COOKIE_SECURE:'true',CMS_MEDIA_ROOT:'/data/media',
    SPRING_DATASOURCE_URL:inspection.jdbcUrl,SPRING_DATASOURCE_USERNAME:'cms_local',SPRING_DATASOURCE_PASSWORD:password,
    CMS_MAINTENANCE_RUN_ID:options.runId,CMS_MAINTENANCE_NODE_BINARY:process.execPath,
    CMS_MAINTENANCE_NODE_SHA256:inspection.target.nodeBinarySha256,CMS_MAINTENANCE_GUARD_SHA256:guardSha};
}
async function launch(options,cwd,env,deps) {
  let child;try{child=(deps.spawn??spawn)(options.javaBin,['-jar',options.jar,'maintenance',...options.maintenanceArgs],{env,cwd,shell:false,stdio:'inherit'});}catch{return {exit:5,spawnFailure:true};}
  const forward=signal=>()=>{try{child.kill(signal);}catch{}}, handlers={SIGINT:forward('SIGINT'),SIGTERM:forward('SIGTERM')};
  try{return await new Promise(done=>{
    let failed=false;
    child.once('error',()=>{failed=true;if(!child.pid)done({exit:5,spawnFailure:true});});
    child.once('exit',(status,signal)=>done({exit:signal?({SIGINT:130,SIGTERM:143}[signal]??5):failed?5:Number.isInteger(status)&&status>=0?status:5,spawnFailure:failed&&!child.pid}));
    for(const [signal,handler] of Object.entries(handlers))process.on(signal,handler);
  });}finally{for(const [signal,handler] of Object.entries(handlers))process.removeListener(signal,handler);}
}
export async function run(options,deps={}) {
  let secret,env,lease;
  try{
    const validated=parseArgs(['--run-id',options.runId,'--java-bin',options.javaBin,'--jar',options.jar,'--',...options.maintenanceArgs]);
    if(Object.keys(options).length!==7||JSON.stringify(validated)!==JSON.stringify(options))fail('INPUT_INVALID');
    const cwd=resolve(deps.cwd??process.cwd()),root=join(cwd,'local/pp1',options.runId);requireSafe(options.targetId===`pp1-local:${options.runId}`);
    const inspection=await(deps.inspect??inspectTarget)(root,deps,{apiState:'running'});
    requireSafe(inspection.target.runId===options.runId&&inspection.target.targetId===options.targetId);
    const tty=deps.tty??{stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,stderr:process.stderr.isTTY};if(!tty.stdin||!tty.stdout||!tty.stderr)fail('SECRET_INPUT_INVALID');
    const libs=join(cwd,'services/cms-api/build/libs');await ancestors(libs);requireSafe((await readdir(libs)).filter(v=>v.endsWith('.jar')).length===1);
    requireSafe(isAbsolute(options.jar)&&await realpath(options.jar)===options.jar&&parse(options.jar).dir===libs&&digest(await file(options.jar))===inspection.target.apiBuild.jarSha256);
    requireSafe(process.versions.node.split('.')[0]==='24'&&digest(await file(process.execPath,false,true))===inspection.target.nodeBinarySha256);
    const guardSha=digest(await file(join(cwd,'scripts/local/maintenance-guard.mjs')));
    requireSafe(isAbsolute(options.javaBin)&&await realpath(options.javaBin)===options.javaBin);await file(options.javaBin,false,true);
    const version=await(deps.command??execute)(options.javaBin,['-XshowSettings:properties','-version'],{env:cleanEnv(),cwd,shell:false,timeout:30000,maxBuffer:65536});
    requireSafe((version.code===undefined||version.code===0)&&/^\s*java.specification.version\s*=\s*25\s*$/m.test((version.stdout??'')+'\n'+(version.stderr??'')));
    await privateDirectory(root);await privateDirectory(join(root,'secrets'));secret=await file(join(root,'secrets/spring.datasource.password'),true);requireSafe(secret.length>0&&secret.length<=65536);
    if(options.operation==='RECOVER_ADMIN')fail('RECOVERY_BACKUP_REQUIRED');
    lease=await(deps.acquire??acquire)(inspection,{operationId:options.operationId,operation:options.operation});
    requireSafe(lease.targetId===inspection.target.targetId&&lease.connection?.jdbcUrl===inspection.jdbcUrl&&lease.connection?.dataGateway===inspection.dataGateway);
    env=childEnvironment(options,inspection,guardSha,secret.toString('utf8'));
    const waiting=launch(options,cwd,env,deps);delete env.SPRING_DATASOURCE_PASSWORD;secret.fill(0);const outcome=await waiting;
    await(deps.finish??finish)(lease,outcome.exit);return outcome.spawnFailure?fixedError('MAINTENANCE_INTERNAL_ERROR',options.operationId):outcome.exit;
  }catch(error){return fixedError(Object.hasOwn(codes,error.message)?error.message:lease?'MAINTENANCE_INTERNAL_ERROR':'QUIESCENCE_NOT_PROVEN',options?.operationId);}
  finally{if(secret)secret.fill(0);if(env)delete env.SPRING_DATASOURCE_PASSWORD;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{process.exitCode=await run(parseArgs(process.argv.slice(2)));}catch(error){process.exitCode=fixedError(Object.hasOwn(codes,error.message)?error.message:'INPUT_INVALID',null);}
}
