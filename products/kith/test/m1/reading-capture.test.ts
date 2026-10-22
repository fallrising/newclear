import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const csrf = "rc-csrf";
const cookie = (role = "operator") => `kith_session=rc-${role}; csrf=${csrf}`;
const now = "2026-01-01T00:00:00.000Z";
async function call(method: string, path: string, body?: unknown, role = "operator", token: string | null = csrf) {
  const headers = new Headers({ Cookie: cookie(role), "Content-Type": "application/json" });
  if (token !== null) headers.set("X-CSRF-Token", token);
  return SELF.fetch(`https://kith.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function rows() { return (await env.DB.prepare("SELECT * FROM captures ORDER BY id").all()).results; }

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM captures").run();
  await env.DB.prepare("DELETE FROM notes").run();
  await env.DB.prepare("UPDATE members SET is_operator = 0 WHERE is_operator = 1").run();
  for (const role of ["operator", "member", "expired", "disabled"]) {
    const id = `rc-${role}`;
    await env.DB.prepare(`INSERT OR REPLACE INTO members (id,kind,handle,display_name,is_operator,created_at,disabled_at,password_hash)
      VALUES (?, 'human', ?, ?, ?, ?, ?, 'synthetic-session-fixture')`).bind(id, id, role, role === "operator" ? 1 : 0, now, role === "disabled" ? now : null).run();
    await env.SESSIONS.put(`session:${id}`, JSON.stringify({ member_id: id, expires_at: role === "expired" ? now : "2099-01-01T00:00:00Z" }));
  }
});

describe("reading capture phase 1", () => {
  it("preserves raw bytes, persists once, and leaves chat untouched", async () => {
    const prior = (await env.DB.prepare("SELECT * FROM messages ORDER BY id").all()).results;
    const body = "  原文🌱\n\t keep spacing \n";
    const res = await call("POST", "/api/captures", { body, client_key: "raw-1" });
    expect(res.status).toBe(201);
    const saved = await res.json() as {capture_id: string};
    expect(saved.capture_id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    const data = await rows();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: saved.capture_id, body, source: "web", client_key: "raw-1", exported_commit: null });
    expect((await env.DB.prepare("SELECT * FROM messages ORDER BY id").all()).results).toEqual(prior);
    const listed = await call("GET", "/api/captures");
    expect(listed.headers.get("Cache-Control")).toBe("no-store");
    expect(await listed.json()).toMatchObject({ captures: [{ id: saved.capture_id, body, exported_commit: null }], next_cursor: null });
  });
  it("serializes concurrent retries and rejects a changed payload without overwrite", async () => {
    const request = { body: "same", client_key: "race" };
    const results = await Promise.all(Array.from({length: 5}, () => call("POST", "/api/captures", request)));
    expect(results.map(r => r.status).sort()).toEqual([200,200,200,200,201]);
    const ids = await Promise.all(results.map(async r => (await r.json() as {capture_id: string}).capture_id));
    expect(new Set(ids).size).toBe(1);
    const conflict = await call("POST", "/api/captures", {...request, body: "changed-secret"});
    expect(conflict.status).toBe(409);
    const text = await conflict.text();
    expect(text).toContain("capture_conflict"); expect(text).not.toContain("changed-secret");
    expect((await rows())[0]?.body).toBe("same");
    expect((await call("POST", "/api/captures", {...request, client_key: "another"})).status).toBe(201);
    expect(await rows()).toHaveLength(2);
  });
  it("validates raw body bytes, Unicode, key, shape and unknown fields", async () => {
    for (const body of ["", "界".repeat(5462), "\u0000", "\ud800", 12, null]) {
      expect((await call("POST", "/api/captures", {body, client_key: "invalid"})).status).toBe(400);
    }
    for (const client_key of ["", "../path", "a".repeat(129), "é", 1, null]) {
      expect((await call("POST", "/api/captures", {body: "valid", client_key})).status).toBe(400);
    }
    for (const obj of [null, [], {body:"valid"}, {body:"valid", client_key:"x", source:"web"}]) {
      expect((await call("POST", "/api/captures", obj)).status).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
    expect((await call("POST", "/api/captures", {body:"x".repeat(16384), client_key:"max"})).status).toBe(201);
    expect((await call("POST", "/api/captures", {body:" \n\t ", client_key:"spaces"})).status).toBe(201);
  });
  it("caps transport bodies before JSON parse", async () => {
    expect((await call("POST", "/api/captures", {body:"x".repeat(200000),client_key:"oversize"})).status).toBe(413);
    expect(await rows()).toHaveLength(0);
  });
  it("keyset pagination handles equal timestamps and intervening inserts", async () => {
    for (const id of ["a","b","c","d","e"]) {
      await env.DB.prepare("INSERT INTO captures(id,body,client_key,created_at) VALUES (?,?,?,?)").bind(id,id,id,now).run();
    }
    const first = await (await call("GET", "/api/captures?limit=2")).json() as {captures:{id:string}[];next_cursor:string};
    expect(first.captures.map(c=>c.id)).toEqual(["e","d"]);
    await env.DB.prepare("INSERT INTO captures(id,body,client_key,created_at) VALUES ('new','new','new','2099-01-01T00:00:00.000Z')").run();
    const second = await (await call("GET", "/api/captures?limit=2&cursor="+encodeURIComponent(first.next_cursor))).json() as typeof first;
    expect(second.captures.map(c=>c.id)).toEqual(["c","b"]);
    const third = await (await call("GET", "/api/captures?limit=2&cursor="+encodeURIComponent(second.next_cursor))).json() as typeof first;
    expect(third.captures.map(c=>c.id)).toEqual(["a"]); expect(third.next_cursor).toBeNull();
    for (const query of ["limit=0","limit=101","limit=1.5","limit=-1","limit=NaN","limit=","limit=01","cursor=garbage","cursor="+"a".repeat(1000),"limit=1&limit=2","unknown=1"]) {
      expect((await call("GET", "/api/captures?"+query)).status).toBe(400);
    }
  });
  it("denies every reserved route before private reads or writes", async () => {
    const routes = [["GET","/api/captures"],["POST","/api/captures"],["GET","/api/notes/article"],["PUT","/api/notes/article"],["GET","/api/reading-export"],["POST","/api/reading-export/ack"]];
    for (const [method,path] of routes) {
      for (const [role,status] of [["anonymous",401],["expired",401],["disabled",401],["member",403]] as const) {
        const res = await call(method!,path!,method === "GET" ? undefined : {body:"private",client_key:"never"},role);
        expect(res.status).toBe(status); expect(await res.text()).not.toContain("private");
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
      if (method !== "GET") {
        for (const token of [null,"wrong"]) expect((await call(method!,path!,{},"operator",token)).status).toBe(401);
      }
    }
    expect(await rows()).toHaveLength(0);
    expect((await env.DB.prepare("SELECT * FROM notes").all()).results).toHaveLength(0);
  });
  it("phase2 replaces the reserved routes without bypassing request validation", async () => {
    for (const [method,path] of [["GET","/api/notes/article"],["PUT","/api/notes/article"],["GET","/api/reading-export"],["POST","/api/reading-export/ack"]]) {
      const response = await call(method!,path!,method === "GET" ? undefined : {});
      expect(response.status).not.toBe(501);
      expect([400,503]).toContain(response.status);
    }
  });
});
