// Explicit loopback development harness, never imported by the deployed Worker.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SQLiteD1 } from './sqlite-d1.mjs';
import { handle } from '../apps/control/worker/index.mjs';
import { enc, iso, recipeRef } from '../apps/control/worker/protocol.mjs';
const PUBLIC = new URL('../apps/control/public/', import.meta.url);
const b64 = value => Buffer.from(value).toString('base64url');
export async function createLocalLab(directory, port = 0) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const DB = new SQLiteD1(join(directory, 'local.sqlite'));
  const ref = await recipeRef(), now = Date.now();
  const secret = randomBytes(32).toString('hex');
  const resource_ref = { resource_id: 'local-node', generation: 1 };
  const common = { workspace_id: 'local-lab', resource_ref, recipe_ref: ref,
    not_before: iso(Math.floor(now / 1000) * 1000 - 1000), expires_at: iso(Math.floor(now / 1000) * 1000 + 86400000), max_timeout_seconds: 30, max_output_bytes: 16384 };
  const policies = [ ['local-human', { ...common, principal_id: 'local-human', capabilities: ['commands:read', 'commands:submit', 'commands:cancel-request', 'node:health:read', 'artifact:read'] }],
    ['local-runner', { ...common, principal_id: 'local-runner', capabilities: ['dispatch:claim', 'runs:report', 'runs:reconcile'] }] ];
  for (const [id, policy] of policies) DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?) ON CONFLICT(id) DO UPDATE SET policy=excluded.policy').run(id, JSON.stringify(policy));
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'local-test' };
  const issuer = 'https://local-test.cloudflareaccess.com';
  const env = { DB, PUBLIC_ORIGIN: 'https://cloud-lab.local', AUDIENCE: 'local-lab',
    ACCESS_CONFIG: JSON.stringify({ issuer, audience: 'local-lab', subjects: { 'local-subject': { principal_id: 'local-human', grant_id: 'local-human' } } }),
    MACHINE_KEYS: JSON.stringify({ 'local-runner': { principal_id: 'local-runner', grant_id: 'local-runner', generation: 1, secret_hex: secret, expires_at: common.expires_at } }),
    ASSETS: { async fetch(request) { const path = new URL(request.url).pathname; const name = path === '/' ? 'index.html' : path.slice(1); if (!['index.html','styles.css','dashboard.mjs'].includes(name)) return new Response('Not found', { status:404 }); return new Response(await readFile(new URL(name, PUBLIC)), { headers: { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript' } }); } },
  };
  async function localJwt() {
    const seconds = Math.floor(Date.now()/1000);
    const prefix = b64(JSON.stringify({ alg:'RS256',kid:'local-test' })) + '.' + b64(JSON.stringify({ iss:issuer,aud:['local-lab'],sub:'local-subject',iat:seconds,exp:seconds+60 }));
    return prefix + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(prefix)));
  }
  const fetchJwks = async url => { if (url !== issuer+'/cdn-cgi/access/certs') throw new Error('Unexpected outbound URL'); return Response.json({ keys:[jwk] }); };
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== `127.0.0.1:${server.address().port}`) { outgoing.writeHead(403);outgoing.end();return; }
      let size=0;const chunks=[];
      for await (const chunk of incoming) { size+=chunk.length;if(size>32768){outgoing.writeHead(413);outgoing.end();return;}chunks.push(chunk); }
      const headers=new Headers();for(const [k,v] of Object.entries(incoming.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
      if (!headers.has('x-lab-key-id')) {
        // Local harness identity is explicitly synthetic. No auth bypass exists in Worker.
        headers.set('Cf-Access-Jwt-Assertion',await localJwt());
        if(headers.get('Origin')===`http://127.0.0.1:${server.address().port}`)headers.set('Origin',env.PUBLIC_ORIGIN);
      }
      const request=new Request(env.PUBLIC_ORIGIN+incoming.url,{method:incoming.method,headers,...(incoming.method==='POST'?{body:Buffer.concat(chunks)}:{})});
      const response=await handle(request,env,Date.now(),fetchJwks);
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500);outgoing.end('Local harness error'); }
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
  const base_url=`http://127.0.0.1:${server.address().port}`;
  const config={base_url,audience:'local-lab',credential_id:'local-runner',generation:1,secret_hex:secret,journal_path:join(directory,'runner.sqlite'),workspace_id:'local-lab',resource_ref,recipe_ref:ref};
  await writeFile(join(directory,'runner.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  return {base_url,env,DB,async close(){await new Promise(resolve=>server.close(resolve));DB.close();}};
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [directory,portText='8787']=process.argv.slice(2);
  if(!directory||!/^\d+$/.test(portText)||+portText>65535)throw new Error('Usage: node tools/local.mjs PRIVATE_DATA_DIRECTORY [PORT]');
  const lab=await createLocalLab(resolve(directory),+portText);
  console.log(`LOCAL TEST ONLY — ${lab.base_url}; synthetic browser identity, no Cloudflare connection`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await lab.close();process.exit(0);});
}
