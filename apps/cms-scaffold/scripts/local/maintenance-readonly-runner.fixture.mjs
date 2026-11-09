// Test-only real observation/proof composition with typed Docker metadata and real IO streams.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releasedSourceFixture } from '../ops/local-recovery-released.fixture.mjs';
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
import * as observation from './maintenance-observation.mjs';
export async function readonlyRunnerFixture(t,options={}) {
  const f=await releasedSourceFixture(t),deps=f.readonlyDeps,state=f.realSource.state,original=deps.command;
  if(options.signal)deps.signal=options.signal;
  const events={created:[],started:[],removed:[],permits:[],endedBeforeFrames:0},none='9'.repeat(64);let counter=10;
  await mkdir(join(f.cwd,'scripts/ops'),{recursive:true});
  await writeFile(join(f.cwd,'scripts/ops/local-media.mjs'),await readFile(new URL('../ops/local-media.mjs',import.meta.url)),{mode:0o600});
  await mkdir(join(f.root,'secrets'),{mode:0o700});
  await writeFile(join(f.root,'secrets/spring.datasource.password'),'synthetic',{mode:0o600});
  const helperList=()=>state.containers.filter(c=>c.Config.Labels['org.cms.pp1c.operation']);
  const setState=(c,status)=>{
    c.State={Status:status,Running:status==='running',ExitCode:0};
    if(c.HostConfig.NetworkMode==='none')c.NetworkSettings.Networks={none:{NetworkID:status==='created'?'':none,IPAddress:'',EndpointID:''}};
    else {
      const network=state.networks.find(n=>n.Id===c.HostConfig.NetworkMode),running=status==='running';
      c.NetworkSettings.Networks={[network.Name]:{NetworkID:running?network.Id:'',IPAddress:running?'172.31.0.9':'',EndpointID:''}};
      if(running)network.Containers[c.Id]={IPv4Address:'172.31.0.9/16'};else delete network.Containers[c.Id];
    }
  };
  deps.command=async(file,args,commandOptions)=>{
    if(file==='javac'||file.endsWith('/javac')) {
      if(args[0]==='-version')return{stdout:'javac 25.0.5\n'};
      await writeFile(join(args[args.indexOf('-d')+1],'Profile.class'),'synthetic-class');return{stdout:''};
    }
    const a=args.slice(2),find=key=>a.find(v=>v.startsWith(key+'='))?.slice(key.length+1);
    if(a[0]==='image') {
      const result=await original(file,args,commandOptions),images=JSON.parse(result.stdout);
      for(const image of images)Object.assign(image.Config,{Env:[],User:'',Volumes:image.Id===f.realSource.receipt.images.postgres?{'/var/lib/postgresql/data':{}}:null});
      return{stdout:JSON.stringify(images)};
    }
    if(a[0]==='network'&&a[2]==='none')return{stdout:JSON.stringify([{Id:none,Name:'none',Driver:'null',Scope:'local'}])};
    if(a[0]==='volume')return{stdout:JSON.stringify(state.volumes.filter(v=>a.slice(2).includes(v.Name)))};
    if(a[0]==='create') {
      const entry=a.indexOf('--entrypoint='+find('--entrypoint')),imageId=a[entry+1],labels=imageId===f.lease.source.images.api?{...state.apiLabels}:{};
      const env=[],mounts=[],tmpfs={};
      for(let i=0;i<a.length;i++) {
        if(a[i]==='--label'){const value=a[++i],n=value.indexOf('=');labels[value.slice(0,n)]=value.slice(n+1);}
        else if(a[i]==='--env')env.push(a[++i]);
        else if(a[i]==='--mount') {
          const fields=Object.fromEntries(a[++i].split(',').map(v=>v.split('=')));
          mounts.push({Type:fields.type,Source:fields.type==='volume'?state.volumes.find(v=>v.Name===fields.src).Mountpoint:fields.src,
            ...(fields.type==='volume'?{Name:fields.src}:{}),Destination:fields.dst,RW:!Object.hasOwn(fields,'readonly')});
        }else if(a[i].startsWith('--tmpfs=')){const value=a[i].slice(8),n=value.indexOf(':');tmpfs[value.slice(0,n)]=value.slice(n+1);}
      }
      const c={Id:(counter++).toString(16).padStart(64,'0'),Name:'/'+a[a.indexOf('--name')+1],Image:imageId,
        Config:{Labels:labels,Env:env.sort(),User:find('--user'),Entrypoint:[find('--entrypoint')],Cmd:a.slice(entry+2),OpenStdin:true,Tty:false},
        HostConfig:{NetworkMode:find('--network'),ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:null,
          SecurityOpt:['no-new-privileges'],RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},
          Devices:[],DeviceRequests:null,PidMode:'',IpcMode:'private',ExtraHosts:null,Tmpfs:tmpfs},
        NetworkSettings:{Ports:{},Networks:{}},Mounts:mounts};
      setState(c,'created');state.containers.push(c);events.created.push(c.Id);events.maxActive=Math.max(events.maxActive??0,helperList().length);return{stdout:c.Id+'\n'};
    }
    if(a[0]==='inspect'&&a.length===2) {
      const c=state.containers.find(c=>c.Id===a[1]);if(c)return{stdout:JSON.stringify([c])};
      throw Object.assign(new Error('synthetic missing'),{code:1,stderr:`Error: No such object: ${a[1]}\n`});
    }
    if(a[0]==='start'&&a.includes('--attach')) {
      const c=helperList().find(c=>c.Id===a.at(-1));events.started.push(c.Id);setState(c,'exited');
      const entry=c.Config.Entrypoint[0];
      if(entry.endsWith('/java'))return{stdout:JSON.stringify({javaRuntimeVersion:'25.0.5+8',jdbc:true,imageio:true,privateFiles:true,mediaReadable:true})+'\n'};
      if(entry.endsWith('/pg_dump'))return{stdout:'pg_dump (PostgreSQL) 16.15\n'};
      if(entry.endsWith('/pg_restore'))return{stdout:'pg_restore (PostgreSQL) 16.15\n'};
      if(entry.endsWith('/id'))return{stdout:'0\n'};
      return{stdout:JSON.stringify({node:'v24.18.0',uid:process.getuid(),gid:process.getgid(),privateFiles:true,directoryFsync:true})+'\n'};
    }
    if(a[0]==='exec'&&a.at(-1)==='SHOW server_version;')return{stdout:'16.15\n'};
    if(a[0]==='exec'&&a.at(-1)==='SHOW server_version_num;')return{stdout:'160015\n'};
    if(a[0]==='exec'&&a.at(-1).includes('pg_stat_activity')&&state.endedBackend&&options.reappearAfterZero) {
      if(++state.endedReads===3)state.backends=[structuredClone(state.endedBackend)];
    }
    if(a[0]==='rm') {const i=state.containers.findIndex(c=>c.Id===a[1]);assert.ok(i>=0);state.containers.splice(i,1);events.removed.push(a[1]);return{stdout:a[1]};}
    if(a[0]==='stop'||a[0]==='kill'){setState(helperList().find(c=>c.Id===a.at(-1)),'exited');state.backends=[];return{stdout:''};}
    if(a[0]==='wait')return{stdout:'0\n'};
    if(a[0]==='top'){const c=helperList().find(c=>c.Id===a[1]);return{stdout:`PID COMMAND\n17 ${[...c.Config.Entrypoint,...c.Config.Cmd].join(' ')}\n`};}
    return original(file,args,commandOptions);
  };
  deps.spawn=(_file,args)=>{
    const c=helperList().find(c=>c.Id===args.at(-1));events.started.push(c.Id);setState(c,'running');
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    const request=JSON.parse(readFileSync(c.Mounts.find(m=>m.Destination==='/run/pp1/request.json').Source));
    const backend={pid:91,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:'172.31.0.9',applicationName:request.operationId};
    state.backends=[{pid:backend.pid,backend_start_epoch:backend.backendStartEpoch,datname:'cms',usename:'cms_local',client_addr:backend.clientAddr,application_name:request.operationId,state:'idle in transaction'}];
    child.stdout.write(canonicalBytes({version:1,operationId:request.operationId,side:'source',mode:'INVENTORY',requestSha256:sha256(canonicalBytes(request)),backend,readOnly:true}));
    options.afterReady?.({state,c,child,f,events,backend});
    child.stdin.on('data',bytes=>events.permits.push(JSON.parse(bytes)));
    child.stdin.on('finish',async()=>{
      const inventory=structuredClone(f.captured.inventory),output=join(c.Mounts.find(m=>m.Destination==='/run/pp1/output').Source,'inventory.json');
      options.mutateInventory?.(inventory);
      await writeFile(output,canonicalBytes(inventory),{mode:0o600});state.backends=[];setState(c,'exited');child.emit('close',0,null);
      state.endedBackend={pid:backend.pid,backend_start_epoch:backend.backendStartEpoch,datname:'cms',usename:'cms_local',client_addr:backend.clientAddr,application_name:request.operationId,state:'idle'};state.endedReads=0;
      options.afterBackendEnded?.({state,c,child,f,events});
      setTimeout(()=>{
        if(!state.backends.length&&!c.State.Running)events.endedBeforeFrames++;
        const result={version:1,operationId:request.operationId,mode:'INVENTORY',inventorySha256:sha256(canonicalBytes(inventory)),dbSnapshotSha256:inventory.dbSnapshotSha256,
          assetCount:String(inventory.assets.length),referencedFileCount:String(inventory.files.filter(x=>x.classification==='referenced').length),
          orphanFileCount:String(inventory.files.filter(x=>x.classification==='orphan').length),fileCount:String(inventory.files.length),
          fileBytes:String(inventory.files.reduce((sum,x)=>sum+BigInt(x.byteSize),0n))};
        child.stdout.end(canonicalBytes(result));child.stderr.end();
      },options.delay??150);
    });return child;
  };
  const token=await observation.beginReadonlyObservation(f.readonlyIds,deps);t.after(()=>observation.closeObservation(token));
  return{...f,deps,token,state,events,observation};
}
