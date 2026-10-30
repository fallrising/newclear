import {Fault,requireThat,strictJSON,readBody,enc,iso,timestamp,integer,fields,id,digest,recipeRef,sameRef,sameRecipe} from './protocol.mjs';
import {authenticate,getGrant,capability} from './auth.mjs';

const terminal=new Set(['result_recorded','cancelled_before_dispatch','expired_before_dispatch']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function scope(ctx,c){const g=ctx.grant.policy;requireThat(c.workspace_id===g.workspace_id&&sameRef(c.resource_ref,g.resource_ref)&&sameRecipe(c.recipe_ref,g.recipe_ref),403,'SCOPE_DENIED');}
function guardSQL(){return 'EXISTS(SELECT 1 FROM grants WHERE id=? AND revision=? AND revoked=0)';}
function guardArgs(ctx){return [ctx.grant.id,ctx.grant.revision];}
async function row(db,commandId){const r=await db.prepare('SELECT * FROM commands WHERE id=?').bind(commandId).first();requireThat(r,404,'NOT_FOUND');return r;}
function record(r){return JSON.parse(r.record);}
function view(r,now){const v=record(r);if(v.attempt&&!terminal.has(v.delivery)&&timestamp(v.attempt.lease_expires_at)<=now)v.delivery='reconciling';return v;}
async function save(db,r,next,ctx,extra='1',args=[]){next.revision=r.revision+1;const active=terminal.has(next.delivery)?0:1;const result=await db.prepare(`UPDATE commands SET record=?,revision=?,active=? WHERE id=? AND revision=? AND ${guardSQL()} AND (${extra})`).bind(JSON.stringify(next),next.revision,active,r.id,r.revision,...guardArgs(ctx),...args).run();requireThat(result.meta.changes===1,409,'REVISION_CONFLICT');return next;}
async function validateCommand(c,ctx,now){
 fields(c,['schema_version','schema_minor','workspace_id','resource_ref','recipe_ref','parameters','idempotency_key','not_before','dispatch_deadline','execution_deadline','timeout_seconds','output_budget_bytes']);
 requireThat(c.schema_version==='cloudlab.command.v1'&&c.schema_minor===0);id(c.workspace_id);id(c.idempotency_key);fields(c.resource_ref,['resource_id','generation']);id(c.resource_ref.resource_id);integer(c.resource_ref.generation,1,2147483647);fields(c.recipe_ref,['recipe_id','version','digest']);fields(c.parameters,['max_sample_age_seconds']);integer(c.parameters.max_sample_age_seconds,1,60);
 requireThat(sameRecipe(c.recipe_ref,await recipeRef()),422,'RECIPE_UNSUPPORTED');integer(c.timeout_seconds,10,10);integer(c.output_budget_bytes,16384,16384);scope(ctx,c);capability(ctx,'commands:submit','node:health:read');
 requireThat(c.timeout_seconds<=ctx.grant.policy.max_timeout_seconds&&c.output_budget_bytes<=ctx.grant.policy.max_output_bytes,403,'SCOPE_DENIED');
 const nb=timestamp(c.not_before),dd=timestamp(c.dispatch_deadline),ed=timestamp(c.execution_deadline);requireThat(nb<=dd&&dd<=ed&&dd<=now+60000&&ed<=now+120000&&nb>=now-120000&&dd>now&&ed-now>=c.timeout_seconds*1000&&ed<=timestamp(ctx.grant.policy.expires_at),422,'DEADLINE_INVALID');
}
async function submit(db,ctx,c,raw,now){
 // Schema and scope checks precede dedupe. A retry of a stored command may be late.
 const previous=await db.prepare('SELECT * FROM commands WHERE principal_id=? AND idem_key=?').bind(ctx.principal,typeof c?.idempotency_key==='string'?c.idempotency_key:'').first();
 if(previous){capability(ctx,'commands:submit','node:health:read');scope(ctx,record(previous).command);requireThat(previous.body===raw,409,'IDEMPOTENCY_CONFLICT');return view(previous,now);}
 await validateCommand(c,ctx,now);const command_id=crypto.randomUUID();const v={command_id,revision:1,command:c,delivery:'accepted',cancel_requested:false,external_ref:null,attempt:null,result:null,created_at:iso(now),updated_at:iso(now)};
 try{const out=await db.prepare(`INSERT INTO commands(id,principal_id,idem_key,body,body_digest,submit_grant,grant_revision,record,revision,active,created_at) SELECT ?,?,?,?,?,?,?,?,1,1,? WHERE ${guardSQL()} AND (SELECT count(*) FROM commands)<10000 AND (SELECT count(*) FROM commands WHERE created_at>?)<1440`).bind(command_id,ctx.principal,c.idempotency_key,raw,await digest(raw),ctx.grant.id,ctx.grant.revision,JSON.stringify(v),now,...guardArgs(ctx),now-86400000).run();requireThat(out.meta.changes===1,429,'QUOTA_EXCEEDED');return v;}catch(e){if(String(e).includes('UNIQUE')){const p=await db.prepare('SELECT * FROM commands WHERE principal_id=? AND idem_key=?').bind(ctx.principal,c.idempotency_key).first();if(p){requireThat(p.body===raw,409,'IDEMPOTENCY_CONFLICT');return view(p,now);}throw new Fault(429,'QUOTA_EXCEEDED');}throw e;}
}
// Explicit opt-in: old rows without a bounded policy never start new work.
function schedulePolicy(env,s){
 try{
  requireThat(typeof env.HEALTH_SCHEDULE==='string'&&enc.encode(env.HEALTH_SCHEDULE).length<=1024);
  const p=strictJSON(enc.encode(env.HEALTH_SCHEDULE));fields(p,['revision','interval_minutes','not_before','expires_at']);
  integer(p.revision,1,2147483647);requireThat(p.revision===s.revision&&[15,60,1440].includes(p.interval_minutes));
  const start=timestamp(p.not_before),end=timestamp(p.expires_at);
  requireThat(start%60000===0&&start<end&&end-start<=7*86400000);
  return {...p,start,end,interval:p.interval_minutes*60000};
 }catch(e){if(!(e instanceof Fault))throw e;return null;}
}
function scheduleDispatchAllowed(env,s,command,now){
 const p=s&&schedulePolicy(env,s);
 return Boolean(s?.enabled&&p&&now>=p.start&&now<p.end&&timestamp(command.execution_deadline)<=p.end);
}
async function healthSchedule(env,ctx,now){
 capability(ctx,'commands:read');const db=env.DB;
 const s=await db.prepare("SELECT * FROM schedules WHERE id='health-minute'").first();
 const envelope={schema_version:'cloudlab.health-schedule.v1',now:iso(now),cron_verified:false,schedule:null};
 if(!s)return envelope;
 const rawGrant=await db.prepare('SELECT * FROM grants WHERE id=?').bind(s.grant_id).first();
 requireThat(rawGrant,503,'CONFIGURATION_INVALID');const g=strictJSON(enc.encode(rawGrant.policy));scope(ctx,g);
 const p=schedulePolicy(env,s);let status=!s.enabled?'disabled':!p?(env.HEALTH_SCHEDULE?'invalid_policy':'unconfigured'):now>=p.end?'expired':now<p.start?'waiting':'ready';
 let next=null;
 if(p&&['ready','waiting'].includes(status)){
  try{
   const grant=await getGrant(db,s.grant_id,g.principal_id,now);capability({grant},'commands:submit','node:health:read');
   const end=Math.min(p.end,timestamp(grant.policy.expires_at));
   next=p.start+Math.ceil((Math.max(now,p.start)-p.start)/p.interval)*p.interval;
   const fired=await db.prepare('SELECT due FROM firings WHERE schedule_id=? AND revision=? AND due=?').bind(s.id,s.revision,next).first();
   if(fired)next+=p.interval;
   if(next+120000>end){next=null;status='window_exhausted';}
  }catch(e){if(!(e instanceof Fault))throw e;status='grant_unavailable';next=null;}
 }
 const firing=await db.prepare('SELECT due,outcome FROM firings WHERE schedule_id=? AND revision=? ORDER BY due DESC LIMIT 1').bind(s.id,s.revision).first();
 let last=null;
 if(firing){
  const command=await db.prepare('SELECT * FROM commands WHERE id=?').bind(firing.outcome).first();
  if(command)scope(ctx,record(command).command);
  last={due_at:iso(firing.due),outcome:command?'submitted':firing.outcome,command_id:command?.id??null};
 }
 // The persisted relation, not an idempotency-key prefix, proves schedule origin.
 const results=(await db.prepare("SELECT c.* FROM firings f JOIN commands c ON c.id=f.outcome WHERE f.schedule_id=? AND json_extract(c.record,'$.result') IS NOT NULL ORDER BY f.due DESC LIMIT 20").bind(s.id).all()).results;
 let latest=null;for(const r of results){try{scope(ctx,record(r).command);latest=publicRecord(view(r,now));break;}catch(e){if(!(e instanceof Fault))throw e;}}
 envelope.schedule={id:s.id,revision:s.revision,enabled:Boolean(s.enabled),status,interval_minutes:p?.interval_minutes??null,not_before:p?.not_before??null,expires_at:p?.expires_at??null,next_due_at:next===null?null:iso(next),last_firing:last,latest_result:latest};
 requireThat(enc.encode(JSON.stringify(envelope)).length<=30000,503,'SNAPSHOT_TOO_LARGE');return envelope;
}
async function usage(db,ctx,now){
 capability(ctx,'commands:read');const g=ctx.grant.policy;
 // One statement observes global admission counters and scope together. A filtered
 // count would misrepresent remaining capacity when another scope owns history.
 const counts=await db.prepare(`SELECT count(*) AS retained,
  coalesce(sum(CASE WHEN created_at>? THEN 1 ELSE 0 END),0) AS recent,
  coalesce(sum(active),0) AS active,
  coalesce(sum(CASE WHEN json_extract(record,'$.command.workspace_id')=?
   AND json_extract(record,'$.command.resource_ref.resource_id')=?
   AND json_extract(record,'$.command.resource_ref.generation')=?
   AND json_extract(record,'$.command.recipe_ref.recipe_id')=?
   AND json_extract(record,'$.command.recipe_ref.version')=?
   AND json_extract(record,'$.command.recipe_ref.digest')=? THEN 1 ELSE 0 END),0) AS scoped
  FROM commands`).bind(now-86400000,g.workspace_id,g.resource_ref.resource_id,g.resource_ref.generation,g.recipe_ref.recipe_id,g.recipe_ref.version,g.recipe_ref.digest).first();
 requireThat(counts&&['retained','recent','active','scoped'].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0),503,'SNAPSHOT_INVALID');
 requireThat(counts.scoped===counts.retained,403,'SCOPE_DENIED');
 const counter=(used,limit)=>({used,limit,remaining:Math.max(0,limit-used)});
 return {schema_version:'cloudlab.usage.v1',observed_at:iso(now),
  scope:{workspace_id:g.workspace_id,resource_ref:g.resource_ref,recipe_ref:g.recipe_ref},
  application:{retained:counter(counts.retained,10000),rolling_24h:{...counter(counts.recent,1440),window_start_exclusive:iso(now-86400000)},active:counter(counts.active,1)},
  provider:{status:'not_connected',workers_requests:null,d1_rows_read:null,d1_rows_written:null,d1_storage_bytes:null,billing:null}};
}
async function claim(db,ctx,now,env){
 capability(ctx,'runs:reconcile');const r=await db.prepare('SELECT * FROM commands WHERE active=1 ORDER BY created_at LIMIT 1').first();if(!r)return null;const v=record(r);scope(ctx,v.command);
 if(v.attempt&&timestamp(v.attempt.lease_expires_at)>now){
  requireThat(v.holder===ctx.principal,409,'LEASE_HELD');
  if(v.attempt.mode==='dispatch'){
   capability(ctx,'dispatch:claim');
   const original=await getGrant(db,r.submit_grant,r.principal_id,now);
   requireThat(original.revision===r.grant_revision,403,'GRANT_REVOKED');
   capability({grant:original},'commands:submit','node:health:read');scope({grant:original},v.command);
   requireThat(!v.cancel_requested&&timestamp(v.command.dispatch_deadline)>now&&timestamp(v.command.execution_deadline)-now>=v.command.timeout_seconds*1000,409,'RECONCILIATION_REQUIRED');
   const firing=await db.prepare('SELECT schedule_id,revision FROM firings WHERE outcome=? LIMIT 1').bind(v.command_id).first();
   if(firing){const schedule=await db.prepare('SELECT * FROM schedules WHERE id=?').bind(firing.schedule_id).first();requireThat(schedule?.revision===firing.revision&&scheduleDispatchAllowed(env,schedule,v.command,now),409,'RECONCILIATION_REQUIRED');}
  }
  return assignment(v);
 }
 let extra='1',args=[];
 if(v.attempt){v.delivery='reconciling';v.attempt={attempt_id:crypto.randomUUID(),fence:v.attempt.fence+1,mode:'reconcile_only',lease_expires_at:iso(now+15000)};}
 else{
  capability(ctx,'dispatch:claim');let submitGrant;
  try{submitGrant=await getGrant(db,r.submit_grant,r.principal_id,now);requireThat(submitGrant.revision===r.grant_revision,403,'GRANT_REVOKED');scope({grant:submitGrant},v.command);capability({grant:submitGrant},'commands:submit','node:health:read');}catch(e){if(!(e instanceof Fault))throw e;v.delivery='cancelled_before_dispatch';v.cancel_requested=true;v.updated_at=iso(now);await save(db,r,v,ctx);return null;}
  if(timestamp(v.command.not_before)>now)return null;
  if(timestamp(v.command.dispatch_deadline)<=now||timestamp(v.command.execution_deadline)-now<v.command.timeout_seconds*1000){v.delivery='expired_before_dispatch';v.updated_at=iso(now);await save(db,r,v,ctx);return null;}
  // Scheduled commands revalidate enablement/revision under the same write CAS.
  const firing=await db.prepare('SELECT schedule_id,revision FROM firings WHERE outcome=? LIMIT 1').bind(v.command_id).first();
  if(firing){const s=await db.prepare('SELECT * FROM schedules WHERE id=?').bind(firing.schedule_id).first();if(s?.revision!==firing.revision||!scheduleDispatchAllowed(env,s,v.command,now)){v.delivery='cancelled_before_dispatch';v.cancel_requested=true;v.updated_at=iso(now);await save(db,r,v,ctx);return null;}extra+=' AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND revision=? AND enabled=1)';args.push(s.id,s.revision);}
  extra+=' AND EXISTS(SELECT 1 FROM grants WHERE id=? AND revision=? AND revoked=0)';args.push(r.submit_grant,r.grant_revision);
  v.delivery='dispatching';v.external_ref={owner:'python-node-health',adapter_id:'node-health',external_id:v.command_id};v.attempt={attempt_id:crypto.randomUUID(),fence:1,mode:'dispatch',lease_expires_at:iso(now+15000)};
 }
 v.holder=ctx.principal;v.updated_at=iso(now);await save(db,r,v,ctx,extra,args);return assignment(v);
}
function assignment(v){return {command_id:v.command_id,command:v.command,attempt:v.attempt,external_ref:v.external_ref};}
async function report(db,ctx,b,now){
 capability(ctx,'runs:report');fields(b,['command_id','attempt_id','fence','owner_outcome','started_at','finished_at','artifact']);id(b.command_id);id(b.attempt_id);integer(b.fence,1,2147483647);requireThat(['succeeded','unknown'].includes(b.owner_outcome));
 const r=await row(db,b.command_id),v=record(r);scope(ctx,v.command);requireThat(v.holder===ctx.principal&&v.attempt?.attempt_id===b.attempt_id&&v.attempt.fence===b.fence,409,'STALE_FENCE');const hash=await digest(JSON.stringify(b));
 if(v.report_digest){requireThat(v.report_digest===hash,409,'RESULT_CONFLICT');return v;}
 requireThat(timestamp(v.attempt.lease_expires_at)>now,409,'STALE_FENCE');if(v.attempt.mode==='reconcile_only')capability(ctx,'runs:reconcile');
 if(b.owner_outcome==='unknown'){requireThat(b.started_at===null&&b.finished_at===null&&b.artifact===null);v.delivery='reconciling';v.attempt.lease_expires_at=iso(now);v.updated_at=iso(now);return save(db,r,v,ctx);}
 const start=timestamp(b.started_at),finish=timestamp(b.finished_at);requireThat(start<=finish&&start>=timestamp(v.command.not_before)&&finish<=now+2000&&typeof b.artifact==='string');
 requireThat(enc.encode(b.artifact).length<=v.command.output_budget_bytes,413,'BODY_TOO_LARGE');
 let health='unknown',schema='passed',sample=null;try{sample=strictJSON(enc.encode(b.artifact));fields(sample,['status','sample_age_seconds','checks','metrics']);fields(sample.metrics,['load_1m_milli','cpu_count','disk_free_percent']);integer(sample.metrics.load_1m_milli,0,1000000000);integer(sample.metrics.cpu_count,1,65536);integer(sample.metrics.disk_free_percent,0,100);fields(sample.checks,['collector']);requireThat(['healthy','unhealthy'].includes(sample.status)&&['ok','failed'].includes(sample.checks.collector));integer(sample.sample_age_seconds,0,0);requireThat(sample.checks.collector==='ok'&&(sample.status==='healthy')===(sample.metrics.load_1m_milli<=sample.metrics.cpu_count*2000&&sample.metrics.disk_free_percent>=10));}catch{schema='failed';}
 const fresh=schema==='passed'&&now>=finish&&now-finish+sample.sample_age_seconds*1000<=v.command.parameters.max_sample_age_seconds*1000&&finish<=timestamp(v.command.execution_deadline)&&finish-start<=v.command.timeout_seconds*1000;
 const status=schema==='failed'?'failed':fresh?'passed':'incomplete';if(status==='passed')health=sample.status;
 v.result={owner_outcome:b.owner_outcome,started_at:b.started_at,finished_at:b.finished_at,received_at:iso(now),late:now>timestamp(v.command.execution_deadline),validation:{status,checks:[{name:'schema',status:schema},{name:'freshness',status:fresh?'passed':'incomplete'},{name:'scope',status:'passed'}]},health,artifact_sha256:'sha256:'+await digest(b.artifact),artifact_expires_at:iso(now+7*86400000)};
 v.artifact=b.artifact;v.report_digest=hash;v.delivery='result_recorded';v.updated_at=iso(now);return save(db,r,v,ctx);
}
function publicRecord(v){const {artifact,report_digest,holder,...publicValue}=v;return publicValue;}
export async function handle(request,env,now=Date.now(),fetcher=fetch){
 now=Math.floor(now/1000)*1000;const request_id=crypto.randomUUID();try{
  requireThat(['GET','POST'].includes(request.method),405,'METHOD_NOT_ALLOWED');const bytes=await readBody(request);if(request.method==='POST')requireThat(request.headers.get('content-type')?.split(';')[0]==='application/json',415,'CONTENT_TYPE_INVALID');const ctx=await authenticate(request,env,bytes,now,fetcher),url=new URL(request.url),db=env.DB;
  const b=request.method==='POST'?strictJSON(bytes):null;const send=(data,status)=>json({...data,request_id},status);
  if(url.pathname==='/api/authorization/self'&&request.method==='POST'){
   requireThat(!ctx.human,403,'SCOPE_DENIED');fields(b,[]);
   const g=ctx.grant.policy;
   return send({schema_version:'cloudlab.authorization-self.v1',observed_at:iso(now),credential:ctx.credential,
    grant:{id:ctx.grant.id,revision:ctx.grant.revision,principal_id:g.principal_id,not_before:g.not_before,expires_at:g.expires_at},
    scope:{workspace_id:g.workspace_id,resource_ref:{resource_id:g.resource_ref.resource_id,generation:g.resource_ref.generation},recipe_ref:{recipe_id:g.recipe_ref.recipe_id,version:g.recipe_ref.version,digest:g.recipe_ref.digest}}});
  }
  if(url.pathname==='/api/bootstrap'&&request.method==='GET'){capability(ctx,'commands:read');return send({workspace_id:ctx.grant.policy.workspace_id,resource_ref:ctx.grant.policy.resource_ref,recipe_ref:await recipeRef(),capabilities:ctx.grant.policy.capabilities,now:iso(now)});}
  if(url.pathname==='/api/health-schedule'&&request.method==='GET')return send(await healthSchedule(env,ctx,now));
  if(url.pathname==='/api/usage'&&request.method==='GET')return send(await usage(db,ctx,now));
  if(url.pathname==='/api/commands'){
   if(request.method==='POST')return send({command:publicRecord(await submit(db,ctx,b,new TextDecoder().decode(bytes),now))},202);
   capability(ctx,'commands:read');const rows=(await db.prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT 20').all()).results;const commands=[];for(const r of rows){try{scope(ctx,record(r).command);const item=publicRecord(view(r,now));if(enc.encode(JSON.stringify([...commands,item])).length<30000)commands.push(item);}catch(e){if(!(e instanceof Fault))throw e;}}return send({commands,now:iso(now)});
  }
  if(url.pathname==='/api/runner/claim'&&request.method==='POST'){fields(b,[]);return send({assignment:await claim(db,ctx,now,env)});}
  if(url.pathname==='/api/runner/report'&&request.method==='POST')return send({command:publicRecord(await report(db,ctx,b,now))});
  const match=url.pathname.match(/^\/api\/commands\/([A-Za-z0-9_-]{1,128})(?:\/(cancel|artifact))?$/);
  if(match){const r=await row(db,match[1]),v=record(r);scope(ctx,v.command);
   if(match[2]==='cancel'&&request.method==='POST'){capability(ctx,'commands:cancel-request');fields(b,[]);v.cancel_requested=true;v.updated_at=iso(now);if(!v.attempt)v.delivery='cancelled_before_dispatch';return send({command:publicRecord(await save(db,r,v,ctx))});}
   if(match[2]==='artifact'&&request.method==='GET'){capability(ctx,'artifact:read');requireThat(v.result&&v.artifact,404,'NOT_FOUND');requireThat(timestamp(v.result.artifact_expires_at)>now,410,'EVIDENCE_EXPIRED');return new Response(v.artifact,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="health.json"','X-Request-Id':request_id}});}
   if(!match[2]&&request.method==='GET'){capability(ctx,'commands:read');return send({command:publicRecord(view(r,now))});}
  }
  if(['/', '/styles.css','/dashboard.mjs'].includes(url.pathname)&&request.method==='GET'){
   requireThat(ctx.human,403,'SCOPE_DENIED');capability(ctx,'commands:read');requireThat(env.ASSETS,503,'ASSETS_UNAVAILABLE');const res=await env.ASSETS.fetch(request),headers=new Headers(res.headers);headers.set('Cache-Control','no-store');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');return new Response(res.body,{status:res.status,headers});
  }
  throw new Fault(404,'NOT_FOUND');
 }catch(e){const status=e instanceof Fault?e.status:503;return json({code:e instanceof Fault?e.code:'TEMPORARILY_UNAVAILABLE',message:e instanceof Fault?e.code:'Service unavailable',retryable:status===503||status===429,request_id},status);}
}
export async function scheduled(event,env,now=Date.now()){
 now=Math.floor(now/1000)*1000;const db=env.DB,s=await db.prepare("SELECT * FROM schedules WHERE id='health-minute'").first();if(!s?.enabled)return;
 const policy=schedulePolicy(env,s);if(!policy||now<policy.start||now>=policy.end)return;
 requireThat(Number.isSafeInteger(event.scheduledTime)&&event.scheduledTime>=0,422,'DEADLINE_INVALID');
 const due=Math.floor(event.scheduledTime/60000)*60000;requireThat(Number.isSafeInteger(due),422,'DEADLINE_INVALID');
 const prior=await db.prepare('SELECT * FROM firings WHERE schedule_id=? AND revision=? AND due=?').bind(s.id,s.revision,due).first();if(prior)return;
 const mark=async outcome=>db.prepare(`INSERT OR IGNORE INTO firings(schedule_id,revision,due,outcome) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM schedules WHERE id=? AND revision=? AND enabled=1)`).bind(s.id,s.revision,due,outcome,s.id,s.revision).run();
 if(due!==Math.floor(now/60000)*60000){await mark('skipped_misfire');return;}
 if(due<policy.start||(due-policy.start)%policy.interval!==0)return;
 if(now+120000>policy.end){await mark('skipped_window');return;}
 const grantRow=await db.prepare('SELECT * FROM grants WHERE id=?').bind(s.grant_id).first();if(!grantRow)return;const p=JSON.parse(grantRow.policy);let ctx;
 try{ctx={principal:p.principal_id,grant_id:s.grant_id,grant:await getGrant(db,s.grant_id,p.principal_id,now)};capability(ctx,'commands:submit','node:health:read');}catch(e){if(!(e instanceof Fault))throw e;await mark('skipped_grant');return;}
 // Keep the due slot as identity; provider delay must not consume dispatch time.
 const c={schema_version:'cloudlab.command.v1',schema_minor:0,workspace_id:p.workspace_id,resource_ref:p.resource_ref,recipe_ref:p.recipe_ref,parameters:{max_sample_age_seconds:30},idempotency_key:`schedule-${s.revision}-${due}`,not_before:iso(due),dispatch_deadline:iso(now+60000),execution_deadline:iso(now+120000),timeout_seconds:10,output_budget_bytes:16384};
 try{await validateCommand(c,ctx,now);}catch(e){if(!(e instanceof Fault))throw e;await mark(e.code);return;}
 const command_id=crypto.randomUUID(),raw=JSON.stringify(c),v={command_id,revision:1,command:c,delivery:'accepted',cancel_requested:false,external_ref:null,attempt:null,result:null,created_at:iso(now),updated_at:iso(now)};
 try{
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO firings(schedule_id,revision,due,outcome) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM schedules WHERE id=? AND revision=? AND enabled=1) AND ${guardSQL()}`).bind(s.id,s.revision,due,command_id,s.id,s.revision,...guardArgs(ctx)),
   db.prepare(`INSERT INTO commands(id,principal_id,idem_key,body,body_digest,submit_grant,grant_revision,record,revision,active,created_at) SELECT ?,?,?,?,?,?,?,?,1,1,? WHERE EXISTS(SELECT 1 FROM firings WHERE schedule_id=? AND revision=? AND due=? AND outcome=?) AND (SELECT count(*) FROM commands)<10000 AND (SELECT count(*) FROM commands WHERE created_at>?)<1440`).bind(command_id,ctx.principal,c.idempotency_key,raw,await digest(raw),ctx.grant.id,ctx.grant.revision,JSON.stringify(v),now,s.id,s.revision,due,command_id,now-86400000),
   db.prepare("UPDATE firings SET outcome='skipped_quota' WHERE outcome=? AND NOT EXISTS(SELECT 1 FROM commands WHERE id=?)").bind(command_id,command_id),
   db.prepare('UPDATE schedules SET last_due=? WHERE id=? AND revision=?').bind(due,s.id,s.revision),
  ]);
 }catch(e){if(String(e).includes('UNIQUE')){await mark('skipped_overlap');return;}throw e;}
}
export default {fetch:(request,env)=>handle(request,env),scheduled:(event,env,ctx)=>ctx.waitUntil(scheduled(event,env))};
