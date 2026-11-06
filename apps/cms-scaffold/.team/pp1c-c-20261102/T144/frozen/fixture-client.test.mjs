import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSmokeFixture } from './fixture-client.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function png(n){const b=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(32,16);b.writeUInt32BE(16,20);b[24]=n;return b;}
function fixture(complete=false){
  const calls=[],state={cookies:0,principal:0},sourceRunId='a'.repeat(32),admin={username:'local-admin',password:'private-admin-password'};
  const cookies=()=>[`cms_session=s${++state.cookies}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`,`cms_csrf=c${state.cookies}; Path=/; Secure; SameSite=Lax; Max-Age=604800`];
  const principal=role=>({id:id(role==='admin'?1:2),username:role==='admin'?admin.username:`pp1c-op-${sourceRunId.slice(0,16)}`,status:'active'});
  const apiClient=async r=>{calls.push(r);
    if(r.path==='/api/v1/auth/csrf')return{status:200,json:{csrfToken:'initial'},setCookies:['cms_csrf=initial; Path=/; Secure; SameSite=Lax; Max-Age=604800']};
    if(r.path==='/api/v1/auth/login') {const role=r.json.username===admin.username?'admin':'operator',setCookies=cookies();return{status:200,json:{principal:principal(role),roles:[{code:role,contentTypeCodes:role==='admin'?[]:['album','photo']}],surfaces:['back','admin'],csrfToken:`c${state.cookies}`},setCookies};}
    if(r.path==='/api/v1/roles')return{status:200,json:{items:[{code:'admin'},{code:'operator'},{code:'anonymous'}]}};
    if(r.path==='/api/v1/principals'&&r.method==='POST')return{status:201,json:{...principal('operator'),temporaryPassword:r.json.temporaryPassword}};
    if(r.path===`/api/v1/principals/${id(2)}/roles`)return{status:204};
    if(r.path.includes('/permissions')){if(r.method==='PUT'){state[r.path]=r.json;return{status:204};}return{status:200,json:{items:state[r.path].map((p,i)=>({...p,id:id(i+50)}))}};}
    if(!complete)throw new Error('MOCK_STOP_AFTER_IDENTITY');
    state.media??=[];state.entries??=[];
    if(r.path==='/api/v1/media'&&r.method==='POST'){
      const file=r.multipart.file,pdf=file.contentType==='application/pdf',media={id:id(100+state.media.length),width:pdf?null:32,height:pdf?null:16,contentType:file.contentType,variants:Object.fromEntries((pdf?['original']:['original','thumbnail','web']).map(v=>[v,{url:'fixed'}]))};
      state.media.push({...media,bytes:file.bytes});return{status:201,json:media};
    }
    const mediaMatch=r.path.match(/^\/api\/v1\/(public\/)?media\/([^/]+)(?:\/file\/(original|thumbnail|web))?$/);
    if(mediaMatch){const m=state.media.find(m=>m.id===mediaMatch[2]);if(r.method==='DELETE'){m.deleted=true;return{status:204};}
      const publicIds=[state.media[0]?.id,state.media[5]?.id];if(m.deleted||mediaMatch[1]&&!publicIds.includes(m.id))return{status:404};
      return{status:200,bytes:mediaMatch[3]==='original'?m.bytes:Buffer.from(m.id+':'+mediaMatch[3])};}
    if(r.path.match(/^\/api\/v1\/content-types\/(album|photo)\/entries$/)&&r.method==='POST'){
      const entry={id:id(200+state.entries.length),version:1,publicationState:'draft',payload:r.json.payload};state.entries.push(entry);return{status:201,json:structuredClone(entry)};
    }
    const entryMatch=r.path.match(/^\/api\/v1\/entries\/([^/?]+)(\/publish|\/revisions|\?include=refs)?$/);
    if(entryMatch){const entry=state.entries.find(e=>e.id===entryMatch[1]);if(entryMatch[2]==='/publish'){entry.publicationState='published';entry.version++;entry.publishedPayload=structuredClone(entry.payload);return{status:200,json:structuredClone(entry)};}
      if(entryMatch[2]==='/revisions')return{status:200,json:{items:[{revisionNo:1,slug:'',publishedAt:'2026-11-02T00:00:00Z'}]}};
      if(r.method==='PATCH'){assert.equal(r.json.version,entry.version);entry.version++;entry.payload=r.json.payload;entry.dirty=true;return{status:200,json:structuredClone(entry)};}
      return{status:200,json:{...structuredClone(entry),refs:{actor:r.surface}}};}
    if(r.path.startsWith('/api/v1/public/content-types/photo/entries/')){const entry=state.entries.find(e=>e.id===r.path.split('/').at(-1));if(entry.publicationState!=='published')return{status:404};return{status:200,json:{id:entry.id,payload:{...entry.publishedPayload,media:{id:entry.publishedPayload.media}}}};}
    if(r.path==='/api/v1/auth/me'){const role=r.surface==='admin'?'admin':'operator';return{status:200,json:{principal:principal(role),roles:[{code:role,contentTypeCodes:role==='admin'?[]:['album','photo']}]}};}
    throw new Error('MOCK_UNKNOWN_FIXED_PATH');
  };
  return{calls,state,input:{sourceRunId,admin,operatorPassword:'private-operator-password',pngs:Object.fromEntries(['public','replacement','draft','private','deleted'].map((k,i)=>[k,png(i+1)])),sessionConfig:{sessionAbsoluteSeconds:'43200',sessionMaxSeconds:'604800'},apiClient,beforeFinalLogin:async()=>{calls.push({hook:'orphan'});}}};
}
test('T144_identity_uses_fixed_operator_and_anonymous_permissions_before_media',async()=>{
  const f=fixture();await assert.rejects(prepareSmokeFixture(f.input),e=>e.code==='FIXTURE_HTTP_FAILED');
  const permissions=f.calls.filter(r=>r.method==='PUT'&&r.path.includes('/permissions'));
  assert.equal(permissions.length,2);assert.equal(permissions[0].json.length,4);assert.equal(permissions[1].json.length,2);
});

