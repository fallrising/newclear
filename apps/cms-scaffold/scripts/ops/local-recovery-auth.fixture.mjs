// Shared test-only auth inventories; production never imports this fixture.
import { inventory, rehashInventory } from './local-recovery.fixture.mjs';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
export const authId=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const authHash=value=>sha256(canonicalBytes(value));
export function authRehash(f) {
  for(const value of [f.baseline,f.after]) {
    for(const table of value.tables)table.rows.sort((a,b)=>Buffer.compare(canonicalBytes(a),canonicalBytes(b)));
    rehashInventory(value);
  }
  f.context.baselineInventorySha256=authHash(f.baseline);f.context.afterInventorySha256=authHash(f.after);
  f.context.fixtureSha256=authHash(f.context.fixture);f.context.assertions.fixtureSha256=f.context.fixtureSha256;return f;
}
export function authRows(value,name){return value.tables.find(table=>table.tableName===name).rows;}
export function authFixture() {
  const baseline=inventory(),row=(name,values)=>({...Object.fromEntries(baseline.tables.find(table=>table.tableName===name).schema.columns.map(c=>[c.name,null])),...values});
  for(const name of ['cms_principal','cms_session','cms_audit_event'])for(const column of baseline.tables.find(table=>table.tableName===name).schema.columns) {
    if(column.name==='id'||column.name.endsWith('principal_id')||column.name==='target_id')Object.assign(column,{dataType:'uuid',udtName:'uuid'});
    if(column.name.endsWith('_at')||column.name==='at')Object.assign(column,{dataType:'timestamp with time zone',udtName:'timestamptz',datetimePrecision:'6'});
    if(column.name==='token_hash')Object.assign(column,{dataType:'bytea',udtName:'bytea'});
    if(column.name==='failed_login_count')Object.assign(column,{dataType:'integer',udtName:'int4',numericPrecision:'32',numericScale:'0'});
  }
  const fixture={version:1,sourceRunId:'a'.repeat(32),adminPrincipalId:authId(1),operatorPrincipalId:authId(2),
    oldSessionIds:{admin:authId(11),operator:authId(12)},publishedEntryId:authId(51),revisionNo:1,refEntryId:authId(52),
    media:Object.fromEntries(['publicImageId','publicPdfId','draftImageId','privateImageId','replacedImageId','deletedImageId'].map((key,i)=>[key,authId(41+i)])),
    expected:Object.fromEntries('privateEntrySha256 operatorEntrySha256 publicEntrySha256 revisionListSha256 publicOriginalSha256 publicThumbnailSha256 publicWebSha256 publicPdfSha256 draftOriginalSha256 privateOriginalSha256 replacedOriginalSha256'.split(' ').map(key=>[key,'c'.repeat(64)])),
    sessionAbsoluteSeconds:'43200',sessionMaxSeconds:'604800'};
  const operationId=authId(90),targetRunId='b'.repeat(32),ingressWebAddress='192.168.253.3';
  const observations={version:1,operationId,targetRunId};
  for(const [i,actor]of ['admin','operator'].entries()) {
    const principalId=authId(i+1),surface=i===0?'admin':'back';
    authRows(baseline,'cms_principal').push(row('cms_principal',{id:principalId,username:actor,display_name:actor,status:'active',failed_login_count:'0',
      last_login_at:'2026-11-06 10:00:00+00',created_at:'2026-11-06 10:00:00+00',updated_at:'2026-11-06 10:00:00+00'}));
    authRows(baseline,'cms_session').push(row('cms_session',{id:authId(11+i),principal_id:principalId,token_hash:'\\x'+(i===0?'d':'e').repeat(64),
      created_at:'2026-11-06 10:00:00+00',last_seen_at:'2026-11-06 10:00:00+00',expires_at:'2026-11-06 12:30:00+00',
      revoked_at:'2026-11-06 11:30:00+00',created_surface:surface,ip:ingressWebAddress,user_agent:'old agent'}));
    observations[actor]={principalId,sessionTokenSha256:(i===0?'a':'b').repeat(64),
      loginStartedAt:`2026-11-06T12:00:0${i}.123Z`,loginFinishedAt:`2026-11-06T12:00:0${i}.124Z`,oldRejectedAt:`2026-11-06T12:00:00.0${5+i}0Z`};
  }
  authRows(baseline,'cms_audit_event').push(row('cms_audit_event',{id:authId(40),at:'2026-11-06 11:30:00+00',category:'AUTH',action:'PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE',surface:'admin',outcome:'ok'}));
  baseline.files=[{objectKey:'orphan.bin',byteSize:'3',sha256:'f'.repeat(64),classification:'orphan'}];
  const after=structuredClone(baseline);
  for(const [i,actor]of ['admin','operator'].entries()) {
    const created=`2026-11-06 12:00:0${i}.123456+00`,seen=`2026-11-06 12:00:02.${i===0?'500123':'600789'}+00`;
    Object.assign(authRows(after,'cms_principal')[i],{last_login_at:created,updated_at:created});
    authRows(after,'cms_session').push(row('cms_session',{id:authId(21+i),principal_id:authId(i+1),token_hash:'\\x'+observations[actor].sessionTokenSha256,
      created_at:created,last_seen_at:seen,expires_at:`2026-11-07 00:00:02.${i===0?'500123':'600789'}+00`,created_surface:i===0?'admin':'back',
      ip:ingressWebAddress,user_agent:`CMS-PP1C-RESTORE/${operationId}`}));
    authRows(after,'cms_audit_event').push(row('cms_audit_event',{id:authId(31+i),at:`2026-11-06 12:00:0${i}.123999+00`,actor_principal_id:authId(i+1),
      category:'AUTH',action:'LOGIN_SUCCESS',target_type:'principal',target_id:authId(i+1),surface:i===0?'admin':'back',outcome:'ok',ip:ingressWebAddress}));
  }
  const assertions={version:1,operationId,targetRunId,fixtureSha256:'c'.repeat(64),startedAt:'2026-11-06T12:00:00.000Z',finishedAt:'2026-11-06T12:00:03.000Z',
    checks:Object.fromEntries('oldAdminRejected oldOperatorRejected adminLogin operatorLogin publishedBytes privateIsolation restoredContent originTls'.split(' ').map(key=>[key,true])),loginCount:'2',credentialDeliveries:'1'};
  return authRehash({baseline,after,context:{operationId,targetRunId,fixture,observations,assertions,ingressWebAddress,baselineInventorySha256:null,afterInventorySha256:null,fixtureSha256:null}});
}
