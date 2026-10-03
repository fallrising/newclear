import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loopback mock Agent: emits M0 `edgeops.telemetry.v1` reports (contracts/schemas/telemetry-report.v1.schema.json)
// with synthetic values. It is a one-shot generator, not a collector, and refuses non-loopback targets.

export function target(value='http://127.0.0.1:8787') {
  const u=new URL(value);
  if (u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('Mock Agent only accepts an HTTP loopback origin');
  return u.origin;
}
const utc=ms=>new Date(Math.floor(ms/1000)*1000).toISOString().replace(/\.\d{3}Z$/,'Z');
const GiB=1024n**3n;
/** One 60-second window ending at `observedMs`. `cpu` is a percent, or null when unsupported. */
export function sample(node,observedMs,seq=0,boot=randomUUID(),cpu=24) {
  const bp=cpu===null?null:Math.round(cpu*100);
  return {schema_version:'edgeops.telemetry.v1',node_id:node,enrollment_generation:1,boot_id:boot,seq,
    window_start:utc(observedMs-60_000),window_end:utc(observedMs),sample_count:6,agent_version:'0.1.0-dev',spool_dropped_reports:0,
    metrics:{cpu_busy_bp:bp===null?null:{avg:bp,max:Math.min(10000,bp+1200),last:bp},
      load1_milli:cpu===null?null:150,load5_milli:cpu===null?null:120,load15_milli:cpu===null?null:80,
      mem_total_bytes:cpu===null?null:String(8n*GiB),mem_available_bytes:cpu===null?null:String(5n*GiB),
      swap_total_bytes:'0',swap_free_bytes:'0',uptime_seconds:86400,
      mounts:cpu===null?null:[{mount:'/',total_bytes:String(200n*GiB),avail_bytes:String(113n*GiB)}],
      disk_io:null,
      net:[{iface:'eth0',rx_bytes_total:'9007199254740993',tx_bytes_total:'2147483648'}]}};
}
export async function call(base,path,{method='GET',body,agent,operator=false}={}) {
  const headers=agent?{authorization:`Demo ${agent}`}:{'x-edge-demo-role':operator?'operator':'viewer'};
  if(body!==undefined) headers['content-type']='application/json';
  const r=await fetch(target(base)+path,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
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
      const id=`node_demo0${i}`,boot=randomUUID();
      const enrollment=await call(base,'/agent/v1/enroll',{method:'POST',agent:id,body:{node_id:id,display_name:name}});
      log(JSON.stringify({phase:'enrolled',node:id,request_id:enrollment.request_id}));
      for(let seq=0;seq<12;seq++) {
        const body=sample(id,now-(11-seq)*60_000-(i===3?600_000:0),seq,boot,cpu===null?null:cpu+(seq%4)-3);
        const ack=await call(base,'/agent/v1/telemetry',{method:'POST',body,agent:id});
        log(JSON.stringify({phase:'durable_ack',node:id,seq,...ack.data,request_id:ack.request_id}));
      }
    }
  } else if(['tick','recover'].includes(command)) {
    if(!current.nodes.length) throw new Error('Seed the demo first');
    const node=current.nodes[0];
    const next=node.latest?{boot:node.latest.boot_id,seq:node.latest.seq+1}:{boot:randomUUID(),seq:0};
    const ack=await call(base,'/agent/v1/telemetry',{method:'POST',agent:node.id,body:sample(node.id,now,next.seq,next.boot,command==='recover'?19:57)});
    log(JSON.stringify({phase:'durable_ack',node:node.id,...ack.data}));
  } else if(command==='replay') {
    const last=current.nodes[0]?.latest;
    if(!last) throw new Error('No sample to replay');
    // A spooled report is resent byte for byte; the server answers with the original receipt.
    const ack=await call(base,'/agent/v1/telemetry',{method:'POST',agent:current.nodes[0].id,body:JSON.stringify(last.report)});
    if(!ack.data.duplicate) throw new Error('Expected duplicate receipt');
    log(JSON.stringify({phase:'duplicate_ack',...ack.data}));
  } else throw new Error('Commands: seed | tick | replay | offline | recover | reset');
  return (await call(base,'/api/v1/nodes')).data;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const r=await run(process.argv[2]??'seed',process.env.DEMO_URL);console.log(JSON.stringify({phase:'snapshot',result:r}));}
  catch(e) {console.error(e.message);process.exitCode=1;}
}
