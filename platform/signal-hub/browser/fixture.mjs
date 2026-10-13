import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export async function startFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'signalhub-browser-'));
  const tokens = Object.fromEntries(['owner','reader','source','watch','never','decision','execution'].map(role => [role,randomBytes(32).toString('base64url')]));
  for (const [role,token] of Object.entries(tokens)) await writeFile(join(directory,role+'.token'),token,{mode:0o600});
  const ref=role=>'file:'+join(directory,role+'.token');
  const config={
    sources:[
      {name:'demo',source_prefix:'urn:example:demo:',allowed_types:['release.deploy.*'],token_ref:ref('source')},
      {name:'watch',source_prefix:'urn:example:watch:',allowed_types:['inspection.check.*'],expected_interval:'2s',token_ref:ref('watch')},
      {name:'never',source_prefix:'urn:example:never:',allowed_types:['inspection.check.*'],expected_interval:'1h',token_ref:ref('never')},
    ],rules:[],subscriptions:[],webhook_allowlist:[],
  };
  await writeFile(join(directory,'config.json'),JSON.stringify(config),{mode:0o600});
  const binary=process.env.SIGNALHUB_BINARY || '/tmp/signalhub';
  const child=spawn(resolve(binary),['-config',join(directory,'config.json'),'-db',join(directory,'events.db'),'-owner-token-ref',ref('owner'),'-readonly-token-ref',ref('reader'),'-listen','127.0.0.1:0'],{stdio:['ignore','ignore','pipe']});
  let stderr='';
  let closed=false;
  async function stop(){
    if(closed)return;
    closed=true;
    if(child.exitCode===null&&child.signalCode===null){
      const exited=new Promise(resolve=>child.once('exit',resolve));
      child.kill('SIGTERM');
      const kill=setTimeout(()=>child.kill('SIGKILL'),15_000);
      await exited;
      clearTimeout(kill);
    }
    await rm(directory,{recursive:true,force:true});
  }
  let base;
  try{
    base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Go fixture startup timeout')),15_000);
      child.on('error',e=>{clearTimeout(timer);reject(e)});
      child.on('exit',()=>{clearTimeout(timer);reject(new Error('Go fixture exited before startup: '+stderr))});
      child.stderr.on('data',chunk=>{
        stderr=(stderr+chunk.toString()).slice(-16_384);
        const match=stderr.match(/signalhub listening on (127\.0\.0\.1:\d+)/);
        if(match){clearTimeout(timer);resolve('http://'+match[1])}
      });
    });
    async function api(path,{role='reader',method='GET',body}={}){
      const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':Array.isArray(body)?'application/cloudevents-batch+json':'application/cloudevents+json'},...(body?{body:JSON.stringify(body)}:{})});
      const value=await response.json();
      if(!response.ok)throw new Error('fixture HTTP '+response.status+': '+JSON.stringify(value));
      return value;
    }
    const now=Date.now()-5000;
    const events=Array.from({length:105},(_,index)=>({
      specversion:'1.0',id:'browser-'+index,source:'urn:example:demo:service',
      type:index%3===0?'release.deploy.failed':'release.deploy.succeeded',
      time:new Date(now-index*1000).toISOString(),subject:'api-service',
      severity:index%3===0?'error':'info',summary:'Browser fixture '+String(index).padStart(3,'0'),
      ...(index<3?{correlationid:'browser-chain'}:{}),
      ...(index===0?{originurl:'javascript:alert(1)'}:{originurl:'https://example.invalid/run/'+index}),
      data:{duration_ms:120+index,content:'<img src=x onerror=alert(1)>'},
    }));
    for(let i=0;i<events.length;i+=100){
      const result=await api('/v1/events',{role:'source',method:'POST',body:events.slice(i,i+100)});
      if(result.results.some(r=>r.status!==202))throw new Error('fixture seed failed');
    }
    let watchID=0;
    async function touchWatch(){
      return api('/v1/events',{role:'watch',method:'POST',body:{specversion:'1.0',id:'watch-'+(++watchID),source:'urn:example:watch:checks',type:'inspection.check.passed',time:new Date().toISOString(),summary:'Watch heartbeat'}});
    }
    async function configureRules(rules) {
      config.rules=rules;
      await writeFile(join(directory,'config.json'),JSON.stringify(config),{mode:0o600});
      return api('/v1/config:reload',{role:'owner',method:'POST'});
    }
    async function configureDecisionSources() {
      for (const role of ['decision','execution']) {
        config.sources.push({name:role,source_prefix:'urn:example:'+role+':',allowed_types:role==='decision'?['decision.case.*','decision.proposal.*','decision.choice.*']:['execution.run.*'],token_ref:ref(role)});
      }
      await writeFile(join(directory,'config.json'),JSON.stringify(config),{mode:0o600});
      return api('/v1/config:reload',{role:'owner',method:'POST'});
    }
    async function configureSubscriptions() {
      // Synthetic unreachable receiver: no real notification account or service.
      const url='https://recipient.example.invalid/signal';
      await writeFile(join(directory,'webhook.secret'),'synthetic-browser-webhook-secret',{mode:0o600});
      config.webhook_allowlist=[url];
      config.subscriptions=Array.from({length:101},(_,index)=>({
        id:'board-'+String(index).padStart(3,'0'),filter:{types:['release.delivery.synthetic']},
        channel:{kind:'webhook',url,secret_ref:'file:'+join(directory,'webhook.secret')},mode:'immediate',start:'now',
      }));
      await writeFile(join(directory,'config.json'),JSON.stringify(config),{mode:0o600});
      await api('/v1/config:reload',{role:'owner',method:'POST'});
    }
    function seedDeliveryHistory() {
      // Synthetic historical states exercise the actual query/replay handlers.
      // Dispatcher transport/retry integration is covered by the service suite.
      const db=new DatabaseSync(join(directory,'events.db'));
      try {
        db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
        const insert=db.prepare(`INSERT INTO deliveries(delivery_id,subscription_id,event_seq,body,content_type,headers,state,attempt_count,cycle_attempts,next_attempt_at,next_attempt_key,lease_token,lease_until)
          VALUES(?, 'board-000', ?, ?, 'application/cloudevents+json', '{}', ?, ?, ?, ?, ?, ?, ?)`);
        const attempt=db.prepare('INSERT INTO delivery_attempts(delivery_id,attempt,at,http_status,duration_ms,error) VALUES(?,1,?, ?,17,?)');
        const events=db.prepare('SELECT seq,raw_json FROM events WHERE source=? ORDER BY seq LIMIT 105').all('urn:example:demo:service');
        for(const [index,event] of events.entries()) {
          const id='board-000:'+event.seq;
          const state=index===0?'dlq':index===1?'pending':index===2?'inflight':'succeeded';
          const count=state==='pending'?0:1;
          const future='2100-01-01T00:00:00Z';
          const futureKey='02101-01-01T00:00:00.!';
          insert.run(id,event.seq,event.raw_json,state,count,count,state==='pending'?future:null,state==='pending'?futureKey:null,state==='inflight'?'synthetic-lease':null,state==='inflight'?futureKey:null);
          if(count)attempt.run(id,new Date(Date.now()-60_000).toISOString(),state==='dlq'?400:state==='succeeded'?200:null,state==='dlq'?'Synthetic rejected <script>inert</script>':null);
        }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      finally { db.close(); }
    }
    function replayAudit(id) {
      const db=new DatabaseSync(join(directory,'events.db'));
      try { return db.prepare('SELECT actor,action,target,reason FROM audit_log WHERE target=? ORDER BY seq DESC').all(id); }
      finally { db.close(); }
    }
    function expireMetricHistory() {
      // Synthetic retention fixture only: emulate an older event no longer in
      // hot storage while retaining its already-computed rollups for AC-44.
      const db=new DatabaseSync(join(directory,'events.db'));
      try { db.prepare('DELETE FROM events WHERE source=? AND id=?').run('urn:example:demo:service','metric-history'); }
      finally { db.close(); }
    }
    return {base,tokens,api,touchWatch,configureRules,configureDecisionSources,configureSubscriptions,seedDeliveryHistory,replayAudit,expireMetricHistory,stop};
  }catch(error){await stop();throw error}
}
