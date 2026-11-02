// Mounted alone at /tool/local-media.mjs; only Node built-in imports are allowed.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, mkdir, statfs } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { constants as bufferLimits } from 'node:buffer';

export class MediaError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new MediaError(code); };
const ensure = (condition, code = 'SCHEMA_UNSUPPORTED') => { if (!condition) fail(code); };
const text = value => typeof value === 'string';
const decimal = value => text(value) && /^(0|[1-9][0-9]*)$/.test(value);
const hash = value => text(value) && /^[a-f0-9]{64}$/.test(value);
const uuid = value => text(value) && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const dimension = value => value === null || Number.isInteger(value) && value > 0 && value <= 2147483647;
const nullable = (value, predicate = text) => value === null || predicate(value);
const sameBytes = (a, b) => canonicalBytes(a).equals(canonicalBytes(b));
const COLUMNS = {
  cms_principal: 'id username display_name email status failed_login_count locked_until last_login_at created_at updated_at deleted_at'.split(' '),
  cms_credential: 'id principal_id type secret_hash algo rotated_at'.split(' '),
  cms_role: 'id code display_name system created_at'.split(' '),
  cms_principal_role: 'principal_id role_id content_type_codes'.split(' '),
  cms_permission: 'id role_id action content_type_code predicate_json allowed_surfaces created_at'.split(' '),
  cms_session: 'id principal_id token_hash created_at expires_at last_seen_at revoked_at created_surface ip user_agent'.split(' '),
  cms_audit_event: 'id at actor_principal_id category action target_type target_id surface outcome ip detail_json'.split(' '),
  cms_content_type: 'id type_key display_name plural_display_name description title_field slug_policy singleton enabled previewable public_requires_published_refs created_at updated_at sort_field visibility_field owner_field'.split(' '),
  cms_field: 'id content_type_id field_key field_type required unique_in_type indexed visibility sort_order default_value validations ref_target_type_key on_delete enum_values help_text enabled public_bytes label group_key listable filterable enum_labels placeholder'.split(' '),
  cms_entry: 'id content_type_id slug publication_state version payload published_payload published_at archived_at deleted_at created_by updated_by created_at updated_at publish_requested_at publish_requested_by'.split(' '),
  cms_entry_revision: 'id entry_id revision_no slug payload published_at published_by content_type_key'.split(' '),
  cms_entry_ref: 'from_entry_id field_key to_id to_kind sort_position'.split(' '),
  cms_entry_index: 'entry_id field_key value_kind value_string value_int value_bool value_ts scope'.split(' '),
  cms_navigation_menu: 'id menu_key surface publication_state version document published_document updated_by updated_at'.split(' '),
  cms_media: 'id owner_principal_id title alt_text original_filename content_type byte_size stored_bytes width height checksum_sha256 status deleted_at created_at updated_at'.split(' '),
  cms_media_variant: 'media_id variant content_type byte_size width height object_key'.split(' '),
  cms_media_attachment: 'media_id entry_id field_key attached_at'.split(' '),
  cms_media_settings: 'id max_file_bytes max_library_bytes max_files max_files_per_principal updated_at'.split(' '),
  cms_audit_settings: 'id retention_days updated_at updated_by'.split(' '),
  flyway_schema_history: 'installed_rank version description type script checksum installed_by installed_on execution_time success'.split(' '),
};
const codepointCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

