import { OpsError, canonicalBytes, parseStrictJson, sha256, validateManifest, validateLocalComplete } from './recovery-protocol.mjs';
import { validateInventory, validateHeader } from './local-media.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
import * as helpers from '../local/maintenance-helper.mjs';
import { directory, syncDirectory, read } from '../local/maintenance-store.mjs';
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, statfs, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectTarget } from '../local/maintenance-target.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { createInflate } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ensure = (value, code = 'BUNDLE_MISMATCH') => { if (!value) throw new OpsError(code); };
const same = (a, b) => canonicalBytes(a).equals(canonicalBytes(b));
const digest = value => sha256(canonicalBytes(value));
const stable = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid', 'nlink'].every(k => a[k] === b[k]);
async function privateDirectory(path, exclusive = false) {
  try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (exclusive || e.code !== 'EEXIST') throw e; }
  return directory(path);
}
async function privateFile(path) {
  await directory(dirname(path));
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat({ bigint: true });
    ensure(s.isFile() && s.nlink === 1n && s.uid === BigInt(process.getuid()) && (s.mode & 0o7777n) === 0o600n);
    ensure(stable(s, await lstat(path, { bigint: true })));
    return { fd, before: s };
  } catch (e) { await fd.close(); throw e; }
}
async function checkIdentity(path, source) {
  ensure(stable(source.before, await source.fd.stat({ bigint: true }))
    && stable(source.before, await lstat(path, { bigint: true })), 'WRITER_NOT_QUIESCED');
}
async function freeBytes(path, deps) {
  const fs = await (deps.statfs ?? statfs)(path, { bigint: true });
  const available = BigInt(fs.bsize) * BigInt(fs.bavail), reserve = available / 10n > 536870912n ? available / 10n : 536870912n;
  ensure(available > reserve, 'CAPTURE_FAILED'); return available - reserve;
}
async function writePrivate(path, bytes) {
  const fd = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  await syncDirectory(dirname(path));
}
async function copyArtifact(result, path, context, deps) {
  const prefix = join(context.base, 'operations', context.operationId, 'helper') + '/';
  ensure(typeof result.path === 'string' && result.path.startsWith(prefix)
    && /^[1-9][0-9]*\/(?:output\/)?(?:inventory\.json|db\.dump|media\.package)$/.test(result.path.slice(prefix.length)));
  ensure(/^(0|[1-9][0-9]*)$/.test(result.byteSize) && /^[a-f0-9]{64}$/.test(result.sha256));
  ensure(BigInt(result.byteSize) <= await freeBytes(dirname(path), deps), 'CAPTURE_FAILED');
  const source = await privateFile(result.path); let output;
  try {
    ensure(source.before.size === BigInt(result.byteSize));
    output = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'); let size = 0n;
    for await (const chunk of source.fd.createReadStream({ autoClose: false })) {
      hash.update(chunk); size += BigInt(chunk.length); ensure(size <= BigInt(result.byteSize));
      await output.writeFile(chunk);
    }
    ensure(size === BigInt(result.byteSize) && hash.digest('hex') === result.sha256);
    await checkIdentity(result.path, source); await output.sync();
  } finally { await output?.close(); await source.fd.close(); }
  await syncDirectory(dirname(path));
  return { path: path.split('/').at(-1), byteSize: result.byteSize, sha256: result.sha256 };
}
async function verifyArtifact(path, expected) {
  const source = await privateFile(path);
  try {
    const hash = createHash('sha256'); let size = 0n;
    for await (const chunk of source.fd.createReadStream({ autoClose: false })) { size += BigInt(chunk.length); hash.update(chunk); }
    ensure(String(size) === expected.byteSize && hash.digest('hex') === expected.sha256);
    await checkIdentity(path, source);
  } finally { await source.fd.close(); }
}
async function readInventory(path) {
  const source = await privateFile(path);
  try {
    const bytes = await source.fd.readFile();
    await checkIdentity(path, source);
    const inventory = parseStrictJson(bytes); validateInventory(inventory); return inventory;
  } finally { await source.fd.close(); }
}
// PG16 custom 1.15 framing, from PostgreSQL's WriteHead/WriteToc/custom block format.
// This proves archive completeness, not that its SQL/data restores to the source snapshot.
async function verifyDump(path, inventory, profile) {
  const source = await privateFile(path); let position = 0n;
  try {
    const exact = async size => {
      ensure(Number.isSafeInteger(size) && size >= 0 && BigInt(size) <= source.before.size - position);
      const bytes = Buffer.alloc(size); let offset = 0;
      while (offset < size) { const { bytesRead } = await source.fd.read(bytes, offset, size - offset, null); ensure(bytesRead > 0); offset += bytesRead; }
      position += BigInt(size); return bytes;
    };
    const integer = async () => {
      const b = await exact(5); ensure(b[0] <= 1); const n = b.readUInt32LE(1);
      return b[0] ? -n : n;
    };
    const string = async () => {
      const size = await integer(); if (size === -1) return null;
      ensure(size >= 0 && size <= 67108864);
      return new TextDecoder('utf8', { fatal: true }).decode(await exact(size));
    };
    ensure((await exact(5)).equals(Buffer.from('PGDMP')));
    const version = await exact(7);
    ensure(version.subarray(0, 6).equals(Buffer.from([1, 15, 0, 4, 8, 1])) && [0, 1].includes(version[6]));
    for (let i = 0; i < 7; i++) await integer();
    ensure(await string() === 'cms');
    const server = await string(), dumper = await string();
    ensure(server === profile.postgresServerVersion && dumper === profile.pgDumpVersion);
    const count = await integer(); ensure(count > 0 && count <= 1000000);
    const entries = new Map(), data = new Map(), names = new Set();
    for (let i = 0; i < count; i++) {
      const id = await integer(), hasData = await integer();
      ensure(id > 0 && !entries.has(id) && [0, 1].includes(hasData)); entries.set(id, true);
      await string(); await string(); const name = await string(), description = await string(); await integer();
      await string(); await string(); await string(); const namespace = await string();
      for (let j = 0; j < 4; j++) await string();
      let dependency, dependencies = 0;
      while ((dependency = await string()) !== null) { ensure(/^[1-9][0-9]*$/.test(dependency) && ++dependencies <= count); }
      const state = (await exact(1))[0], offset = (await exact(8)).readBigUInt64LE();
      ensure([1, 2, 3].includes(state) && offset <= source.before.size);
      if (hasData) {
        ensure(description === 'TABLE DATA' && namespace === 'public' && !names.has(name)
          && inventory.tables.some(table => table.tableName === name) && state !== 3);
        names.add(name); data.set(id, { state, offset });
      } else ensure(state === 3);
    }
    ensure(names.size === inventory.tables.length);
    const seen = new Set();
    while (position < source.before.size) {
      const start = position; ensure((await exact(1))[0] === 1);
      const id = await integer(), entry = data.get(id); ensure(entry && !seen.has(id));
      ensure(entry.state !== 2 || entry.offset === start); seen.add(id);
      let compressedBytes = 0;
      async function* chunks() {
        let size;
        while ((size = await integer()) !== 0) {
          ensure(size > 0);
          while (size > 0) { const amount = Math.min(size, 65536); compressedBytes += amount; yield await exact(amount); size -= amount; }
        }
      }
      const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
      if (version[6] === 1) {
        const inflate = createInflate(); await pipeline(Readable.from(chunks()), inflate, sink);
        ensure(inflate.bytesWritten === compressedBytes);
      } else await pipeline(Readable.from(chunks()), sink);
    }
    ensure(seen.size === data.size); await checkIdentity(path, source);
  } catch { throw new OpsError('BUNDLE_MISMATCH'); }
  finally { await source.fd.close(); }
}
async function verifyPackage(path, inventory) {
  const source = await privateFile(path);
  try {
    const exact = async size => {
      const bytes = Buffer.alloc(size); let offset = 0;
      while (offset < size) { const { bytesRead } = await source.fd.read(bytes, offset, size - offset, null); ensure(bytesRead > 0); offset += bytesRead; }
      return bytes;
    };
    ensure((await exact(11)).equals(Buffer.from('PP1CMEDIA1\n')));
    const length = (await exact(8)).readBigUInt64BE(); ensure(length <= 67108864n);
    const header = parseStrictJson(await exact(Number(length))); validateHeader(header);
    ensure(same(header, { version: 1, files: inventory.files }));
    for (const file of header.files) {
      let remaining = BigInt(file.byteSize); const hash = createHash('sha256');
      while (remaining > 0n) { const size = Number(remaining > 65536n ? 65536n : remaining); hash.update(await exact(size)); remaining -= BigInt(size); }
      ensure(hash.digest('hex') === file.sha256);
    }
    ensure((await source.fd.read(Buffer.alloc(1), 0, 1, null)).bytesRead === 0);
    await checkIdentity(path, source);
  } finally { await source.fd.close(); }
}
function migrationRows(inventory) {
  return inventory.tables.find(t => t.tableName === 'flyway_schema_history').rows.map(row => ({
    installedRank: row.installed_rank, version: row.version, description: row.description, type: row.type,
    script: row.script, checksum: row.checksum, success: row.success === 'true'
  })).sort((a, b) => BigInt(a.installedRank) < BigInt(b.installedRank) ? -1 : 1);
}
function manifestFor(context, backupId, inventory, profile, artifacts, releaseArtifacts, times) {
  const target = context.target, id = target.runId;
  ensure(releaseArtifacts.sourceCommit === target.sourceCommit, 'SOURCE_CHANGED');
  const config = { apiOrigin: releaseArtifacts.apiOrigin, ingressScriptSha256: releaseArtifacts.ingressScriptSha256,
    nodeBinarySha256: releaseArtifacts.nodeBinarySha256, dist: releaseArtifacts.dist };
  const counts = { assetCount: String(inventory.assets.length), referencedFileCount: String(inventory.files.filter(f => f.classification === 'referenced').length),
    orphanFileCount: String(inventory.files.filter(f => f.classification === 'orphan').length), fileCount: String(inventory.files.length),
    fileBytes: String(inventory.files.reduce((n, f) => n + BigInt(f.byteSize), 0n)) };
  return validateManifest({ manifestVersion: 1, backupId, instanceId: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    release: { sourceCommit: target.sourceCommit, apiImageDigest: target.images.api, postgresImageDigest: target.images.postgres,
      javaRuntimeVersion: profile.javaRuntimeVersion, postgresServerVersion: profile.postgresServerVersion,
      frontend: Object.fromEntries(['front', 'back', 'admin'].map(surface => [surface, {
        artifactSha256: digest(releaseArtifacts.dist[surface]), apiBaseConfigSha256: digest({ apiOrigin: releaseArtifacts.apiOrigin }) }])), configSha256: digest(config) },
    migration: migrationRows(inventory), scope: { dbSchema: 'public', tableNames: inventory.tables.map(t => t.tableName),
      dbRoleRef: 'cms-local-role', secretRefs: ['source-database-secret'] }, times,
    toolchain: { inventorySourceCommit: target.sourceCommit, inventoryJavaVersion: profile.javaRuntimeVersion,
      pgDumpVersion: profile.pgDumpVersion, pgRestoreVersion: profile.pgRestoreVersion,
      mediaPackageAdapterId: 'pp1c-node-framed-media', mediaPackageAdapterVersion: '1' }, artifacts,
    inventory: { sha256: artifacts[1].sha256, dbSnapshotSha256: inventory.dbSnapshotSha256, ...counts },
    source: { projectRef: target.project, dbVolumeRef: target.volumeNames['db-data'], mediaVolumeRef: target.volumeNames['media-data'],
      writerSetSha256: digest({ source: target, apiState: 'stopped', backends: [] }) } });
}

