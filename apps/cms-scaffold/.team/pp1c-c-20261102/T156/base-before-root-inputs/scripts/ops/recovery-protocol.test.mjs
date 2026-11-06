import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes, parseStrictJson, sha256, validateManifest,
  validateLocalComplete, validateRestoreVerified, OpsError } from './recovery-protocol.mjs';

const H = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const UUID = '00112233-4455-6677-8899-aabbccddeeff';
const RUN = '11'.repeat(16);
const TIME = '2026-11-01T12:00:00.000Z';
const TABLES = ['cms_audit_event', 'cms_audit_settings', 'cms_content_type', 'cms_credential',
  'cms_entry', 'cms_entry_index', 'cms_entry_ref', 'cms_entry_revision', 'cms_field',
  'cms_media', 'cms_media_attachment', 'cms_media_settings', 'cms_media_variant',
  'cms_navigation_menu', 'cms_permission', 'cms_principal', 'cms_principal_role',
  'cms_role', 'cms_session', 'flyway_schema_history'];
const CANARY = 'secret-canary-password@host';
function manifest() {
  return {
    manifestVersion: 1, backupId: `pp1-20261101T120000000Z-${'c'.repeat(32)}`, instanceId: UUID,
    release: { sourceCommit: COMMIT, apiImageDigest: `sha256:${H}`, postgresImageDigest: `sha256:${H}`,
      javaRuntimeVersion: '25.0.5+8', postgresServerVersion: '16.15',
      frontend: Object.fromEntries(['front', 'back', 'admin'].map(k =>
        [k, { artifactSha256: H, apiBaseConfigSha256: H }])), configSha256: H },
    migration: [{ installedRank: '1', version: null, description: 'Initial schema', type: 'SQL',
      script: 'V1__initial.sql', checksum: null, success: true },
    { installedRank: '2', version: '2', description: 'Identity', type: 'SQL',
      script: 'V2__identity.sql', checksum: '-2147483648', success: true }],
    scope: { dbSchema: 'public', tableNames: [...TABLES], dbRoleRef: 'role-001', secretRefs: ['secret-001'] },
    times: { startedAt: TIME, quiescedAt: TIME, capturedAt: TIME, verifiedLocalAt: TIME },
    toolchain: { inventorySourceCommit: COMMIT, inventoryJavaVersion: '25.0.5+8', pgDumpVersion: '16.15',
      pgRestoreVersion: '16.15', mediaPackageAdapterId: 'pp1c-node-framed-media', mediaPackageAdapterVersion: '1' },
    artifacts: ['db.dump', 'inventory.json', 'media.package'].map(path => ({ path, byteSize: '1', sha256: H })),
    inventory: { sha256: H, dbSnapshotSha256: H, assetCount: '1', referencedFileCount: '1',
      orphanFileCount: '0', fileCount: '1', fileBytes: '9007199254740993' },
    source: { projectRef: 'source-project', dbVolumeRef: 'source-db', mediaVolumeRef: 'source-media', writerSetSha256: H }
  };
}
const complete = m => ({ version: 1, backupId: m.backupId,
  manifestSha256: sha256(canonicalBytes(m)), verifiedLocalAt: TIME });
const restored = m => ({ version: 1, runId: RUN, backupId: m.backupId,
  manifestSha256: sha256(canonicalBytes(m)), targetRef: `pp1-local:${RUN}`,
  rawSnapshotSha256: H, mediaInventorySha256: H, smokeReceiptSha256: H,
  environment: 'isolated-drill', incidentStartedAt: TIME, startedAt: TIME, availableAt: TIME,
  elapsedMs: '0', rtoBudgetMs: '14400000', withinRto: true });
function rejects(fn, code = 'MANIFEST_MISMATCH') {
  assert.throws(fn, error => error instanceof OpsError && error.code === code && error.message === code);
}