// Build JSON directly: JSON.stringify(object) reorders integer-like keys by UTF-16/array-index rules.
export function canonicalBytes(value) {
  const ancestors = new Set();
  function encode(current) {
    if (current === null) return 'null';
    if (typeof current === 'string') {
      if (!current.isWellFormed()) fail('INPUT_INVALID');
      return JSON.stringify(current);
    }
    if (typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== 'object' || ancestors.has(current)) fail('INPUT_INVALID');
    ancestors.add(current);
    let result;
    if (Array.isArray(current)) {
      if (Object.keys(current).length !== current.length) fail('INPUT_INVALID');
      result = `[${Array.from(current, encode).join(',')}]`;
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(current))
          || Object.getOwnPropertySymbols(current).length) fail('INPUT_INVALID');
      const keys = Object.getOwnPropertyNames(current);
      if (keys.some(key => !key.isWellFormed()
          || !Object.getOwnPropertyDescriptor(current, key).enumerable
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(current, key), 'value'))) fail('INPUT_INVALID');
      result = `{${keys.sort(codepointCompare).map(key => `${encode(key)}:${encode(current[key])}`).join(',')}}`;
    }
    ancestors.delete(current);
    return result;
  }
  try { return Buffer.from(`${encode(value)}\n`, 'utf8'); }
  catch { fail('INPUT_INVALID'); }
}

export function parseStrictJson(bytes) {
  try {
    if (!(bytes instanceof Uint8Array)) fail('INPUT_INVALID');
    const raw = Buffer.from(bytes);
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    const value = JSON.parse(decoded);
    if (!canonicalBytes(value).equals(raw)) fail('INPUT_INVALID');
    return value;
  } catch { fail('INPUT_INVALID'); }
}

export function sha256(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('INPUT_INVALID');
  return createHash('sha256').update(bytes).digest('hex');
}

