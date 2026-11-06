import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { prepareRestore, createPreparedNetworks } from './prepare.mjs';
import { restoreTargetContext, assertWorkflow, sealRestoreTarget, failWorkflow } from './maintenance-workflow.mjs';
import { inspectTarget } from './maintenance-target.mjs';
import { read, syncDirectory } from './maintenance-store.mjs';
import { OpsError, canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
const execute=promisify(execFile),ensure=value=>{if(!value)throw new OpsError('TARGET_NOT_BLANK');};
const composeSha256='5350e6b5f929f7b21fa97e859197aa721a0303c52a260870bf11bf4738cd2d7e';
const blankSql="SELECT count(*)::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR c.relname='flyway_schema_history';";
async function evidence(root,name,value) {
  const file=await open(join(root,name),'wx',0o600);try{await file.writeFile(canonicalBytes(value));await file.sync();}finally{await file.close();}await syncDirectory(root);
}
export async function createRestoreTarget(token,deps={}) {
  const context=await restoreTargetContext(token,deps),{root,target,source}=context,cwd=deps.cwd??process.cwd();
  try {
    const compose=join(cwd,'compose.pp1-local.yaml');ensure(sha256(await readFile(compose))===composeSha256);
    const env={...(deps.environment??process.env)};
    ensure(!env.DOCKER_HOST||env.DOCKER_HOST==='unix:///var/run/docker.sock');ensure(!env.DOCKER_CONTEXT||env.DOCKER_CONTEXT==='default');ensure(!env.DOCKER_TLS_VERIFY);
    for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
    const options={env,shell:false,timeout:30000,maxBuffer:16*1024*1024};
    const command=async(file,args)=>{const r=await(deps.command??execute)(file,args,options);ensure(r.code===undefined||r.code===0);return r.stdout;};
    const docker=args=>command('docker',['--host','unix:///var/run/docker.sock',...args]);
    const list=async args=>{const result=JSON.parse(await docker(args));ensure(Array.isArray(result));return result;};
    const composeBinary=env.CMS_DOCKER_COMPOSE;ensure(!composeBinary||isAbsolute(composeBinary)&&!/[\r\n\0]/.test(composeBinary));
    const assertCreatedNetworks=async()=>{
      const expected=Object.values(createdNetworks),rows=await list(['network','inspect',...expected.map(n=>n.name)]);
      ensure(rows.length===2&&new Set(rows.map(n=>n.Id)).size===2);
      for(const role of ['web','data']){const e=createdNetworks[role],n=rows.find(n=>n.Id===e.id);
        ensure(n&&n.Name===e.name&&n.Driver==='bridge'&&n.Internal===true&&n.Scope==='local'&&n.EnableIPv6===false&&n.Attachable===false&&n.Ingress===false);
        ensure(n.Labels?.['com.docker.compose.project']===target.project&&n.Labels['com.docker.compose.network']===role&&n.Options&&Object.keys(n.Options).length===0);
        ensure(n.IPAM?.Driver==='default'&&(!n.IPAM.Options||Object.keys(n.IPAM.Options).length===0)&&n.IPAM.Config?.length===1);
        const ipam=n.IPAM.Config[0];ensure(ipam.Subnet===e.subnet&&ipam.Gateway===e.gateway&&!ipam.IPRange&&(!ipam.AuxiliaryAddresses||Object.keys(ipam.AuxiliaryAddresses).length===0));
      }
    };
    const createdServices=new Map();let postgresStarted=false;
    const assertCreatedServices=async()=>{
      if(!createdServices.size)return;
      const rows=await list(['inspect',...createdServices.values()]);ensure(rows.length===createdServices.size);
      for(const [service,id] of createdServices){const c=rows.find(c=>c.Id===id);
        ensure(c&&c.Name===`/${target.project}-${service}-1`&&c.Image===source.images[{postgres:'postgres','cms-api':'api',ingress:'node'}[service]]);
        ensure(c.Config?.Labels?.['com.docker.compose.project']===target.project&&c.Config.Labels['com.docker.compose.service']===service);
        ensure(c.State?.Running===(service==='postgres'&&postgresStarted)&&c.State.Status===(service==='postgres'&&postgresStarted?'running':'created'));
      }
    };
    const create=async service=>{
      await assertCreatedServices();
      await assertCreatedNetworks();
      await assertWorkflow(token,{},deps);
      const args=['--env-file',join(root,'compose.env'),'--file',compose,'--project-name',target.project,'create','--no-recreate','--pull','never','--no-build',service];
      if(composeBinary)await command(composeBinary,args);else await docker(['compose',...args]);
      await assertCreatedServices();
      const rows=await list(['inspect',`${target.project}-${service}-1`]);ensure(rows.length===1);const c=rows[0];
      ensure(/^[a-f0-9]{64}$/.test(c.Id)&&!Object.values(source.containerIds).includes(c.Id)&&![...createdServices.values()].includes(c.Id));
      createdServices.set(service,c.Id);await assertCreatedServices();
      await assertCreatedNetworks();
      await assertWorkflow(token,{},deps);
    };
    const preparedReceipt=await prepareRestore(token,deps);
    for(const type of ['ps','network','volume']) {
      const args=type==='ps'?['ps','-a','--filter',`label=com.docker.compose.project=${target.project}`,'--format','{{.ID}}']:
        [type,'ls','--filter',`label=com.docker.compose.project=${target.project}`,'--format',type==='network'?'{{.ID}}':'{{.Name}}'];
      ensure((await docker(args)).trim()==='');
    }
    const createdNetworks=await createPreparedNetworks(preparedReceipt,deps);
    await create('postgres');
    const rows=await list(['inspect',`${target.project}-postgres-1`]);ensure(rows.length===1);
    const pg=rows[0],dataName=`${target.project}_data`,volumeName=`${target.project}_db-data`;
    ensure(/^[a-f0-9]{64}$/.test(pg.Id)&&!Object.values(source.containerIds).includes(pg.Id)&&pg.Name===`/${target.project}-postgres-1`&&pg.Image===source.images.postgres);
    ensure(pg.State?.Status==='created'&&pg.State.Running===false&&pg.Config?.Labels?.['com.docker.compose.project']===target.project&&pg.Config.Labels['com.docker.compose.service']==='postgres');
    const sourcePg=await list(['inspect',source.containerIds.postgres]);ensure(sourcePg.length===1&&sourcePg[0].Id===source.containerIds.postgres);
    for(const field of ['Entrypoint','Cmd'])ensure(canonicalBytes(pg.Config[field]??null).equals(canonicalBytes(sourcePg[0].Config[field]??null)));
    const h=pg.HostConfig;ensure(h?.RestartPolicy?.Name==='no'&&h.Privileged===false&&h.NetworkMode===dataName&&Object.keys(h.PortBindings??{unexpected:true}).length===0);
    ensure(Object.values(pg.NetworkSettings?.Ports??{unexpected:1}).every(v=>v===null||Array.isArray(v)&&v.length===0));
    ensure(Object.keys(pg.NetworkSettings?.Networks??{}).length===1&&pg.NetworkSettings.Networks[dataName]);
    const endpoint=pg.NetworkSettings.Networks[dataName];
    for(const key of ['IPAddress','EndpointID','Gateway','MacAddress','IPv6Gateway','GlobalIPv6Address'])ensure((endpoint[key]??'')==='');
    ensure((endpoint.IPPrefixLen??0)===0&&(endpoint.GlobalIPv6PrefixLen??0)===0);
    const expectedEnv={POSTGRES_DB:'cms',POSTGRES_USER:'cms_local',POSTGRES_PASSWORD_FILE:'/run/secrets/spring.datasource.password'};
    ensure(Array.isArray(pg.Config.Env));const vars=new Map(pg.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
    ensure(vars.size===pg.Config.Env.length&&Object.entries(expectedEnv).every(([k,v])=>vars.get(k)===v)&&[...vars.keys()].filter(k=>/^(CMS_|SPRING_|POSTGRES_)/.test(k)).every(k=>Object.hasOwn(expectedEnv,k)));
    const nets=await list(['network','inspect',dataName]),volumes=await list(['volume','inspect',volumeName]);ensure(nets.length===1&&volumes.length===1);
    const network=nets[0],volume=volumes[0];
    ensure(/^[a-f0-9]{64}$/.test(network.Id)&&!Object.values(source.networkIds).includes(network.Id)&&network.Name===dataName&&network.Internal===true&&network.Driver==='bridge');
    ensure(network.Labels?.['com.docker.compose.project']===target.project&&network.Labels['com.docker.compose.network']==='data'&&Object.keys(network.Containers??{unexpected:true}).length===0);
    ensure(endpoint.NetworkID===''||endpoint.NetworkID===network.Id);
    ensure(volume.Name===volumeName&&!Object.values(source.volumeNames).includes(volume.Name)&&volume.Driver==='local'&&Object.keys(volume.Options??{}).length===0);
    ensure(volume.Labels?.['com.docker.compose.project']===target.project&&volume.Labels['com.docker.compose.volume']==='db-data'&&isAbsolute(volume.Mountpoint));
    ensure(Array.isArray(pg.Mounts)&&pg.Mounts.length===2);
    const data=pg.Mounts.find(m=>m.Destination==='/var/lib/postgresql/data'),secret=pg.Mounts.find(m=>m.Destination==='/run/secrets/spring.datasource.password');
    ensure(data?.Type==='volume'&&data.Name===volumeName&&data.Source===volume.Mountpoint&&data.RW===true&&secret?.Type==='bind'&&secret.Source===join(root,'secrets/spring.datasource.password')&&secret.RW===false);
    const sourceVolumes=await list(['volume','inspect',...Object.values(source.volumeNames)]);ensure(sourceVolumes.every(v=>v.Mountpoint!==volume.Mountpoint));
    await evidence(root,'created-postgres.json',{containerId:pg.Id,networkId:network.Id,volumeName});
    await assertWorkflow(token,{},deps);await docker(['start',pg.Id]);postgresStarted=true;
    const clock=deps.clock??Date.now,deadline=clock()+120000;
    while(true) {
      const current=await list(['inspect',pg.Id]);ensure(current.length===1&&current[0].Id===pg.Id&&current[0].Image===pg.Image&&current[0].State?.Running===true);
      if(current[0].State.Health?.Status==='healthy')break;
      ensure(clock()<deadline);await(deps.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(250);
    }
    await assertWorkflow(token,{},deps);
    ensure((await docker(['exec',pg.Id,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',blankSql])).trim()==='0');
    await create('cms-api');await create('ingress');
    const inspection=await inspectTarget(root,deps,{apiState:'stopped',workflow:token});
    const resources={containerIds:inspection.target.containerIds,networkIds:inspection.target.networkIds,volumeNames:inspection.target.volumeNames};
    ensure([...createdServices].every(([service,id])=>resources.containerIds[service]===id));
    ensure(resources.containerIds.postgres===pg.Id&&resources.networkIds.data===network.Id&&['web','data'].every(role=>resources.networkIds[role]===createdNetworks[role].id)&&resources.volumeNames['db-data']===volumeName);
    await evidence(root,'created-resources.json',resources);
    const preparation={receipt:await read(join(root,'receipt.json')),artifacts:await read(join(root,'artifacts.json'))};
    return await sealRestoreTarget(token,inspection,{preparationSha256:sha256(canonicalBytes(preparation)),createdResourceSetSha256:sha256(canonicalBytes(resources))},deps);
  }catch(error){await failWorkflow(token,error instanceof OpsError?error.code:'TARGET_NOT_BLANK',deps);throw error;}
}
