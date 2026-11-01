import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const PHASES = new Set(('PRECHECK SOURCE_QUIESCED LOCAL_CAPTURED LOCAL_VERIFIED TARGET_RESERVED '
  + 'TARGET_BLANK DB_RESTORED MEDIA_RESTORED RAW_VERIFIED SESSIONS_REVOKED STARTUP_VERIFIED '
  + 'API_HEALTHY INGRESS_STARTED BROWSER_VERIFIED TARGET_STOPPED RESTART_VERIFIED COMPLETE '
  + 'PROOF_REVALIDATED ACCOUNT_PRE_CONNECTION ACCOUNT_BOUND ACCOUNT_COMMITTED FAILED_OR_UNKNOWN').split(' '));
const EXITS = new Map([
  [2, 'INPUT_INVALID MANIFEST_MISMATCH'],
  [3, 'SCHEMA_UNSUPPORTED UNSAFE_MEDIA_PATH MISSING_MEDIA_OBJECT MEDIA_HASH_MISMATCH MEDIA_SIZE_MISMATCH IMAGE_VARIANTS_INCOMPLETE'],
  [4, 'LOCK_BUSY WRITER_NOT_QUIESCED SOURCE_CHANGED'],
  [5, 'CAPTURE_FAILED LOCAL_VERIFY_FAILED COPY_FAILED BUNDLE_MISMATCH'],
  [7, 'TARGET_NOT_BLANK TARGET_NOT_OWNED ADAPTER_UNSEALED'],
  [8, 'RESTORE_FAILED RAW_MISMATCH SESSION_REVOKE_FAILED STARTUP_MUTATION SMOKE_FAILED'],
  [10, 'INTERRUPTED JOURNAL_INCOMPLETE'], [11, 'OBJECTIVE_MISSED OBJECTIVE_UNKNOWN']
].flatMap(([exit, codes]) => codes.split(' ').map(code => [code, exit])));