test('T144_full_fixed_recipe_returns_actual_ids_hashes_and_last_memory_sessions',async()=>{
  const f=fixture(true),result=await prepareSmokeFixture(f.input);
  assert.deepEqual(Object.keys(result).sort(),['recoverySecrets','smokeFixtureInput']);
  assert.equal(result.smokeFixtureInput.publishedEntryId,id(201));assert.equal(result.smokeFixtureInput.refEntryId,id(200));
  assert.equal(result.smokeFixtureInput.media.replacedImageId,id(101));assert.equal(result.smokeFixtureInput.revisionNo,1);
  assert.equal(result.recoverySecrets.admin.oldSessionToken,'s3');assert.equal(result.recoverySecrets.operator.oldSessionToken,'s4');
  const hook=f.calls.findIndex(r=>r.hook==='orphan'),last=f.calls.slice(hook+1);assert.equal(last.filter(r=>r.path==='/api/v1/auth/login').length,2);
  assert.ok(!last.some(r=>r.method==='POST'&&r.path!=='/api/v1/auth/login'));
  const publicHash=result.smokeFixtureInput.expected.publicOriginalSha256;assert.match(publicHash,/^[a-f0-9]{64}$/);
  assert.notEqual(result.smokeFixtureInput.expected.privateEntrySha256,result.smokeFixtureInput.expected.operatorEntrySha256);
});
import { createHash } from 'node:crypto';
import { canonicalBytes } from '../../../scripts/ops/recovery-protocol.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('T144_png_order_is_fixed_independently_of_caller_object_order',async()=>{
  const f=fixture(true);f.input.pngs=Object.fromEntries(Object.entries(f.input.pngs).reverse());
  await prepareSmokeFixture(f.input);assert.deepEqual(f.calls.filter(r=>r.multipart).map(r=>r.multipart.file.filename),['public.png','replacement.png','draft.png','private.png','deleted.png','pdf.pdf']);
});
test('T144_malformed_response_has_compact_fixed_failure',async()=>{
  const f=fixture(true),original=f.input.apiClient;f.input.apiClient=async r=>{const result=await original(r);if(r.method==='GET'&&r.path==='/api/v1/roles/operator/permissions')result.json.items[0].allowedSurfaces=null;return result;};
  await assert.rejects(prepareSmokeFixture(f.input),e=>e.code==='FIXTURE_RESPONSE_INVALID');
});
for(const fault of ['missing-hook','invalid-run','duplicate-png','wrong-size','bad-seconds','short-password','same-actor'])test(`T144_invalid_${fault}_makes_no_HTTP_calls`,async()=>{
  const f=fixture(true);
  if(fault==='missing-hook')delete f.input.beforeFinalLogin;
  if(fault==='invalid-run')f.input.sourceRunId='../source';
  if(fault==='duplicate-png')f.input.pngs.deleted=f.input.pngs.public;
  if(fault==='wrong-size')f.input.pngs.public.writeUInt32BE(64,16);
  if(fault==='bad-seconds')f.input.sessionConfig.sessionMaxSeconds=604800;
  if(fault==='short-password')f.input.operatorPassword='short';
  if(fault==='same-actor')f.input.admin.username=`pp1c-op-${f.input.sourceRunId.slice(0,16)}`;
  await assert.rejects(prepareSmokeFixture(f.input),e=>e.code==='FIXTURE_INPUT_INVALID');assert.equal(f.calls.length,0);
});
for(const [fault,code]of [['cookie-insecure','FIXTURE_COOKIE_INVALID'],['csrf-mismatch','FIXTURE_COOKIE_INVALID'],['force-change','FIXTURE_PRINCIPAL_INVALID'],['unknown-role','FIXTURE_PERMISSION_INVALID'],['extra-permission','FIXTURE_PERMISSION_INVALID'],['temporary-password','FIXTURE_PRINCIPAL_INVALID'],['media-bytes','FIXTURE_MEDIA_INVALID'],['missing-revision','FIXTURE_ENTRY_INVALID'],['wrong-version','FIXTURE_ENTRY_INVALID'],['public-private','FIXTURE_HTTP_STATUS']])test(`T144_${fault}_fails_before_orphan_and_final_logins`,async()=>{
  const f=fixture(true),original=f.input.apiClient;
  f.input.apiClient=async r=>{const result=await original(r);
    if(fault==='cookie-insecure'&&r.path==='/api/v1/auth/login')result.setCookies[0]=result.setCookies[0].replace('; Secure','');
    if(fault==='csrf-mismatch'&&r.path==='/api/v1/auth/login')result.json.csrfToken='other';
    if(fault==='force-change'&&r.path==='/api/v1/auth/login')result.json.forceChangePassword=true;
    if(fault==='unknown-role'&&r.path==='/api/v1/roles')result.json.items=result.json.items.filter(r=>r.code!=='operator');
    if(fault==='extra-permission'&&r.method==='GET'&&r.path==='/api/v1/roles/anonymous/permissions')result.json.items.push({...result.json.items[0],action:'create'});
    if(fault==='temporary-password'&&r.path==='/api/v1/principals')result.json.temporaryPassword='wrong';
    if(fault==='media-bytes'&&r.response==='bytes')result.bytes=Buffer.from('wrong');
    if(fault==='missing-revision'&&r.path.endsWith('/revisions'))result.json.items=[];
    if(fault==='wrong-version'&&r.method==='PATCH')result.json.version=1;
    if(fault==='public-private'&&r.path===`/api/v1/public/media/${id(101)}/file/original`)result.status=200;
    return result;};
  await assert.rejects(prepareSmokeFixture(f.input),e=>e.code===code);assert.ok(!f.calls.some(r=>r.hook));
});
test('T144_requests_use_exact_surface_cookies_csrf_and_no_credential_leak',async()=>{
  const f=fixture(true),original=f.input.apiClient,lastTokens=new Map();
  f.input.apiClient=async r=>{
    assert.equal(r.headers.Origin,`https://${r.surface}.cms.test:8443`);assert.ok(r.path.startsWith('/api/v1/')&&!r.path.includes('password'));
    const cookies=Object.fromEntries((r.headers.Cookie??'').split('; ').filter(Boolean).map(p=>p.split('=')));
    if(r.surface==='front')assert.equal(r.headers.Cookie,undefined);
    else if(cookies.cms_session)assert.equal(cookies.cms_session,lastTokens.get(r.surface));
    if(r.method!=='GET'&&cookies.cms_session)assert.equal(r.headers['X-CSRF-Token'],cookies.cms_csrf);
    const result=await original(r);if(r.path==='/api/v1/auth/login')lastTokens.set(r.surface,result.setCookies[0].split(';')[0].split('=')[1]);return result;
  };
  const result=await prepareSmokeFixture(f.input),safe=canonicalBytes(result.smokeFixtureInput).toString();
  assert.equal(result.smokeFixtureInput.expected.publicOriginalSha256,hash(f.input.pngs.public));
  assert.equal(result.smokeFixtureInput.expected.publicPdfSha256,hash(Buffer.from('%PDF-1.4\n')));
  for(const actor of Object.values(result.recoverySecrets))for(const k of ['username','password','oldSessionToken'])assert.ok(!safe.includes(actor[k]));
  assert.equal(Object.hasOwn(result.smokeFixtureInput,'oldSessionIds'),false);assert.equal(f.calls.filter(r=>r.hook).length,1);
});
test('T144_transport_and_orphan_errors_do_not_echo_private_messages',async()=>{
  for(const stage of ['transport','orphan']){
    const f=fixture(true),canary='PRIVATE-CREDENTIAL-CANARY';
    if(stage==='transport')f.input.apiClient=async()=>{throw new Error(canary);};else f.input.beforeFinalLogin=async()=>{throw new Error(canary);};
    await assert.rejects(prepareSmokeFixture(f.input),e=>e.code===(stage==='transport'?'FIXTURE_HTTP_FAILED':'FIXTURE_ORPHAN_FAILED')&&!String(e).includes(canary)&&!JSON.stringify(e).includes(canary));
  }
});
