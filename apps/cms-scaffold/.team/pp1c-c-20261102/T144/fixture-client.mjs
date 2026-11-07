import { createHash } from 'node:crypto';
import { canonicalBytes } from '../../../scripts/ops/recovery-protocol.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,code='FIXTURE_INPUT_INVALID')=>{if(!ok)throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const plain=value=>typeof value==='string'&&value.length>0&&!/[\u0000-\u001f\u007f]/u.test(value);
const same=(a,b)=>canonicalBytes(a).equals(canonicalBytes(b));
const keys=(object,names)=>requireValue(object&&same(Object.keys(object).sort(),names.split(' ').sort()));
function validate(input) {
  keys(input,'sourceRunId admin operatorPassword pngs sessionConfig apiClient beforeFinalLogin');keys(input.admin,'username password');keys(input.pngs,'public replacement draft private deleted');keys(input.sessionConfig,'sessionAbsoluteSeconds sessionMaxSeconds');
  requireValue(/^[a-f0-9]{32}$/.test(input.sourceRunId)&&/^[a-z0-9._-]{3,32}$/.test(input.admin.username));
  for(const password of [input.admin.password,input.operatorPassword])requireValue(plain(password)&&password.length>=12);
  requireValue(input.admin.password.toLowerCase()!==input.admin.username&&typeof input.apiClient==='function'&&typeof input.beforeFinalLogin==='function');
  const operatorUsername=`pp1c-op-${input.sourceRunId.slice(0,16)}`;requireValue(input.admin.username!==operatorUsername&&input.operatorPassword.toLowerCase()!==operatorUsername);
  requireValue(Object.values(input.sessionConfig).every(s=>typeof s==='string'&&/^[1-9][0-9]*$/.test(s)));
  for(const png of Object.values(input.pngs))requireValue(Buffer.isBuffer(png)&&png.length>=33&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&png.toString('ascii',12,16)==='IHDR'&&png.readUInt32BE(16)===32&&png.readUInt32BE(20)===16);
  requireValue(new Set(Object.values(input.pngs).map(digest)).size===5);
}
function api(input) {
  const jars={admin:new Map(),operator:new Map(),anonymous:new Map()};
  async function request(actor,method,path,{json,multipart,bytes=false,status=200}={}) {
    const surface=actor==='admin'?'admin':actor==='operator'?'back':'front',jar=jars[actor];
    const headers={Origin:`https://${surface}.cms.test:8443`};
    if(jar.size)headers.Cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    if(method!=='GET'&&jar.has('cms_csrf'))headers['X-CSRF-Token']=jar.get('cms_csrf');
    if(json!==undefined)headers['Content-Type']='application/json';
    let response;try{response=await input.apiClient({method,path,surface,headers,...(json!==undefined?{json}:{}),...(multipart?{multipart}:{}),response:bytes?'bytes':'json'});}catch{throw Object.assign(new Error('FIXTURE_HTTP_FAILED'),{code:'FIXTURE_HTTP_FAILED'});}
    requireValue(response?.status===status,'FIXTURE_HTTP_STATUS');
    const seen=new Set();for(const cookie of response.setCookies??[]){
      requireValue(typeof cookie==='string'&&!/[\r\n]/.test(cookie),'FIXTURE_COOKIE_INVALID');const parts=cookie.split(';').map(v=>v.trim()),at=parts[0].indexOf('='),name=parts[0].slice(0,at),value=parts[0].slice(at+1);
      requireValue(['cms_session','cms_csrf'].includes(name)&&!seen.has(name)&&/^[A-Za-z0-9_-]+$/.test(value),'FIXTURE_COOKIE_INVALID');seen.add(name);
      requireValue(parts.some(p=>p.toLowerCase()==='secure')&&parts.some(p=>p.toLowerCase()==='path=/')&&parts.some(p=>p.toLowerCase()==='samesite=lax'),'FIXTURE_COOKIE_INVALID');
      requireValue(parts.some(p=>p.toLowerCase()===`max-age=${input.sessionConfig.sessionMaxSeconds}`),'FIXTURE_COOKIE_INVALID');
      if(name==='cms_session')requireValue(parts.some(p=>p.toLowerCase()==='httponly'),'FIXTURE_COOKIE_INVALID');jar.set(name,value);
    }
    if(status===204||status===404||status===410)return null;
    if(bytes){requireValue(Buffer.isBuffer(response.bytes)&&response.bytes.length>0,'FIXTURE_RESPONSE_INVALID');return response.bytes;}
    requireValue(response.json&&typeof response.json==='object'&&!Array.isArray(response.json),'FIXTURE_RESPONSE_INVALID');return response.json;
  }
  async function login(actor,credentials,expectedId=null) {
    const csrf=await request(actor,'GET','/api/v1/auth/csrf');requireValue(csrf.csrfToken===jars[actor].get('cms_csrf'),'FIXTURE_COOKIE_INVALID');
    const body=await request(actor,'POST','/api/v1/auth/login',{json:{username:credentials.username,password:credentials.password,surface:actor==='admin'?'admin':'back'}});
    requireValue(body.csrfToken===jars[actor].get('cms_csrf')&&plain(jars[actor].get('cms_session')),'FIXTURE_COOKIE_INVALID');
    requireValue(uuid(body.principal?.id)&&body.principal.username===credentials.username&&body.principal.status==='active'&&(!expectedId||body.principal.id===expectedId),'FIXTURE_PRINCIPAL_INVALID');
    requireValue(!body.forceChangePassword&&!body.mustChangePassword&&Array.isArray(body.roles)&&body.roles.some(r=>r.code===actor),'FIXTURE_PRINCIPAL_INVALID');
    if(actor==='operator')requireValue(body.roles.length===1&&same([...body.roles[0].contentTypeCodes].sort(),['album','photo']),'FIXTURE_PERMISSION_INVALID');
    return{principalId:body.principal.id,username:credentials.username,password:credentials.password,oldSessionToken:jars[actor].get('cms_session')};
  }
  return{request,login};
}
async function buildFixture(input) {
  validate(input);const {request,login}=api(input),admin=await login('admin',input.admin);
  const roles=await request('admin','GET','/api/v1/roles');for(const role of ['operator','anonymous'])requireValue(roles.items?.filter(r=>r.code===role).length===1,'FIXTURE_PERMISSION_INVALID');
  const operator={username:`pp1c-op-${input.sourceRunId.slice(0,16)}`,password:input.operatorPassword};
  requireValue(operator.username!==admin.username&&operator.password.toLowerCase()!==operator.username);
  const created=await request('admin','POST','/api/v1/principals',{status:201,json:{username:operator.username,displayName:'PP1c operator',email:null,temporaryPassword:operator.password}});
  requireValue(uuid(created.id)&&created.id!==admin.principalId&&created.username===operator.username&&created.status==='active'&&created.temporaryPassword===operator.password,'FIXTURE_PRINCIPAL_INVALID');
  await request('admin','PUT',`/api/v1/principals/${created.id}/roles`,{status:204,json:[{code:'operator',contentTypeCodes:['album','photo']}]});
  for(const role of ['operator','anonymous']) {
    const permissions=['album','photo'].flatMap(contentTypeCode=>(role==='operator'?['read_published','read_draft']:['read_published']).map(action=>({action,contentTypeCode,predicateJson:null,allowedSurfaces:role==='operator'?['back','admin']:['front']})));
    await request('admin','PUT',`/api/v1/roles/${role}/permissions`,{status:204,json:permissions});
    const actual=await request('admin','GET',`/api/v1/roles/${role}/permissions`);
    const normalize=values=>values.map(({action,contentTypeCode,predicateJson,allowedSurfaces})=>({action,contentTypeCode,predicateJson,allowedSurfaces:[...allowedSurfaces].sort()})).sort((a,b)=>(a.contentTypeCode+a.action).localeCompare(b.contentTypeCode+b.action));
    requireValue(Array.isArray(actual.items)&&same(normalize(actual.items),normalize(permissions)),'FIXTURE_PERMISSION_INVALID');
  }
  const media={},mediaBytes={};
  for(const [name,bytes,contentType]of [...['public','replacement','draft','private','deleted'].map(n=>[n,input.pngs[n],'image/png']),['pdf',Buffer.from('%PDF-1.4\n'),'application/pdf']]) {
    const uploaded=await request('admin','POST','/api/v1/media',{status:201,multipart:{file:{filename:name+(name==='pdf'?'.pdf':'.png'),contentType,bytes},fields:{}}});
    requireValue(uuid(uploaded.id)&&!Object.values(media).includes(uploaded.id)&&uploaded.contentType===contentType,'FIXTURE_MEDIA_INVALID');
    if(name!=='pdf')requireValue(uploaded.width===32&&uploaded.height===16,'FIXTURE_MEDIA_INVALID');media[name]=uploaded.id;mediaBytes[name]={};
    for(const variant of name==='pdf'?['original']:['original','thumbnail','web']) {
      requireValue(uploaded.variants?.[variant]?.url,'FIXTURE_MEDIA_INVALID');const read=await request('admin','GET',`/api/v1/media/${uploaded.id}/file/${variant}`,{bytes:true});
      if(variant==='original')requireValue(read.equals(bytes),'FIXTURE_MEDIA_INVALID');mediaBytes[name][variant]=read;
    }
  }
  await request('admin','DELETE',`/api/v1/media/${media.deleted}`,{status:204});
  await request('admin','GET',`/api/v1/media/${media.deleted}/file/original`,{status:410});
  const entry=async(type,payload,slug)=>{
    const value=await request('admin','POST',`/api/v1/content-types/${type}/entries`,{status:201,json:{...(slug?{slug}:{}),payload}});
    requireValue(uuid(value.id)&&Number.isInteger(value.version)&&value.version>0&&value.publicationState==='draft'&&same(value.payload,payload),'FIXTURE_ENTRY_INVALID');return value;
  };
  const publish=async value=>{
    const result=await request('admin','POST',`/api/v1/entries/${value.id}/publish`);
    requireValue(result.id===value.id&&result.publicationState==='published'&&Number.isInteger(result.version)&&result.version>value.version,'FIXTURE_ENTRY_INVALID');return result;
  };
  const album=await publish(await entry('album',{title:'PP1c restore album',visibility:'public'},`pp1c-${input.sourceRunId}`));
  const payload={title:'PP1c published',album:album.id,media:media.public,sortOrder:0};
  const photo=await publish(await entry('photo',payload));
  const firstRevisions=await request('admin','GET',`/api/v1/entries/${photo.id}/revisions`);
  requireValue(firstRevisions.items?.filter(r=>r.revisionNo===1).length===1,'FIXTURE_ENTRY_INVALID');
  const replacement={...payload,media:media.replacement};
  const patched=await request('admin','PATCH',`/api/v1/entries/${photo.id}`,{json:{version:photo.version,payload:replacement}});
  requireValue(patched.id===photo.id&&patched.version>photo.version&&patched.publicationState==='published'&&patched.dirty===true&&same(patched.payload,replacement),'FIXTURE_ENTRY_INVALID');
  const draft=await entry('photo',{title:'PP1c draft',album:album.id,media:media.draft,sortOrder:1});
  const pdf=await publish(await entry('photo',{title:'PP1c PDF',album:album.id,media:media.pdf,sortOrder:2}));
  requireValue(new Set([album.id,photo.id,draft.id,pdf.id]).size===4,'FIXTURE_ENTRY_INVALID');
  const privateEntry=await request('admin','GET',`/api/v1/entries/${photo.id}?include=refs`);
  const revisions=await request('admin','GET',`/api/v1/entries/${photo.id}/revisions`);
  const publicEntry=await request('anonymous','GET',`/api/v1/public/content-types/photo/entries/${photo.id}`);
  requireValue(privateEntry.id===photo.id&&same(privateEntry.payload,replacement)&&publicEntry.id===photo.id&&publicEntry.payload?.media?.id===media.public,'FIXTURE_ENTRY_INVALID');
  requireValue(same(firstRevisions,revisions),'FIXTURE_ENTRY_INVALID');
  await request('anonymous','GET',`/api/v1/public/content-types/photo/entries/${draft.id}`,{status:404});
  await login('operator',operator,created.id);
  const operatorEntry=await request('operator','GET',`/api/v1/entries/${photo.id}?include=refs`);
  requireValue(operatorEntry.id===photo.id&&same(operatorEntry.payload,replacement),'FIXTURE_ENTRY_INVALID');
  const expected={privateEntrySha256:digest(canonicalBytes(privateEntry)),operatorEntrySha256:digest(canonicalBytes(operatorEntry)),publicEntrySha256:digest(canonicalBytes(publicEntry)),revisionListSha256:digest(canonicalBytes(revisions))};
  for(const [name,variant,key]of [['public','original','publicOriginalSha256'],['public','thumbnail','publicThumbnailSha256'],['public','web','publicWebSha256'],['pdf','original','publicPdfSha256']]) {
    const bytes=await request('anonymous','GET',`/api/v1/public/media/${media[name]}/file/${variant}`,{bytes:true});requireValue(bytes.equals(mediaBytes[name][variant]),'FIXTURE_MEDIA_INVALID');expected[key]=digest(bytes);
  }
  for(const [name,key]of [['draft','draftOriginalSha256'],['private','privateOriginalSha256'],['replacement','replacedOriginalSha256']]){
    const bytes=await request('admin','GET',`/api/v1/media/${media[name]}/file/original`,{bytes:true});requireValue(bytes.equals(mediaBytes[name].original),'FIXTURE_MEDIA_INVALID');expected[key]=digest(bytes);
  }
  for(const name of ['replacement','draft','private','deleted'])await request('anonymous','GET',`/api/v1/public/media/${media[name]}/file/original`,{status:404});
  try{await input.beforeFinalLogin();}catch{throw Object.assign(new Error('FIXTURE_ORPHAN_FAILED'),{code:'FIXTURE_ORPHAN_FAILED'});}
  const recoverySecrets={admin:await login('admin',input.admin,admin.principalId),operator:await login('operator',operator,created.id)};
  for(const role of ['admin','operator']){const me=await request(role,'GET','/api/v1/auth/me');requireValue(me.principal?.id===recoverySecrets[role].principalId&&me.principal.username===recoverySecrets[role].username&&me.principal.status==='active','FIXTURE_PRINCIPAL_INVALID');}
  const smokeFixtureInput={version:1,sourceRunId:input.sourceRunId,adminPrincipalId:admin.principalId,operatorPrincipalId:created.id,publishedEntryId:photo.id,revisionNo:1,refEntryId:album.id,
    media:{publicImageId:media.public,publicPdfId:media.pdf,draftImageId:media.draft,privateImageId:media.private,replacedImageId:media.replacement,deletedImageId:media.deleted},expected,...input.sessionConfig};
  return{recoverySecrets,smokeFixtureInput};
}

export async function prepareSmokeFixture(input) {
  try{return await buildFixture(input);}catch(error){
    const known=['FIXTURE_INPUT_INVALID','FIXTURE_HTTP_FAILED','FIXTURE_HTTP_STATUS','FIXTURE_COOKIE_INVALID','FIXTURE_RESPONSE_INVALID','FIXTURE_PRINCIPAL_INVALID','FIXTURE_PERMISSION_INVALID','FIXTURE_MEDIA_INVALID','FIXTURE_ENTRY_INVALID','FIXTURE_ORPHAN_FAILED'];
    const code=known.includes(error?.code)?error.code:'FIXTURE_RESPONSE_INVALID';throw Object.assign(new Error(code),{code});
  }
}