function exact(value, fields) {
  const keys = typeof fields === 'string' ? fields.split(' ') : fields;
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function ordered(values, key, strict = true) {
  ensure(Array.isArray(values));
  ensure(values.every((v, i) => i === 0 || (strict
    ? codepointCompare(key(values[i - 1]), key(v)) < 0 : codepointCompare(key(values[i - 1]), key(v)) <= 0)));
}
function objectKey(key) {
  ensure(text(key) && key.isWellFormed() && Buffer.byteLength(key) >= 1 && Buffer.byteLength(key) <= 4096
    && !key.includes('\\') && !key.includes('\0') && !/^[A-Za-z]:/.test(key)
    && key.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'UNSAFE_MEDIA_PATH');
}
export function validateHeader(header) {
  exact(header, 'version files');
  ensure(header.version === 1 && Array.isArray(header.files) && header.files.length <= 1_000_000);
  let prior;
  for (const file of header.files) {
    exact(file, 'objectKey byteSize sha256 classification');
    objectKey(file.objectKey);
    ensure(prior === undefined || codepointCompare(prior, file.objectKey) < 0, 'UNSAFE_MEDIA_PATH');
    prior = file.objectKey;
    ensure(decimal(file.byteSize) && hash(file.sha256) && ['referenced', 'orphan'].includes(file.classification));
  }
  ensure(canonicalBytes(header).length <= 64 * 1024 * 1024, 'INPUT_INVALID');
  return header;
}
function validateSchema(schema, allowed) {
  exact(schema, 'columns constraints indexes');
  ensure(Array.isArray(schema.columns) && schema.columns.length === allowed.length);
  const names = new Set();
  let ordinal = 0n;
  for (const c of schema.columns) {
    exact(c, 'ordinalPosition name dataType udtSchema udtName isNullable characterMaximumLength numericPrecision numericScale datetimePrecision columnDefault isIdentity identityGeneration isGenerated generationExpression');
    ensure(decimal(c.ordinalPosition) && BigInt(c.ordinalPosition) > ordinal);
    ordinal = BigInt(c.ordinalPosition);
    ensure(allowed.includes(c.name) && !names.has(c.name));
    names.add(c.name);
    ensure(['dataType', 'udtSchema', 'udtName'].every(k => text(c[k]) && c[k].length > 0));
    ensure(['isNullable', 'isIdentity', 'isGenerated'].every(k => typeof c[k] === 'boolean'));
    ensure(['characterMaximumLength', 'numericPrecision', 'datetimePrecision'].every(k => nullable(c[k], decimal)));
    ensure(nullable(c.numericScale, v => text(v) && /^(0|-?[1-9][0-9]*)$/.test(v)));
    ensure(nullable(c.columnDefault) && nullable(c.generationExpression)
      && (c.isIdentity ? ['ALWAYS', 'BY DEFAULT'].includes(c.identityGeneration) : c.identityGeneration === null));
  }
  for (const [kind, fields, flags] of [
    ['constraints', 'name type definition deferrable initiallyDeferred validated', ['deferrable', 'initiallyDeferred', 'validated']],
    ['indexes', 'name definition unique primary valid ready', ['unique', 'primary', 'valid', 'ready']]
  ]) {
    ordered(schema[kind], v => v.name);
    for (const item of schema[kind]) {
      exact(item, fields);
      ensure(text(item.name) && item.name.length > 0 && text(item.definition) && item.definition.length > 0
        && flags.every(k => typeof item[k] === 'boolean'));
      if (kind === 'constraints') ensure(['PRIMARY_KEY', 'UNIQUE', 'FOREIGN_KEY', 'CHECK'].includes(item.type));
    }
  }
}
function validateTables(tables) {
  const names = Object.keys(COLUMNS).sort(codepointCompare);
  ensure(Array.isArray(tables) && tables.length === names.length);
  tables.forEach((table, index) => {
    exact(table, 'tableName schema rows schemaSha256 rowsSha256 rowCount snapshotSha256');
    ensure(table.tableName === names[index]);
    validateSchema(table.schema, COLUMNS[table.tableName]);
    ensure(Array.isArray(table.rows));
    for (const row of table.rows) {
      exact(row, COLUMNS[table.tableName]);
      ensure(Object.values(row).every(value => nullable(value)));
    }
    ordered(table.rows, row => canonicalBytes(row).toString(), false);
    ensure(table.rowCount === String(table.rows.length), 'BUNDLE_MISMATCH');
    for (const [field, value] of [['schemaSha256', table.schema], ['rowsSha256', table.rows],
      ['snapshotSha256', { schema: table.schema, rows: table.rows }]]) {
      ensure(hash(table[field]) && table[field] === sha256(canonicalBytes(value)), 'BUNDLE_MISMATCH');
    }
  });
}
function validateMedia(value) {
  ordered(value.assets, asset => asset.id);
  ordered(value.variants, variant => `${variant.mediaId}/${variant.variant}`);
  const types = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  const assets = new Map();
  const files = new Map(value.files.map(file => [file.objectKey, file]));
  const referenced = new Set();
  for (const asset of value.assets) {
    exact(asset, 'id contentType byteSize storedBytes checksumSha256 width height status');
    ensure(uuid(asset.id) && types.includes(asset.contentType) && decimal(asset.byteSize) && decimal(asset.storedBytes)
      && hash(asset.checksumSha256) && dimension(asset.width) && dimension(asset.height)
      && ['available', 'deleted'].includes(asset.status));
    assets.set(asset.id, []);
  }
  for (const variant of value.variants) {
    exact(variant, 'mediaId variant contentType byteSize width height objectKey');
    objectKey(variant.objectKey);
    ensure(assets.has(variant.mediaId) && ['original', 'thumbnail', 'web'].includes(variant.variant)
      && types.includes(variant.contentType) && decimal(variant.byteSize) && dimension(variant.width) && dimension(variant.height)
      && !referenced.has(variant.objectKey) && files.get(variant.objectKey)?.byteSize === variant.byteSize);
    referenced.add(variant.objectKey);
    assets.get(variant.mediaId).push(variant);
  }
  for (const asset of value.assets) {
    const variants = assets.get(asset.id);
    const original = variants.find(v => v.variant === 'original');
    ensure(original && original.contentType === asset.contentType && original.byteSize === asset.byteSize
      && original.width === asset.width && original.height === asset.height
      && files.get(original.objectKey).sha256 === asset.checksumSha256);
    ensure(variants.reduce((sum, v) => sum + BigInt(v.byteSize), 0n) === BigInt(asset.storedBytes));
    if (asset.contentType === 'application/pdf' || asset.width === null || asset.height === null) {
      ensure(asset.width === null && asset.height === null && variants.length === 1);
    } else {
      ensure(variants.map(v => v.variant).join(',') === 'original,thumbnail,web');
      for (const [name, edge] of [['thumbnail', 320], ['web', 1600]]) {
        const v = variants.find(v => v.variant === name);
        const scale = Math.min(1, edge / Math.max(asset.width, asset.height));
        ensure(v.contentType === 'image/jpeg' && v.width === Math.max(1, Math.round(asset.width * scale))
          && v.height === Math.max(1, Math.round(asset.height * scale)));
      }
    }
  }
  ensure(value.files.every(file => file.classification === (referenced.has(file.objectKey) ? 'referenced' : 'orphan')));
  for (const [table, items, mapping] of [
    ['cms_media', value.assets, { id: 'id', contentType: 'content_type', byteSize: 'byte_size', storedBytes: 'stored_bytes',
      checksumSha256: 'checksum_sha256', width: 'width', height: 'height', status: 'status' }],
    ['cms_media_variant', value.variants, { mediaId: 'media_id', variant: 'variant', contentType: 'content_type',
      byteSize: 'byte_size', width: 'width', height: 'height', objectKey: 'object_key' }]
  ]) {
    const rows = value.tables.find(t => t.tableName === table).rows;
    const projected = rows.map(row => Object.fromEntries(Object.entries(mapping).map(([key, column]) =>
      [key, (key === 'width' || key === 'height') && row[column] !== null ? Number(row[column]) : row[column]])));
    projected.sort((a, b) => codepointCompare(a.id ?? `${a.mediaId}/${a.variant}`, b.id ?? `${b.mediaId}/${b.variant}`));
    ensure(sameBytes(items, projected));
  }
}
function checkInventory(value) {
  canonicalBytes(value);
  exact(value, 'version files tables assets variants dbSnapshotSha256 mediaHeaderSha256');
  ensure(value.version === 1);
  const header = validateHeader({ version: 1, files: value.files });
  validateTables(value.tables);
  validateMedia(value);
  const summary = value.tables.map(({ tableName, schemaSha256, rowsSha256, rowCount }) =>
    ({ tableName, schemaSha256, rowsSha256, rowCount }));
  ensure(value.dbSnapshotSha256 === sha256(canonicalBytes(summary)), 'BUNDLE_MISMATCH');
  ensure(value.mediaHeaderSha256 === sha256(canonicalBytes(header)), 'BUNDLE_MISMATCH');
  return header;
}

export function validateInventory(value) {
  try { return checkInventory(value); }
  catch (error) {
    if (error instanceof MediaError) throw error;
    fail('SCHEMA_UNSUPPORTED');
  }
}

const MAGIC = Buffer.from('PP1CMEDIA1\n');
const statFields = ['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid'];
const sameStat = (a, b) => statFields.every(key => a[key] === b[key]);
async function safeRoot(root) {
  ensure(typeof root === 'string' && resolve(root) === root, 'UNSAFE_MEDIA_PATH');
  const ancestors = new Map();
  for (let path = root; ; path = dirname(path)) {
    const stat = await lstat(path, { bigint: true });
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_MEDIA_PATH');
    ancestors.set(path, stat);
    if (dirname(path) === path) break;
  }
  return ancestors;
}
async function snapshot(root) {
  const ancestors = await safeRoot(root), files = new Map(), directories = new Map();
  async function visit(path, prefix) {
    const before = await lstat(path, { bigint: true });
    ensure(before.isDirectory() && !before.isSymbolicLink(), 'UNSAFE_MEDIA_PATH');
    directories.set(path, before);
    const names = await readdir(path, { encoding: 'buffer' });
    for (const raw of names) {
      let name;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { fail('UNSAFE_MEDIA_PATH'); }
      ensure(Buffer.from(name).equals(raw), 'UNSAFE_MEDIA_PATH');
      const key = prefix + name;
      objectKey(key);
      const child = join(path, name), stat = await lstat(child, { bigint: true });
      if (stat.isDirectory()) await visit(child, key + '/');
      else {
        ensure(stat.isFile() && stat.nlink === 1n && !files.has(key), 'UNSAFE_MEDIA_PATH');
        files.set(key, stat);
      }
    }
    ensure(sameStat(before, await lstat(path, { bigint: true })), 'WRITER_NOT_QUIESCED');
  }
  await visit(root, '');
  for (const [path, before] of ancestors) {
    const after = await lstat(path, { bigint: true });
    ensure(after.isDirectory() && before.dev === after.dev && before.ino === after.ino, 'WRITER_NOT_QUIESCED');
  }
  return { files, directories };
}
function snapshotEqual(before, after) {
  for (const kind of ['files', 'directories']) {
    ensure(before[kind].size === after[kind].size, 'WRITER_NOT_QUIESCED');
    for (const [key, stat] of before[kind]) ensure(after[kind].has(key)
      && sameStat(stat, after[kind].get(key)), 'WRITER_NOT_QUIESCED');
  }
}
async function* packageChunks(root, header, before, afterRead) {
  const bytes = canonicalBytes(header), length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  yield MAGIC;
  yield length;
  yield bytes;
  for (const file of header.files) {
    const path = join(root, file.objectKey);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let primary;
    try {
      const stat = await handle.stat({ bigint: true });
      ensure(stat.isFile() && stat.nlink === 1n && sameStat(stat, before.files.get(file.objectKey)), 'WRITER_NOT_QUIESCED');
      ensure(stat.size === BigInt(file.byteSize), 'MEDIA_SIZE_MISMATCH');
      const digest = createHash('sha256');
      let count = 0n;
      while (true) {
        const buffer = Buffer.alloc(65536);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        count += BigInt(bytesRead);
        ensure(count <= BigInt(file.byteSize), 'WRITER_NOT_QUIESCED');
        digest.update(buffer.subarray(0, bytesRead));
        yield buffer.subarray(0, bytesRead);
      }
      await afterRead(file);
      ensure(count === BigInt(file.byteSize) && sameStat(stat, await handle.stat({ bigint: true }))
        && sameStat(stat, await lstat(path, { bigint: true })), 'WRITER_NOT_QUIESCED');
      ensure(digest.digest('hex') === file.sha256, 'MEDIA_HASH_MISMATCH');
    } catch (error) { primary = error; throw error; }
    finally { await handle.close().catch(error => { if (!primary) throw error; }); }
  }
  snapshotEqual(before, await snapshot(root));
}
export async function packMedia({ root, inventory, output, afterRead = async () => {} }) {
  try {
    const header = validateInventory(parseStrictJson(inventory));
    const before = await snapshot(root);
    ensure(header.files.every(file => before.files.has(file.objectKey)), 'MISSING_MEDIA_OBJECT');
    ensure(before.files.size === header.files.length, 'WRITER_NOT_QUIESCED');
    await pipeline(packageChunks(root, header, before, afterRead), output, { end: false });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    fail('CAPTURE_FAILED');
  }
}
async function readInventory(input) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    ensure(bytes <= Math.min(bufferLimits.MAX_LENGTH, bufferLimits.MAX_STRING_LENGTH * 3), 'INPUT_INVALID');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}
const EXITS = new Map([[2, 'INPUT_INVALID'], [3, 'SCHEMA_UNSUPPORTED UNSAFE_MEDIA_PATH MISSING_MEDIA_OBJECT MEDIA_HASH_MISMATCH MEDIA_SIZE_MISMATCH'],
  [4, 'WRITER_NOT_QUIESCED'], [5, 'CAPTURE_FAILED BUNDLE_MISMATCH'], [7, 'TARGET_NOT_BLANK ADAPTER_UNSEALED'], [8, 'RESTORE_FAILED']]
  .flatMap(([exit, codes]) => codes.split(' ').map(code => [code, exit])));
