import {probeHelperProfile} from '../../scripts/local/maintenance-helper.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {resolve,join} from 'node:path';
const run=promisify(execFile),p=process.cwd(),e=join(p,'.team/pp1c-b-20261102'),root=join(p,'local/pp1c-real-profile-approved'),q=join(root,'helper');await mkdir(root,{mode:0o700});await mkdir(q,{mode:0o700});
const cmd=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{timeout:60000})).stdout;
const pg=JSON.parse(await readFile(join(e,'C08b/real-pg16-summary.json'))),image=(await readFile(join(e,'runtime-image-id'),'utf8')).trim(),volume='cms-pp1c-profile-'+randomUUID();
await cmd(['volume','create','--label','org.cms.pp1c.probe=synthetic',volume]);
const c={cwd:p,runRoot:root,helperRoot:q,nodeBinary:'/home/ckc/.local/node-v24.18.0/bin/node',uid:process.getuid(),gid:process.getgid(),operationId:randomUUID(),seq:'1',target:{images:{api:image,node:'sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc',postgres:pg.image_id},containerIds:{postgres:pg.container_id},volumeNames:{'media-data':volume}}};
const evidence={scope:'real same-image synthetic private-file/JDBC-load/ImageIO/Node/PG profile; no application backup/restore claim',context:c};
try {await cmd(['start',pg.container_id]);let ready=false;for(let i=0;i<60;i++){try{await cmd(['exec',pg.container_id,'pg_isready','-U','cms_local','-d','cms']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!ready)throw Error('PG readiness');
 evidence.profile=await probeHelperProfile(c,{command:async(file,args,options)=>{try{return await run(file,args,options);}catch(error){evidence.lastNonzeroCommand={file,args,code:error.code,stderr:String(error.stderr).slice(0,4000)};throw error;}}});evidence.success=true;
}catch(error){evidence.success=false;evidence.code=error.code??error.message;process.exitCode=1;}
finally{await cmd(['stop','--time','30',pg.container_id]);evidence.pgStopped=!(JSON.parse(await cmd(['inspect',pg.container_id]))[0].State.Running);await writeFile(join(e,'approved-pg/real-profile.json'),JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify({success:evidence.success,profile:evidence.profile,code:evidence.code}));
