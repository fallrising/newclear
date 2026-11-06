import assert from 'node:assert/strict';
// Shared synthetic Node test fixture; production modules never import this file.
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, link } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { canonicalBytes, sha256, OpsError } from './recovery-protocol.mjs';
const digest = value => sha256(canonicalBytes(value));
const java = readFileSync(new URL('../../services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java', import.meta.url), 'utf8');
const columns = Object.fromEntries([...java.matchAll(/Map.entry\("([^"]+)", List.of\((.*?)\)\)/g)]
  .map(([, name, values]) => [name, [...values.matchAll(/"([^"]+)"/g)].map(m => m[1])]));
function inventory() {
  const tables = Object.keys(columns).sort().map(tableName => {
    const schema = { columns: columns[tableName].map((name, i) => ({ ordinalPosition: String(i + 1), name,
      dataType: 'text', udtSchema: 'pg_catalog', udtName: 'text', isNullable: true,
      characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null,
      columnDefault: null, isIdentity: false, identityGeneration: null, isGenerated: false, generationExpression: null })), constraints: [], indexes: [] };
    const rows = tableName === 'flyway_schema_history' ? [{ installed_rank: '1', version: '2', description: 'Identity',
      type: 'SQL', script: 'V2__identity.sql', checksum: null, installed_by: 'cms_local', installed_on: '2026-11-01 00:00:00',
      execution_time: '1', success: 'true' }] : [];
    return { tableName, schema, rows, schemaSha256: digest(schema), rowsSha256: digest(rows),
      rowCount: String(rows.length), snapshotSha256: digest({ schema, rows }) };
  });
  return { version: 1, files: [], tables, assets: [], variants: [],
    dbSnapshotSha256: digest(tables.map(({ tableName, schemaSha256, rowsSha256, rowCount }) =>
      ({ tableName, schemaSha256, rowsSha256, rowCount }))), mediaHeaderSha256: digest({ version: 1, files: [] }) };
}
const full = c => c.repeat(64), op = '11111111-1111-4111-8111-111111111111';
function archive() {
  const integer = n => { const b = Buffer.alloc(5); b[0] = n < 0 ? 1 : 0; b.writeUInt32LE(Math.abs(n), 1); return b; };
  const string = s => s === null ? integer(-1) : Buffer.concat([integer(Buffer.byteLength(s)), Buffer.from(s)]);
  const names = Object.keys(columns).sort(), chunks = [Buffer.from('PGDMP'), Buffer.from([1, 15, 0, 4, 8, 1, 1]),
    ...[0, 0, 0, 2, 10, 126, 0].map(integer), ...['cms', '16.15', '16.15'].map(string), integer(names.length)];
  names.forEach((name, i) => chunks.push(integer(i + 1), integer(1), string('0'), string('0'), string(name), string('TABLE DATA'),
    integer(2), ...['', '', `COPY public.${name} FROM stdin;`, 'public', '', '', 'cms_local', 'false'].map(string), string(null), Buffer.from([1]), Buffer.alloc(8)));
  for (let i = 0; i < names.length; i++) {
    const data = deflateSync(Buffer.from('\\.\n'));
    chunks.push(Buffer.from([1]), integer(i + 1), integer(data.length), data, integer(0));
  }
  return Buffer.concat(chunks);
}
export async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'cms-bundle-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, 'run'), base = join(root, 'maintenance');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const target = { runId: 'a'.repeat(32), targetId: `pp1-local:${'a'.repeat(32)}`, project: `cms-pp1-local-${'a'.repeat(32)}`,
    sourceCommit: 'b'.repeat(40), images: { api: `sha256:${full('c')}`, postgres: `sha256:${full('d')}` },
    volumeNames: { 'db-data': 'db-source', 'media-data': 'media-source' } };
  target.apiBuild={sourceCommit:target.sourceCommit,jarSha256:full('9'),baseImage:`sha256:${full('8')}`};
  const artifacts = { version:1,worktreeDirty:true,apiBuild:target.apiBuild,apiOrigin: 'https://api.cms.test:8443', sourceCommit: target.sourceCommit,
    ingressScriptSha256: full('e'), nodeBinarySha256: full('f'),
    dist: Object.fromEntries(['front', 'back', 'admin'].map(s => [s, { 'index.html': full('a') }])) };
  await writeFile(join(root, 'artifacts.json'), JSON.stringify(artifacts), { mode: 0o600 });
  const profile = { javaRuntimeVersion: '25.0.5+8', pgDumpVersion: '16.15', pgRestoreVersion: '16.15', postgresServerVersion: '16.15' };
  const ctx = { root, base, target, operationId: op,
    request: { startedAt: '2026-11-02T11:59:00.000Z' },
    lease: { source: target, operationId: op, purpose: 'BACKUP_LOCAL', phase: 'SOURCE_QUIESCED' } };
  const token = Object.freeze({}), calls = [], state = { checks: 0, helpers: 0, inventoryCount: 0, fail: null };
  const workflow = {
    beginWorkflow: async () => { calls.push('begin'); return token; },
    assertWorkflow: async value => { assert.equal(value, token); state.checks++; if (state.writer) throw new OpsError('WRITER_NOT_QUIESCED'); return structuredClone(ctx); },
    beginPhase: async (_t, phase) => { calls.push(`begin:${phase}`); ctx.lease.phase = phase; },
    endPhase: async () => { calls.push(`end:${ctx.lease.phase}`); },
    failWorkflow: async (_t, code) => { calls.push(`fail:${code}`); state.fail = code; },
    finishWorkflow: async () => { calls.push('finish'); }
  };
  const helper = async (_t, { side, kind }) => {
    assert.equal(side, 'source'); calls.push(kind); state.helpers++;
    const dir = join(base, 'operations', op, 'helper', String(state.helpers));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (state.failureKind === kind) { await writeFile(join(dir, 'partial'), 'CANARY', { mode: 0o600 }); throw new OpsError('CAPTURE_FAILED'); }
    let bytes, name, value;
    if (kind === 'INVENTORY') {
      state.inventoryCount++; value = inventory();
      if (state.change && state.inventoryCount === 2) value.tables.find(t => t.tableName === 'flyway_schema_history').rows[0].installed_on = '2026-11-02 00:00:00';
      if (state.large) value.tables[0].rows.push({ ...Object.fromEntries(columns[value.tables[0].tableName].map(c => [c, null])), detail_json: 'x'.repeat(1100000) });
      for (const table of value.tables) Object.assign(table, { rowsSha256: digest(table.rows), rowCount: String(table.rows.length), snapshotSha256: digest({ schema: table.schema, rows: table.rows }) });
      value.dbSnapshotSha256 = digest(value.tables.map(({ tableName, schemaSha256, rowsSha256, rowCount }) => ({ tableName, schemaSha256, rowsSha256, rowCount })));
      bytes = canonicalBytes(value); name = 'inventory.json';
    } else if (kind === 'PG_DUMP') {
      bytes = state.dumpBytes ?? archive(); name = 'db.dump'; if (state.truncatedDump) bytes = bytes.subarray(0, bytes.length - 1);
      if (state.dumpMutation) bytes = state.dumpMutation(bytes);
    }
    else {
      const header = canonicalBytes({ version: 1, files: [] }), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(header.length));
      bytes = Buffer.concat([Buffer.from('PP1CMEDIA1\n'), length, header]); name = 'media.package';
      if (state.trailingMedia) bytes = Buffer.concat([bytes, Buffer.from('extra')]);
    }
    const path = join(dir, name); await writeFile(path, bytes, { mode: 0o600 });
    if (state.linkKind === kind) { await link(path, `${path}.hardlink`); }
    const result = { kind, path, byteSize: String(bytes.length), sha256: sha256(bytes) };
    if (kind === 'INVENTORY') Object.assign(result, { inventory: value, inventorySha256: sha256(bytes), profile });
    if (state.wrongHash === kind) result.sha256 = full('0');
    if (state.writerAfter === kind) state.writer = true;
    return result;
  };
  return { cwd, root, base, token, calls, state, ctx, deps: { workflow, runOwnedHelper: helper, helperProfile:async()=>profile, now: () => new Date('2026-11-02T12:00:00.000Z') } };
}

export { inventory, digest, columns, archive, op, full };
