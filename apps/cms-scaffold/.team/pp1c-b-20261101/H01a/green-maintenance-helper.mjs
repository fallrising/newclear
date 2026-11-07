import { OpsError, canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
import { isIP } from 'node:net';
const requirePolicy = value => { if (!value) throw new OpsError('ADAPTER_UNSEALED'); };
const same = (a,b) => canonicalBytes(a).equals(canonicalBytes(b));
const empty = value => value == null || Object.keys(value).length === 0;
const pathSafe = value => typeof value === 'string' && value.startsWith('/')
  && !/[,\r\n\0]/.test(value) && !value.split('/').some(x => x === '..' || x === '.');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value);
const fullId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sides = { INVENTORY:['source','target'], REVOKE_SESSIONS:['target'], PG_DUMP:['source'],
  PG_RESTORE:['target'], MEDIA_PACK:['source'], MEDIA_RESTORE:['target'] };

// Inputs come from the workflow's private capability plus fresh immutable image inspection.
export function buildHelperPolicy(c) {
  try {
    const {kind,side,target,image,helperRoot:q,runRoot,cwd,nodeBinary} = c;
    requirePolicy(sides[kind]?.includes(side) && [q,runRoot,cwd,nodeBinary].every(pathSafe));
    requirePolicy(Number.isSafeInteger(c.uid) && c.uid >= 0 && Number.isSafeInteger(c.gid) && c.gid >= 0);
    requirePolicy(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.operationId) && /^[1-9][0-9]*$/.test(c.seq));
    const pg = kind.startsWith('PG_'), media = kind.startsWith('MEDIA_');
    const selected = target.images[pg ? 'postgres' : media ? 'node' : 'api'];
    requirePolicy(imageId(selected) && image.Id === selected && image.Os === 'linux');
    requirePolicy(image.Config && Array.isArray(image.Config.Env));
    requirePolicy(!Object.keys(image.Config.Labels ?? {}).some(k => k.startsWith('org.cms.pp1c.')));
    const variables = new Map();
    for (const pair of image.Config.Env) {
      requirePolicy(typeof pair === 'string' && pair.indexOf('=') > 0);
      const name = pair.slice(0,pair.indexOf('=')); requirePolicy(!variables.has(name)); variables.set(name,pair);
    }
    if (pg) for (const pair of ['PGPASSFILE=/run/pp1/pgpass',`PGAPPNAME=${c.operationId}`,'PGCONNECT_TIMEOUT=15']) variables.set(pair.slice(0,pair.indexOf('=')),pair);
    let args, entrypoint, user = `${c.uid}:${c.gid}`;
    const mounts = [], bind = (source,destination,readOnly=true) => mounts.push({type:'bind',source,destination,readOnly});
    const volume = readOnly => mounts.push({type:'volume',source:target.volumeNames['media-data'],destination:'/media',readOnly});
    if (pg) {
      entrypoint = `/usr/local/bin/${kind === 'PG_DUMP' ? 'pg_dump' : 'pg_restore'}`;
      args = ['--host=postgres','--port=5432','--username=cms_local','--dbname=cms','--format=custom',
        ...(kind === 'PG_RESTORE' ? ['--single-transaction','--exit-on-error'] : []),
        '--no-owner','--no-privileges','--no-password',...(kind === 'PG_DUMP' ? ['--lock-wait-timeout=30000'] : [])];
      bind(`${q}/pgpass`,'/run/pp1/pgpass');
    } else if (media) {
      entrypoint='/opt/pp1-node'; args=['/tool/local-media.mjs',kind === 'MEDIA_PACK' ? 'pack' : 'restore'];
      bind(nodeBinary,'/opt/pp1-node'); bind(`${cwd}/scripts/ops/local-media.mjs`,'/tool/local-media.mjs');
      volume(kind === 'MEDIA_PACK');
      if (kind === 'MEDIA_RESTORE') { requirePolicy(/^[0-9]+:[0-9]+$/.test(c.mediaUser)); user=c.mediaUser; }
    } else {
      entrypoint='/opt/java/openjdk/bin/java';
      args=['-jar','/app/app.jar',kind === 'INVENTORY' ? 'ops-inventory' : 'ops-revoke-restored-sessions','--request','/run/pp1/request.json'];
      bind(`${q}/request.json`,'/run/pp1/request.json'); bind(`${runRoot}/secrets/spring.datasource.password`,'/run/secrets/spring.datasource.password');
      if (kind === 'INVENTORY') { volume(true); bind(`${q}/output`,'/run/pp1/output',false); }
    }
    requirePolicy(media || fullId(target.networkIds.data));
    return {version:1,kind,side,imageId:selected,user,entrypoint,args,env:[...variables.values()].sort(),
      mounts:mounts.sort((a,b)=>Buffer.compare(Buffer.from(a.destination),Buffer.from(b.destination))),
      networkId:media?null:target.networkIds.data,readOnlyRootfs:true,capDrop:['ALL'],noNewPrivileges:true,restart:'no',logDriver:'none'};
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
}

