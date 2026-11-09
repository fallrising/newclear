import { constants, watch, lstatSync, openSync, fstatSync, readFileSync, closeSync, readdirSync, mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve, parse } from 'node:path';
import { canonicalBytes, parseStrictJson, sha256, OpsError } from '../ops/recovery-protocol.mjs';
import { rootFor, directory, syncDirectory, WORKFLOW_PHASES } from './maintenance-store.mjs';
import { inspectTarget, inspectionDetails } from './maintenance-target.mjs';

const owners = new WeakMap(), execute = promisify(execFile);
const ensure = (ok, code = 'SOURCE_CHANGED') => { if (!ok) throw new OpsError(code); };
const same = (a, b) => canonicalBytes(a).equals(canonicalBytes(b));
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const exact = (v, keys) => v && same(Object.keys(v).sort(), keys.split(' ').sort());
const frozen = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) frozen(x); Object.freeze(v); } return v; };
const identity = s => ({ dev: String(s.dev), ino: String(s.ino), mode: String(s.mode), uid: String(s.uid), gid: String(s.gid) });
const fingerprint = s => ({ ...identity(s), size: String(s.size), nlink: String(s.nlink), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) });
function stat(path, file = false, privateFile = true) {
  const s = lstatSync(path, { bigint: true });
  ensure(!s.isSymbolicLink() && (file ? s.isFile() && s.nlink === 1n : s.isDirectory()));
  ensure(s.uid === BigInt(process.getuid()) && (file && !privateFile ? (s.mode & 0o7022n) === 0n
    : (s.mode & 0o7777n) === BigInt(file ? 0o600 : 0o700)));
  return s;
}
function raw(path, privateFile = true) {
  const before = stat(path, true, privateFile), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true }); ensure(same(fingerprint(before), fingerprint(opened)));
    const bytes = readFileSync(fd), after = stat(path, true, privateFile);
    ensure(same(fingerprint(opened), fingerprint(fstatSync(fd, { bigint: true }))) && same(fingerprint(before), fingerprint(after)));
    return { identity: fingerprint(after), bytes: bytes.toString('base64') };
  } finally { closeSync(fd); }
}
function noSymlinkParents(path) {
  let p = parse(path).root; const result = {};
  for (const part of path.slice(p.length).split('/')) {
    p = join(p, part); const s = lstatSync(p, { bigint: true }); ensure(s.isDirectory() && !s.isSymbolicLink()); result[p] = identity(s);
  }
  return result;
}
const json = file => JSON.parse(Buffer.from(file.bytes, 'base64').toString('utf8'));
function accountResult(r, id, targetId, releaseId) {
  ensure(exact(r, 'operationId operation principalId completedAt releaseId targetId') && r.operationId === id
    && r.targetId === targetId && r.releaseId === releaseId && uuid(r.principalId)
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(r.completedAt)
    && Number.isFinite(Date.parse(r.completedAt)), 'JOURNAL_INCOMPLETE');
}
function auditOperations(files, dirs, material) {
  const rootFiles = Object.keys(files).filter(p => !p.includes('/')), journals = new Set();
  for (const name of rootFiles) {
    const match = /^([a-f0-9-]{36})(\.(?:request|proof|result))?\.json$/.exec(name);
    ensure(match && uuid(match[1]), 'JOURNAL_INCOMPLETE');
    if (!match[2]) journals.add(match[1]);
  }
  for (const name of rootFiles) ensure(journals.has(name.slice(0, 36)), 'JOURNAL_INCOMPLETE');
  for (const name of Object.keys(dirs)) ensure(journals.has(name.split('/')[0]), 'JOURNAL_INCOMPLETE');
  for (const id of journals) {
    const j = json(files[id + '.json']); ensure(j.operationId === id, 'JOURNAL_INCOMPLETE');
    if (j.version === 2) {
      ensure(exact(j, 'version operationId purpose sourceTargetId releaseId records'), 'JOURNAL_INCOMPLETE');
      parseStrictJson(Buffer.from(files[id + '.json'].bytes, 'base64'));
      ensure(files[id + '.request.json'] && (j.purpose === 'RECOVER_ADMIN' ? files[id + '.result.json'] : !files[id + '.result.json']), 'JOURNAL_INCOMPLETE');
      const request = parseStrictJson(Buffer.from(files[id + '.request.json'].bytes, 'base64'));
      ensure(exact(request, 'version operationId sourceRunId purpose targetRunId incidentStartedAt startedAt environment')
        && request.version === 1 && typeof request.startedAt === 'string' && new Date(request.startedAt).toISOString() === request.startedAt,
      'JOURNAL_INCOMPLETE');
      if (j.purpose === 'RESTORE_VERIFY_LOCAL') ensure(typeof request.targetRunId === 'string' && /^[a-f0-9]{32}$/.test(request.targetRunId)
        && request.targetRunId !== material.source.target.runId && request.environment === 'isolated-drill'
        && new Date(request.incidentStartedAt).toISOString() === request.incidentStartedAt && request.incidentStartedAt <= request.startedAt, 'JOURNAL_INCOMPLETE');
      else ensure(request.targetRunId === null && request.environment === null && request.incidentStartedAt === null, 'JOURNAL_INCOMPLETE');
      const phases = WORKFLOW_PHASES[j.purpose];
      ensure(phases && j.sourceTargetId === material.source.target.targetId && j.releaseId === `sha256:${material.source.target.apiBuild.jarSha256}`
        && request.operationId === id && request.sourceRunId === material.source.target.runId && request.purpose === j.purpose
        && Array.isArray(j.records) && j.records.length === phases.length * 2, 'JOURNAL_INCOMPLETE');
      j.records.forEach((r, n) => ensure(exact(r, 'seq event phase at failureCode leaseSha256 proofSha256')
        && typeof r.at === 'string' && new Date(r.at).toISOString() === r.at && r.at >= (j.records[n - 1]?.at ?? request.startedAt)
        && r.seq === String(n + 1) && r.event === (n % 2 ? 'END' : 'BEGIN')
        && r.phase === phases[Math.floor(n / 2)] && r.failureCode === null && hex(r.leaseSha256)
        && (r.proofSha256 === null || hex(r.proofSha256)), 'JOURNAL_INCOMPLETE'));
      ensure(j.records.at(-1)?.phase === 'COMPLETE', 'JOURNAL_INCOMPLETE');
      ensure(j.purpose === 'BACKUP_LOCAL' ? j.records.at(-1).proofSha256 === null : hex(j.records.at(-1).proofSha256), 'JOURNAL_INCOMPLETE');
      if (j.purpose === 'RECOVER_ADMIN') {
        const r = json(files[id + '.result.json']); accountResult(r, id, j.sourceTargetId, j.releaseId);
        ensure(r.operation === j.purpose && Date.parse(r.completedAt) >= Date.parse(request.startedAt), 'JOURNAL_INCOMPLETE');
      }
    } else {
      ensure(exact(j, 'operationId operation targetId releaseId phase at failureCode') && ['FRESH_INIT', 'RECOVER_ADMIN'].includes(j.operation)
        && j.phase === 'COMPLETE' && j.failureCode === null && new Date(j.at).toISOString() === j.at
        && j.targetId === material.source.target.targetId && j.releaseId === `sha256:${material.source.target.apiBuild.jarSha256}`
        && files[id + '.result.json'] && !files[id + '.request.json'] && !files[id + '.proof.json'], 'JOURNAL_INCOMPLETE');
      const r = json(files[id + '.result.json']);
      accountResult(r, id, j.targetId, j.releaseId); ensure(r.operation === j.operation, 'JOURNAL_INCOMPLETE');
    }
  }
}
function snapshot(base) {
  const parents = noSymlinkParents(base); stat(base);
  try { lstatSync(join(base, 'operation.lock')); ensure(false, 'LOCK_BUSY'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const operations = join(base, 'operations'), files = {}, dirs = {};
  const entries = readdirSync(base).filter(name => name !== 'verification').sort();
  ensure(same(entries, ['lease.json', 'operations', 'recovery-candidate.json', 'target.json']), 'JOURNAL_INCOMPLETE');
  const walk = (path, relative = '') => {
    dirs[relative] = identity(stat(path));
    for (const name of readdirSync(path).sort()) {
      const key = relative ? `${relative}/${name}` : name, p = join(path, name), s = lstatSync(p, { bigint: true });
      if (s.isDirectory()) walk(p, key); else files[key] = raw(p, relative === '');
    }
  };
  walk(operations); delete dirs[''];
  const registry = {};
  for (const name of ['lease.json', 'target.json', 'recovery-candidate.json']) registry[name] = raw(join(base, name));
  return { parents, entries, operationsIdentity: identity(stat(operations)), registry, files, dirs };
}
function invalidate(c, code = 'SOURCE_CHANGED') { c.invalid ??= code; c.controller.abort(); }
function owned(token, deps, cleanup = false) {
  const c = owners.get(token); ensure(c && !c.closed, 'TARGET_NOT_OWNED');
  if (deps) ensure(resolve(deps.cwd ?? process.cwd()) === c.cwd, 'TARGET_NOT_OWNED');
  if (!cleanup) { ensure(!c.invalid, c.invalid); ensure(!c.signal.aborted, 'INTERRUPTED'); }
  return c;
}
function guard(c) {
  try {
    ensure(!c.invalid, c.invalid); ensure(!c.signal.aborted, 'INTERRUPTED');
    ensure(same(snapshot(c.base), c.original));
    for (const [p, i] of Object.entries(c.scratch)) ensure(same(identity(stat(p)), i));
    for (const [p, value] of Object.entries(c.protectedFiles ?? {})) ensure(same(raw(p), value));
  } catch (error) { invalidate(c, error.code === 'LOCK_BUSY' ? 'LOCK_BUSY' : 'SOURCE_CHANGED'); throw error; }
}
export function assertObservationGate(token) { const c = owned(token); guard(c); }
function watchGuard(c) {
  const paths = [c.root, c.base, join(c.base, 'operations'), ...Object.keys(c.original.dirs).map(p => join(c.base, 'operations', p))];
  for (const path of paths) {
    const watcher = watch(path, { persistent: false }, (_event, name) => {
      if (path === c.base && _event === 'rename' && name?.toString() === 'verification' && c.verificationCreation) {
        const expected = c.verificationCreation; c.verificationCreation = null;
        try { ensure(same(identity(stat(join(c.base, 'verification'))), expected)); guard(c); return; } catch {}
      }
      invalidate(c);
    });
    watcher.on('error', () => invalidate(c)); c.watchers.push(watcher);
  }
}
async function docker(c, args, deps) {
  const env = { ...(deps.environment ?? process.env) };
  ensure(!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock');
  ensure(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'); ensure(!env.DOCKER_TLS_VERIFY);
  for (const k of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[k];
  const result = await (deps.command ?? execute)('docker', ['--host', 'unix:///var/run/docker.sock', ...args],
    { env, shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  guard(c); ensure(result.code === undefined || result.code === 0); return result.stdout;
}
const activitySql = "SELECT COALESCE(json_agg(a), '[]'::json)::text FROM (SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch, usename, datname, application_name, host(client_addr) AS client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()) a;";
async function clients(c, deps) {
  try { guard(c); await queryClients(c, deps); guard(c); }
  catch (error) {
    const failure = error instanceof OpsError ? error : new OpsError('WRITER_NOT_QUIESCED');
    invalidate(c, failure.code); throw failure;
  }
}
async function queryClients(c, deps) {
  const rows = JSON.parse(await docker(c, ['exec', c.target.containerIds.postgres, 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', activitySql], deps));
  ensure(Array.isArray(rows) && rows.length <= 1, 'WRITER_NOT_QUIESCED');
  const h = c.helper;
  if (!h || ['CREATED', 'EXITED'].includes(h.state) || c.step < 7) ensure(rows.length === 0, 'WRITER_NOT_QUIESCED');
  else if (!rows.length) { ensure(h.backend === null || c.draining, 'WRITER_NOT_QUIESCED'); if (h.backend) c.backendEnded = true; }
  else {
    const r = rows[0]; ensure(!c.backendEnded && r.usename === 'cms_local' && r.datname === 'cms' && r.application_name === c.operationId
      && r.client_addr === h.endpoint?.address && ['active', 'idle', 'idle in transaction'].includes(r.state), 'WRITER_NOT_QUIESCED');
    if (h.backend) ensure(r.pid === h.backend.pid && r.backend_start_epoch === h.backend.backendStartEpoch, 'WRITER_NOT_QUIESCED');
  }
}
function context(c) {
  return Object.freeze({ root: c.root, base: c.base, runRoot: c.root, cwd: c.cwd, target: c.target, connection: c.connection,
    nodeBinary: c.nodeBinary, uid: c.uid, gid: c.gid, operationId: c.operationId, seq: c.seq, helperSequence: Number(c.seq),
    helperRoot: c.helperRoot, material: c.material, helper: c.helper ? frozen(structuredClone(c.helper)) : null, signal: c.signal });
}
export async function beginReadonlyObservation(ids, deps = {}) {
  ensure(exact(ids, 'runId backupId restoreOperationId') && Object.getOwnPropertySymbols(ids).length === 0, 'INPUT_INVALID');
  const root = rootFor(ids.runId, deps), base = join(root, 'maintenance'), original = snapshot(base);
  const c = { root, base, original, cwd: resolve(deps.cwd ?? process.cwd()), operationId: ids.restoreOperationId,
    uid: process.getuid(), gid: process.getgid(),
    watchers: [], controller: new AbortController(), scratch: {}, step: 1, reservation: null, helper: null, closed: false };
  c.signal = AbortSignal.any([c.controller.signal, AbortSignal.timeout(6 * 60 * 60 * 1000), ...(deps.signal ? [deps.signal] : [])]);
  try {
    // No await (including module loading/material reads) may precede the continuous guard.
    watchGuard(c); guard(c);
    const { readReadonlyMaterial } = await import('../ops/local-recovery-verify.mjs'); guard(c);
    const material = await readReadonlyMaterial(ids, deps); guard(c); auditOperations(original.files, original.dirs, material);
    c.material = material; c.target = material.source.target; c.connection = material.source.connection;
    const verification = join(base, 'verification'), operation = join(verification, ids.restoreOperationId);
    // Only this exact new parent may produce one expected base event; no registry event is exempt.
    try { mkdirSync(verification, { mode: 0o700 }); c.verificationCreation = identity(stat(verification)); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    c.scratch[verification] = identity(stat(verification)); await syncDirectory(base); guard(c);
    try { await mkdir(operation, { mode: 0o700 }); await syncDirectory(verification); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    await directory(operation); c.scratch[operation] = identity(stat(operation)); guard(c);
    c.helperRoot = join(operation, randomBytes(16).toString('hex')); await mkdir(c.helperRoot, { mode: 0o700 }); await syncDirectory(operation);
    c.scratch[c.helperRoot] = identity(stat(c.helperRoot)); c.seq = String(randomBytes(6).readUIntBE(0, 6)); ensure(c.seq !== '0');
    guard(c);
    const reread = await readReadonlyMaterial(ids, deps); guard(c); ensure(same(reread, material));
    const inspection = await inspectTarget(root, deps, { apiState: 'stopped' }); guard(c);
    ensure(same(inspection.target, c.target) && same({ jdbcUrl: inspection.jdbcUrl, dataGateway: inspection.dataGateway }, c.connection));
    c.nodeBinary = inspectionDetails(inspection).nodeBinary; await clients(c, deps); guard(c); ensure(!c.signal.aborted, 'INTERRUPTED');
    const token = Object.freeze({}); owners.set(token, c); return token;
  } catch (error) { c.watchers.forEach(w => w.close()); invalidate(c); throw error; }
}
export async function observationContext(token, deps = {}) {
  const c = owned(token, deps);
  try {
    guard(c);
    const inspection = await inspectTarget(c.root, deps, { apiState: 'stopped', observation: token }); guard(c);
    ensure(same(inspection.target, c.target) && same({ jdbcUrl: inspection.jdbcUrl, dataGateway: inspection.dataGateway }, c.connection));
    ensure(inspectionDetails(inspection).nodeBinary === c.nodeBinary); await clients(c, deps); assertObservationGate(token); return context(c);
  } catch (error) { invalidate(c, error instanceof OpsError ? error.code : 'SOURCE_CHANGED'); throw error; }
}
export const assertObservation = observationContext;
export async function reserveObservationHelper(token, options, deps = {}) {
  const c = owned(token, deps); ensure(exact(options, 'step') && options.step === c.step && c.step <= 7 && !c.reservation && !c.helper && !c.finalReady, 'ADAPTER_UNSEALED');
  await observationContext(token, deps); assertObservationGate(token); c.reservation = Object.freeze({}); return c.reservation;
}
const kinds = ['PROFILE', 'PROFILE', 'PG_DUMP_VERSION', 'PG_RESTORE_VERSION', 'PROFILE', 'PROFILE', 'INVENTORY'];
function boundContext(c, supplied) {
  const expected = context(c);
  for (const key of ['root', 'base', 'runRoot', 'cwd', 'target', 'connection', 'nodeBinary', 'uid', 'gid', 'operationId', 'seq', 'helperSequence', 'helperRoot'])
    ensure(same(supplied[key], expected[key]), 'TARGET_NOT_OWNED');
}
async function helperSnapshot(c, deps, state, cleanup = false) {
  const { assertHelperPolicy } = await import('./maintenance-helper.mjs');
  const result = await (cleanup ? cleanupDocker(c, ['inspect', c.helper.fullContainerId], deps) : docker(c, ['inspect', c.helper.fullContainerId], deps));
  const rows = JSON.parse(result); ensure(Array.isArray(rows) && rows.length === 1);
  const actual = rows[0].State?.Status;
  if (state === 'actual') ensure(['created', 'running', 'exited'].includes(actual)); else ensure(actual === state);
  assertHelperPolicy(rows[0], c.policy, { ...c.expected, state: actual });
  if (actual === 'exited' && !cleanup) ensure(rows[0].State.ExitCode === 0);
  return rows[0];
}
async function validateCreation(c, record, deps) {
  const { helper, policy, expected, step, context: supplied } = record;
  boundContext(c, supplied);
  ensure(step === c.step && policy.kind === kinds[step - 1] && helper.kind === policy.kind && helper.side === 'source'
    && policy.side === 'source' && hex(helper.fullContainerId) && helper.state === 'CREATED' && helper.endpoint === null && helper.backend === null
    && helper.policySha256 === sha256(canonicalBytes(policy))
    && (expected.fullContainerId === undefined || expected.fullContainerId === helper.fullContainerId), 'TARGET_NOT_OWNED');
  ensure(expected.name === `cms-pp1c-${c.operationId}-${c.seq}${step < 7 ? '-profile-' + step : ''}`);
  const imageId = c.target.images[[null, 'api', 'node', 'postgres', 'postgres', 'api', 'api', 'api'][step]];
  ensure(policy.imageId === imageId && expected.labels['org.cms.pp1c.operation'] === c.operationId
    && expected.labels['org.cms.pp1c.seq'] === c.seq && expected.labels['org.cms.pp1c.kind'] === policy.kind
    && expected.labels['org.cms.pp1c.policy'] === helper.policySha256);
  const images = JSON.parse(await docker(c, ['image', 'inspect', imageId], deps));
  ensure(images.length === 1 && images[0].Id === imageId && images[0].Os === 'linux');
  const image = images[0];
  ensure(same(expected.labels, { ...(image.Config.Labels ?? {}), 'org.cms.pp1c.operation': c.operationId,
    'org.cms.pp1c.seq': c.seq, 'org.cms.pp1c.kind': policy.kind, 'org.cms.pp1c.policy': helper.policySha256 }));
  const volumes = JSON.parse(await docker(c, ['volume', 'inspect', c.target.volumeNames['media-data']], deps));
  ensure(volumes.length === 1 && volumes[0].Name === c.target.volumeNames['media-data']
    && expected.volumeMountpoints[volumes[0].Name] === volumes[0].Mountpoint);
  if (step === 7) {
    const { buildHelperPolicy } = await import('./maintenance-helper.mjs');
    ensure(same(buildHelperPolicy({ ...context(c), image: images[0], kind: 'INVENTORY', side: 'source' }), policy));
  } else {
    ensure(policy.networkId === null && same(policy.env, [...(image.Config.Env ?? [])].sort()));
    const networks = JSON.parse(await docker(c, ['network', 'inspect', 'none'], deps));
    ensure(networks.length === 1 && networks[0].Id === expected.noneNetworkId && hex(expected.noneNetworkId)
      && networks[0].Name === 'none' && networks[0].Driver === 'null' && networks[0].Scope === 'local');
    if (step === 3 || step === 4) ensure(expected.pgProfileImageId === c.target.images.postgres);
    if (step >= 5) ensure(policy.user === (image.Config.User ?? ''));
    const preimages = expected.profileArtifacts;
    ensure(exact(preimages, 'sourceSha256 classSha256 nodeProfileSha256') && Object.values(preimages).every(hex));
    const base = join(c.helperRoot, 'profile');
    ensure(sha256(Buffer.from(raw(join(base, 'Profile.java')).bytes, 'base64')) === preimages.sourceSha256
      && sha256(Buffer.from(raw(join(base, 'classes/Profile.class')).bytes, 'base64')) === preimages.classSha256);
    const compiled = parseStrictJson(Buffer.from(raw(join(base, 'compile.json')).bytes, 'base64'));
    ensure(same(compiled, { sourceSha256: preimages.sourceSha256, classSha256: preimages.classSha256, uid: c.uid, gid: c.gid }));
    const entry = [null, '/opt/java/openjdk/bin/java', '/opt/pp1-node', '/usr/local/bin/pg_dump', '/usr/local/bin/pg_restore', '/usr/bin/id', '/usr/bin/id'][step];
    ensure(policy.entrypoint === entry);
    if (step === 1) ensure(same(policy.args, ['-cp', '/probe/classes', 'Profile']));
    if (step === 2) ensure(policy.args.length === 2 && policy.args[0] === '-e' && typeof policy.args[1] === 'string'
      && sha256(Buffer.from(policy.args[1])) === preimages.nodeProfileSha256);
    if (step >= 3) ensure(same(policy.args, [step <= 4 ? '--version' : step === 5 ? '-u' : '-g']));
    if (step <= 4) ensure(policy.user === `${c.uid}:${c.gid}`);
    const bind = (source, destination, readOnly = true) => ({ type: 'bind', source, destination, readOnly });
    const mounts = step <= 2 ? [bind(join(base, 'input'), '/probe/input'), bind(join(base, 'output'), '/probe/output', false),
      ...(step === 1 ? [bind(join(base, 'classes'), '/probe/classes'), { type: 'volume', source: c.target.volumeNames['media-data'], destination: '/media', readOnly: true }]
        : [bind(c.nodeBinary, '/opt/pp1-node')])] : [];
    ensure(same(policy.mounts, mounts.sort((a, b) => a.destination.localeCompare(b.destination))));
  }
}
export async function registerObservationHelper(token, ticket, reservation, deps = {}) {
  const c = owned(token, deps, true); ensure(c.reservation === reservation && !c.helper && c.step <= 7, 'TARGET_NOT_OWNED');
  const { claimReadonlyCreation } = await import('./maintenance-helper.mjs');
  const record = claimReadonlyCreation(ticket, token, reservation);
  // Capture private creation provenance before cancellation/full-source checks, never a caller policy.
  boundContext(c, record.context); ensure(record.step === c.step && hex(record.helper.fullContainerId));
  c.helper = structuredClone(record.helper); c.policy = record.policy;
  c.expected = frozen({ ...structuredClone(record.expected), fullContainerId: record.helper.fullContainerId });
  await validateCreation(c, record, deps);
  c.protectedFiles ??= {};
  if (c.step < 7) {
    for (const relative of ['profile', 'profile/classes', 'profile/output']) {
      const path = join(c.helperRoot, relative); c.scratch[path] ??= identity(stat(path));
    }
    for (const relative of ['profile/Profile.java', 'profile/classes/Profile.class', 'profile/compile.json', 'profile/input']) {
      const path = join(c.helperRoot, relative); c.protectedFiles[path] ??= raw(path);
    }
  } else {
    const path = join(c.helperRoot, 'request.json'); c.protectedFiles[path] = raw(path);
    const output = join(c.helperRoot, 'output'); c.scratch[output] = identity(stat(output));
  }
  await helperSnapshot(c, deps, 'created', true);
  await observationContext(token, deps); return frozen(structuredClone(c.helper));
}
export function observationInspectionContext(token, root, deps = {}) {
  const c = owned(token, deps); ensure(root === c.root); guard(c);
  return c.helper && !c.removed ? { restoreRoot: null, helper: structuredClone(c.helper), policy: c.policy, expected: c.expected,
    allowExited: c.draining === true, profileTransition: c.profileTransition === true } : null;
}
export async function beginObservationProfile(token, reservation, deps = {}) {
  const c = owned(token, deps); ensure(c.reservation === reservation && c.step < 7 && c.helper?.state === 'CREATED' && !c.profileTransition);
  await observationContext(token, deps); assertObservationGate(token); c.profileTransition = true;
}
export async function updateObservationHelper(token, helper, deps = {}) {
  const c = owned(token, deps), old = c.helper; ensure(old && exact(helper, 'kind side fullContainerId policySha256 state endpoint backend startedAt'));
  for (const k of ['kind', 'side', 'fullContainerId', 'policySha256', 'startedAt']) ensure(helper[k] === old[k]);
  const transitions = { CREATED: c.step < 7 ? ['EXITED'] : ['RUNNING'], RUNNING: ['READY', 'EXITED'], READY: ['PERMITTED', 'EXITED'], PERMITTED: ['EXITED'], EXITED: [] };
  ensure(transitions[old.state].includes(helper.state));
  if (old.endpoint) ensure(same(old.endpoint, helper.endpoint));
  if (old.backend) ensure(same(old.backend, helper.backend));
  const snapshot = await helperSnapshot(c, deps, helper.state === 'EXITED' ? 'exited' : 'running');
  if (c.step === 7) {
    const endpoint = Object.values(snapshot.NetworkSettings.Networks)[0];
    if (helper.state !== 'EXITED') ensure(exact(helper.endpoint, 'networkId address') && helper.endpoint.networkId === c.target.networkIds.data
      && helper.endpoint.address === endpoint.IPAddress);
    if (['READY', 'PERMITTED'].includes(helper.state)) ensure(helper.backend && Number.isInteger(helper.backend.pid) && helper.backend.pid > 0
      && /^[1-9][0-9]*\.[0-9]+$/.test(helper.backend.backendStartEpoch) && helper.backend.db === 'cms' && helper.backend.role === 'cms_local'
      && helper.backend.clientAddr === helper.endpoint.address && helper.backend.applicationName === c.operationId);
  } else ensure(helper.endpoint === null && helper.backend === null && c.profileTransition);
  c.helper = structuredClone(helper); if (helper.state === 'EXITED') c.profileTransition = false;
  await observationContext(token, deps);
}
export async function assertObservationDrain(token, deps = {}) {
  const c = owned(token, deps); ensure(c.step === 7 && c.helper?.backend && ['PERMITTED', 'EXITED'].includes(c.helper.state));
  c.draining = true; const snapshot = await helperSnapshot(c, deps, 'actual');
  ensure(['running', 'exited'].includes(snapshot.State.Status)); await clients(c, deps);
  if (snapshot.State.Status === 'exited') { ensure(c.backendEnded, 'WRITER_NOT_QUIESCED'); c.helper.state = 'EXITED'; }
  const value = await observationContext(token, deps); return Object.freeze({ ...value, helperBackendEnded: c.backendEnded === true });
}
async function cleanupDocker(c, args, deps) {
  const env = { ...(deps.environment ?? process.env) };
  ensure(!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock');
  ensure(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'); ensure(!env.DOCKER_TLS_VERIFY);
  for (const k of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[k];
  return (await (deps.command ?? execute)('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { env, shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024 })).stdout;
}
export async function observationCleanupContext(token, reservation, deps = {}) {
  const c = owned(token, deps, true); ensure(c.reservation === reservation && c.helper, 'TARGET_NOT_OWNED');
  await helperSnapshot(c, deps, 'actual', true);
  return frozen({ helper: structuredClone(c.helper), policy: structuredClone(c.policy), expected: structuredClone(c.expected) });
}
export async function clearObservationHelper(token, deps = {}) {
  const c = owned(token, deps, true); ensure(c.helper);
  let missing; try { await cleanupDocker(c, ['inspect', c.helper.fullContainerId], deps); } catch (error) { missing = error; }
  ensure(missing?.code === 1 && [`Error: No such object: ${c.helper.fullContainerId}`, `error: no such object: ${c.helper.fullContainerId}`,
    `Error response from daemon: No such container: ${c.helper.fullContainerId}`].includes(String(missing.stderr ?? '').trim()));
  c.removed = true;
  await observationContext(token, deps); c.helper = null; c.policy = null; c.expected = null; c.reservation = null;
  c.removed = false; c.profileTransition = false; c.draining = false; c.backendEnded = false; c.step++;
}
export async function finishObservation(token, deps = {}) {
  const c = owned(token, deps); ensure(c.step === 8 && !c.helper && !c.reservation && !c.finalReady);
  await observationContext(token, deps);
  const { readReadonlyMaterial } = await import('../ops/local-recovery-verify.mjs');
  const material = await readReadonlyMaterial({ runId: c.target.runId, backupId: c.material.proof.backupId, restoreOperationId: c.operationId }, deps);
  assertObservationGate(token); ensure(same(material, c.material)); c.finalReady = true;
}
export async function failObservation(token, code, deps = {}) {
  const c = owned(token, deps, true); const safe = new OpsError(code); invalidate(c, safe.code);
}
export function closeObservation(token) {
  const c = owners.get(token); if (!c || c.closed) return;
  c.closed = true; c.watchers.forEach(w => w.close()); c.controller.abort();
}
