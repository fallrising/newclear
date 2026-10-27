import {Fault,requireThat,strictJSON,enc,digest,unhex,timestamp,integer} from './protocol.mjs';

export async function getGrant(db,id,principal,now){const row=await db.prepare('SELECT * FROM grants WHERE id=?').bind(id).first();requireThat(row&&!row.revoked,403,'GRANT_REVOKED');const policy=strictJSON(enc.encode(row.policy));requireThat(policy.principal_id===principal&&timestamp(policy.not_before)<=now&&timestamp(policy.expires_at)>now,403,'SCOPE_DENIED');return {...row,policy};}
function b64(s){requireThat(/^[A-Za-z0-9_-]+$/.test(s),401,'UNAUTHENTICATED');try{return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{throw new Fault(401,'UNAUTHENTICATED');}}
async function access(request,env,now,fetcher){
 const config=JSON.parse(env.ACCESS_CONFIG||'null');requireThat(config&&/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer),401,'UNAUTHENTICATED');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');requireThat(token&&token.length<=16384,401,'UNAUTHENTICATED');const parts=token.split('.');requireThat(parts.length===3,401,'UNAUTHENTICATED');const h=strictJSON(b64(parts[0])),p=strictJSON(b64(parts[1]));requireThat(h.alg==='RS256'&&typeof h.kid==='string'&&!h.crit,401,'UNAUTHENTICATED');
 const response=await fetcher(config.issuer+'/cdn-cgi/access/certs',{redirect:'manual',signal:AbortSignal.timeout(5000)});requireThat(response.ok,401,'UNAUTHENTICATED');const jwks=strictJSON(await readJwks(response));const jwk=jwks.keys?.find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));
 requireThat(jwk,401,'UNAUTHENTICATED');const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);requireThat(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(parts[2]),enc.encode(parts[0]+'.'+parts[1])),401,'UNAUTHENTICATED');
 requireThat(p.iss===config.issuer&&Array.isArray(p.aud)&&p.aud.includes(config.audience)&&Number.isInteger(p.exp)&&p.exp*1000>now&&Number.isInteger(p.iat)&&p.iat*1000<=now+30000&&(!p.nbf||(Number.isInteger(p.nbf)&&p.nbf*1000<=now))&&typeof p.sub==='string',401,'UNAUTHENTICATED');const binding=config.subjects?.[p.sub];requireThat(binding,403,'SCOPE_DENIED');return {principal:binding.principal_id,grant_id:binding.grant_id,human:true};
}
async function readJwks(response){const reader=response.body.getReader();let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;requireThat(size<=32768,401,'UNAUTHENTICATED');chunks.push(value);}}finally{await reader.cancel();}const bytes=new Uint8Array(size);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length;}return bytes;}
export async function authenticate(request,env,bytes,now,fetcher=fetch){
 const url=new URL(request.url);requireThat(url.origin===env.PUBLIC_ORIGIN&&url.search===''&&url.protocol==='https:',403,'SCOPE_DENIED');let identity;
 const keyId=request.headers.get('X-Lab-Key-Id');
 if(keyId){
  requireThat(!request.headers.has('Origin'),403,'SCOPE_DENIED');const keys=JSON.parse(env.MACHINE_KEYS||'{}'),key=Object.hasOwn(keys,keyId)?keys[keyId]:null;
  requireThat(key&&!key.revoked&&timestamp(key.expires_at)>now&&typeof env.AUDIENCE==='string'&&env.AUDIENCE.length>0,401,'UNAUTHENTICATED');
  requireThat(typeof key.secret_hex==='string'&&/^[a-f0-9]{64,128}$/.test(key.secret_hex)&&key.secret_hex.length%2===0,503,'CONFIGURATION_INVALID');integer(key.generation,1,2147483647);
  const time=request.headers.get('X-Lab-Time')||'',nonce=request.headers.get('X-Lab-Nonce')||'',signature=request.headers.get('X-Lab-Signature')||'';
  requireThat(/^[0-9]{10,11}$/.test(time)&&/^[a-f0-9]{32}$/.test(nonce)&&/^[a-f0-9]{64}$/.test(signature)&&Math.abs(Number(time)*1000-now)<=120000,401,'UNAUTHENTICATED');
  // WebCrypto verification is used instead of a timing-sensitive string compare.
  const verifier=await crypto.subtle.importKey('raw',unhex(key.secret_hex),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const message=`CLOUDLAB-M1\n${env.AUDIENCE}\n${keyId}\n${key.generation}\n${request.method}\n${url.pathname}\n${time}\n${nonce}\n${await digest(bytes)}`;
  requireThat(await crypto.subtle.verify('HMAC',verifier,unhex(signature),enc.encode(message)),401,'UNAUTHENTICATED');
  try{await env.DB.batch([env.DB.prepare('DELETE FROM nonces WHERE expires_at < ?').bind(now),env.DB.prepare('INSERT INTO nonces(credential_id,nonce,expires_at) VALUES(?,?,?)').bind(keyId,nonce,now+600000)]);}catch(e){if(String(e).includes('UNIQUE'))throw new Fault(401,'REPLAY_REJECTED');throw e;}
  identity={principal:key.principal_id,grant_id:key.grant_id,human:false};
 }else identity=await access(request,env,now,fetcher);
 if(identity.human&&request.method!=='GET'){requireThat(request.headers.get('Origin')===env.PUBLIC_ORIGIN&&request.headers.get('X-Cloud-Lab')==='1',403,'ORIGIN_DENIED');}
 return {...identity,grant:await getGrant(env.DB,identity.grant_id,identity.principal,now)};
}
export function capability(ctx,...caps){requireThat(Array.isArray(ctx.grant.policy.capabilities)&&caps.every(x=>ctx.grant.policy.capabilities.includes(x)),403,'SCOPE_DENIED');}