export function helperCreateArgs(policy, expected) {
  const args=['create','--pull=never','--name',expected.name];
  for (const [key,value] of Object.entries(expected.labels).filter(([key])=>key.startsWith('org.cms.pp1c.'))) args.push('--label',`${key}=${value}`);
  args.push('--restart=no','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--log-driver=none',
    `--user=${policy.user}`,`--network=${policy.networkId??'none'}`,'--tmpfs=/tmp:rw,nosuid,nodev,size=67108864','--interactive');
  for (const m of policy.mounts) args.push('--mount',`type=${m.type},src=${m.source},dst=${m.destination}${m.readOnly?',readonly':''}`);
  if (policy.kind.startsWith('PG_')) for (const pair of policy.env.filter(x=>/^(PGPASSFILE|PGAPPNAME|PGCONNECT_TIMEOUT)=/.test(x))) args.push('--env',pair);
  args.push(`--entrypoint=${policy.entrypoint}`,policy.imageId,...policy.args); return args;
}

export function assertHelperPolicy(container, policy, expected) {
  try {
    const p=container,h=p.HostConfig,c=p.Config,n=p.NetworkSettings;
    requirePolicy(fullId(expected.fullContainerId) && p.Id === expected.fullContainerId && p.Name === `/${expected.name}` && p.Image === policy.imageId);
    requirePolicy(same(c.Labels,expected.labels) && same([...c.Env].sort(),policy.env) && new Set(c.Env.map(x=>x.split('=')[0])).size===c.Env.length);
    requirePolicy(c.User===policy.user && same(c.Entrypoint,[policy.entrypoint]) && same(c.Cmd,policy.args) && c.OpenStdin===true && c.Tty===false);
    requirePolicy(h.ReadonlyRootfs===true && h.Privileged===false && same(h.CapDrop,['ALL']) && empty(h.CapAdd));
    requirePolicy(same(h.SecurityOpt,['no-new-privileges']) && h.RestartPolicy?.Name==='no' && h.LogConfig?.Type==='none');
    requirePolicy(empty(h.PortBindings) && empty(h.Devices) && empty(h.DeviceRequests) && empty(h.ExtraHosts));
    requirePolicy(h.PidMode==='' && ['', 'private'].includes(h.IpcMode) && !h.AutoRemove);
    requirePolicy(same(h.Tmpfs,{'/tmp':'rw,nosuid,nodev,size=67108864'}));
    requirePolicy(h.NetworkMode===(policy.networkId??'none') && Object.values(n.Ports??{}).every(empty));
    requirePolicy(Array.isArray(p.Mounts) && p.Mounts.length===policy.mounts.length);
    const mounts=new Map(p.Mounts.map(m=>[m.Destination,m])); requirePolicy(mounts.size===p.Mounts.length);
    for (const m of policy.mounts) {
      const actual=mounts.get(m.destination); requirePolicy(actual?.Type===m.type && actual.RW===!m.readOnly);
      if(m.type==='volume') requirePolicy(actual.Name===m.source && actual.Source===expected.volumeMountpoints[m.source]);
      else requirePolicy(actual.Source===m.source);
    }
    const networks=Object.entries(n.Networks??{});
    if(policy.networkId) {
      requirePolicy(networks.length===1 && networks[0][1].NetworkID===policy.networkId);
      if(expected.state==='running') requirePolicy(isIP(networks[0][1].IPAddress)!==0);
    } else requirePolicy(networks.every(([name,v])=>name==='none' && !v.IPAddress && !v.GlobalIPv6Address && !v.EndpointID));
    requirePolicy(['created','running','exited'].includes(expected.state) && p.State.Status===expected.state && p.State.Running===(expected.state==='running'));
    return container;
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
}
