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
