import assert from 'node:assert/strict';
// Shared synthetic Node test fixture; production modules never import this file.
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, link } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { captureSource } from './local-bundle.mjs';
import { verifyCapturedBundle, protectCapturedBundle } from './local-recovery-verify.mjs';
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
  Object.assign(target,{version:1,databaseOid:16384,ingressScriptSha256:full('e'),nodeBinarySha256:full('f'),mediaProbeSha256:full('7'),
    containerIds:{postgres:full('1'),'cms-api':full('2'),ingress:full('3')},networkIds:{web:full('4'),data:full('5')}});
  target.images.node=`sha256:${full('6')}`;
  target.volumeNames=Object.fromEntries(['db-data','media-data'].map(name=>[name,`${target.project}_${name}`]));
  target.apiBuild={sourceCommit:target.sourceCommit,jarSha256:full('9'),baseImage:`sha256:${full('8')}`};
  const artifacts = { version:1,worktreeDirty:true,apiBuild:target.apiBuild,apiOrigin: 'https://api.cms.test:8443', sourceCommit: target.sourceCommit,
    ingressScriptSha256: full('e'), nodeBinarySha256: full('f'),
    dist: Object.fromEntries(['front', 'back', 'admin'].map(s => [s, { 'index.html': full('a') }])) };
  await writeFile(join(root, 'artifacts.json'), JSON.stringify(artifacts), { mode: 0o600 });
  const profile = { javaRuntimeVersion: '25.0.5+8', pgDumpVersion: '16.15', pgRestoreVersion: '16.15', postgresServerVersion: '16.15' };
  const ctx = { root, base, target, operationId: op,
    request: { startedAt: '2026-11-02T11:59:00.000Z' },
    lease: { source: target, operationId: op, purpose: 'BACKUP_LOCAL', helper:null, phase: 'SOURCE_QUIESCED' } };
  const token = Object.freeze({}), calls = [], state = { checks: 0, helpers: 0, inventoryCount: 0, fail: null };
  const workflow = {
    beginWorkflow: async () => { calls.push('begin'); return token; },
    assertWorkflow: async value => { assert.equal(value, token); state.checks++; if (state.writer) throw new OpsError('WRITER_NOT_QUIESCED'); return {...structuredClone(ctx),helperSequence:state.helpers}; },
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
      state.inventoryCount++; value = state.inventoryTemplate?structuredClone(state.inventoryTemplate):inventory();
      if(state.rawPermission)value.tables.find(t=>t.tableName==='cms_permission').rows=[{...Object.fromEntries(columns.cms_permission.map(k=>[k,null])),id:'10000000-0000-4000-8000-000000000001',action:'read'}];
      if(state.rawOrphan)value.files=[{objectKey:'orphan.bin',byteSize:'3',sha256:sha256(Buffer.from('raw')),classification:'orphan'}];
      value.mediaHeaderSha256=digest({version:1,files:value.files});
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
      const files=state.rawOrphan?[{objectKey:'orphan.bin',byteSize:'3',sha256:sha256(Buffer.from('raw')),classification:'orphan'}]:[];
      const header = canonicalBytes({ version: 1, files }), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(header.length));
      bytes = Buffer.concat([Buffer.from('PP1CMEDIA1\n'), length, header,...(state.rawOrphan?[Buffer.from('raw')]:[])]); name = 'media.package';
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

