import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { parseBundle, type ReadingBundle } from "../../reading/bundle.ts";
import { hashBotToken } from "../../src/token.ts";
import { authorizationBearer, invalid, randomToken, requireOperator, unauthorized } from "../auth.ts";
import type { Env } from "../env.ts";
import { errorBody } from "../errors.ts";
import { extraKeys, parseObject } from "../json.ts";

type AppEnv = {Bindings:Env};
type C = Context<AppEnv>;
type Note = {id:string;article_id:string;body:string;revision:number;updated_at:string;exported_commit:string|null};
type Capture = {id:string;body:string;source:"web";created_at:string;exported_commit:string|null};
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{40}$/;
const NOTE_COLUMNS = "id,article_id,body,revision,updated_at,exported_commit";
export const isExportEndpoint = (method:string,path:string):boolean =>
  (method === "GET" && path === "/api/reading-export") || (method === "POST" && path === "/api/reading-export/ack");

/** Never fall back to cookies after any Bearer credential was supplied. */
export async function requireExportCaller(c:C):Promise<Response|null> {
  const token = authorizationBearer(c);
  if (token === null) {const auth=await requireOperator(c);return auth instanceof Response?auth:null;}
  if (!/^kith_export_[A-Za-z0-9_-]{43}$/.test(token)) return unauthorized(c);
  const row=await c.env.DB.prepare(`SELECT t.id FROM reading_export_tokens t JOIN members m ON m.id=t.member_id
    WHERE t.token_hash=? AND t.revoked_at IS NULL AND m.is_operator=1 AND m.kind='human' AND m.disabled_at IS NULL`)
    .bind(await hashBotToken(token)).first();
  return row?null:unauthorized(c);
}

/** ASSETS is an internal fetch; direct URLs are denied by the outer Worker. */
async function readBundle(c:C):Promise<ReadingBundle|null> {
  if (!c.env.ASSETS) return null;
  try {
    const res=await c.env.ASSETS.fetch(new Request(new URL("/_reading/current.json",c.req.url)));
    if (!res.ok || !res.body) return null;
    const reader=res.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();return null;}chunks.push(value);}}
    finally {reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return parseBundle(JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes)));
  } catch {return null;}
}
function unavailable(c:C){return c.json(errorBody("reading_unavailable","reading publication unavailable"),503);}

