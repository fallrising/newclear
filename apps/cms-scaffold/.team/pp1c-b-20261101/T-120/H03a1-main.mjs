// Mounted alone at /tool/local-media.mjs; only Node built-in imports are allowed.
import { createHash } from 'node:crypto';

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