// Internal orchestration API. The capability supplies every source/path/policy; callers cannot select an archive destination.
export async function captureSource(token, deps = {}) {
  const wf = deps.workflow ?? workflow, helper = deps.runOwnedHelper ?? helpers.runOwnedHelper;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  let context, path, phase = 'LOCAL_CAPTURED';
  try {
    context = await wf.assertWorkflow(token, { side: 'source', stage: 'SOURCE_QUIESCED' }, deps);
    ensure(['BACKUP_LOCAL', 'RESTORE_VERIFY_LOCAL'].includes(context.lease.purpose), 'ADAPTER_UNSEALED');
    ensure(typeof helper === 'function', 'ADAPTER_UNSEALED');
    const startedAt = context.request.startedAt, quiescedAt = now();
    ensure(new Date(startedAt).toISOString() === startedAt && startedAt <= quiescedAt, 'INPUT_INVALID');
    await wf.beginPhase(token, phase, {}, deps);
    const parent = join(context.root, 'bundles'); await privateDirectory(parent);
    const backupId = `pp1-${startedAt.replaceAll(/[-:.]/g, '')}-${randomBytes(16).toString('hex')}`;
    path = join(parent, backupId); await privateDirectory(path, true); await syncDirectory(parent); await freeBytes(path, deps);
    const invoke = async kind => { await wf.assertWorkflow(token, { side: 'source', stage: phase }, deps);
      const result = await helper(token, { side: 'source', kind }, deps);
      ensure(result.kind === kind); await wf.assertWorkflow(token, { side: 'source', stage: phase }, deps); return result; };
    const before = await invoke('INVENTORY'); validateInventory(before.inventory);
    ensure(before.inventorySha256 === digest(before.inventory) && before.sha256 === before.inventorySha256);
    const savedInventory = await copyArtifact(before, join(path, 'inventory.json'), context, deps);
    const dump = await invoke('PG_DUMP'); ensure(BigInt(dump.byteSize) > 0n);
    const savedDump = await copyArtifact(dump, join(path, 'db.dump'), context, deps);
    const media = await invoke('MEDIA_PACK'), savedMedia = await copyArtifact(media, join(path, 'media.package'), context, deps);
    const after = await invoke('INVENTORY'); validateInventory(after.inventory);
    ensure(same(before.inventory, after.inventory) && before.inventorySha256 === after.inventorySha256, 'WRITER_NOT_QUIESCED');
    ensure(same(before.profile, after.profile), 'SOURCE_CHANGED');
    const capturedAt = now(); await wf.endPhase(token, {}, deps);
    phase = 'LOCAL_VERIFIED'; await wf.beginPhase(token, phase, {}, deps);
    const artifacts = [savedDump, savedInventory, savedMedia];
    for (const item of artifacts) await verifyArtifact(join(path, item.path), item);
    const saved = await readInventory(join(path, 'inventory.json')); ensure(same(saved, before.inventory));
    await verifyDump(join(path, 'db.dump'), saved, before.profile);
    await verifyPackage(join(path, 'media.package'), saved);
    const releaseArtifacts = await read(join(context.root, 'artifacts.json'));
    await wf.assertWorkflow(token, { side: 'source', stage: phase }, deps);
    const manifest = manifestFor(context, backupId, saved, before.profile, artifacts, releaseArtifacts,
      { startedAt, quiescedAt, capturedAt, verifiedLocalAt: now() });
    await writePrivate(join(path, 'manifest.json'), canonicalBytes(manifest));
    const complete = validateLocalComplete({ version: 1, backupId, manifestSha256: digest(manifest), verifiedLocalAt: manifest.times.verifiedLocalAt }, manifest);
    await wf.endPhase(token, {}, deps);
    await writePrivate(join(path, '.local-complete.pending'), canonicalBytes(complete));
    await rename(join(path, '.local-complete.pending'), join(path, 'local-complete.json')); await syncDirectory(path);
    return Object.freeze({ path, backupId, manifest, complete, inventory: saved });
  } catch (error) {
    const failure = error instanceof OpsError ? error : new OpsError('CAPTURE_FAILED', phase, context?.operationId);
    if (path) try { await writePrivate(join(path, 'failure.json'), canonicalBytes({ code: failure.code, phase, operationId: context?.operationId ?? null })); } catch { /* Keep partial artifacts and primary failure. */ }
    try { await wf.failWorkflow(token, failure.code, deps); } catch { /* Never discard a retained lock after persistence failure. */ }
    throw failure;
  }
}
export async function captureLocal(inspection, request, deps = {}) {
  const wf = deps.workflow ?? workflow, token = await wf.beginWorkflow(inspection, request, deps);
  try {
    await wf.beginPhase(token, 'SOURCE_QUIESCED', {}, deps); await wf.endPhase(token, {}, deps);
    const result = await captureSource(token, deps);
    await wf.finishWorkflow(token, { success: true }, deps); return result;
  } catch (error) {
    try { await wf.failWorkflow(token, error instanceof OpsError ? error.code : 'CAPTURE_FAILED', deps); } catch { /* Retain original failure. */ }
    throw error;
  }
}

