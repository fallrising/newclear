import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SqliteD1 } from './sqlite-d1.mjs';
import { handle } from '../backend/src/worker.ts';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DIST=resolve(ROOT,'web/dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
export async function startServer({port=8787,file=resolve(ROOT,'.local/edgeops-demo.sqlite'),mode='disabled',clock=Date.now}={}) {
  const db=new SqliteD1(file);
  const server=createServer(async (req,res)=>{
    try {
      const url=new URL(req.url,`http://${req.headers.host}`);
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method) ? {body:Readable.toWeb(req),duplex:'half'} : {})});
      if (/^\/(api|agent|demo)\//.test(url.pathname) || url.pathname==='/healthz' || mode!=='demo' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
        const response=await handle(request,{DB:db,MODE:mode},clock);
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
      let path;
      try {path=await realpath(resolve(DIST,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname)));} catch {
        // Only known UI routes receive SPA fallback. Missing assets must stay 404.
        if (url.pathname==='/' || url.pathname==='/fleet' || /^\/nodes\/node_demo(?:0[1-9]|10)$/.test(url.pathname)) path=resolve(DIST,'index.html');
        else {res.writeHead(404);res.end('Not found');return;}
      }
      if (!path.startsWith(DIST+sep)) {res.writeHead(403);res.end();return;}
      const body=await readFile(path);
      res.writeHead(200,{'content-type':mime[extname(path)] ?? 'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(req.method==='HEAD' ? undefined : body);
    } catch {res.writeHead(503,{'content-type':'text/plain'});res.end('Local backend or built UI unavailable. Run npm --prefix web run build.');}
  });
  try {await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});} catch(e) {db.close();throw e;}
  const url=`http://127.0.0.1:${server.address().port}`;
  return {url,db,server,close:()=>new Promise((yes,no)=>{server.close(e=>{db.close();e?no(e):yes();});server.closeIdleConnections();})};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (args.some(x=>!['--demo','--seed'].includes(x))) {console.error('Only --demo and --seed are supported.');process.exit(2);}
  const port=Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be 1024..65535');
  const app=await startServer({port,file:process.env.DEMO_DB ?? resolve(ROOT,'.local/edgeops-demo.sqlite'),mode:args.includes('--demo')?'demo':'disabled'});
  const stop=async()=>{await app.close();process.exit(0);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log(`Edge Ops loopback mock: ${app.url} (SQLite adapter; NOT workerd / NOT live)`);
  if (args.includes('--seed')) {
    const snapshot=await fetch(app.url+'/api/v1/nodes',{headers:{'x-edge-demo-role':'viewer'}}).then(r=>r.json());
    if (snapshot.data?.nodes.length===0) {
      const child=spawn(process.execPath,[resolve(ROOT,'scripts/mock-agent.mjs'),'seed'],{env:{...process.env,DEMO_URL:app.url},stdio:'inherit'});
      child.once('exit',code=>{if(code) {console.error('Mock seeding failed');void app.close().then(()=>process.exit(1));}});
    } else console.log('Existing synthetic data preserved. Use mock-agent reset explicitly to clear it.');
  }
}
