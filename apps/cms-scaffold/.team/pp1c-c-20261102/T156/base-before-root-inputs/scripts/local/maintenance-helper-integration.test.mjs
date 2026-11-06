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
    if(a[0]==='image') {
      const pg=a[2]===context.target.images.postgres;
      const volumes=pg?{'/var/lib/postgresql/data':{}}:{};
      if((pg&&fault==='pg-volume-extra')||(!pg&&fault==='other-volume'))volumes['/unexpected']={};
      return{stdout:JSON.stringify([{Id:a[2],Os:'linux',Config:{Env:[],Labels:{},User:'',Volumes:volumes}}])};
    }
    if(a[0]==='network')return{stdout:JSON.stringify([{Id:'9'.repeat(64),Name:'none',Driver:fault==='none-driver'?'bridge':'null',Scope:'local'}])};
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
          RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},PidMode:'',IpcMode:'private',Tmpfs:Object.fromEntries(a.filter(x=>x.startsWith('--tmpfs=')).map(x=>x.slice(8).split(':')))},
        Mounts:mounts,NetworkSettings:{Ports:{},Networks:{none:{NetworkID:'9'.repeat(64),EndpointID:'',IPAddress:''}}}});return{stdout:full+'\n'};
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

test('T126_profile_only_fixed_PG_version_roles_receive_exact_mask',async t=>{
  const f=await profileFixture(t);await probeHelperProfile(f.context,f.deps);
  const creates=f.calls.filter(a=>a[2]==='create');let count=0;
  for(const args of creates) {
    const masked=args.includes('--tmpfs=/var/lib/postgresql/data:ro,nosuid,nodev,noexec,size=1048576');
    const role=args.find(x=>x.startsWith('org.cms.pp1c.kind='));
    if(args.includes(f.context.target.images.postgres)) {
      count++;assert.equal(masked,true);assert.equal(args.at(-1),'--version');
      assert.ok(['org.cms.pp1c.kind=PG_DUMP_VERSION','org.cms.pp1c.kind=PG_RESTORE_VERSION'].includes(role));
      assert.ok(args.includes(role.endsWith('PG_DUMP_VERSION')?'--entrypoint=/usr/local/bin/pg_dump':'--entrypoint=/usr/local/bin/pg_restore'));
    }else assert.equal(masked,false);
  }
  assert.equal(count,2);assert.equal(f.containers.size,0);
});
for(const fault of ['pg-volume-extra','other-volume'])test(`T126_profile_rejects_${fault}_before_create`,async t=>{
  const f=await profileFixture(t,fault);await assert.rejects(probeHelperProfile(f.context,f.deps),/ADAPTER_UNSEALED/);
  assert.ok(f.calls.filter(a=>a[2]==='create').every(a=>fault==='pg-volume-extra'&&!a.includes(f.context.target.images.postgres)));
});

test('T126_none_profile_rejects_non_builtin_driver_before_create',async t=>{
  const f=await profileFixture(t,'none-driver');await assert.rejects(probeHelperProfile(f.context,f.deps),/ADAPTER_UNSEALED/);
  assert.equal(f.calls.filter(a=>a[2]==='create').length,0);
});
