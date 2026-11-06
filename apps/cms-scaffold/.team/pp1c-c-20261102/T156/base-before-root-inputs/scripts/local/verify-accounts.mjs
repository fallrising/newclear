import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve, join, parse, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTarget } from './maintenance-target.mjs';
const execute = promisify(execFile), fail = () => { throw new Error('PP1_ACCOUNT_VERIFICATION_FAILED'); };
const ensure = value => { if (!value) fail(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const exact = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const timestamp = value => instant(value) && new Date(value).toISOString() === value;
export function parseArgs(argv) {
  ensure(Array.isArray(argv) && argv.length === 6); const fields = {};
  for (let i = 0; i < argv.length; i += 2) {
    ensure(['--run-root','--stage','--operation-id'].includes(argv[i]) && !Object.hasOwn(fields, argv[i]));
    ensure(typeof argv[i+1] === 'string' && argv[i+1].length > 0 && !argv[i+1].startsWith('--')); fields[argv[i]] = argv[i+1];
  }
  ensure(fields['--stage'] === 'initialized' && uuid(fields['--operation-id']));
  return { runRoot: fields['--run-root'], stage: fields['--stage'], operationId: fields['--operation-id'] };
}
async function directory(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/')) { current = join(current, part); ensure(!(await lstat(current)).isSymbolicLink()); }
  const info = await lstat(path); ensure(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o7777) === 0o700);
}
async function read(path) {
  await directory(parse(path).dir); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const info = await handle.stat(); ensure(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o7777) === 0o600 && info.size <= 1048576);
    return JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
}
// One fixed aggregate query: only validated canonical metadata is interpolated; rows and hashes never leave PostgreSQL.
function query(operationId, principalId, releaseId, targetId) {
  return `WITH expected(action, surfaces) AS (VALUES
 ('read_published', ARRAY['front','back','admin']::text[]),
 ('read_draft', ARRAY['back','admin']::text[]),
 ('create', ARRAY['back','admin']::text[]),
 ('update', ARRAY['back','admin']::text[]),
 ('publish', ARRAY['back','admin']::text[]),
 ('unpublish', ARRAY['back','admin']::text[]),
 ('delete', ARRAY['back','admin']::text[]),
 ('archive', ARRAY['back','admin']::text[]),
 ('manage_media', ARRAY['back','admin']::text[]),
 ('manage_types', ARRAY['admin']::text[]),
 ('manage_principals', ARRAY['admin']::text[]),
 ('manage_settings', ARRAY['admin']::text[]),
 ('read_audit', ARRAY['admin']::text[])
), actual AS (
 SELECT p.action, p.allowed_surfaces AS surfaces FROM cms_permission p JOIN cms_role r ON r.id=p.role_id
 WHERE r.code='admin' AND p.content_type_code IS NULL AND p.predicate_json IS NULL
), differences AS (
 (SELECT * FROM actual EXCEPT SELECT * FROM expected)
 UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
), expected_migrations(installed_rank, version, type, script) AS (VALUES
 (1,'1','SQL','V1__wave_a_baseline.sql'),
 (2,'2','SQL','V2__identity.sql'),
 (3,'3','SQL','V3__content.sql'),
 (4,'4','SQL','V4__media.sql'),
 (5,'5','SQL','V5__type_settings_and_field_metadata.sql'),
 (6,'6','SQL','V6__entry_index_scope.sql'),
 (7,'7','JDBC','db.migration.V7__backfill_entry_index'),
 (8,'8','SQL','V8__publish_request_and_audit_indexes.sql'),
 (9,'9','SQL','V9__audit_retention.sql'),
 (10,'10','JDBC','db.migration.V10__index_ref_fields')
), actual_migrations AS (SELECT installed_rank, version::text, type::text, script::text FROM flyway_schema_history), migration_differences AS (
 (SELECT * FROM actual_migrations EXCEPT SELECT * FROM expected_migrations)
 UNION ALL (SELECT * FROM expected_migrations EXCEPT SELECT * FROM actual_migrations)
)
SELECT json_build_object(
 'principal',(SELECT count(*) FROM cms_principal), 'credential',(SELECT count(*) FROM cms_credential),
 'roleAssignment',(SELECT count(*) FROM cms_principal_role), 'permission',(SELECT count(*) FROM cms_permission),
 'session',(SELECT count(*) FROM cms_session), 'audit',(SELECT count(*) FROM cms_audit_event),
 'roles',(SELECT count(*) FROM cms_role), 'types',(SELECT count(*) FROM cms_content_type),
 'migrations',(SELECT count(*) FROM flyway_schema_history),
 'failedMigrations',(SELECT count(*) FROM flyway_schema_history WHERE NOT success),
 'serverVersion',current_setting('server_version_num')::int,
 'contentRows',(SELECT count(*) FROM cms_entry)+(SELECT count(*) FROM cms_entry_revision)
   +(SELECT count(*) FROM cms_entry_ref)+(SELECT count(*) FROM cms_entry_index)
   +(SELECT count(*) FROM cms_navigation_menu)+(SELECT count(*) FROM cms_media)
   +(SELECT count(*) FROM cms_media_variant)+(SELECT count(*) FROM cms_media_attachment),
 'roleCatalog',(SELECT bool_and(system) AND array_agg(code::text ORDER BY code)=
   ARRAY['admin','anonymous','editor','member','operator']::text[] FROM cms_role),
 'typeCatalog',(SELECT array_agg(type_key::text ORDER BY type_key)=ARRAY[
   'album','appointment_request','clinic_profile','issue','milestone','owner','page','pet','photo','project','vet','visit']::text[] FROM cms_content_type),
 'migrationCatalog',NOT EXISTS(SELECT 1 FROM migration_differences),
 'principalGraph',(SELECT count(*)=1 FROM cms_principal p
   JOIN cms_credential c ON c.principal_id=p.id JOIN cms_principal_role pr ON pr.principal_id=p.id JOIN cms_role r ON r.id=pr.role_id
   WHERE p.id='${principalId}'::uuid AND p.status='active' AND p.email IS NULL
     AND p.failed_login_count=0 AND p.locked_until IS NULL AND p.last_login_at IS NULL AND p.deleted_at IS NULL
     AND c.type='password' AND c.algo='argon2id' AND c.secret_hash ~ '^[$]argon2id[$]v=19[$]m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*[$][A-Za-z0-9+/]+={0,2}[$][A-Za-z0-9+/]+={0,2}$'
     AND r.code='admin' AND pr.content_type_codes=ARRAY[]::text[]),
 'permissionGraph',NOT EXISTS(SELECT 1 FROM differences) AND (SELECT count(*)=13 FROM actual)
   AND NOT EXISTS(SELECT 1 FROM cms_permission p JOIN cms_role r ON r.id=p.role_id WHERE r.code<>'admin'),
 'auditGraph',(SELECT count(*)=1 FROM cms_audit_event a
   WHERE a.category='AUTH' AND a.action='PRODUCTION_ADMIN_INITIALIZED' AND a.actor_principal_id IS NULL
     AND a.target_type='principal' AND a.target_id='${principalId}'::uuid AND a.surface='admin' AND a.outcome='ok'
     AND a.detail_json->>'operationId'='${operationId}' AND a.detail_json->>'releaseId'='${releaseId}'
     AND a.detail_json->>'targetId'='${targetId}' AND a.detail_json->>'mode'='FRESH_INIT'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a.detail_json) AS keys(k))=ARRAY['mode','operationId','releaseId','targetId']::text[])
)::text;`;
}
export async function verifyAccounts(runRoot, operationId, deps = {}) {
  try {
    ensure(uuid(operationId) && typeof runRoot === 'string' && isAbsolute(runRoot) && resolve(runRoot) === runRoot && !/[\r\n\0]/.test(runRoot));
    const root = resolve(runRoot), base = join(root, 'maintenance'); await directory(root); await directory(base);
    const inspection = await inspectTarget(root, deps, { apiState: 'running' }), target = inspection.target, targetKeys = Object.keys(target);
    const storedTarget = await read(join(base, 'target.json')), lease = await read(join(base, 'lease.json'));
    ensure(same(storedTarget, target) && exact(lease, [...targetKeys,'connection','operationId','operation','releaseId','phase','boundBackend','createdAt']));
    ensure(targetKeys.every(k => same(lease[k], target[k])) && same(lease.connection, { jdbcUrl: inspection.jdbcUrl, dataGateway: inspection.dataGateway }));
    ensure(lease.operationId === operationId && lease.operation === 'FRESH_INIT' && lease.releaseId === `sha256:${target.apiBuild.jarSha256}` && lease.phase === 'COMPLETE' && timestamp(lease.createdAt));
    const b = lease.boundBackend; ensure(exact(b, ['pid','backendStartEpoch','db','role','clientAddr','applicationName']));
    ensure(Number.isInteger(b.pid) && b.pid > 0 && b.pid <= 2147483647 && typeof b.backendStartEpoch === 'string' && /^[1-9][0-9]*\.[0-9]+$/.test(b.backendStartEpoch));
    ensure(b.db === 'cms' && b.role === 'cms_local' && b.clientAddr === inspection.dataGateway && b.applicationName === operationId);
    const journal = await read(join(base, 'operations', `${operationId}.json`)), result = await read(join(base, 'operations', `${operationId}.result.json`));
    ensure(exact(journal, ['operationId','operation','targetId','releaseId','phase','at','failureCode']) && journal.phase === 'COMPLETE' && journal.failureCode === null && timestamp(journal.at));
    ensure(exact(result, ['operationId','operation','principalId','completedAt','releaseId','targetId']) && uuid(result.principalId) && instant(result.completedAt));
    for (const record of [journal, result]) ensure(['operationId','operation','targetId','releaseId'].every(k => record[k] === lease[k]));
    try { await lstat(join(base, 'operation.lock')); fail(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const env = { ...(deps.environment ?? process.env) };
    for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
    const docker = async args => {
      const response = await (deps.command ?? execute)('docker', ['--host','unix:///var/run/docker.sock', ...args], { env, shell: false, timeout: 30000, maxBuffer: 1024 * 1024 });
      ensure(response.code === undefined || response.code === 0); ensure(typeof response.stdout === 'string'); return response.stdout;
    };
    ensure((await docker(['inspect','--format','{{.State.Health.Status}}',target.containerIds['cms-api']])).trim() === 'healthy');
    const aggregate = JSON.parse(await docker(['exec',target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',query(operationId,result.principalId,lease.releaseId,target.targetId)]));
    const expected = { principal: 1, credential: 1, roleAssignment: 1, permission: 13, session: 0, audit: 1, roles: 5, types: 12, migrations: 10, failedMigrations: 0, contentRows: 0,
      roleCatalog: true, typeCatalog: true, migrationCatalog: true, principalGraph: true, permissionGraph: true, auditGraph: true };
    ensure(exact(aggregate, [...Object.keys(expected),'serverVersion']) && Object.entries(expected).every(([key,value]) => aggregate[key] === value));
    ensure(Number.isInteger(aggregate.serverVersion) && aggregate.serverVersion >= 160000 && aggregate.serverVersion < 170000);
    return { stage: 'initialized', verified: true };
  } catch { fail(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const args = parseArgs(process.argv.slice(2)); await verifyAccounts(args.runRoot, args.operationId); process.stdout.write('PP1_ACCOUNT_VERIFIED\n'); }
  catch { process.stderr.write('PP1_ACCOUNT_VERIFICATION_FAILED\n'); process.exitCode = 1; }
}
