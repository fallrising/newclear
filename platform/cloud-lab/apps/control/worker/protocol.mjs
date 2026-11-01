// Web Platform APIs only: usable in Workers and the Node test harness.
export class Fault extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
export function requireThat(ok,status=422,code='SCHEMA_INVALID'){if(!ok)throw new Fault(status,code);}
export const enc=new TextEncoder();
export const iso=t=>new Date(t).toISOString().replace('.000Z','Z');
export function timestamp(s){requireThat(typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s));const t=Date.parse(s);requireThat(Number.isFinite(t)&&iso(t)===s);return t;}
export function integer(v,min,max){requireThat(Number.isSafeInteger(v)&&v>=min&&v<=max);return v;}
export function fields(v,keys){requireThat(v&&typeof v==='object'&&!Array.isArray(v));requireThat(Object.keys(v).sort().join(',')===keys.slice().sort().join(','));return v;}
export function id(v){requireThat(typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v));return v;}
export function strictJSON(bytes){
 requireThat(bytes.length<=32768,413,'BODY_TOO_LARGE');let s;try{s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Fault(422,'SCHEMA_INVALID');}
 let i=0;const ws=()=>{while(/[ \r\n\t]/.test(s[i]||'!'))i++;};
 function string(){const start=i++;while(i<s.length){const c=s[i++];if(c==='"'){try{const v=JSON.parse(s.slice(start,i));requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v));return v;}catch{throw new Fault(422,'SCHEMA_INVALID');}}if(c==='\\')i++;}throw new Fault(422,'SCHEMA_INVALID');}
 function value(depth){requireThat(depth<12);ws();const c=s[i];if(c==='"')return string();if(c==='{'||c==='['){i++;const obj=c==='{'?Object.create(null):[];const end=c==='{'?'}':']';ws();if(s[i]===end){i++;return obj;}while(true){ws();if(c==='{'){requireThat(s[i]==='"');const k=string();requireThat(!Object.hasOwn(obj,k));ws();requireThat(s[i++]===':');obj[k]=value(depth+1);}else obj.push(value(depth+1));ws();if(s[i]===end){i++;return obj;}requireThat(s[i++]===',');}}
 for(const [lit,v] of [['true',true],['false',false],['null',null]])if(s.startsWith(lit,i)){i+=lit.length;return v;}
 const m=s.slice(i).match(/^-?(?:0|[1-9][0-9]*)/);requireThat(m);i+=m[0].length;const n=Number(m[0]);requireThat(Number.isSafeInteger(n)&&!Object.is(n,-0));return n;
 }
 const result=value(0);ws();requireThat(i===s.length);return result;
}
export async function readBody(request){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let length=0;const parts=[];try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;requireThat(length<=32768,413,'BODY_TOO_LARGE');parts.push(r.value);}}finally{await reader.cancel();}const out=new Uint8Array(length);let n=0;for(const p of parts){out.set(p,n);n+=p.length;}return out;}
export const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(value){return hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value));}
export function unhex(s){requireThat(typeof s==='string'&&/^(?:[a-f0-9]{2})+$/.test(s));return Uint8Array.from(s.match(/../g),x=>parseInt(x,16));}
export async function sign(secret,audience,key,generation,method,path,time,nonce,body){const message=`CLOUDLAB-M1\n${audience}\n${key}\n${generation}\n${method}\n${path}\n${time}\n${nonce}\n${await digest(body)}`;const k=await crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(message)));}
export const RECIPE_BYTES='{"recipe_id":"node-health","version":"1.0.0","owner":"python-node-health","profile":"unprivileged-read-only","collector":"python-os-health","healthy_policy":"load_1m_milli<=cpu_count*2000;disk_free_percent>=10","timeout_seconds":10,"output_budget_bytes":16384,"verification":"schema-freshness-scope-v1"}\n';
export async function recipeRef(){return {recipe_id:'node-health',version:'1.0.0',digest:'sha256:'+await digest(RECIPE_BYTES)};}
export function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function sameRef(a,b){return a&&b&&a.resource_id===b.resource_id&&a.generation===b.generation;}
export function sameRecipe(a,b){return a&&b&&a.recipe_id===b.recipe_id&&a.version===b.version&&a.digest===b.digest;}
