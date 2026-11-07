import { OpsError, canonicalBytes, parseStrictJson, sha256, validateManifest, validateLocalComplete } from './recovery-protocol.mjs';
import { validateInventory, validateHeader } from './local-media.mjs';
import * as workflow from '../local/maintenance-workflow.mjs';
import * as helpers from '../local/maintenance-helper.mjs';
import { directory, syncDirectory, read } from '../local/maintenance-store.mjs';
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, statfs } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

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
    const startedAt = now(), quiescedAt = startedAt;
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
