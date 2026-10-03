import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function startFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'signalhub-browser-'));
  const tokens = Object.fromEntries(['owner','reader','source','watch','never'].map(role => [role,randomBytes(32).toString('base64url')]));
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
    return {base,tokens,api,touchWatch,stop};
  }catch(error){await stop();throw error}
}
