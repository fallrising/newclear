import { SELF, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import { hashBotToken } from "../../src/token.ts";

const PASSWORD = "test-pass-m2";
let HASH = "";

type Seed = {
  operatorId: string;
  guestId: string;
  roomId: string;
  operatorHandle: string;
  guestHandle: string;
};

function mergeCookies(existing: string, res: Response): string {
  const map: Record<string, string> = {};
  if (existing) {
    for (const part of existing.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  const set =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("Set-Cookie")
        ? [res.headers.get("Set-Cookie")!]
        : [];
  for (const cookie of set) {
    const nv = cookie.split(";")[0] ?? "";
    const eq = nv.indexOf("=");
    if (eq < 0) continue;
    map[nv.slice(0, eq).trim()] = nv.slice(eq + 1).trim();
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function getCsrf(cookie = ""): Promise<{ cookie: string; csrf: string }> {
  const res = await SELF.fetch("https://kith.test/api/csrf", {
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { csrf: string };
  expect(typeof body.csrf).toBe("string");
  return { cookie: mergeCookies(cookie, res), csrf: body.csrf };
}

async function api(
  method: string,
  path: string,
  cookie: string,
  csrf: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = csrf;
    headers["content-type"] = "application/json";
  }
  return SELF.fetch(`https://kith.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function apiBearer(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (method !== "GET" && method !== "HEAD") {
    headers["content-type"] = "application/json";
  }
  return SELF.fetch(`https://kith.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(handle: string): Promise<{ cookie: string; csrf: string }> {
  const tok = await getCsrf();
  const res = await api("POST", "/api/auth/login", tok.cookie, tok.csrf, {
    handle,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  const cookie = mergeCookies(tok.cookie, res);
  return getCsrf(cookie);
}

async function resetStorage(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages"),
    env.DB.prepare("DELETE FROM bot_tokens"),
    env.DB.prepare("DELETE FROM generations"),
    env.DB.prepare("DELETE FROM room_members"),
    env.DB.prepare("DELETE FROM rooms"),
    env.DB.prepare("DELETE FROM members"),
  ]);
  const listed = await env.SESSIONS.list();
  await Promise.all(listed.keys.map((k) => env.SESSIONS.delete(k.name)));
}

async function seed(): Promise<Seed> {
  const operatorId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const operatorHandle = `op_${operatorId.replaceAll("-", "").slice(0, 10)}`;
  const guestHandle = `g_${guestId.replaceAll("-", "").slice(0, 10)}`;
  const now = "2026-09-20T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 1, ?)`,
    ).bind(operatorId, operatorHandle, "Operator", HASH, now),
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 0, ?)`,
    ).bind(guestId, guestHandle, "Guest", HASH, now),
    env.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'Lobby', ?, ?)`).bind(
      roomId,
      `slug_${roomId.replaceAll("-", "").slice(0, 10)}`,
      operatorId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'mention')`,
    ).bind(roomId, operatorId),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
    ).bind(roomId, guestId),
  ]);
  return { operatorId, guestId, roomId, operatorHandle, guestHandle };
}

type AgentCreated = { id: string; handle: string; kind: string; quota_class: string; is_operator: number };
type TokenCreated = { id: string; token: string };

async function createAgent(
  op: { cookie: string; csrf: string },
  handle = "grok",
  extra: Record<string, unknown> = {},
): Promise<{ res: Response; body: AgentCreated }> {
  const res = await api("POST", "/api/agents", op.cookie, op.csrf, {
    handle,
    display_name: "Grok",
    ...extra,
  });
  const body = (await res.json()) as AgentCreated;
  return { res, body };
}

async function issueToken(
  op: { cookie: string; csrf: string },
  agentId: string,
  extra: Record<string, unknown> = {},
): Promise<{ res: Response; body: TokenCreated }> {
  const res = await api("POST", `/api/agents/${agentId}/tokens`, op.cookie, op.csrf, extra);
  const body = (await res.json()) as TokenCreated;
  return { res, body };
}

beforeAll(async () => {
  if (env.TEST_MIGRATIONS) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  }
  HASH = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetStorage();
});

describe("kith M2 worker", () => {
  it("M2-US-02: create agent, issue token, GET /api/me with Bearer, revoke, Bearer 401", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);

    const unknown = await api("POST", "/api/agents", op.cookie, op.csrf, {
      handle: "grok",
      display_name: "Grok",
      extra: true,
    });
    expect(unknown.status).toBe(400);

    const created = await createAgent(op);
    expect(created.res.status).toBe(200);
    expect(created.body.kind).toBe("agent");
    expect(created.body.handle).toBe("grok");
    expect(created.body.quota_class).toBe("api_key");
    expect(created.body.is_operator).toBe(0);
    const dbMember = await env.DB.prepare(`SELECT kind, password_hash, is_operator, quota_class FROM members WHERE id = ?`)
      .bind(created.body.id)
      .first<{ kind: string; password_hash: string | null; is_operator: number; quota_class: string }>();
    expect(dbMember?.kind).toBe("agent");
    expect(dbMember?.password_hash).toBeNull();
    expect(Number(dbMember?.is_operator)).toBe(0);
    expect(dbMember?.quota_class).toBe("api_key");

    const dup = await createAgent(op);
    expect(dup.res.status).toBe(409);
    expect((dup.body as unknown as { error: { code: string } }).error.code).toBe("handle_taken");

    const mcp = await api("POST", "/mcp", op.cookie, op.csrf, {});
    expect(mcp.status).toBe(401);
    expect(((await mcp.json()) as { error: { code: string } }).error.code).toBe("unauthorized");

    const token = await issueToken(op, created.body.id);
    expect(token.res.status).toBe(200);
    expect(token.body.token.startsWith("kith_bot_")).toBe(true);
    expect(typeof token.body.id).toBe("string");

    const add = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: created.body.id,
    });
    expect(add.status).toBe(200);
    expect(((await add.json()) as { role: string }).role).toBe("member");
    const membership = await env.DB.prepare(
      `SELECT role, attention_mode, policy_epoch FROM room_members WHERE room_id = ? AND member_id = ?`,
    )
      .bind(s.roomId, created.body.id)
      .first<{ role: string; attention_mode: string; policy_epoch: number }>();
    expect(membership?.role).toBe("member");
    expect(membership?.attention_mode).toBe("mention");
    expect(Number(membership?.policy_epoch)).toBe(1);

    const me = await apiBearer("GET", "/api/me", token.body.token);
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { id: string; kind: string; handle: string; is_operator: number };
    expect(meBody.id).toBe(created.body.id);
    expect(meBody.kind).toBe("agent");
    expect(meBody.handle).toBe("grok");
    expect(meBody.is_operator).toBe(0);
    expect(JSON.stringify(meBody)).not.toMatch(/password_hash/);

    const send = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "hello from agent",
      client_message_id: "01M2AGENTSEND01",
    });
    expect(send.status).toBe(200);
    const sendBody = (await send.json()) as { seq: number; sender_id: string; kind: string; body: string };
    expect(typeof sendBody.seq).toBe("number");
    expect(sendBody.seq).toBe(0);
    expect(sendBody.sender_id).toBe(created.body.id);
    expect(sendBody.kind).toBe("message");
    expect(sendBody.body).toBe("hello from agent");

    const revoked = await api("DELETE", `/api/agents/${created.body.id}/tokens/${token.body.id}`, op.cookie, op.csrf);
    expect(revoked.status).toBe(200);

    const after = await apiBearer("GET", "/api/me", token.body.token);
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe("token_revoked");
  });

  it("TOK-01: create response has plaintext kith_bot_; GET list has no plaintext; D1 token_hash is 64 hex and does not contain kith_bot_ or the plaintext", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const created = await createAgent(op, "tokbot");
    expect(created.res.status).toBe(200);

    const token = await issueToken(op, created.body.id, { room_scope_json: [] });
    expect(token.res.status).toBe(200);
    expect(token.body.token.startsWith("kith_bot_")).toBe(true);
    expect(token.body.token.slice("kith_bot_".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(token.body.id).toBeTruthy();

    const listed = await api("GET", `/api/agents/${created.body.id}/tokens`, op.cookie, op.csrf);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(listBody.tokens).toHaveLength(1);
    const row = listBody.tokens[0]!;
    expect(row.id).toBe(token.body.id);
    expect("token" in row).toBe(false);
    expect("token_hash" in row).toBe(false);
    const dumped = JSON.stringify(listBody);
    expect(dumped).not.toContain(token.body.token);
    expect(dumped).not.toContain("kith_bot_");
    expect(dumped).not.toContain("token_hash");

    const db = await env.DB.prepare(`SELECT token_hash, id FROM bot_tokens WHERE id = ?`)
      .bind(token.body.id)
      .first<{ token_hash: string; id: string }>();
    expect(db?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db?.token_hash).not.toContain("kith_bot_");
    expect(db?.token_hash).not.toContain(token.body.token);
    expect(db?.token_hash).toBe(await hashBotToken(token.body.token));
    const allTokens = JSON.stringify(
      (await env.DB.prepare(`SELECT * FROM bot_tokens`).all()).results ?? [],
    );
    expect(allTokens).not.toContain(token.body.token);
    expect(allTokens).not.toContain("kith_bot_");
  });

  it("TOK-02: after DELETE, Bearer GET /api/me is 401 token_revoked immediately", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const created = await createAgent(op, "revoker");
    const token = await issueToken(op, created.body.id);
    expect(token.res.status).toBe(200);

    const before = await apiBearer("GET", "/api/me", token.body.token);
    expect(before.status).toBe(200);

    const del = await api("DELETE", `/api/agents/${created.body.id}/tokens/${token.body.id}`, op.cookie, op.csrf);
    expect(del.status).toBe(200);

    const after = await apiBearer("GET", "/api/me", token.body.token);
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe("token_revoked");

    const unknown = await apiBearer("GET", "/api/me", "kith_bot_" + "0".repeat(64));
    expect(unknown.status).toBe(401);
  });

  it("INV-02-HTTP: Bearer cannot POST tokens / POST members / PATCH attention (403); operator POST members role=owner for agent is 403; agent still cannot be owner in D1", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const agentA = await createAgent(op, "agent_a");
    const agentB = await createAgent(op, "agent_b");
    expect(agentA.res.status).toBe(200);
    expect(agentB.res.status).toBe(200);
    const token = await issueToken(op, agentA.body.id);
    expect(token.res.status).toBe(200);

    const bearerIssue = await apiBearer("POST", `/api/agents/${agentA.body.id}/tokens`, token.body.token, {});
    expect(bearerIssue.status).toBe(403);
    expect(((await bearerIssue.json()) as { error: { code: string } }).error.code).toBe("forbidden");

    const bearerInvite = await apiBearer("POST", `/api/rooms/${s.roomId}/members`, token.body.token, {
      member_id: s.guestId,
    });
    expect(bearerInvite.status).toBe(403);

    const bearerPatch = await apiBearer(
      "PATCH",
      `/api/rooms/${s.roomId}/members/${s.operatorId}/attention`,
      token.body.token,
      { mode: "silent" },
    );
    expect(bearerPatch.status).toBe(403);

    const bearerOtherTokens = await apiBearer("GET", `/api/agents/${agentB.body.id}/tokens`, token.body.token);
    expect(bearerOtherTokens.status).toBe(403);

    const bearerDelete = await apiBearer(
      "DELETE",
      `/api/agents/${agentA.body.id}/tokens/${token.body.id}`,
      token.body.token,
    );
    expect(bearerDelete.status).toBe(403);

    const bearerRooms = await apiBearer("POST", "/api/rooms", token.body.token, { slug: "x", name: "X" });
    expect(bearerRooms.status).toBe(403);

    const bearerAgents = await apiBearer("POST", "/api/agents", token.body.token, {
      handle: "nope",
      display_name: "Nope",
    });
    expect(bearerAgents.status).toBe(403);

    const ownerAttempt = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: agentA.body.id,
      role: "owner",
    });
    expect(ownerAttempt.status).toBe(403);
    expect(((await ownerAttempt.json()) as { error: { code: string } }).error.code).toBe("forbidden");

    const ownerRows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM room_members WHERE member_id = ? AND role = 'owner'`,
    )
      .bind(agentA.body.id)
      .first<{ n: number }>();
    expect(Number(ownerRows?.n ?? 0)).toBe(0);
    const anyMembership = await env.DB.prepare(`SELECT COUNT(*) AS n FROM room_members WHERE member_id = ?`)
      .bind(agentA.body.id)
      .first<{ n: number }>();
    expect(Number(anyMembership?.n ?? 0)).toBe(0);

    const asMember = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: agentA.body.id,
    });
    expect(asMember.status).toBe(200);

    const patch = await api("PATCH", `/api/rooms/${s.roomId}/members/${agentA.body.id}/attention`, op.cookie, op.csrf, {
      mode: "keyword",
      keywords: ["wake"],
      cooldown_ms: 1000,
      debounce_ms: 500,
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as { policy_epoch: number; attention_mode: string };
    expect(patchBody.attention_mode).toBe("keyword");
    expect(Number(patchBody.policy_epoch)).toBe(2);

    const epoch = await env.DB.prepare(
      `SELECT attention_mode, keywords_json, cooldown_ms, debounce_ms, policy_epoch, role
       FROM room_members WHERE room_id = ? AND member_id = ?`,
    )
      .bind(s.roomId, agentA.body.id)
      .first<{
        attention_mode: string;
        keywords_json: string;
        cooldown_ms: number;
        debounce_ms: number;
        policy_epoch: number;
        role: string;
      }>();
    expect(epoch?.role).toBe("member");
    expect(epoch?.attention_mode).toBe("keyword");
    expect(epoch?.keywords_json).toBe(JSON.stringify(["wake"]));
    expect(Number(epoch?.cooldown_ms)).toBe(1000);
    expect(Number(epoch?.debounce_ms)).toBe(500);
    expect(Number(epoch?.policy_epoch)).toBe(2);

    const bearerPatchAfter = await apiBearer(
      "PATCH",
      `/api/rooms/${s.roomId}/members/${agentA.body.id}/attention`,
      token.body.token,
      { mode: "ambient" },
    );
    expect(bearerPatchAfter.status).toBe(403);
    const epochAfter = await env.DB.prepare(
      `SELECT policy_epoch, attention_mode FROM room_members WHERE room_id = ? AND member_id = ?`,
    )
      .bind(s.roomId, agentA.body.id)
      .first<{ policy_epoch: number; attention_mode: string }>();
    expect(Number(epochAfter?.policy_epoch)).toBe(2);
    expect(epochAfter?.attention_mode).toBe("keyword");
  });

  it("M5-TRACE-01: agent bearer posts kind=trace; D1 has seq; GET ?kind=trace returns it; default GET is message-only", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const created = await createAgent(op, "tracer");
    expect(created.res.status).toBe(200);
    const token = await issueToken(op, created.body.id);
    expect(token.res.status).toBe(200);
    const add = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: created.body.id,
    });
    expect(add.status).toBe(200);

    const visible = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "visible message",
      client_message_id: "01M5TRACEMSG0001",
    });
    expect(visible.status).toBe(200);
    const visibleBody = (await visible.json()) as { seq: number; kind: string };
    expect(visibleBody.kind).toBe("message");
    expect(visibleBody.seq).toBe(0);

    const unknown = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "nope",
      client_message_id: "01M5TRACEUNKNOWN",
      kind: "trace",
      extra: true,
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

    const statusKind = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "typing",
      client_message_id: "01M5TRACESTATUS1",
      kind: "status",
    });
    expect(statusKind.status).toBe(400);
    expect(((await statusKind.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

    const tooBig = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "x".repeat(2049),
      client_message_id: "01M5TRACETOOBIG1",
      kind: "trace",
    });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");

    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ?`)
      .bind(s.roomId)
      .first<{ n: number }>();
    expect(Number(before?.n ?? 0)).toBe(1);

    const trace = await apiBearer("POST", `/api/rooms/${s.roomId}/messages`, token.body.token, {
      body: "sidecar summary",
      client_message_id: "01M5TRACE01CLIENT",
      kind: "trace",
    });
    expect(trace.status).toBe(200);
    const posted = (await trace.json()) as {
      id: string;
      seq: number;
      kind: string;
      body: string;
      sender_id: string;
      client_message_id: string;
    };
    expect(posted.kind).toBe("trace");
    expect(posted.seq).toBe(1);
    expect(posted.body).toBe("sidecar summary");
    expect(posted.sender_id).toBe(created.body.id);
    expect(posted.client_message_id).toBe("01M5TRACE01CLIENT");

    const row = await env.DB.prepare(
      `SELECT id, seq, kind, body, sender_id, client_message_id FROM messages WHERE room_id = ? AND client_message_id = ?`,
    )
      .bind(s.roomId, "01M5TRACE01CLIENT")
      .first<{
        id: string;
        seq: number;
        kind: string;
        body: string;
        sender_id: string;
        client_message_id: string;
      }>();
    expect(row?.kind).toBe("trace");
    expect(Number(row?.seq)).toBe(1);
    expect(row?.id).toBe(posted.id);
    expect(row?.body).toBe("sidecar summary");
    expect(row?.sender_id).toBe(created.body.id);

    const defaultGet = await apiBearer("GET", `/api/rooms/${s.roomId}/messages`, token.body.token);
    expect(defaultGet.status).toBe(200);
    const defaultBody = (await defaultGet.json()) as { messages: Array<{ seq: number; kind: string; body: string }> };
    expect(defaultBody.messages.map((m) => m.kind)).toEqual(["message"]);
    expect(defaultBody.messages.map((m) => m.seq)).toEqual([0]);
    expect(defaultBody.messages.some((m) => m.kind === "trace")).toBe(false);

    const traces = await apiBearer("GET", `/api/rooms/${s.roomId}/messages?kind=trace`, token.body.token);
    expect(traces.status).toBe(200);
    const tracesBody = (await traces.json()) as { messages: Array<{ seq: number; kind: string; body: string; id: string }> };
    expect(tracesBody.messages).toHaveLength(1);
    expect(tracesBody.messages[0]?.kind).toBe("trace");
    expect(tracesBody.messages[0]?.seq).toBe(1);
    expect(tracesBody.messages[0]?.id).toBe(posted.id);
    expect(tracesBody.messages[0]?.body).toBe("sidecar summary");

    const both = await apiBearer("GET", `/api/rooms/${s.roomId}/messages?kind=message,trace`, token.body.token);
    expect(both.status).toBe(200);
    const bothBody = (await both.json()) as { messages: Array<{ seq: number; kind: string }> };
    expect(bothBody.messages.map((m) => m.kind)).toEqual(["message", "trace"]);
    expect(bothBody.messages.map((m) => m.seq)).toEqual([0, 1]);
  });
});