export async function run(args, { root = '/media', input = process.stdin, output = process.stdout, error = process.stderr } = {}) {
  try {
    ensure(args.length === 1 && ['pack', 'restore'].includes(args[0]), 'INPUT_INVALID');
    if (args[0] === 'pack') await packMedia({ root, inventory: await readInventory(input), output });
    else {
      const receipt = await restoreMedia({ root, input });
      await pipeline(Readable.from([canonicalBytes(receipt)]), output, { end: false });
    }
    return 0;
  } catch (failure) {
    const code = failure instanceof MediaError && EXITS.has(failure.code) ? failure.code
      : args[0] === 'restore' ? 'RESTORE_FAILED' : 'CAPTURE_FAILED';
    try { await pipeline(Readable.from([Buffer.from(code + '\n')]), error, { end: false }); }
    catch { /* Diagnostic failure never replaces the primary exit. */ }
    return EXITS.get(code);
  }
}
class PackageReader {
  constructor(input) { this.iterator = input[Symbol.asyncIterator](); this.pending = Buffer.alloc(0); }
  async take(length) {
    while (this.pending.length === 0) {
      const next = await this.iterator.next();
      if (next.done) return Buffer.alloc(0);
      this.pending = Buffer.from(next.value);
    }
    const bytes = this.pending.subarray(0, length);
    this.pending = this.pending.subarray(bytes.length);
    return bytes;
  }
  async exact(length) {
    const parts = [];
    let remaining = length;
    while (remaining > 0) {
      const bytes = await this.take(remaining);
      ensure(bytes.length > 0, 'RESTORE_FAILED');
      parts.push(bytes);
      remaining -= bytes.length;
    }
    return Buffer.concat(parts, length);
  }
  async close() { await this.iterator.return?.(); }
}
async function syncDirectory(path, expected, syncHandle) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let primary;
  try {
    const stat = await handle.stat({ bigint: true });
    ensure(stat.isDirectory() && stat.dev === expected.dev && stat.ino === expected.ino, 'WRITER_NOT_QUIESCED');
    await syncHandle(handle);
  } catch (error) { primary = error; throw error; }
  finally { await handle.close().catch(error => { if (!primary) throw error; }); }
}
async function restoreFile(root, file, reader, directories, syncHandle) {
  let parent = root;
  for (const component of file.objectKey.split('/').slice(0, -1)) {
    const path = join(parent, component);
    if (!directories.has(path)) {
      await mkdir(path, { mode: 0o755 });
      const stat = await lstat(path, { bigint: true });
      ensure(stat.isDirectory() && (stat.mode & 0o777n) === 0o755n && stat.uid === BigInt(process.getuid())
        && stat.gid === BigInt(process.getgid()), 'ADAPTER_UNSEALED');
      directories.set(path, stat);
      await syncDirectory(path, stat, syncHandle);
      await syncDirectory(parent, directories.get(parent), syncHandle);
    }
    const current = await lstat(path, { bigint: true });
    ensure(current.isDirectory() && current.dev === directories.get(path).dev
      && current.ino === directories.get(path).ino, 'WRITER_NOT_QUIESCED');
    parent = path;
  }
  const path = join(parent, file.objectKey.split('/').at(-1));
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR, 0o644);
  let primary;
  try {
    const initial = await handle.stat({ bigint: true });
    ensure(initial.isFile() && initial.nlink === 1n && initial.uid === BigInt(process.getuid())
      && initial.gid === BigInt(process.getgid()) && (initial.mode & 0o777n) === 0o644n, 'ADAPTER_UNSEALED');
    let remaining = BigInt(file.byteSize);
    const digest = createHash('sha256');
    while (remaining > 0n) {
      const chunk = await reader.take(Number(remaining > 65536n ? 65536n : remaining));
      ensure(chunk.length > 0, 'RESTORE_FAILED');
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
        ensure(bytesWritten > 0, 'RESTORE_FAILED');
        offset += bytesWritten;
      }
      remaining -= BigInt(chunk.length);
    }
    ensure(digest.digest('hex') === file.sha256, 'RESTORE_FAILED');
    await syncHandle(handle);
    const final = await handle.stat({ bigint: true });
    ensure(final.size === BigInt(file.byteSize) && final.dev === initial.dev && final.ino === initial.ino
      && final.nlink === 1n && final.mode === initial.mode && final.uid === initial.uid && final.gid === initial.gid
      && sameStat(final, await lstat(path, { bigint: true })), 'WRITER_NOT_QUIESCED');
    await syncDirectory(parent, directories.get(parent), syncHandle);
    return final;
  } catch (error) { primary = error; throw error; }
  finally { await handle.close().catch(error => { if (!primary) throw error; }); }
}
export async function restoreMedia({ root, input, syncHandle = handle => handle.sync() }) {
  let reader, primary;
  try {
    const ancestors = await safeRoot(root);
    ensure((await readdir(root)).length === 0, 'TARGET_NOT_BLANK');
    reader = new PackageReader(input);
    ensure((await reader.exact(MAGIC.length)).equals(MAGIC), 'RESTORE_FAILED');
    const length = (await reader.exact(8)).readBigUInt64BE();
    ensure(length > 0n && length <= 64n * 1024n * 1024n, 'INPUT_INVALID');
    const headerBytes = await reader.exact(Number(length));
    const header = validateHeader(parseStrictJson(headerBytes));
    const names = new Set(header.files.map(file => file.objectKey));
    for (const file of header.files) {
      const parts = file.objectKey.split('/');
      for (let i = 1; i < parts.length; i++) ensure(!names.has(parts.slice(0, i).join('/')), 'UNSAFE_MEDIA_PATH');
    }
    const total = header.files.reduce((sum, file) => sum + BigInt(file.byteSize), 0n);
    const space = await statfs(root, { bigint: true }), free = space.bsize * space.bavail;
    const reserve = free / 10n > 512n * 1024n * 1024n ? free / 10n : 512n * 1024n * 1024n;
    ensure(total + length + BigInt(MAGIC.length + 8) <= free - reserve, 'RESTORE_FAILED');
    const directories = new Map([[root, ancestors.get(root)]]), files = new Map();
    for (const file of header.files) files.set(file.objectKey, await restoreFile(root, file, reader, directories, syncHandle));
    ensure((await reader.take(1)).length === 0, 'RESTORE_FAILED');
    const after = await snapshot(root);
    ensure(after.files.size === files.size && after.directories.size === directories.size, 'WRITER_NOT_QUIESCED');
    for (const [key, stat] of files) ensure(after.files.has(key) && sameStat(stat, after.files.get(key)), 'WRITER_NOT_QUIESCED');
    for (const [path, stat] of directories) {
      const current = after.directories.get(path);
      ensure(current && current.dev === stat.dev && current.ino === stat.ino && current.mode === stat.mode
        && current.uid === stat.uid && current.gid === stat.gid, 'WRITER_NOT_QUIESCED');
      await syncDirectory(path, stat, syncHandle);
    }
    return { version: 1, operationId: null, fileCount: String(files.size), fileBytes: total.toString(),
      mediaHeaderSha256: sha256(headerBytes) };
  } catch (error) {
    primary = error instanceof MediaError ? error
      : new MediaError(['EACCES', 'EPERM'].includes(error.code) ? 'ADAPTER_UNSEALED' : 'RESTORE_FAILED');
    throw primary;
  } finally { await reader?.close().catch(error => { if (!primary) fail('RESTORE_FAILED'); }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2));
}