export class OpsError extends Error {
  constructor(code, phase = null, operationId = null) {
    if (!EXITS.has(code)) throw new OpsError('INPUT_INVALID');
    super(code);
    this.code = code;
    this.phase = PHASES.has(phase) ? phase : null;
    this.operationId = typeof operationId === 'string' && UUID.test(operationId) ? operationId : null;
  }
  get exitCode() { return EXITS.get(this.code); }
}
const fail = (code = 'MANIFEST_MISMATCH') => { throw new OpsError(code); };
const requireValue = condition => { if (!condition) fail(); };
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
const count = value => matches(value, DECIMAL);
const ref = value => matches(value, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/) && !value.includes('..');
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
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const expected = fields.split(' ');
  requireValue(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
}
function timestamp(value) {
  requireValue(matches(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
  const milliseconds = Date.parse(value);
  requireValue(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value);
  return milliseconds;
}
function orderedTimes(values) {
  const parsed = values.map(timestamp);
  requireValue(parsed.every((value, index) => index === 0 || value >= parsed[index - 1]));
  return parsed;
}
function ordered(values, predicate) {
  requireValue(Array.isArray(values) && values.every(predicate)
    && values.every((value, i) => i === 0 || codepointCompare(values[i - 1], value) < 0));
}
function safeValidation(action) {
  try { return action(); }
  catch { fail(); }
}
const TABLES = ('cms_audit_event cms_audit_settings cms_content_type cms_credential cms_entry '
  + 'cms_entry_index cms_entry_ref cms_entry_revision cms_field cms_media cms_media_attachment '
  + 'cms_media_settings cms_media_variant cms_navigation_menu cms_permission cms_principal '
  + 'cms_principal_role cms_role cms_session flyway_schema_history').split(' ');
const ARTIFACTS = ['db.dump', 'inventory.json', 'media.package'];

// Value validators are for already parsed data. Raw ingress must call parseStrictJson first.
// They check declarations and bindings, never claim on-disk artifacts or live targets are verified.
export function validateManifest(value) {
  return safeValidation(() => {
    canonicalBytes(value);
    exact(value, 'manifestVersion backupId instanceId release migration scope times toolchain artifacts inventory source');
    requireValue(value.manifestVersion === 1 && matches(value.instanceId, UUID));
    requireValue(matches(value.backupId, /^pp1-\d{8}T\d{9}Z-[0-9a-f]{32}$/));
    const compact = value.backupId.slice(4, 23);
    timestamp(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T`
      + `${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.${compact.slice(15, 18)}Z`);
    const { release, migration, scope, times, toolchain, artifacts, inventory, source } = value;
    exact(release, 'sourceCommit apiImageDigest postgresImageDigest javaRuntimeVersion postgresServerVersion frontend configSha256');
    requireValue(matches(release.sourceCommit, /^[0-9a-f]{40}$/) && matches(release.configSha256, HASH));
    for (const field of ['apiImageDigest', 'postgresImageDigest']) {
      requireValue(matches(release[field], /^sha256:[0-9a-f]{64}$/));
    }
    requireValue(text(release.javaRuntimeVersion) && /^25(?:\.|\+|$)/.test(release.javaRuntimeVersion));
    requireValue(text(release.postgresServerVersion) && /^16(?:\.|$)/.test(release.postgresServerVersion));
    exact(release.frontend, 'front back admin');
    for (const frontend of Object.values(release.frontend)) {
      exact(frontend, 'artifactSha256 apiBaseConfigSha256');
      requireValue(matches(frontend.artifactSha256, HASH) && matches(frontend.apiBaseConfigSha256, HASH));
    }
    requireValue(Array.isArray(migration) && migration.length > 0);
    let previousRank = -1n;
    for (const row of migration) {
      exact(row, 'installedRank version description type script checksum success');
      requireValue(count(row.installedRank) && BigInt(row.installedRank) > previousRank);
      previousRank = BigInt(row.installedRank);
      requireValue((row.version === null || text(row.version)) && text(row.description)
        && text(row.type) && text(row.script) && row.success === true);
      requireValue(row.checksum === null || matches(row.checksum, /^(0|-?[1-9][0-9]*)$/));
    }
    exact(scope, 'dbSchema tableNames dbRoleRef secretRefs');
    requireValue(scope.dbSchema === 'public' && ref(scope.dbRoleRef));
    requireValue(Array.isArray(scope.tableNames) && scope.tableNames.length === TABLES.length
      && scope.tableNames.every((name, index) => name === TABLES[index]));
    ordered(scope.secretRefs, ref);
    exact(times, 'startedAt quiescedAt capturedAt verifiedLocalAt');
    orderedTimes([times.startedAt, times.quiescedAt, times.capturedAt, times.verifiedLocalAt]);
    exact(toolchain, 'inventorySourceCommit inventoryJavaVersion pgDumpVersion pgRestoreVersion mediaPackageAdapterId mediaPackageAdapterVersion');
    requireValue(Object.values(toolchain).every(text));
    requireValue(toolchain.inventorySourceCommit === release.sourceCommit
      && toolchain.inventoryJavaVersion === release.javaRuntimeVersion);
    requireValue(/^16(?:\.|$)/.test(toolchain.pgDumpVersion) && /^16(?:\.|$)/.test(toolchain.pgRestoreVersion));
    requireValue(toolchain.mediaPackageAdapterId === 'pp1c-node-framed-media' && toolchain.mediaPackageAdapterVersion === '1');
    requireValue(Array.isArray(artifacts) && artifacts.length === ARTIFACTS.length);
    artifacts.forEach((artifact, index) => {
      exact(artifact, 'path byteSize sha256');
      requireValue(artifact.path === ARTIFACTS[index] && count(artifact.byteSize) && matches(artifact.sha256, HASH));
    });
    exact(inventory, 'sha256 dbSnapshotSha256 assetCount referencedFileCount orphanFileCount fileCount fileBytes');
    requireValue(matches(inventory.sha256, HASH) && matches(inventory.dbSnapshotSha256, HASH)
      && inventory.sha256 === artifacts[1].sha256);
    for (const key of ['assetCount', 'referencedFileCount', 'orphanFileCount', 'fileCount', 'fileBytes']) {
      requireValue(count(inventory[key]));
    }
    requireValue(BigInt(inventory.fileCount) === BigInt(inventory.referencedFileCount) + BigInt(inventory.orphanFileCount));
    exact(source, 'projectRef dbVolumeRef mediaVolumeRef writerSetSha256');
    requireValue([source.projectRef, source.dbVolumeRef, source.mediaVolumeRef].every(ref)
      && source.dbVolumeRef !== source.mediaVolumeRef && matches(source.writerSetSha256, HASH));
    return value;
  });
}

function receiptBinding(value, manifest) {
  validateManifest(manifest);
  requireValue(value.version === 1 && value.backupId === manifest.backupId
    && value.manifestSha256 === sha256(canonicalBytes(manifest)));
}
export function validateLocalComplete(value, manifest) {
  return safeValidation(() => {
    canonicalBytes(value);
    exact(value, 'version backupId manifestSha256 verifiedLocalAt');
    receiptBinding(value, manifest);
    requireValue(value.verifiedLocalAt === manifest.times.verifiedLocalAt);
    return value;
  });
}
export function validateRestoreVerified(value, manifest) {
  return safeValidation(() => {
    canonicalBytes(value);
    exact(value, 'version runId backupId manifestSha256 targetRef rawSnapshotSha256 mediaInventorySha256 smokeReceiptSha256 environment incidentStartedAt startedAt availableAt elapsedMs rtoBudgetMs withinRto');
    receiptBinding(value, manifest);
    requireValue(matches(value.runId, /^[0-9a-f]{32}$/) && ref(value.targetRef));
    requireValue(![manifest.source.projectRef, manifest.source.dbVolumeRef, manifest.source.mediaVolumeRef].includes(value.targetRef));
    // These receipt hashes have no defined preimage binding in the parent schema yet.
    requireValue([value.rawSnapshotSha256, value.mediaInventorySha256, value.smokeReceiptSha256]
      .every(hash => matches(hash, HASH)));
    requireValue(['isolated-drill', 'production'].includes(value.environment));
    const [incident, started] = orderedTimes([value.incidentStartedAt, value.startedAt, value.availableAt]);
    requireValue(count(value.elapsedMs) && BigInt(value.elapsedMs) >= BigInt(started - incident));
    requireValue(value.rtoBudgetMs === '14400000' && typeof value.withinRto === 'boolean'
      && value.withinRto === (BigInt(value.elapsedMs) <= 14400000n));
    return value;
  });
}