test('PP1c_canonical_codepoint_order_LF_nullable_PG_text', () => {
  const value = { '\u{10000}': 'supplementary', '\ue000': null, '2': 'two', '10': 'ten',
    row: { secret_hash: null, value: '9007199254740993', bytea: '\\x00ff', newline: 'a\nb' } };
  const expected = '{"10":"ten","2":"two","row":{"bytea":"\\\\x00ff","newline":"a\\nb","secret_hash":null,"value":"9007199254740993"},"\ue000":null,"\u{10000}":"supplementary"}\n';
  assert.equal(canonicalBytes(value).toString('utf8'), expected);
  assert.deepEqual(parseStrictJson(Buffer.from(expected)), value);
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
for (const [name, bytes] of [
  ['duplicate', Buffer.from('{"a":1,"a":1}\n')], ['unknown_spacing', Buffer.from('{ "a":1}\n')],
  ['key_order', Buffer.from('{"z":1,"a":2}\n')], ['missing_LF', Buffer.from('{}')],
  ['extra_LF', Buffer.from('{}\n\n')], ['BOM', Buffer.from('\ufeff{}\n')],
  ['invalid_UTF8', Buffer.from([0x22, 0xc0, 0xaf, 0x22, 10])],
  ['overflow_number', Buffer.from('1e999\n')], ['multiple_documents', Buffer.from('{}\n{}\n')],
  ['escaped_key', Buffer.from('{"\\u0061":1}\n')], ['surrogate', Buffer.from('"\\ud800"\n')]
]) test(`PP1c_strict_${name}`, () => rejects(() => parseStrictJson(bytes), 'INPUT_INVALID'));
for (const [name, value] of [['NaN', NaN], ['Infinity', Infinity], ['undefined', undefined],
  ['bigint', 1n], ['sparse', new Array(1)], ['date', new Date(TIME)], ['surrogate', '\ud800']]) {
  test(`PP1c_canonical_rejects_${name}`, () => rejects(() => canonicalBytes(value), 'INPUT_INVALID'));
}
test('PP1c_valid_manifest_and_receipts_roundtrip', () => {
  const m = parseStrictJson(canonicalBytes(manifest()));
  assert.equal(validateManifest(m), m);
  assert.deepEqual(validateLocalComplete(complete(m), m), complete(m));
  assert.deepEqual(validateRestoreVerified(restored(m), m), restored(m));
});
const invalidManifest = [
  ['unknown_root', m => { m.password = CANARY; }], ['missing_required', m => { delete m.source; }],
  ['wrong_version', m => { m.manifestVersion = '1'; }], ['backupId', m => { m.backupId = 'pp1-invalid'; }],
  ['instanceId', m => { m.instanceId = UUID.toUpperCase(); }],
  ['source_commit', m => { m.release.sourceCommit = H; }],
  ['release_unknown', m => { m.release.host = CANARY; }],
  ['frontend_unknown', m => { m.release.frontend.front.password = CANARY; }],
  ['frontend_missing', m => { delete m.release.frontend.admin; }],
  ['PG_major', m => { m.release.postgresServerVersion = '17.1'; }],
  ['Java_major', m => { m.release.javaRuntimeVersion = '250.1'; }],
  ['tool_source_binding', m => { m.toolchain.inventorySourceCommit = 'd'.repeat(40); }],
  ['tool_Java_binding', m => { m.toolchain.inventoryJavaVersion = '25.0.1'; }],
  ['empty_tool', m => { m.toolchain.pgDumpVersion = ''; }],
  ['scope_missing_table', m => { m.scope.tableNames.pop(); }],
  ['scope_order', m => { m.scope.tableNames.reverse(); }],
  ['secret_ref_value', m => { m.scope.secretRefs = [CANARY]; }],
  ['secret_ref_duplicate', m => { m.scope.secretRefs.push('secret-001'); }],
  ['unsafe_ref_path', m => { m.scope.dbRoleRef = '../secret'; }],
  ['unsafe_ref_URL', m => { m.source.projectRef = 'https://example.test'; }],
  ['same_volumes', m => { m.source.mediaVolumeRef = m.source.dbVolumeRef; }],
  ['migration_order', m => { m.migration.reverse(); }],
  ['migration_rank_duplicate', m => { m.migration[1].installedRank = '1'; }],
  ['migration_failed', m => { m.migration[0].success = false; }],
  ['migration_unknown', m => { m.migration[0].installedBy = CANARY; }],
  ['migration_bad_checksum', m => { m.migration[0].checksum = 1; }],
  ['time_backwards', m => { m.times.capturedAt = '2026-10-31T12:00:00.000Z'; }],
  ['time_invalid_calendar', m => { m.times.startedAt = '2026-02-30T12:00:00.000Z'; }],
  ['artifact_order', m => { m.artifacts.reverse(); }],
  ['artifact_path', m => { m.artifacts[0].path = '../db.dump'; }],
  ['artifact_self', m => { m.artifacts[0].path = 'manifest.json'; }],
  ['artifact_unknown', m => { m.artifacts[0].url = CANARY; }],
  ['artifact_size_number', m => { m.artifacts[0].byteSize = 1; }],
  ['artifact_size_leading_zero', m => { m.artifacts[0].byteSize = '01'; }],
  ['artifact_hash_upper', m => { m.artifacts[0].sha256 = H.toUpperCase(); }],
  ['inventory_hash_binding', m => { m.inventory.sha256 = 'd'.repeat(64); }],
  ['inventory_count_binding', m => { m.inventory.fileCount = '2'; }],
  ['inventory_count_number', m => { m.inventory.fileBytes = 9007199254740992; }]
];
for (const [name, mutate] of invalidManifest) test(`PP1c_manifest_${name}`, () => {
  const m = manifest(); mutate(m); rejects(() => validateManifest(m));
});
for (const [name, mutate] of [
  ['backup_binding', r => { r.backupId += '0'; }], ['hash_binding', r => { r.manifestSha256 = 'd'.repeat(64); }],
  ['time_binding', r => { r.verifiedLocalAt = '2026-11-01T12:00:01.000Z'; }],
  ['unknown', r => { r.password = CANARY; }]
]) test(`PP1c_complete_${name}`, () => { const m = manifest(); const r = complete(m);
  mutate(r); rejects(() => validateLocalComplete(r, m)); });
for (const [name, mutate] of [
  ['backup_binding', r => { r.backupId += '0'; }], ['hash_binding', r => { r.manifestSha256 = 'd'.repeat(64); }],
  ['target_source_alias', r => { r.targetRef = 'source-db'; }],
  ['run_shape', r => { r.runId = 'f'.repeat(34); }],
  ['raw_hash_shape', r => { r.rawSnapshotSha256 = 'd'.repeat(63); }],
  ['inventory_hash_shape', r => { r.mediaInventorySha256 = 'D'.repeat(64); }],
  ['time_backwards', r => { r.availableAt = '2026-10-31T12:00:00.000Z'; }],
  ['elapsed_understates_incident', r => { r.incidentStartedAt = '2026-11-01T11:00:00.000Z'; }],
  ['rto_budget', r => { r.rtoBudgetMs = '14400001'; }], ['rto_false_claim', r => { r.elapsedMs = '14400001'; }],
  ['unknown', r => { r.password = CANARY; }], ['environment', r => { r.environment = 'local'; }]
]) test(`PP1c_restore_${name}`, () => { const m = manifest(); const r = restored(m);
  mutate(r); rejects(() => validateRestoreVerified(r, m)); });
test('PP1c_RTO_missed_receipt_preserves_successful_restore', () => {
  const m = manifest(); const r = restored(m);
  r.availableAt = '2026-11-01T16:00:00.001Z'; r.elapsedMs = '14400001'; r.withinRto = false;
  assert.equal(validateRestoreVerified(r, m), r);
});
test('PP1c_error_fixed_safe_context_and_exit', () => {
  const error = new OpsError('MEDIA_HASH_MISMATCH', 'RAW_VERIFIED', UUID);
  assert.equal(error.message, 'MEDIA_HASH_MISMATCH'); assert.equal(error.exitCode, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), { code: 'MEDIA_HASH_MISMATCH', phase: 'RAW_VERIFIED', operationId: UUID });
  assert.equal(error.cause, undefined);
  rejects(() => new OpsError(CANARY), 'INPUT_INVALID');
  const safe = new OpsError('INPUT_INVALID', CANARY, CANARY);
  assert.equal(safe.phase, null); assert.equal(safe.operationId, null);
  assert.ok(!JSON.stringify(safe).includes(CANARY));
});

// Exercise every nested object, so a schema field cannot silently become optional.
const objectPaths = [[], ['release'], ['release', 'frontend'], ['release', 'frontend', 'front'],
  ['release', 'frontend', 'back'], ['release', 'frontend', 'admin'], ['migration', 0], ['scope'],
  ['times'], ['toolchain'], ['artifacts', 0], ['artifacts', 1], ['artifacts', 2], ['inventory'], ['source']];
for (const path of objectPaths) {
  const label = path.join('.') || 'root';
  const at = m => path.reduce((object, key) => object[key], m);
  test(`PP1c_exact_schema_${label}`, () => {
    for (const key of Object.keys(at(manifest()))) {
      const m = manifest(); delete at(m)[key]; rejects(() => validateManifest(m));
    }
    const m = manifest(); at(m).unexpected = CANARY; rejects(() => validateManifest(m));
  });
}
for (const [name, factory, validate] of [
  ['complete', complete, validateLocalComplete], ['restore', restored, validateRestoreVerified]
]) test(`PP1c_receipt_all_required_${name}`, () => {
  const m = manifest();
  for (const key of Object.keys(factory(m))) {
    const receipt = factory(m); delete receipt[key]; rejects(() => validate(receipt, m));
  }
});
test('PP1c_error_all_parent_codes_and_future_codes_rejected', () => {
  const groups = [
    [2, 'INPUT_INVALID MANIFEST_MISMATCH'],
    [3, 'SCHEMA_UNSUPPORTED UNSAFE_MEDIA_PATH MISSING_MEDIA_OBJECT MEDIA_HASH_MISMATCH MEDIA_SIZE_MISMATCH IMAGE_VARIANTS_INCOMPLETE'],
    [4, 'LOCK_BUSY WRITER_NOT_QUIESCED SOURCE_CHANGED'],
    [5, 'CAPTURE_FAILED LOCAL_VERIFY_FAILED COPY_FAILED BUNDLE_MISMATCH'],
    [7, 'TARGET_NOT_BLANK TARGET_NOT_OWNED ADAPTER_UNSEALED'],
    [8, 'RESTORE_FAILED RAW_MISMATCH SESSION_REVOKE_FAILED STARTUP_MUTATION SMOKE_FAILED'],
    [10, 'INTERRUPTED JOURNAL_INCOMPLETE'], [11, 'OBJECTIVE_MISSED OBJECTIVE_UNKNOWN']
  ];
  for (const [exit, codes] of groups) for (const code of codes.split(' ')) {
    assert.equal(new OpsError(code).exitCode, exit);
  }
  for (const code of ['OFFSITE_FAILED', 'OFFSITE_VERIFY_FAILED', 'NOTIFY_FAILED', 'UPGRADE_FAILED',
    'RECOVERY_FAILED', 'WRITES_ALREADY_OPEN', 'NO_RECOVERABLE_BASELINE']) {
    rejects(() => new OpsError(code), 'INPUT_INVALID');
  }
});
test('PP1c_errors_never_expose_rejected_input', () => {
  for (const action of [() => parseStrictJson(Buffer.from(CANARY)),
    () => validateManifest({ password: CANARY }), () => validateLocalComplete({ password: CANARY }, manifest())]) {
    try { action(); assert.fail('expected rejection'); }
    catch (error) {
      assert.ok(error instanceof OpsError);
      assert.ok(![error.message, error.stack, JSON.stringify(error)].some(value => value.includes(CANARY)));
      assert.equal(error.cause, undefined);
    }
  }
});
test('PP1c_canonical_cycles_and_accessors_fail_closed', () => {
  const cycle = {}; cycle.self = cycle;
  rejects(() => canonicalBytes(cycle), 'INPUT_INVALID');
  const accessor = { get secret() { throw new Error(CANARY); } };
  rejects(() => canonicalBytes(accessor), 'INPUT_INVALID');
  rejects(() => parseStrictJson('{}\n'), 'INPUT_INVALID');
  rejects(() => sha256(CANARY), 'INPUT_INVALID');
});
test('PP1c_large_decimal_counts_preserve_precision', () => {
  const m = manifest();
  m.inventory.referencedFileCount = '9007199254740993'; m.inventory.orphanFileCount = '2';
  m.inventory.fileCount = '9007199254740995';
  assert.equal(validateManifest(m), m);
  m.inventory.fileCount = '9007199254740994'; rejects(() => validateManifest(m));
});
test('PP1c_restore_hashes_have_shape_without_invented_preimage_binding', () => {
  const m = manifest(); const r = restored(m);
  r.rawSnapshotSha256 = 'd'.repeat(64); r.mediaInventorySha256 = 'e'.repeat(64);
  r.targetRef = 'opaque-target-001';
  assert.equal(validateRestoreVerified(r, m), r);
});
