import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalBytes as canonical, sha256 as hash } from './recovery-protocol.mjs';
import { canonicalBytes, parseStrictJson, validateInventory, validateHeader } from './local-media.mjs';

const java = readFileSync(new URL('../../services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java', import.meta.url), 'utf8');
const columns = Object.fromEntries([...java.matchAll(/Map.entry\("([^"]+)", List.of\((.*?)\)\)/g)]
  .map(([, name, values]) => [name, [...values.matchAll(/"([^"]+)"/g)].map(match => match[1])]));
const digest = value => hash(canonical(value));
function inventory(files = []) {
  const tables = Object.keys(columns).sort().map(tableName => {
    const schema = { columns: columns[tableName].map((name, i) => ({ ordinalPosition: String(i + 1), name,
      dataType: 'text', udtSchema: 'pg_catalog', udtName: 'text', isNullable: true,
      characterMaximumLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null,
      columnDefault: null, isIdentity: false, identityGeneration: null, isGenerated: false, generationExpression: null })),
    constraints: [], indexes: [] };
    return { tableName, schema, rows: [], schemaSha256: digest(schema), rowsSha256: digest([]),
      rowCount: '0', snapshotSha256: digest({ schema, rows: [] }) };
  });
  return { version: 1, files, tables, assets: [], variants: [],
    dbSnapshotSha256: digest(tables.map(({ tableName, schemaSha256, rowsSha256, rowCount }) =>
      ({ tableName, schemaSha256, rowsSha256, rowCount }))), mediaHeaderSha256: digest({ version: 1, files }) };
}
const file = (objectKey = 'orphan.bin', bytes = Buffer.from('orphan\n')) =>
  ({ objectKey, byteSize: String(bytes.length), sha256: hash(bytes), classification: 'orphan' });
const rejects = (action, code) => assert.throws(action, error => error.code === code && error.message === code);

test('H03a1_canonical_matches_A_codepoint_nullable_vector', () => {
  const value = { '\u{10000}': 'supplementary', '\ue000': null, '2': 'two', '10': 'ten',
    row: { secret_hash: null, value: '9007199254740993', bytea: '\\x00ff', newline: 'a\nb' } };
  assert.deepEqual(canonicalBytes(value), canonical(value));
});
test('H03a1_strict_rejects_duplicate_noncanonical_and_invalid_utf8', () => {
  for (const bytes of [Buffer.from('{"x":1,"x":1}\n'), Buffer.from('{ "x":1}\n'), Buffer.from([0x80])]) {
    rejects(() => parseStrictJson(bytes), 'INPUT_INVALID');
  }
});
test('H03a1_complete_inventory_accepts_all_twenty_tables_and_orphan', () => {
  const value = inventory([file()]);
  assert.equal(value.tables.length, 20);
  assert.deepEqual(validateInventory(value), { version: 1, files: value.files });
});
for (const [name, mutate, code] of [
  ['unknown_root', v => { v.secret = 'CANARY'; }, 'SCHEMA_UNSUPPORTED'],
  ['missing_table', v => { v.tables.pop(); }, 'SCHEMA_UNSUPPORTED'],
  ['unknown_column', v => { v.tables[0].schema.columns[0].name = 'extra'; }, 'SCHEMA_UNSUPPORTED'],
  ['unknown_nested', v => { v.tables[0].schema.columns[0].extra = true; }, 'SCHEMA_UNSUPPORTED'],
  ['schema_hash', v => { v.tables[0].schemaSha256 = '0'.repeat(64); }, 'BUNDLE_MISMATCH'],
  ['row_hash', v => { v.tables[0].rowsSha256 = '0'.repeat(64); }, 'BUNDLE_MISMATCH'],
  ['db_hash', v => { v.dbSnapshotSha256 = '0'.repeat(64); }, 'BUNDLE_MISMATCH'],
  ['header_hash', v => { v.mediaHeaderSha256 = '0'.repeat(64); }, 'BUNDLE_MISMATCH'],
  ['referenced_without_variant', v => { v.files[0].classification = 'referenced'; }, 'SCHEMA_UNSUPPORTED']
]) test(`H03a1_${name}`, () => { const v = inventory([file()]); mutate(v); rejects(() => validateInventory(v), code); });
test('H03a1_header_rejects_unsafe_duplicate_and_unknown', () => {
  for (const key of ['../escape', '/absolute', 'a//b', 'C:drive', 'a\\b', 'a\0b']) {
    rejects(() => validateHeader({ version: 1, files: [file(key)] }), 'UNSAFE_MEDIA_PATH');
  }
  rejects(() => validateHeader({ version: 1, files: [file(), file()] }), 'UNSAFE_MEDIA_PATH');
  rejects(() => validateHeader({ version: 1, files: [], extra: true }), 'SCHEMA_UNSUPPORTED');
});

function rehash(value) {
  for (const t of value.tables) Object.assign(t, { schemaSha256: digest(t.schema), rowsSha256: digest(t.rows),
    rowCount: String(t.rows.length), snapshotSha256: digest({ schema: t.schema, rows: t.rows }) });
  value.dbSnapshotSha256 = digest(value.tables.map(({ tableName, schemaSha256, rowsSha256, rowCount }) =>
    ({ tableName, schemaSha256, rowsSha256, rowCount })));
  value.mediaHeaderSha256 = digest({ version: 1, files: value.files });
  return value;
}
function deletedInventory(bytes = Buffer.from('%PDF-fixture')) {
  const original = { ...file('original.pdf', bytes), classification: 'referenced' };
  const v = inventory([original, file()]);
  const id = '10000000-0000-0000-0000-000000000001';
  v.assets = [{ id, contentType: 'application/pdf', byteSize: original.byteSize, storedBytes: original.byteSize,
    checksumSha256: original.sha256, width: null, height: null, status: 'deleted' }];
  v.variants = [{ mediaId: id, variant: 'original', contentType: 'application/pdf', byteSize: original.byteSize,
    width: null, height: null, objectKey: original.objectKey }];
  const row = table => Object.fromEntries(columns[table].map(name => [name, null]));
  v.tables.find(t => t.tableName === 'cms_media').rows = [{ ...row('cms_media'), id, content_type: 'application/pdf',
    byte_size: original.byteSize, stored_bytes: original.byteSize, checksum_sha256: original.sha256, status: 'deleted' }];
  v.tables.find(t => t.tableName === 'cms_media_variant').rows = [{ ...row('cms_media_variant'), media_id: id,
    variant: 'original', content_type: 'application/pdf', byte_size: original.byteSize, object_key: original.objectKey }];
  return rehash(v);
}
test('H03a1_deleted_original_and_orphan_bind_complete_raw_media_rows', () => {
  const value = deletedInventory();
  assert.equal(validateInventory(value).files.length, 2);
  value.assets[0].status = 'available';
  rejects(() => validateInventory(value), 'SCHEMA_UNSUPPORTED');
});
test('H03a1_self_consistent_hashes_do_not_hide_bad_schema_rows_or_media', () => {
  for (const mutate of [v => { v.tables[0].rows = [{ extra: null }]; },
    v => { v.tables[0].schema.constraints = [null]; }, v => { v.assets[0].width = 1; },
    v => { v.variants.push({ ...v.variants[0] }); }]) {
    const value = deletedInventory(); mutate(value); rehash(value);
    rejects(() => validateInventory(value), 'SCHEMA_UNSUPPORTED');
  }
});

import { mkdtemp, writeFile, readFile, mkdir, symlink, link, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { packMedia, run } from './local-media.mjs';
const MAGIC = Buffer.from('PP1CMEDIA1\n');
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'pp1c-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function sink() {
  const chunks = [];
  const stream = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  return { stream, bytes: () => Buffer.concat(chunks) };
}
async function pack(root, value, extra = {}) {
  const output = sink();
  await packMedia({ root, inventory: canonical(value), output: output.stream, ...extra });
  return output.bytes();
}
const rejectAsync = (action, code) => assert.rejects(action, error => error.code === code && error.message === code);
test('H03a2_pack_exact_frame_preserves_deleted_and_orphan_bytes', async t => {
  const root = await directory(t);
  const pdf = Buffer.from('%PDF-fixture');
  await writeFile(join(root, 'original.pdf'), pdf);
  await writeFile(join(root, 'orphan.bin'), 'orphan\n');
  const value = deletedInventory(pdf), bytes = await pack(root, value);
  const header = canonical({ version: 1, files: value.files });
  assert.deepEqual(bytes.subarray(0, MAGIC.length), MAGIC);
  assert.equal(bytes.readBigUInt64BE(MAGIC.length), BigInt(header.length));
  assert.deepEqual(bytes.subarray(MAGIC.length + 8), Buffer.concat([header, pdf, Buffer.from('orphan\n')]));
  assert.deepEqual(await readFile(join(root, 'original.pdf')), pdf);
});
test('H03a2_pack_missing_hash_and_unlisted_orphan_rejected', async t => {
  const root = await directory(t), value = inventory([file()]);
  await rejectAsync(() => pack(root, value), 'MISSING_MEDIA_OBJECT');
  await writeFile(join(root, 'orphan.bin'), 'CHANGED');
  await rejectAsync(() => pack(root, value), 'MEDIA_HASH_MISMATCH');
  await writeFile(join(root, 'orphan.bin'), 'orphan\n');
  await writeFile(join(root, 'unlisted'), 'preserve');
  await rejectAsync(() => pack(root, value), 'WRITER_NOT_QUIESCED');
  assert.equal(await readFile(join(root, 'unlisted'), 'utf8'), 'preserve');
});
test('H03a2_pack_link_and_invalid_raw_utf8_rejected', async t => {
  for (const kind of ['symbolic', 'hard', 'invalid']) {
    const root = await directory(t);
    await writeFile(join(root, 'orphan.bin'), 'orphan\n');
    if (kind === 'symbolic') await symlink('orphan.bin', join(root, 'link'));
    if (kind === 'hard') await link(join(root, 'orphan.bin'), join(root, 'link'));
    if (kind === 'invalid') await writeFile(Buffer.concat([Buffer.from(root + '/'), Buffer.from([0x80])]), 'raw');
    await rejectAsync(() => pack(root, inventory([file()])), 'UNSAFE_MEDIA_PATH');
    assert.equal(await readFile(join(root, 'orphan.bin'), 'utf8'), 'orphan\n');
  }
});
test('H03a2_pack_writer_and_output_failure_preserve_primary_safe_code', async t => {
  const root = await directory(t);
  await writeFile(join(root, 'orphan.bin'), 'orphan\n');
  await rejectAsync(() => pack(root, inventory([file()]), { afterRead: async () => {
    await writeFile(join(root, 'orphan.bin'), 'CHANGED');
  } }), 'WRITER_NOT_QUIESCED');
  await writeFile(join(root, 'orphan.bin'), 'orphan\n');
  const output = new Writable({ write(chunk, encoding, done) { done(new Error('CANARY-secret-path')); } });
  await rejectAsync(() => packMedia({ root, inventory: canonical(inventory([file()])), output }), 'CAPTURE_FAILED');
  assert.equal(await readFile(join(root, 'orphan.bin'), 'utf8'), 'orphan\n');
});
test('H03a2_exact_cli_safe_diagnostics_and_standalone_script', async t => {
  const root = await directory(t), stdout = sink(), stderr = sink();
  assert.equal(await run(['pack', 'extra'], { root, input: Readable.from([]), output: stdout.stream, error: stderr.stream }), 2);
  assert.equal(stdout.bytes().length, 0);
  assert.equal(stderr.bytes().toString(), 'INPUT_INVALID\n');
  await copyFile(new URL('./local-media.mjs', import.meta.url), join(root, 'only.mjs'));
  const child = spawnSync(process.execPath, [join(root, 'only.mjs'), 'wrong'],
    { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'INPUT_INVALID\n');
});
test('H03a2_backpressure_large_chunks_and_valid_replacement_character', async t => {
  const root = await directory(t), bytes = Buffer.alloc(200003);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const value = inventory([file('\uFFFD', bytes)]), chunks = [];
  await writeFile(join(root, '\uFFFD'), bytes);
  const output = new Writable({ highWaterMark: 1, write(chunk, encoding, done) {
    setImmediate(() => { chunks.push(Buffer.from(chunk)); done(); });
  } });
  await packMedia({ root, inventory: canonical(value), output });
  const framed = Buffer.concat(chunks), offset = MAGIC.length + 8 + Number(framed.readBigUInt64BE(MAGIC.length));
  assert.deepEqual(framed.subarray(offset), bytes);
});
test('H03a2_source_directory_drift_and_root_symlink_fail_closed', async t => {
  const root = await directory(t);
  await writeFile(join(root, 'orphan.bin'), 'orphan\n');
  await rejectAsync(() => pack(root, inventory([file()]), { afterRead: async () => {
    await writeFile(join(root, 'new-object'), 'preserved');
  } }), 'WRITER_NOT_QUIESCED');
  const parent = await directory(t);
  await symlink(root, join(parent, 'link'));
  await rejectAsync(() => pack(join(parent, 'link'), inventory([file()])), 'UNSAFE_MEDIA_PATH');
  assert.equal(await readFile(join(root, 'new-object'), 'utf8'), 'preserved');
});

import { chmod, lstat, readdir } from 'node:fs/promises';
import { restoreMedia } from './local-media.mjs';
function packageBytes(files, bodies, suffix = Buffer.alloc(0)) {
  const header = canonical({ version: 1, files }), length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(header.length));
  return Buffer.concat([MAGIC, length, header, ...bodies, suffix]);
}
async function restore(root, bytes, extra = {}) {
  return restoreMedia({ root, input: Readable.from([bytes]), ...extra });
}
test('H03b_roundtrip_nested_original_orphan_and_durable_modes', async t => {
  const source = await directory(t), target = await directory(t), bytes = Buffer.from('nested bytes');
  await mkdir(join(source, 'nested'));
  await writeFile(join(source, 'nested/file'), bytes);
  const files = [file('nested/file', bytes)], archive = await pack(source, inventory(files));
  let syncs = 0;
  const result = await restore(target, archive, { syncHandle: async handle => { syncs++; await handle.sync(); } });
  assert.deepEqual(result, { version: 1, operationId: null, fileCount: '1', fileBytes: String(bytes.length),
    mediaHeaderSha256: digest({ version: 1, files }) });
  assert.deepEqual(await readFile(join(target, 'nested/file')), bytes);
  assert.equal((await lstat(join(target, 'nested'))).mode & 0o777, 0o755);
  assert.equal((await lstat(join(target, 'nested/file'))).mode & 0o777, 0o644);
  assert.ok(syncs >= 4);
  assert.deepEqual(await readFile(join(source, 'nested/file')), bytes);
});
test('H03b_chunk_boundaries_and_exact_fixed_cli_receipt', async t => {
  const root = await directory(t), body = Buffer.from('orphan\n'), files = [file()];
  const bytes = packageBytes(files, [body]), stdout = sink(), stderr = sink();
  const input = Readable.from([...bytes].map(byte => Buffer.from([byte])));
  assert.equal(await run(['restore'], { root, input, output: stdout.stream, error: stderr.stream }), 0);
  assert.deepEqual(JSON.parse(stdout.bytes()), { version: 1, operationId: null, fileCount: '1', fileBytes: '7',
    mediaHeaderSha256: digest({ version: 1, files }) });
  assert.equal(stderr.bytes().length, 0);
});
test('H03b_nonblank_symlink_and_readonly_target_refuse_writes', async t => {
  const root = await directory(t), archive = packageBytes([file()], [Buffer.from('orphan\n')]);
  await writeFile(join(root, 'owned'), 'preserve');
  await rejectAsync(() => restore(root, archive), 'TARGET_NOT_BLANK');
  assert.equal(await readFile(join(root, 'owned'), 'utf8'), 'preserve');
  const parent = await directory(t);
  await symlink(root, join(parent, 'link'));
  await rejectAsync(() => restore(join(parent, 'link'), archive), 'UNSAFE_MEDIA_PATH');
  const readonly = await directory(t);
  await chmod(readonly, 0o500);
  try { await rejectAsync(() => restore(readonly, archive), 'ADAPTER_UNSEALED'); }
  finally { await chmod(readonly, 0o700); }
});
test('H03b_truncated_hash_trailing_and_input_error_never_succeed', async t => {
  const complete = packageBytes([file()], [Buffer.from('orphan\n')]);
  for (const bytes of [complete.subarray(0, 5), complete.subarray(0, complete.length - 1),
    packageBytes([file()], [Buffer.from('CHANGED')]), Buffer.concat([complete, Buffer.from('extra')])]) {
    await rejectAsync(async () => restore(await directory(t), bytes), 'RESTORE_FAILED');
  }
  const input = Readable.from((async function* () { yield complete; throw new Error('CANARY-input-secret'); })());
  await rejectAsync(async () => restoreMedia({ root: await directory(t), input }), 'RESTORE_FAILED');
});
test('H03b_duplicate_unsafe_oversized_header_and_conflicting_keys_rejected', async t => {
  for (const files of [[file(), file()], [file('../escape')], [file('a'), file('a/b')]]) {
    await assert.rejects(async () => restore(await directory(t), packageBytes(files, [])));
  }
  const huge = Buffer.alloc(8); huge.writeBigUInt64BE(64n * 1024n * 1024n + 1n);
  await rejectAsync(async () => restore(await directory(t), Buffer.concat([MAGIC, huge])), 'INPUT_INVALID');
});
test('H03b_fsync_failure_preserves_partial_file_and_primary_code', async t => {
  const root = await directory(t), archive = packageBytes([file()], [Buffer.from('orphan\n')]);
  await rejectAsync(() => restore(root, archive, { syncHandle: async () => { throw new Error('CANARY-sync-secret'); } }), 'RESTORE_FAILED');
  assert.equal(await readFile(join(root, 'orphan.bin'), 'utf8'), 'orphan\n');
  await rejectAsync(() => restore(root, archive), 'TARGET_NOT_BLANK');
});
test('H03b_restore_receipt_pipe_failure_is_sanitized', async t => {
  const root = await directory(t), stderr = sink();
  const output = new Writable({ write(chunk, encoding, done) { done(new Error('CANARY-output-secret')); } });
  const code = await run(['restore'], { root, input: Readable.from([packageBytes([], [])]), output, error: stderr.stream });
  assert.equal(code, 8);
  assert.equal(stderr.bytes().toString(), 'RESTORE_FAILED\n');
});

test('H03b_capacity_and_header_conflicts_fail_before_any_write', async t => {
  for (const files of [[{ ...file(), byteSize: '9007199254740993' }], [file('a'), file('a/b')]]) {
    const root = await directory(t);
    await assert.rejects(() => restore(root, packageBytes(files, [])));
    assert.deepEqual(await readdir(root), []);
  }
});
test('H03b_empty_file_and_empty_package_have_exact_counts', async t => {
  for (const files of [[], [file('empty', Buffer.alloc(0))]]) {
    const root = await directory(t), result = await restore(root, packageBytes(files, []));
    assert.equal(result.fileCount, String(files.length));
    assert.equal(result.fileBytes, '0');
    if (files.length) assert.equal((await readFile(join(root, 'empty'))).length, 0);
  }
});
test('H03b_mode_drift_after_creation_cannot_make_inventory_unreadable', async t => {
  for (const kind of ['file', 'directory']) {
    const root = await directory(t), rootInode = (await lstat(root)).ino;
    const bytes = Buffer.from('data'), archive = packageBytes([file('nested/object', bytes)], [bytes]);
    await rejectAsync(() => restore(root, archive, { syncHandle: async handle => {
      await handle.sync();
      const stat = await handle.stat();
      if (kind === 'file' && stat.isFile()) await handle.chmod(0o600);
      if (kind === 'directory' && stat.isDirectory() && stat.ino !== rootInode) await handle.chmod(0o700);
    } }), 'WRITER_NOT_QUIESCED');
  }
});
test('H03b_diagnostic_pipe_failure_preserves_primary_exit', async () => {
  const output = sink();
  const error = new Writable({ write(chunk, encoding, done) { done(new Error('CANARY-diagnostic-secret')); } });
  assert.equal(await run(['invalid'], { input: Readable.from([]), output: output.stream, error }), 2);
  assert.equal(output.bytes().length, 0);
});
