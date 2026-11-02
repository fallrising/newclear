import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeHelperProfile } from './maintenance-helper.mjs';
const id=n=>n.toString(16).repeat(64), image=n=>`sha256:${id(n)}`;
async function profileFixture(t,fault=null) {
  const root=await mkdtemp(join(tmpdir(),'pp1-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const q=join(root,'helper');await mkdir(q,{mode:0o700});
  const context={helperRoot:q,runRoot:root,cwd:root,nodeBinary:join(root,'node'),uid:process.getuid(),gid:process.getgid(),
    operationId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',seq:'1',target:{images:{api:image(1),node:image(2),postgres:image(3)},
      containerIds:{postgres:id(4)},volumeNames:{'media-data':'owned_media'}}};
  const calls=[],containers=new Map();let next=5;
  const command=async(file,args,options)=>{
    if(file==='javac'||file.endsWith('/javac')) {
      if(args[0]==='-version')return{stdout:fault==='compiler'?'javac 17.0.1\n':'javac 25.0.5\n'};
      await writeFile(join(args[args.indexOf('-d')+1],'Profile.class'),'synthetic-class');return{stdout:''};
    }
    assert.equal(file,'docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);assert.equal(options.shell,false);
    calls.push(args);const a=args.slice(2),value=key=>a.find(x=>x.startsWith(key+'='))?.slice(key.length+1);
    if(a[0]==='image')return{stdout:JSON.stringify([{Id:a[2],Os:'linux',Config:{Env:[],Labels:{},User:''}}])};
    if(a[0]==='volume')return{stdout:JSON.stringify([{Name:'owned_media',Mountpoint:'/var/lib/docker/volumes/owned_media/_data'}])};
    if(a[0]==='exec')return{stdout:a.at(-1)==='SHOW server_version_num;'?(fault==='server-number'?'170001\n':'160015\n'):fault==='server'?'17.2\n':'16.15\n'};
    if(a[0]==='create') {
      const full=id(next++);const entry=a.indexOf('--entrypoint='+value('--entrypoint'));const mounts=[];
      for(let i=0;i<a.length;i++)if(a[i]==='--mount') {
        const fields=Object.fromEntries(a[++i].split(',').map(x=>x.split('=')));
        mounts.push({Type:fields.type,Name:fields.type==='volume'?fields.src:undefined,Source:fields.type==='volume'?'/var/lib/docker/volumes/owned_media/_data':fields.src,
          Destination:fields.dst,RW:!Object.hasOwn(fields,'readonly')});
      }
      const labels={};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const pair=a[++i],at=pair.indexOf('=');labels[pair.slice(0,at)]=pair.slice(at+1);}
      containers.set(full,{Id:full,Name:`/${a[a.indexOf('--name')+1]}`,Image:a[entry+1],State:{Status:'created',Running:false,ExitCode:0},
        Config:{Labels:labels,Env:[],User:value('--user'),Entrypoint:[value('--entrypoint')],Cmd:a.slice(entry+2),OpenStdin:true,Tty:false},
        HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],
          RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},PidMode:'',IpcMode:'private',Tmpfs:{'/tmp':'rw,nosuid,nodev,size=67108864'}},
        Mounts:mounts,NetworkSettings:{Ports:{},Networks:{none:{IPAddress:''}}}});return{stdout:full+'\n'};
    }
    if(a[0]==='inspect') {
      const c=containers.get(a[1]);return c?{stdout:JSON.stringify([c])}:{code:1,stderr:`${fault==='lowercase-missing'?'error: no such object:':'Error: No such object:'} ${a[1]}\n`};
    }
    if(a[0]==='start') {
      const c=containers.get(a.at(-1));c.State={Status:'exited',Running:false,ExitCode:0};
      if(fault==='policy')c.HostConfig.Privileged=true;
      if(c.Config.Entrypoint[0].endsWith('/java'))return{stdout:JSON.stringify({javaRuntimeVersion:'25.0.5+8',jdbc:true,imageio:true,privateFiles:true,mediaReadable:true})+'\n'};
      if(c.Config.Entrypoint[0].endsWith('/pg_dump'))return{stdout:`pg_dump (PostgreSQL) ${fault==='pg-version'?'17.2':'16.15'}\n`};
      if(c.Config.Entrypoint[0].endsWith('/pg_restore'))return{stdout:'pg_restore (PostgreSQL) 16.15\n'};
      if(c.Config.Entrypoint[0].endsWith('/id'))return{stdout:'0\n'};
      return{stdout:JSON.stringify({node:'v24.18.0',uid:context.uid,gid:context.gid,privateFiles:true,directoryFsync:true})+'\n'};
    }
    if(a[0]==='wait')return{stdout:'0\n'};
    if(a[0]==='rm'){containers.delete(a[1]);return{stdout:a[1]};}
    assert.fail(`unexpected ${a[0]}`);
  };
  return {context,calls,containers,deps:{command,environment:{}}};
}
test('PP1C_H02b2a_same_image_private_profile_returns_observed_versions',async t=>{
  const f=await profileFixture(t),profile=await probeHelperProfile(f.context,f.deps);
  assert.deepEqual(profile,{javaRuntimeVersion:'25.0.5+8',pgDumpVersion:'16.15',pgRestoreVersion:'16.15',postgresServerVersion:'16.15',mediaUser:'0:0'});
  assert.equal(f.containers.size,0);assert.ok(f.calls.filter(x=>x[2]==='create').every(x=>x.includes('--network=none')&&x.includes('--log-driver=none')));
});
for(const fault of ['pg-version','server','server-number','compiler','policy'])test(`PP1C_H02b2a_profile_rejects_${fault}`,async t=>{
  const f=await profileFixture(t,fault);await assert.rejects(probeHelperProfile(f.context,f.deps),/ADAPTER_UNSEALED/);
});

test('PP1C_H02b2d_profile_accepts_actual_Docker_lowercase_exact_missing_ID',async t=>{
  const f=await profileFixture(t,'lowercase-missing');
  assert.equal((await probeHelperProfile(f.context,f.deps)).pgDumpVersion,'16.15');
  assert.equal(f.containers.size,0);
});
