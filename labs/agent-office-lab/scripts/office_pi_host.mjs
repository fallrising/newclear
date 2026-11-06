// Restartable native Pi Office host; no credentials or prompts arrive over IPC.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installManualRecovery} from './manual_recovery.mjs';
import {onePiTask} from './pi_office_policy.mjs';

const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert(config.workspace===path.join(config.out,'workspace')&&config.out.startsWith(lab+'/runs/'));
let office,stopping=false;
async function stop(code=0){
 if(stopping)return;stopping=true;
 if(office){const closed=new Promise(r=>office.server.once('close',r));office.shutdown(false);office.server.closeAllConnections();await closed;}
 process.exit(code);
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
try{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(lab,'vendor/agent-office'),encoding:'utf8'}).trim(),'852e2ab28c4f3f31bffdf4b20353bd119c9d3270');
 for(const key of Object.keys(process.env))if(key.startsWith('AGENT_OFFICE_'))delete process.env[key];
 const {WorkerManager}=await import('../vendor/agent-office/dist/server/server/workers.js');
 installManualRecovery(WorkerManager,config.workspace,'deepseek/deepseek-flash',{provider:'pi'});
 const {loadConfig}=await import('../vendor/agent-office/dist/server/server/config.js');
 const {startServer}=await import('../vendor/agent-office/dist/server/server/server.js');
 const cfg=loadConfig([config.workspace,'--home',path.join(config.out,'office-home'),'--projects',path.join(config.out,'projects'),
  '--host','127.0.0.1','--no-open','--max-workers','1','--weather','clear','--webhook','','--password',config.password,'--agent',path.join(lab,'scripts/bin/pi')]);
 cfg.port=config.port;office=await startServer(cfg);
 const gates=office.floors().map(f=>{
  const gate=onePiTask(f,{allowReconnect:true,allowRestoredReconnect:true});
  const native=f.workers.handleProviderHook.bind(f.workers);
  f.workers.handleProviderHook=(route,id,token,event,payload)=>{
   const accepted=native(route,id,token,event,payload);
   if(route==='pi'&&accepted)process.send?.({t:'hook',workerId:id,payload});
   return accepted;
  };return gate;
 });
 process.on('message',msg=>{
  if(msg.t==='inspect')process.send?.({t:'inspect',request:msg.request,workers:office.floors().flatMap(f=>f.workers.list()),owners:office.floors().flatMap(f=>f.workers.owners())});
  if(msg.t==='arm')process.send?.({t:'arm',request:msg.request,armed:gates.length===1&&gates[0].armReconnect(msg.workerId,msg.sessionId)});
  if(msg.t==='stop')void stop();
 });
 process.send?.({t:'ready',pid:process.pid,port:office.server.address().port});
}catch(error){process.send?.({t:'error',error:String(error)});await stop(1);}