// Fixed host CLI. Dependency overrides are internal test seams, never argv options.
export function parseArgs(argv) {
  ensure(Array.isArray(argv) && argv.length === 4 && argv.every(v => typeof v === 'string'), 'INPUT_INVALID');
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    ensure(['--run-id', '--operation-id'].includes(argv[i]) && !values.has(argv[i]), 'INPUT_INVALID');
    values.set(argv[i], argv[i + 1]);
  }
  const runId = values.get('--run-id'), operationId = values.get('--operation-id');
  ensure(/^[a-f0-9]{32}$/.test(runId) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operationId), 'INPUT_INVALID');
  return Object.freeze({ runId, operationId });
}
export async function run(argv, deps = {}) {
  let operationId = null, backupId = null, phase = null, code = null, exitCode = 0;
  try {
    const options = parseArgs(argv); operationId = options.operationId;
    const component = fileURLToPath(new URL('../../', import.meta.url)), cwd = resolve(deps.cwd ?? process.cwd());
    ensure(deps.cwd !== undefined || cwd === resolve(component), 'INPUT_INVALID');
    ensure(process.versions.node.split('.')[0] === '24', 'ADAPTER_UNSEALED');
    const root = join(cwd, 'local', 'pp1', options.runId), inspect = deps.inspectTarget ?? inspectTarget;
    let inspection;
    for (const apiState of ['running', 'stopped']) {
      try {
        const candidate = await inspect(root, deps, { apiState });
        ensure(candidate.target.runId === options.runId && candidate.target.targetId === `pp1-local:${options.runId}`, 'TARGET_NOT_OWNED');
        inspection = candidate; break;
      } catch { /* Only a complete strict inspection can establish original state. */ }
    }
    ensure(inspection, 'TARGET_NOT_OWNED');
    ensure(sha256(await readFile(process.execPath)) === inspection.target.nodeBinarySha256, 'ADAPTER_UNSEALED');
    const result = await (deps.captureLocal ?? captureLocal)(inspection, {
      operationId, purpose: 'BACKUP_LOCAL', completionPolicy: 'RESTORE_ORIGINAL', targetRunId: null, incidentStartedAt: null
    }, deps);
    ensure(typeof result?.backupId === 'string' && /^pp1-\d{8}T\d{9}Z-[a-f0-9]{32}$/.test(result.backupId), 'CAPTURE_FAILED');
    backupId = result.backupId; phase = 'COMPLETE';
  } catch (error) {
    let failure = new OpsError('CAPTURE_FAILED');
    if (error instanceof OpsError) {
      try { failure = new OpsError(error.code, error.phase); } catch { /* Do not emit unrecognized mutable error fields. */ }
    }
    code = failure.code; phase = failure.phase; exitCode = failure.exitCode;
  }
  try { (deps.stdout ?? process.stdout).write(canonicalBytes({ operationId, backupId, phase, code, exitCode })); }
  catch { return 5; }
  return exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.on('error', () => { process.exitCode = 5; });
  process.exitCode = await run(process.argv.slice(2));
}