export function mountReadingRoutes(app:Hono<AppEnv>,options:{now:()=>string;id:()=>string},validBody:(body:unknown)=>body is string):void {
  app.use("/api/notes/*",bodyLimit({maxSize:128*1024,onError:c=>c.json(errorBody("body_too_large","request body too large"),413)}));
  app.use("/api/reading-export/*",bodyLimit({maxSize:64*1024,onError:c=>c.json(errorBody("body_too_large","request body too large"),413)}));
  app.get("/api/reading",async c=>{const bundle=await readBundle(c);return bundle?c.json(bundle):unavailable(c);});
  app.on(["GET","PUT"],"/api/notes/:article_id",async c=>{
    const article=c.req.param("article_id")!;
    if(!ID.test(article))return invalid(c,"invalid article ID");
    let obj:Record<string,unknown>|null=null;
    if(c.req.method==="PUT"){
      obj=parseObject(await c.req.text());
      if(!obj||extraKeys(obj,["body","revision"]).length||!validBody(obj.body)||!Number.isSafeInteger(obj.revision)||(obj.revision as number)<0)return invalid(c,"expected raw body and current revision");
    }
    const bundle=await readBundle(c);if(!bundle)return unavailable(c);
    if(!bundle.articles.some(a=>a.id===article))return c.json(errorBody("not_found","article not found"),404);
    if(!obj)return c.json({note:await c.env.DB.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE article_id=?`).bind(article).first<Note>()});
    const revision=obj.revision as number;const body=obj.body as string;
    if(revision===Number.MAX_SAFE_INTEGER)return c.json(errorBody("revision_exhausted","note revision exhausted"),409);
    const statement=revision===0
      ?c.env.DB.prepare("INSERT INTO notes(id,article_id,body,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(article_id) DO NOTHING").bind(options.id(),article,body,options.now())
      :c.env.DB.prepare("UPDATE notes SET body=?,revision=revision+1,updated_at=?,exported_commit=NULL WHERE article_id=? AND revision=? AND revision<9007199254740991").bind(body,options.now(),article,revision);
    const result=await c.env.DB.batch([statement,c.env.DB.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE article_id=?`).bind(article)]);
    const note=result[1]!.results[0] as Note|undefined;
    if(!note||note.revision!==revision+1||note.body!==body)return c.json(errorBody("note_conflict","note changed; reload before retrying"),409);
    return c.json({note},revision===0&&result[0]!.meta.changes===1?201:200);
  });
  app.get("/api/reading-export/tokens",async c=>{
    const auth=await requireOperator(c);if(auth instanceof Response)return auth;
    const rows=await c.env.DB.prepare("SELECT id,created_at,revoked_at FROM reading_export_tokens WHERE member_id=? ORDER BY (revoked_at IS NULL) DESC,created_at DESC,id DESC LIMIT 100").bind(auth.member.id).all();
    return c.json({tokens:rows.results});
  });
  app.post("/api/reading-export/tokens",async c=>{
    const auth=await requireOperator(c);if(auth instanceof Response)return auth;
    const obj=parseObject(await c.req.text());if(!obj||Object.keys(obj).length)return invalid(c,"expected empty object");
    // Bound outstanding capability administration, including concurrent issuers.
    const id=options.id(),token="kith_export_"+randomToken();
    const result=await c.env.DB.prepare(`INSERT INTO reading_export_tokens(id,member_id,token_hash,created_at)
      SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM reading_export_tokens WHERE member_id=? AND revoked_at IS NULL)<20`)
      .bind(id,auth.member.id,await hashBotToken(token),options.now(),auth.member.id).run();
    if(result.meta.changes!==1)return c.json(errorBody("token_limit","revoke an existing export token first"),409);
    return c.json({id,token},201);
  });
  app.delete("/api/reading-export/tokens/:id",async c=>{
    const auth=await requireOperator(c);if(auth instanceof Response)return auth;
    const id=c.req.param("id");if(!ID.test(id))return invalid(c,"invalid token ID");
    await c.env.DB.prepare("UPDATE reading_export_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND member_id=?").bind(options.now(),id,auth.member.id).run();
    return c.body(null,204);
  });
  app.get("/api/reading-export",async c=>{
    const q=new URL(c.req.url).searchParams;
    if([...q.keys()].some(k=>!["kind","limit","cursor"].includes(k)||q.getAll(k).length!==1))return invalid(c,"invalid export query");
    const kind=q.get("kind"),limit=q.get("limit")??"100",cursor=q.get("cursor");
    if((kind!=="captures"&&kind!=="notes")||! /^[1-9][0-9]{0,2}$/.test(limit)||Number(limit)>100||(cursor!==null&&!ID.test(cursor)))return invalid(c,"invalid export page");
    const columns=kind==="captures"?"id,body,source,created_at,exported_commit":NOTE_COLUMNS;
    // Table/column interpolation is from closed constants; user values are bound.
    const result=await c.env.DB.prepare(`SELECT ${columns} FROM ${kind} WHERE id>? ORDER BY id LIMIT ?`).bind(cursor??"",Number(limit)+1).all<Capture|Note>();
    const records=result.results.slice(0,Number(limit));
    return c.json({records,next_cursor:result.results.length>Number(limit)?records.at(-1)!.id:null});
  });
  app.post("/api/reading-export/ack",async c=>{
    const obj=parseObject(await c.req.text());
    if(!obj||extraKeys(obj,["commit","captures","notes"]).length||typeof obj.commit!=="string"||!SHA.test(obj.commit)||!Array.isArray(obj.captures)||!Array.isArray(obj.notes)||obj.captures.length+obj.notes.length>100)return invalid(c,"invalid acknowledgement");
    const captures=obj.captures as unknown[],notes=obj.notes as unknown[];
    const ids=new Set<string>(),noteIds=new Set<string>();
    for(const id of captures){if(typeof id!=="string"||!ID.test(id)||ids.has(id))return invalid(c,"invalid capture IDs");ids.add(id);}
    for(const n of notes){if(!n||typeof n!=="object"||Array.isArray(n))return invalid(c,"invalid note acknowledgements");const o=n as Record<string,unknown>;
      if(extraKeys(o,["id","revision"]).length||typeof o.id!=="string"||!ID.test(o.id)||noteIds.has(o.id)||!Number.isSafeInteger(o.revision)||(o.revision as number)<1)return invalid(c,"invalid note acknowledgements");noteIds.add(o.id);}
    const statements=[...captures.map(id=>c.env.DB.prepare("UPDATE captures SET exported_commit=? WHERE id=? AND exported_commit IS NULL").bind(obj.commit,id)),
      ...(notes as {id:string;revision:number}[]).map(n=>c.env.DB.prepare("UPDATE notes SET exported_commit=? WHERE id=? AND revision=? AND exported_commit IS NULL").bind(obj.commit,n.id,n.revision))];
    const results=statements.length?await c.env.DB.batch(statements):[];
    return c.json({captures:results.slice(0,captures.length).reduce((n,r)=>n+r.meta.changes,0),notes:results.slice(captures.length).reduce((n,r)=>n+r.meta.changes,0)});
  });
}
