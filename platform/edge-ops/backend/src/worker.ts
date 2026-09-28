import { Store } from './store.ts';
import type { Database } from './store.ts';
import { HttpError, nodeId, object, requireThat, strictJson, telemetry, timestamp } from '../../contracts/validation.ts';

export interface Env {DB: Database; MODE?: string}
const MAX_BODY = 16 * 1024;
function loopback(url: URL): boolean {return ['127.0.0.1','localhost','[::1]'].includes(url.hostname);}
async function jsonBody(req: Request): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415,'json_required','Content-Type must be application/json');
  if (Number(req.headers.get('content-length') ?? 0)>MAX_BODY) throw new HttpError(413,'payload_too_large','Maximum body is 16 KiB');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400,'empty_body','JSON body is required');
  const chunks: Uint8Array[] = []; let size=0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size+=value.byteLength;
      if (size>MAX_BODY) {await reader.cancel();throw new HttpError(413,'payload_too_large','Maximum body is 16 KiB');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset=0;
  for (const c of chunks) {bytes.set(c,offset);offset+=c.byteLength;}
  let text: string;
  try {text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {throw new HttpError(400,'invalid_utf8','Body is not UTF-8');}
  return strictJson(text);
}
function human(req: Request, operator=false): string {
  // Deliberately fake identity adapter. Reachable ONLY in explicitly enabled loopback demo.
  const role=req.headers.get('x-edge-demo-role');
  if (!['viewer','operator','outsider'].includes(role ?? '')) throw new HttpError(401,'demo_identity_required','Select a mock identity');
  if (operator && role!=='operator') throw new HttpError(403,'forbidden','Mock operator role required');
  return role==='outsider' ? 'ws_other' : 'ws_demo';
}
function machine(req: Request): string {
  const id=req.headers.get('authorization')?.replace(/^Demo /,'');
  if (!id || req.headers.get('authorization') !== `Demo ${id}` || !/^node_demo(?:0[1-9]|10)$/.test(id)) throw new HttpError(401,'demo_agent_required','Synthetic Agent identity required');
  return id;
}
export async function handle(req: Request, env: Env, clock:()=>number=Date.now): Promise<Response> {
  const request_id=crypto.randomUUID();
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':request_id,'x-content-type-options':'nosniff'};
  const ok=(data: unknown,status=200)=>new Response(JSON.stringify({data,request_id}),{status,headers});
  try {
    const url=new URL(req.url), p=url.pathname, method=req.method;
    if (env.MODE !== 'demo' || !loopback(url)) throw new HttpError(503,'demo_disabled','Only explicit loopback demo mode is implemented; live mode is unavailable');
    const origin=req.headers.get('origin');
    if (origin && origin!==url.origin && origin!=='http://127.0.0.1:5173') throw new HttpError(403,'cross_origin_denied','Same-origin demo access only');
    const store=new Store(env.DB);
    if (method==='GET' && p==='/healthz') return ok({mode:'demo',auth:'mock-loopback-only',ready:true});
    if (method==='POST' && p==='/agent/v1/enroll') {
      const id=machine(req), body=object(await jsonBody(req),['node_id','display_name']); nodeId(body.node_id);
      if (body.node_id!==id) throw new HttpError(403,'node_mismatch','Agent cannot enroll another node');
      requireThat(typeof body.display_name==='string' && body.display_name.length>=1 && body.display_name.length<=60 && !/[\u0000-\u001f]/.test(body.display_name),'Invalid display name');
      await store.enroll(id,body.display_name); return ok({node_id:id,enrollment_generation:1,auth:'mock-loopback-only'},201);
    }
    if (method==='POST' && p==='/agent/v1/telemetry') {
      const id=machine(req), now=await store.now(clock), t=telemetry(await jsonBody(req),now);
      if (t.node_id!==id) throw new HttpError(403,'node_mismatch','Agent cannot report another node');
      return ok(await store.ingest(t,request_id,now));
    }
    if (p.startsWith('/agent/')) throw new HttpError(501,'capability_not_implemented','No job, command, log, or bootstrap channel exists');
    if (method==='POST' && p==='/demo/v1/reset') {
      human(req,true); const b=object(await jsonBody(req),['confirm']);
      requireThat(b.confirm==='RESET_SYNTHETIC_DATA','Explicit synthetic reset confirmation required');
      // Exact confirmation prevents accidental invocation from ordinary read clients.
      // The caller still has access only to this isolated synthetic database.
      // All multi-table resets are atomic.
      await store.reset(); return ok({reset:true});
    }
    if (method==='POST' && p==='/demo/v1/clock') {
      human(req,true); const b=object(await jsonBody(req),['advance_seconds']);
      requireThat(Number.isInteger(b.advance_seconds) && (b.advance_seconds as number)>0 && (b.advance_seconds as number)<=3600,'Advance must be 1..3600 seconds');
      await store.advance(b.advance_seconds as number); return ok({server_time:new Date(await store.now(clock)).toISOString()});
    }
    const workspace=human(req), now=await store.now(clock);
    if (method==='GET' && p==='/api/v1/nodes') {
      requireThat([...url.searchParams].length===0,'Unexpected query parameters');
      return ok({mode:'demo',auth:'mock-loopback-only',transport:'http-poll',server_time:new Date(now).toISOString(),nodes:await store.list(now,workspace),capabilities:{telemetry:true,logs:false,jobs:false,bootstrap:false}});
    }
    const match=p.match(/^\/api\/v1\/nodes\/(node_demo(?:0[1-9]|10))(\/metrics)?$/);
    if (method==='GET' && match) {
      const row=await store.row(match[1],workspace);
      if (!match[2]) return ok(await store.view(row,now));
      requireThat([...url.searchParams.keys()].every(k=>['from','to','limit'].includes(k)) && ['from','to','limit'].every(k=>url.searchParams.getAll(k).length<=1),'Unexpected or duplicate query parameter');
      const from=url.searchParams.get('from') ?? new Date(now-3600_000).toISOString(), to=url.searchParams.get('to') ?? new Date(now).toISOString();
      timestamp(from);timestamp(to);
      const limit=Number(url.searchParams.get('limit') ?? '120');
      requireThat(Number.isInteger(limit) && limit>=1 && limit<=240,'limit must be 1..240');
      requireThat(Date.parse(from)<=Date.parse(to) && Date.parse(to)-Date.parse(from)<=7*86400_000,'History range must be ordered and at most 7 days');
      return ok({node_id:row.id,from,to,...await store.history(row.id,from,to,limit)});
    }
    if (p.includes('/jobs') || p.includes('/logs') || p.includes('/recipes') || p.includes('/bootstrap')) throw new HttpError(501,'capability_not_implemented','This slice supports telemetry only');
    throw new HttpError(404,'not_found','Route not found');
  } catch (e) {
    const error=e instanceof HttpError ? e : new HttpError(503,'storage_unavailable','Backend unavailable; no success receipt issued');
    return new Response(JSON.stringify({code:error.code,message:error.message,retryable:error.status===503,request_id}),{status:error.status,headers});
  }
}
export default {fetch(req: Request, env: Env): Promise<Response> {return handle(req,env);}};