export function rehashInventory(value) {
  for(const t of value.tables) {
    t.schemaSha256=digest(t.schema);t.rowsSha256=digest(t.rows);
    t.snapshotSha256=digest({schema:t.schema,rows:t.rows});t.rowCount=String(t.rows.length);
  }
  value.dbSnapshotSha256=digest(value.tables.map(({tableName,schemaSha256,rowsSha256,rowCount})=>({tableName,schemaSha256,rowsSha256,rowCount})));
  value.mediaHeaderSha256=digest({version:1,files:value.files});return value;
}
export async function rawFixture(t,{mutateTarget,mutateSource,files=false,baseInventory}={}) {
  const f=await fixture(t);f.ctx.lease.purpose='RESTORE_VERIFY_LOCAL';
  f.state.rawPermission=true;f.state.rawOrphan=files;
  f.state.inventoryTemplate=baseInventory;
  const captured=await captureSource(f.token,f.deps);
  const verified=await verifyCapturedBundle(f.token,captured.backupId,f.deps);
  const copy=await protectCapturedBundle(f.token,verified,f.deps);
  const source=f.ctx.target,child=structuredClone(source),id='c'.repeat(32);
  Object.assign(child,{runId:id,targetId:`pp1-local:${id}`,project:`cms-pp1-local-${id}`,databaseOid:16385,
    containerIds:{postgres:full('6'),'cms-api':full('7'),ingress:full('8')},networkIds:{web:full('9'),data:full('0')}});
  child.volumeNames=Object.fromEntries(['db-data','media-data'].map(n=>[n,`${child.project}_${n}`]));
  const targetRoot=join(f.cwd,'child');await mkdir(targetRoot,{mode:0o700});
  f.ctx.lease.sourceConnection={jdbcUrl:'jdbc:postgresql://10.0.0.2:5432/cms',dataGateway:'10.0.0.1'};
  f.ctx.lease.target={identity:child,connection:{jdbcUrl:'jdbc:postgresql://10.1.0.2:5432/cms',dataGateway:'10.1.0.1'}};
  f.ctx.lease.phase='RAW_VERIFIED';f.ctx.helperSequence=8;
  f.deps.workflow.assertWorkflow=async(value,{side='source',stage}={})=>{
    assert.equal(value,f.token);if(stage)assert.equal(stage,f.ctx.lease.phase);
    const c=structuredClone(f.ctx);c.helperSequence=f.ctx.helperSequence;
    if(side==='target'){c.target=child;c.root=targetRoot;c.runRoot=targetRoot;c.connection=f.ctx.lease.target.connection;}
    else c.connection=f.ctx.lease.sourceConnection;
    return c;
  };
  const ownership=new WeakMap();
  f.deps.inventoryAuthority=async(token,result)=>{
    assert.equal(token,f.token);const m=ownership.get(result);
    if(!m)throw new OpsError('ADAPTER_UNSEALED');return m;
  };
  const results={};
  f.issueInventory=async(side,seq,value)=>{
    const identity=side==='target'?child:source;
    const connection=side==='target'?f.ctx.lease.target.connection:f.ctx.lease.sourceConnection;
    const dir=join(f.base,'operations',op,'helper',seq);await mkdir(join(dir,'output'),{recursive:true,mode:0o700});
    rehashInventory(value);
    const bytes=canonicalBytes(value),path=join(dir,'output/inventory.json');
    const request={version:1,mode:'INVENTORY',operationId:op,side,targetId:identity.targetId,releaseId:`sha256:${identity.apiBuild.jarSha256}`,
      jdbcUrl:connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
      mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
    await writeFile(path,bytes,{mode:0o600});await writeFile(join(dir,'request.json'),canonicalBytes(request),{mode:0o600});
    const result=Object.freeze({kind:'INVENTORY',path,sha256:sha256(bytes),byteSize:String(bytes.length)});
    ownership.set(result,Object.freeze({...result,seq,side,operationId:op,targetId:identity.targetId,
      releaseId:`sha256:${identity.apiBuild.jarSha256}`,requestSha256:digest(request)}));return result;
  };
  for(const side of ['target','source']) {
    const value=structuredClone(captured.inventory);if(side==='target')mutateTarget?.(value);else mutateSource?.(value);
    results[side]=await f.issueInventory(side,side==='target'?'7':'8',value);
  }
  return {...f,captured,verified,copy,results,child};
}

export function revocationFixture() {
  const raw=inventory(),at='2026-11-02 12:00:00.123456+00';
  const session=(digit,revoked)=>({...Object.fromEntries(columns.cms_session.map(k=>[k,null])),
    id:`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    principal_id:'10000000-0000-4000-8000-000000000001',token_hash:'\\x'+digit.repeat(64),
    created_at:'2026-11-01 10:00:00+00',expires_at:'2026-11-01 22:00:00+00',last_seen_at:'2026-11-01 10:00:00+00',
    revoked_at:revoked,created_surface:'admin'});
  raw.tables.find(t=>t.tableName==='cms_session').rows=[session('1',null),session('2',null),session('3','2026-11-01 11:00:00+00')];
  rehashInventory(raw);
  const context={operationId:op,backupId:'pp1-20261102T120000000Z-'+'b'.repeat(32),targetId:'pp1-local:'+'c'.repeat(32)};
  const receipt={operationId:op,backupId:context.backupId,revokedCount:'2',auditEventId:'40000000-0000-4000-8000-000000000004',committed:true};
  const after=structuredClone(raw);
  after.tables.find(t=>t.tableName==='cms_session').rows.forEach(row=>{if(row.revoked_at===null)row.revoked_at=at;});
  after.tables.find(t=>t.tableName==='cms_audit_event').rows=[{id:receipt.auditEventId,at,actor_principal_id:null,
    category:'AUTH',action:'PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE',target_type:'restore',target_id:null,
    surface:'admin',outcome:'ok',ip:null,detail_json:JSON.stringify({operationId:op,backupId:context.backupId,targetRef:context.targetId,revokedCount:'2'})}];
  rehashInventory(after);return{raw,after,receipt,context};
}

export async function revokedFixture(t) {
  const r=revocationFixture(),f=await rawFixture(t,{baseInventory:r.raw});
  const {compareRestoredBundle,restoreBundleMaterial}=await import('./local-recovery-verify.mjs');
  await compareRestoredBundle(f.token,f.results,f.deps);
  const material=await restoreBundleMaterial(f.token,f.deps);
  const receipt={...r.receipt,operationId:f.ctx.operationId,backupId:material.backupId};
  const post=structuredClone(f.captured.inventory);
  post.tables.find(t=>t.tableName==='cms_session').rows=structuredClone(r.after.tables.find(t=>t.tableName==='cms_session').rows);
  post.tables.find(t=>t.tableName==='cms_audit_event').rows=structuredClone(r.after.tables.find(t=>t.tableName==='cms_audit_event').rows);
  post.tables.find(t=>t.tableName==='cms_audit_event').rows[0].detail_json=JSON.stringify({operationId:f.ctx.operationId,backupId:material.backupId,targetRef:f.child.targetId,revokedCount:'2'});
  const dir=join(f.base,'operations',f.ctx.operationId,'helper/9');await mkdir(dir,{mode:0o700});
  const path=join(dir,'commit-receipt.json');await writeFile(path,canonicalBytes(receipt),{mode:0o600});
  const request={version:1,mode:'REVOKE_SESSIONS',operationId:f.ctx.operationId,side:'target',targetId:f.child.targetId,releaseId:`sha256:${f.child.apiBuild.jarSha256}`,
    jdbcUrl:f.ctx.lease.target.connection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:null,outputFile:null,
    backupId:material.backupId,rawProofSha256:material.rawProofSha256};
  await writeFile(join(dir,'request.json'),canonicalBytes(request),{mode:0o600});
  const commit=Object.freeze({kind:'REVOKE_SESSIONS',side:'target',receipt:Object.freeze(receipt)}),owned=new WeakMap();
  owned.set(commit,{side:'target',kind:'REVOKE_SESSIONS',seq:'9',operationId:f.ctx.operationId,targetId:f.child.targetId,releaseId:`sha256:${f.child.apiBuild.jarSha256}`,
    path,sha256:digest(receipt),byteSize:String(canonicalBytes(receipt).length),requestSha256:digest(request),backupId:material.backupId,rawProofSha256:material.rawProofSha256});
  f.deps.commitAuthority=(token,value)=>{const m=owned.get(value);if(token!==f.token||!m)throw new OpsError('ADAPTER_UNSEALED');return m;};
  f.ctx.lease.phase='SESSIONS_REVOKED';f.ctx.helperSequence=10;
  const inventory=await f.issueInventory('target','10',post);return {...f,commit,post,inventory,receipt};
}
