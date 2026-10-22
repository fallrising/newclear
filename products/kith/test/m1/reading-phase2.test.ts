import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { mountReadingCaptureRoutes } from "../../worker/routes/reading-capture.ts";
import { csrfOk, unauthorized, authorizationBearer } from "../../worker/auth.ts";
import type { Env } from "../../worker/env.ts";

const tick = "2026-02-03T00:00:00.000Z";
let bundle: unknown;
let serial = 0;
const app = new Hono<{Bindings:Env}>();
app.use("/api/*", async(c,next)=>{
  c.header("Cache-Control","no-store");
  if (!["GET","HEAD"].includes(c.req.method) && authorizationBearer(c) === null && !csrfOk(c)) return unauthorized(c);
  return next();
});
mountReadingCaptureRoutes(app,{now:()=>tick,id:()=>`phase2-${++serial}`});
const bindings = {...env, ASSETS:{fetch:async()=>new Response(JSON.stringify(bundle),{headers:{"Content-Type":"application/json"}})}} as unknown as Env;
function call(method:string,path:string,body?:unknown,role="operator",bearer?:string) {
  const headers:Record<string,string>={Cookie:`kith_session=p2-${role}; csrf=test`,"X-CSRF-Token":"test","Content-Type":"application/json"};
  if(bearer!==undefined) headers.Authorization=`Bearer ${bearer}`;
  return app.request(`https://kith.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)},bindings);
}
async function note(){return (await (await call("GET","/api/notes/A")).json() as any).note;}
async function issue(){const res=await call("POST","/api/reading-export/tokens",{});expect(res.status).toBe(201);return await res.json() as {id:string;token:string};}
beforeEach(async()=>{
  bundle={version:1,commit:"a".repeat(40),articles:[{id:"A",title:"A",body:"# Article A"},{id:"B",title:"B",body:"Article B"}]};
  await env.DB.prepare("DELETE FROM captures").run();await env.DB.prepare("DELETE FROM notes").run();
  await env.DB.prepare("UPDATE members SET is_operator=0 WHERE is_operator=1").run();
  for(const role of ["operator","member"]){
    const id=`p2-${role}`;
    await env.DB.prepare("INSERT OR REPLACE INTO members(id,kind,handle,display_name,is_operator,created_at,password_hash) VALUES (?,'human',?,?,?,?,'fixture')").bind(id,id,id,role==="operator"?1:0,tick).run();
    await env.SESSIONS.put(`session:${id}`,JSON.stringify({member_id:id,expires_at:"2099-01-01T00:00:00Z"}));
  }
});
it("returns one immutable bundle only for operator; invalid publication is unavailable",async()=>{
  const r=await call("GET","/api/reading");expect(r.status).toBe(200);expect(await r.json()).toEqual(bundle);expect(r.headers.get("Cache-Control")).toBe("no-store");
  expect((await call("GET","/api/reading",undefined,"member")).status).toBe(403);
  expect((await call("GET","/api/reading",undefined,"anonymous")).status).toBe(401);
  bundle={version:1,commit:"partial",articles:[]};expect((await call("GET","/api/reading")).status).toBe(503);
});
it("uses raw-body revision CAS, same-tick updates, replay and old ACK cannot lose new notes",async()=>{
  const before=(await env.DB.prepare("SELECT * FROM messages ORDER BY id").all()).results;
  expect(await note()).toBeNull();
  const body="  補充 🌱\n\t ";
  expect((await call("PUT","/api/notes/A",{body,revision:0})).status).toBe(201);
  const first=await note();expect(first).toMatchObject({body,revision:1,updated_at:tick,exported_commit:null});
  expect((await call("PUT","/api/notes/A",{body,revision:0})).status).toBe(200);expect((await note()).revision).toBe(1);
  const token=await issue();
  const ack=(revision:number)=>call("POST","/api/reading-export/ack",{commit:"b".repeat(40),captures:[],notes:[{id:first.id,revision}]},"anonymous",token.token);
  expect(await (await ack(1)).json()).toEqual({captures:0,notes:1});
  const changed="new\n raw ";expect((await call("PUT","/api/notes/A",{body:changed,revision:1})).status).toBe(200);
  expect(await (await ack(1)).json()).toEqual({captures:0,notes:0});
  expect(await note()).toMatchObject({id:first.id,body:changed,revision:2,updated_at:tick,exported_commit:null});
  expect((await call("PUT","/api/notes/A",{body:"stale",revision:1})).status).toBe(409);
  expect(await (await ack(2)).json()).toEqual({captures:0,notes:1});expect(await (await ack(2)).json()).toEqual({captures:0,notes:0});
  expect((await env.DB.prepare("SELECT * FROM messages ORDER BY id").all()).results).toEqual(before);
});
it("atomically arbitrates simultaneous updates and protects revision exhaustion",async()=>{
  await call("PUT","/api/notes/A",{body:"one",revision:0});
  const rs=await Promise.all(["two","three"].map(body=>call("PUT","/api/notes/A",{body,revision:1})));
  expect(rs.map(r=>r.status).sort()).toEqual([200,409]);expect((await note()).revision).toBe(2);
  await env.DB.prepare("UPDATE notes SET revision=9007199254740991 WHERE article_id='A'").run();
  expect((await call("PUT","/api/notes/A",{body:"exhaust",revision:Number.MAX_SAFE_INTEGER})).status).toBe(409);
  expect((await note()).revision).toBe(Number.MAX_SAFE_INTEGER);
});
it("rejects invalid notes, unknown articles and malformed revisions without writes",async()=>{
  for(const body of ["", "\0", "\ud800", "界".repeat(5462),null]) expect((await call("PUT","/api/notes/A",{body,revision:0})).status).toBe(400);
  for(const revision of [-1,1.2,"0",null,Number.MAX_SAFE_INTEGER+1]) expect((await call("PUT","/api/notes/A",{body:"x",revision})).status).toBe(400);
  expect((await call("PUT","/api/notes/A",{body:"x",revision:0,extra:1})).status).toBe(400);
  expect((await call("PUT","/api/notes/unknown",{body:"x",revision:0})).status).toBe(404);
  expect((await env.DB.prepare("SELECT * FROM notes").all()).results).toHaveLength(0);
});
it("scopes and revokes dedicated hashed export tokens without session fallback",async()=>{
  const t=await issue();expect(t.token).toMatch(/^kith_export_/);
  const stored=(await env.DB.prepare("SELECT * FROM reading_export_tokens WHERE id=?").bind(t.id).first())!;
  expect(JSON.stringify(stored)).not.toContain(t.token);expect(String(stored.token_hash)).toMatch(/^[a-f0-9]{64}$/);
  expect((await call("GET","/api/reading-export?kind=captures",undefined,"anonymous",t.token)).status).toBe(200);
  for(const [m,p,b] of [["GET","/api/reading",undefined],["GET","/api/captures",undefined],["GET","/api/notes/A",undefined],["PUT","/api/notes/A",{body:"x",revision:0}],["GET","/api/reading-export/tokens",undefined],["POST","/api/reading-export/tokens",{}]] as const) expect((await call(m,p,b,"operator",t.token)).status).toBe(401);
  expect((await call("GET","/api/reading-export?kind=captures",undefined,"operator","bogus")).status).toBe(401);
  const list=await (await call("GET","/api/reading-export/tokens")).text();expect(list).not.toContain(t.token);expect(list).not.toContain("token_hash");
  expect((await call("DELETE","/api/reading-export/tokens/"+t.id)).status).toBe(204);
  expect((await call("GET","/api/reading-export?kind=captures",undefined,"anonymous",t.token)).status).toBe(401);
  const t2=await issue();await env.DB.prepare("UPDATE members SET is_operator=0 WHERE id='p2-operator'").run();
  expect((await call("GET","/api/reading-export?kind=notes",undefined,"anonymous",t2.token)).status).toBe(401);
});
it("recognizes case-insensitive Bearer schemes and never widens them with operator cookies",async()=>{
  const t=await issue();
  for(const scheme of ["bearer ","bEaReR ","Bearer\t"]){
    const headers={Cookie:"kith_session=p2-operator; csrf=test","X-CSRF-Token":"test",Authorization:scheme+t.token};
    for(const path of ["/api/reading","/api/reading-export/tokens","/api/notes/A"]){
      expect((await app.request("https://kith.test"+path,{headers},bindings)).status).toBe(401);
    }
    expect((await app.request("https://kith.test/api/reading-export?kind=captures",{headers},bindings)).status).toBe(200);
  }
});
it("guards the real Worker's private asset and session-only paths, including malformed encodings",async()=>{
  for(const path of ["/_reading/current.json","/%5freading/current.json","/_reading%2fcurrent.json","/%5freading/%ZZ"]){
    for(const method of ["GET","HEAD"]){
      const response=await SELF.fetch("https://kith.test"+path,{method});
      expect([400,404]).toContain(response.status);expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).not.toContain("articles");
    }
  }
  const t=await issue();
  for(const auth of ["bearer "+t.token,"bEaReR "+t.token,"Basic unsupported","Bearer"]){
    for(const [method,path] of [["GET","/api/rooms"],["PATCH","/api/me"]]){
      const response=await SELF.fetch("https://kith.test"+path,{method,headers:{Authorization:auth,Cookie:"kith_session=p2-operator; csrf=test","X-CSRF-Token":"test","Content-Type":"application/json"},...(method==="PATCH"?{body:JSON.stringify({display_name:"not changed"})}:{})});
      expect(response.status).toBe(401);expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  }
});
it("bounds token issuance atomically and refuses disabled owners and oversized writes",async()=>{
  const results=await Promise.all(Array.from({length:22},()=>call("POST","/api/reading-export/tokens",{})));
  expect(results.filter(r=>r.status===201)).toHaveLength(20);expect(results.filter(r=>r.status===409)).toHaveLength(2);
  const issued=await results.find(r=>r.status===201)!.json() as {token:string};
  await env.DB.prepare("UPDATE members SET disabled_at=? WHERE id='p2-operator'").bind(tick).run();
  expect((await call("POST","/api/reading-export/ack",{commit:"b".repeat(40),captures:[],notes:[]},"anonymous",issued.token)).status).toBe(401);
  await env.DB.prepare("UPDATE members SET disabled_at=NULL WHERE id='p2-operator'").run();
  expect((await call("PUT","/api/notes/A",{body:"\u0001".repeat(16384),revision:0})).status).toBe(201);
  expect((await note()).body).toBe("\u0001".repeat(16384));
  expect((await call("PUT","/api/notes/A",{body:"x".repeat(140000),revision:1})).status).toBe(413);
  expect((await call("POST","/api/reading-export/ack",{commit:"b".repeat(40),captures:Array.from({length:101},(_,i)=>"c"+i),notes:[]})).status).toBe(400);
  expect((await call("POST","/api/reading-export/ack",{commit:"b".repeat(40),captures:[],notes:[{id:"n",revision:1},{id:"n",revision:1}]})).status).toBe(400);
});
it("exports bounded reconciliation pages including already ACKed rows and validates ACKs",async()=>{
  for(const id of ["a","b","c"])await env.DB.prepare("INSERT INTO captures(id,body,client_key,created_at,exported_commit) VALUES(?,?,?,?,?)").bind(id,id,id,tick,id==="a"?"c".repeat(40):null).run();
  const t=await issue();
  const page=await(await call("GET","/api/reading-export?kind=captures&limit=2",undefined,"anonymous",t.token)).json() as any;
  expect(page.records.map((x:any)=>x.id)).toEqual(["a","b"]);expect(page.next_cursor).toBe("b");expect(JSON.stringify(page)).not.toContain("client_key");
  const last=await(await call("GET","/api/reading-export?kind=captures&limit=2&cursor=b",undefined,"anonymous",t.token)).json() as any;
  expect(last.records.map((x:any)=>x.id)).toEqual(["c"]);expect(last.next_cursor).toBeNull();
  for(const q of ["","kind=unknown","kind=captures&limit=0","kind=notes&cursor=../x","kind=notes&kind=notes","kind=captures&limit=101"])expect((await call("GET","/api/reading-export?"+q)).status).toBe(400);
  for(const ack of [{commit:"bad",captures:[],notes:[]},{commit:"d".repeat(40),captures:["b","b"],notes:[]},{commit:"d".repeat(40),captures:[],notes:[{id:"n",revision:0}]}])expect((await call("POST","/api/reading-export/ack",ack)).status).toBe(400);
  const ack={commit:"d".repeat(40),captures:["a","b","c"],notes:[]};expect(await(await call("POST","/api/reading-export/ack",ack)).json()).toEqual({captures:2,notes:0});expect(await(await call("POST","/api/reading-export/ack",ack)).json()).toEqual({captures:0,notes:0});
});
