import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function target(value='http://127.0.0.1:8787') {
  const u=new URL(value);
  if (u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('Mock Agent only accepts an HTTP loopback origin');
  return u.origin;
}
export function sample(node,now,seq=0,boot=`boot_${randomUUID()}`,cpu=24) {
  return {schema_version:'edgeops.telemetry.demo.v1',node_id:node,enrollment_generation:1,boot_id:boot,seq,
    sent_at:new Date(now).toISOString(),observed_at:new Date(now).toISOString(),window_seconds:60,sample_count:6,
    metrics:{cpu_avg_percent:cpu,cpu_max_percent:cpu===null?null:Math.min(100,cpu+12),memory_used_bytes:cpu===null?null:'3221225472',memory_total_bytes:cpu===null?null:'8589934592',disk_used_percent:43.5,network_rx_bytes:'9007199254740993',network_tx_bytes:'2147483648'}};
}
export async function call(base,path,{method='GET',body,agent,operator=false}={}) {
  const headers=agent?{authorization:`Demo ${agent}`}:{'x-edge-demo-role':operator?'operator':'viewer'};
  if(body!==undefined) headers['content-type']='application/json';
  const r=await fetch(target(base)+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
  const v=await r.json();
  if(!r.ok) throw new Error(`${r.status} ${v.code}: ${v.message}`);
  return v;
}
export async function run(command,base='http://127.0.0.1:8787',log=console.log) {
  base=target(base);
  if(command==='reset') return call(base,'/demo/v1/reset',{method:'POST',body:{confirm:'RESET_SYNTHETIC_DATA'},operator:true});
  if(command==='offline') return call(base,'/demo/v1/clock',{method:'POST',body:{advance_seconds:240},operator:true});
  const current=(await call(base,'/api/v1/nodes')).data;
  const now=Date.parse(current.server_time);
  if(command==='seed') {
    if(current.nodes.length) throw new Error('Seed requires an empty demo. Existing data preserved; use reset explicitly.');
    for(const [i,name,cpu] of [[1,'demo-web-01',24],[2,'demo-batch-02',88],[3,'demo-storage-03',null]]) {
      const id=`node_demo0${i}`,boot=`boot_${randomUUID()}`;
      const enrollment=await call(base,'/agent/v1/enroll',{method:'POST',agent:id,body:{node_id:id,display_name:name}});
      log(JSON.stringify({phase:'enrolled',node:id,request_id:enrollment.request_id}));
      for(let seq=0;seq<12;seq++) {
        const body=sample(id,now,seq,boot,cpu===null?null:cpu+(seq%4)-3);
        body.observed_at=new Date(now-(11-seq)*60_000-(i===3?600_000:0)).toISOString();
        const ack=await call(base,'/agent/v1/telemetry',{method:'POST',body,agent:id});
        log(JSON.stringify({phase:'durable_ack',node:id,seq,...ack.data,request_id:ack.request_id}));
      }
    }
  } else if(['tick','recover'].includes(command)) {
    if(!current.nodes.length) throw new Error('Seed the demo first');
    const node=current.nodes[0].id, ack=await call(base,'/agent/v1/telemetry',{method:'POST',agent:node,body:sample(node,now,0,undefined,command==='recover'?19:57)});
    log(JSON.stringify({phase:'durable_ack',node,...ack.data}));
  } else if(command==='replay') {
    const last=current.nodes[0]?.latest;
    if(!last) throw new Error('No sample to replay');
    const {received_at,request_id,...body}=last;body.sent_at=current.server_time;
    const ack=await call(base,'/agent/v1/telemetry',{method:'POST',agent:body.node_id,body});
    if(!ack.data.duplicate) throw new Error('Expected duplicate receipt');
    log(JSON.stringify({phase:'duplicate_ack',...ack.data}));
  } else throw new Error('Commands: seed | tick | replay | offline | recover | reset');
  return (await call(base,'/api/v1/nodes')).data;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const r=await run(process.argv[2]??'seed',process.env.DEMO_URL);console.log(JSON.stringify({phase:'snapshot',result:r}));}
  catch(e) {console.error(e.message);process.exitCode=1;}
}
