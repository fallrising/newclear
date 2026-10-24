import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, open, mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIPv4 } from 'node:net';
import { inspectTarget, mediaProbeCommand } from './maintenance-target.mjs';
const execute = promisify(execFile), code = name => { throw new Error(name); };
const requireSafe = value => { if (!value) code('QUIESCENCE_NOT_PROVEN'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = v => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const exact = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const phases = ['RESERVED', 'PRE_CONNECTION', 'BOUND', 'COMMITTED', 'COMPLETE', 'FAILED_OR_UNKNOWN'];
const targetKeys = ['version','runId','targetId','project','sourceCommit','apiBuild','images','containerIds','networkIds','volumeNames','databaseOid','ingressScriptSha256','nodeBinarySha256','mediaProbeSha256'];
const leaseKeys = [...targetKeys, 'connection','operationId','operation','releaseId','phase','boundBackend','createdAt'];
const journalKeys = ['operationId','operation','targetId','releaseId','phase','at','failureCode'];
const backendKeys = ['pid','backendStartEpoch','db','role','clientAddr','applicationName'];
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const image = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
function validateTarget(target) {
  requireSafe(exact(target,targetKeys) && target.version === 1 && hex(target.runId,32) && hex(target.sourceCommit,40));
  requireSafe(target.project === `cms-pp1-local-${target.runId}` && target.targetId === `pp1-local:${target.runId}`);
  requireSafe(exact(target.apiBuild,['sourceCommit','jarSha256','baseImage']) && target.apiBuild.sourceCommit === target.sourceCommit && hex(target.apiBuild.jarSha256,64) && image(target.apiBuild.baseImage));
  for (const [field, names] of [['images',['api','node','postgres']],['containerIds',['postgres','cms-api','ingress']],['networkIds',['web','data']]]) requireSafe(exact(target[field],names) && Object.values(target[field]).every(v => field === 'images' ? image(v) : hex(v,64)));
  requireSafe(exact(target.volumeNames,['db-data','media-data']) && Object.entries(target.volumeNames).every(([name,value]) => value === `${target.project}_${name}`));
  requireSafe(Number.isInteger(target.databaseOid) && target.databaseOid > 0 && target.databaseOid <= 4294967295);
  requireSafe(['ingressScriptSha256','nodeBinarySha256','mediaProbeSha256'].every(k => hex(target[k],64)));
}
function privateIp(ip) {
  if (!isIPv4(ip)) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function validBackend(b, lease) {
  return exact(b, backendKeys) && Number.isInteger(b.pid) && b.pid > 0 && b.pid <= 2147483647 &&
    typeof b.backendStartEpoch === 'string' && /^[1-9][0-9]*\.[0-9]+$/.test(b.backendStartEpoch) &&
    b.db === 'cms' && b.role === 'cms_local' && privateIp(b.clientAddr) && b.clientAddr === lease.connection.dataGateway && b.applicationName === lease.operationId;
}
function validateLease(lease) {
  requireSafe(exact(lease, leaseKeys) && lease.version === 1 && /^[a-f0-9]{32}$/.test(lease.runId));
  validateTarget(Object.fromEntries(targetKeys.map(k => [k,lease[k]])));
  requireSafe(uuid(lease.operationId) && ['FRESH_INIT','RECOVER_ADMIN'].includes(lease.operation) && phases.includes(lease.phase));
  requireSafe(lease.releaseId === `sha256:${lease.apiBuild?.jarSha256}` && /^sha256:[a-f0-9]{64}$/.test(lease.releaseId));
  requireSafe(exact(lease.connection, ['jdbcUrl','dataGateway']) && privateIp(lease.connection.dataGateway));
  const ip = /^jdbc:postgresql:\/\/([^/]+):5432\/cms$/.exec(lease.connection.jdbcUrl)?.[1]; requireSafe(privateIp(ip));
  requireSafe(typeof lease.createdAt === 'string' && new Date(lease.createdAt).toISOString() === lease.createdAt);
  requireSafe(['RESERVED','PRE_CONNECTION'].includes(lease.phase) ? lease.boundBackend === null : lease.phase === 'FAILED_OR_UNKNOWN' && lease.boundBackend === null || validBackend(lease.boundBackend, lease));
  return lease;
}
function rootFor(runId, deps) {
  requireSafe(typeof runId === 'string' && /^[a-f0-9]{32}$/.test(runId));
  return join(resolve(deps.cwd ?? process.cwd()), 'local/pp1', runId);
}
async function pathSafe(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/')) { current = join(current, part); requireSafe(!(await lstat(current)).isSymbolicLink()); }
}
async function directory(path) {
  await pathSafe(path); const info = await lstat(path);
  requireSafe(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o7777) === 0o700); return info;
}
async function read(path) {
  await directory(parse(path).dir); await pathSafe(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat(); requireSafe(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o7777) === 0o600 && info.size <= 1048576);
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function writeNew(path, value) {
  await directory(parse(path).dir); const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(parse(path).dir);
}
async function syncDirectory(path) {
  const handle = await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function update(path, value) {
  await read(path); const temp = `${path}.tmp-${randomBytes(16).toString('hex')}`;
  await writeNew(temp, value); await rename(temp, path); await syncDirectory(parse(path).dir);
}
function runtime(deps, signal, deadline) {
  const env = { ...(deps.environment ?? process.env) };
  requireSafe(!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock');
  requireSafe(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'); requireSafe(!env.DOCKER_TLS_VERIFY);
  for (const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[k];
  return async args => {
    const timeout = deadline === undefined ? 30000 : Math.min(30000,deadline-(deps.clock ?? Date.now)()); requireSafe(timeout>0);
    const result = await (deps.command ?? execute)('docker', ['--host','unix:///var/run/docker.sock', ...args], { env, signal, shell: false, timeout, maxBuffer: 16 * 1024 * 1024 });
    requireSafe(result.code === undefined || result.code === 0); requireSafe(deadline === undefined || (deps.clock ?? Date.now)()<deadline); return result.stdout;
  };
}
const activitySql = "SELECT COALESCE(json_agg(a), '[]'::json)::text FROM (SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch, usename, datname, application_name, host(client_addr) AS client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()) a;";
const psql = (docker, lease, sql) => docker(['exec',lease.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',sql]);
async function storedLease(input, deps) {
  validateLease(input); const root = rootFor(input.runId, deps), base = join(root, 'maintenance');
  await directory(root); await directory(base);
  const lease = validateLease(await read(join(base, 'lease.json')));
  try { await directory(join(base,'operation.lock')); } catch (e) { if (e.code !== 'ENOENT' || lease.phase !== 'COMPLETE') throw e; }
  requireSafe(input.operationId === lease.operationId && input.targetId === lease.targetId && input.releaseId === lease.releaseId && same(input.connection, lease.connection));
  const target = await read(join(base, 'target.json')); requireSafe(exact(target, targetKeys) && targetKeys.every(k => same(target[k], lease[k])));
  const journal = await read(join(base, 'operations', `${lease.operationId}.json`));
  requireSafe(exact(journal, journalKeys) && journal.operationId === lease.operationId && journal.operation === lease.operation && journal.targetId === lease.targetId && journal.releaseId === lease.releaseId && journal.phase === lease.phase);
  requireSafe(phases.includes(journal.phase) && typeof journal.at === 'string' && new Date(journal.at).toISOString() === journal.at && [null,'QUIESCENCE_NOT_PROVEN','COMMITTED_HOST_RESTORE_FAILED'].includes(journal.failureCode));
  return { root, base, lease };
}
async function live(lease, deps, binding = false) {
  const inspection = await inspectTarget(rootFor(lease.runId, deps), deps, { apiState: 'stopped' });
  requireSafe(targetKeys.every(k => same(inspection.target[k], lease[k])) && same(lease.connection, { jdbcUrl: inspection.jdbcUrl, dataGateway: inspection.dataGateway }));
  const rows = JSON.parse(await psql(runtime(deps), lease, activitySql)); requireSafe(Array.isArray(rows));
  if (lease.phase === 'PRE_CONNECTION' && !binding) requireSafe(rows.length === 0);
  else {
    requireSafe(rows.length === 1 && exact(rows[0], ['pid','backend_start_epoch','usename','datname','application_name','client_addr','state']));
    const row = rows[0]; requireSafe(['active','idle','idle in transaction'].includes(row.state));
    const backend = { pid: row.pid, backendStartEpoch: row.backend_start_epoch, db: row.datname, role: row.usename, clientAddr: row.client_addr, applicationName: row.application_name };
    requireSafe(validBackend(backend, lease) && same(backend, lease.boundBackend));
  }
  return inspection;
}
async function phase(record, name, failure, deps) {
  const { base, lease } = record; lease.phase = name;
  const journal = { operationId: lease.operationId, operation: lease.operation, targetId: lease.targetId, releaseId: lease.releaseId, phase: name, at: new Date().toISOString(), failureCode: failure };
  await update(join(base, 'lease.json'), lease); await update(join(base, 'operations', `${lease.operationId}.json`), journal);
  return lease;
}
export async function acquire(inspection, operation, deps = {}) {
  try {
    requireSafe(exact(inspection,['target','jdbcUrl','dataGateway']) && exact(operation,['operationId','operation']) && uuid(operation.operationId));
    validateTarget(inspection.target); requireSafe(['FRESH_INIT','RECOVER_ADMIN'].includes(operation.operation));
    if (operation.operation === 'RECOVER_ADMIN') code('RECOVERY_BACKUP_REQUIRED');
    const root = rootFor(inspection.target.runId,deps), base = join(root,'maintenance');
    await directory(root);
    try { await directory(base); await directory(join(base,'operation.lock')); code('MAINTENANCE_BUSY'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const fresh = await inspectTarget(root,deps,{apiState:'running'}); requireSafe(same(fresh,inspection));
    try { await mkdir(base,{mode:0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; } await directory(base);
    const targetPath = join(base,'target.json'), operations = join(base,'operations'); let existingTarget;
    try { existingTarget = await read(targetPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existingTarget) { requireSafe(same(existingTarget,inspection.target)); await directory(operations); }
    else { try { await mkdir(operations,{mode:0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; } await directory(operations); }
    const lock = join(base,'operation.lock');
    try { await mkdir(lock,{mode:0o700}); } catch (e) { if (e.code === 'EEXIST') code('MAINTENANCE_BUSY'); throw e; }
    await syncDirectory(base);
    const identity = await directory(lock), at = new Date().toISOString(), releaseId = `sha256:${inspection.target.apiBuild.jarSha256}`;
    const journal = {...operation,targetId:inspection.target.targetId,releaseId,phase:'RESERVED',at,failureCode:null};
    try { await writeNew(join(operations,`${operation.operationId}.json`),journal); }
    catch (e) {
      if (e.code === 'EEXIST') {
        const current = await directory(lock); requireSafe(current.ino === identity.ino && current.dev === identity.dev && (await readdir(lock)).length === 0);
        await rmdir(lock); code('DUPLICATE_OPERATION');
      }
      throw e;
    }
    const lease = {...inspection.target,connection:{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway},...operation,releaseId,phase:'RESERVED',boundBackend:null,createdAt:at};
    const record = {root,base,lease};
    try {
      if (!existingTarget) await writeNew(targetPath,inspection.target);
      const path = join(base,'lease.json');
      try { const prior = validateLease(await read(path)); requireSafe(prior.phase === 'COMPLETE'); await storedLease(prior,deps); await update(path,lease); }
      catch (e) { if (e.code !== 'ENOENT' || existingTarget) throw e; await writeNew(path,lease); }
      await runtime(deps)(['stop','--time','30',lease.containerIds['cms-api']]);
      await phase(record,'PRE_CONNECTION',null,deps); await assertQuiesced(lease,deps);
      const tables = ['cms_principal','cms_credential','cms_principal_role','cms_permission','cms_session','cms_audit_event','cms_entry','cms_entry_revision','cms_entry_ref','cms_entry_index','cms_navigation_menu','cms_media','cms_media_variant','cms_media_attachment'];
      const dirty = await psql(runtime(deps),lease,'SELECT '+tables.map(t=>`EXISTS(SELECT 1 FROM ${t})`).join(' OR ')+';');
      requireSafe(dirty === 'f\n' || dirty === 'f'); await probe(record,deps); await assertQuiesced(lease,deps); return lease;
    } catch (e) { try { await phase(record,'FAILED_OR_UNKNOWN','QUIESCENCE_NOT_PROVEN',deps); } catch {} throw e; }
  } catch (e) { if (['MAINTENANCE_BUSY','DUPLICATE_OPERATION','RECOVERY_BACKUP_REQUIRED'].includes(e.message)) throw e; code('QUIESCENCE_NOT_PROVEN'); }
}
export async function assertQuiesced(input, deps = {}) {
  try { const record = await storedLease(input, deps); requireSafe(['PRE_CONNECTION','BOUND'].includes(record.lease.phase)); await live(record.lease, deps); return record.lease; }
  catch { code('QUIESCENCE_NOT_PROVEN'); }
}
export async function bindBackend(input, pid, backendStartEpoch, deps = {}) {
  try {
    const record = await storedLease(input, deps); requireSafe(record.lease.phase === 'PRE_CONNECTION' && record.lease.boundBackend === null);
    record.lease.boundBackend = { pid, backendStartEpoch, db: 'cms', role: 'cms_local', clientAddr: record.lease.connection.dataGateway, applicationName: record.lease.operationId };
    requireSafe(validBackend(record.lease.boundBackend, record.lease)); await live(record.lease, deps, true);
    const lease = await phase(record, 'BOUND', null, deps); Object.assign(input, lease); return lease;
  } catch { code('QUIESCENCE_NOT_PROVEN'); }
}
async function probe(record,deps) {
  const inspection = await live(record.lease,deps), built = mediaProbeCommand(inspection,record.lease.operationId);
  const args = built.args.slice(2).filter(arg=>arg !== '--rm'); args[0] = 'create';
  const abort = new AbortController(), docker = runtime(deps,abort.signal); let id, owned = false, interrupted = false;
  const cancel = () => { interrupted = true; abort.abort(); };
  process.once('SIGINT',cancel); process.once('SIGTERM',cancel);
  try {
    id = (await docker(args)).trim(); requireSafe(hex(id,64) && !interrupted);
    const values = JSON.parse(await docker(['inspect',id])); requireSafe(Array.isArray(values) && values.length === 1);
    const p = values[0], t = record.lease, host = p.HostConfig, labels = p.Config?.Labels;
    requireSafe(p.Id === id && p.Name === `/${t.project}-media-probe-${t.operationId}` && p.Image === t.images.node && p.State?.Running === false);
    const images = JSON.parse(await docker(['image','inspect',t.images.node])); requireSafe(images.length===1 && images[0].Id===t.images.node && images[0].Os==='linux');
    const inherited = images[0].Config?.Labels ?? {}; requireSafe(object(inherited));
    requireSafe(same(labels,{...inherited,'org.cms.pp1.run-id':t.runId,'org.cms.pp1.operation-id':t.operationId,'org.cms.pp1.role':'media-probe'}));
    requireSafe(host?.NetworkMode === 'none' && host.ReadonlyRootfs === true && host.Privileged === false && same(host.CapDrop,['ALL']) && same(host.SecurityOpt,['no-new-privileges']));
    requireSafe(host.RestartPolicy?.Name==='no');
    requireSafe(object(host.PortBindings) && Object.keys(host.PortBindings).length === 0 && object(p.NetworkSettings?.Networks) && Object.keys(p.NetworkSettings.Networks).every(n=>n==='none'));
    requireSafe(Object.values(p.NetworkSettings.Ports ?? {}).every(v=>v===null || Array.isArray(v) && v.length===0));
    const mounts = new Map(p.Mounts?.map(m=>[m.Destination,m])); requireSafe(mounts.size === 3 && p.Mounts.length === 3 && p.Mounts.every(m=>m.RW===false));
    const media = mounts.get('/media'), node = mounts.get('/opt/pp1-node'), script = mounts.get('/tool/probe.mjs');
    const volumes = JSON.parse(await docker(['volume','inspect',t.volumeNames['media-data']])); requireSafe(volumes.length===1 && volumes[0].Name===t.volumeNames['media-data']);
    requireSafe(media?.Type==='volume' && media.Name===t.volumeNames['media-data'] && media.Source===volumes[0].Mountpoint);
    requireSafe(node?.Type==='bind' && script?.Type==='bind' && args.includes(`type=bind,src=${node.Source},dst=/opt/pp1-node,readonly`) && args.includes(`type=bind,src=${script.Source},dst=/tool/probe.mjs,readonly`));
    requireSafe(same(p.Config.Entrypoint,['/opt/pp1-node']) && same(p.Config.Cmd,['/tool/probe.mjs'])); owned = true;
    const bounded = runtime(deps,abort.signal,(deps.clock ?? Date.now)()+30000);
    await bounded(['start',id]); requireSafe((await bounded(['wait',id])).trim()==='0'); requireSafe((await bounded(['logs',id]))==='EMPTY\n' && !interrupted);
  } finally {
    try { if (owned) await runtime(deps)(['rm','--force',id]); }
    finally { process.removeListener('SIGINT',cancel); process.removeListener('SIGTERM',cancel); }
  }
  requireSafe(!interrupted);
  await assertQuiesced(record.lease,deps);
}
export async function finish(input,exitCode,deps = {}) {
  let record, committed = false, started = false;
  try {
    requireSafe(Number.isInteger(exitCode)); record = await storedLease(input,deps);
    let result;
    try { result = await read(join(record.base,'operations',`${record.lease.operationId}.result.json`)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (result) {
      requireSafe(exact(result,['operationId','operation','principalId','completedAt','releaseId','targetId']) && result.operationId===record.lease.operationId && result.operation===record.lease.operation && result.releaseId===record.lease.releaseId && result.targetId===record.lease.targetId && uuid(result.principalId));
      requireSafe(typeof result.completedAt==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result.completedAt) && Number.isFinite(Date.parse(result.completedAt)));
      requireSafe(['BOUND','COMMITTED'].includes(record.lease.phase)); committed = true; await phase(record,'COMMITTED',null,deps);
    } else { await phase(record,'FAILED_OR_UNKNOWN','QUIESCENCE_NOT_PROVEN',deps); if (exitCode===0) code('QUIESCENCE_NOT_PROVEN'); return record.lease; }
    if (exitCode!==0) code('COMMITTED_HOST_RESTORE_FAILED');
    await live({...record.lease,phase:'PRE_CONNECTION',boundBackend:null},deps);
    const clock = deps.clock ?? Date.now, deadline = clock()+30000, docker = runtime(deps,undefined,deadline), api = record.lease.containerIds['cms-api']; started = true; await docker(['start',api]);
    while (true) {
      requireSafe(clock()<deadline);
      if ((await docker(['inspect','--format','{{.State.Health.Status}}',api])).trim()==='healthy') break;
      requireSafe(clock()<deadline); await new Promise(done=>setTimeout(done,Math.min(250,deadline-clock())));
    }
    const inspection = await inspectTarget(record.root,deps,{apiState:'running'}); requireSafe(targetKeys.every(k=>same(inspection.target[k],record.lease[k])) && same(record.lease.connection,{jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway}));
    await phase(record,'COMPLETE',null,deps); const lock = join(record.base,'operation.lock'), identity = await directory(lock);
    requireSafe((await readdir(lock)).length===0); const current = await directory(lock); requireSafe(current.ino===identity.ino && current.dev===identity.dev); await rmdir(lock); return record.lease;
  } catch {
    if (started) try { await runtime(deps)(['stop','--time','30',record.lease.containerIds['cms-api']]); } catch {}
    if (record && committed) try { await phase(record,'COMMITTED','COMMITTED_HOST_RESTORE_FAILED',deps); } catch {}
    if (record && !committed) try { await phase(record,'FAILED_OR_UNKNOWN','QUIESCENCE_NOT_PROVEN',deps); } catch {}
    code(committed ? 'COMMITTED_HOST_RESTORE_FAILED' : 'QUIESCENCE_NOT_PROVEN');
  }
}
async function helper(argv) {
  const [verb, ...rest] = argv, fields = {};
  requireSafe(['assert','bind-backend','inspect'].includes(verb) && rest.length % 2 === 0);
  for (let i = 0; i < rest.length; i += 2) { requireSafe(rest[i].startsWith('--') && !Object.hasOwn(fields, rest[i]) && rest[i+1]); fields[rest[i]] = rest[i+1]; }
  const expected = verb === 'inspect' ? ['--run-id'] : verb === 'assert' ? ['--run-id','--operation-id','--phase'] : ['--run-id','--operation-id','--pid','--backend-start-epoch'];
  requireSafe(exact(fields, expected)); const root = rootFor(fields['--run-id'], {}); const lease = await read(join(root, 'maintenance/lease.json'));
  if (verb === 'inspect') { await storedLease(lease, {}); process.stdout.write(JSON.stringify({ operationId: lease.operationId, phase: lease.phase }) + '\n'); return; }
  requireSafe(uuid(fields['--operation-id']) && fields['--operation-id'] === lease.operationId);
  if (verb === 'assert') { requireSafe(['pre-connection','bound'].includes(fields['--phase']) && lease.phase === { 'pre-connection':'PRE_CONNECTION',bound:'BOUND' }[fields['--phase']]); await assertQuiesced(lease); }
  else { requireSafe(/^[1-9][0-9]*$/.test(fields['--pid'])); await bindBackend(lease, Number(fields['--pid']), fields['--backend-start-epoch']); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await helper(process.argv.slice(2)); } catch { process.stderr.write('QUIESCENCE_NOT_PROVEN\n'); process.exitCode = 6; }
}
