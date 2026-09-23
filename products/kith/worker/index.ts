import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { MEMBERS_PER_ROOM } from "../src/caps.ts";
import { rejectMemberCount } from "../src/reject.ts";
import { verifyPassword } from "../src/password.ts";
import { hashBotToken, issueBotToken } from "../src/token.ts";
import {
  authorizationBearer,
  clearSessionCookie,
  createSession,
  csrfOk,
  destroySession,
  forbidden,
  invalid,
  isRoomMember,
  loadActiveMemberByHandle,
  loadMember,
  requireAuth,
  requireOperator,
  requireSession,
  roomExists,
  setCsrfCookie,
  setSessionCookie,
  unauthorized,
  randomToken,
  type MemberRow,
} from "./auth.ts";
import {
  INTERNAL_HEADER,
  INTERNAL_ORIGIN,
  MEMBER_HEADER,
  ROOM_HEADER,
  SESSION_COOKIE,
  flagOn,
  type Env,
} from "./env.ts";
import { errorBody } from "./errors.ts";
import { asInt, extraKeys, parseObject } from "./json.ts";
import { handleMcpEvents } from "./events.ts";
import { gcAllRooms } from "./gc.ts";
import { HostedGeneration } from "./hosted/generation.ts";
import { Inbox } from "./inbox.ts";
import { handleMcpPost } from "./mcp.ts";
import { snapshot } from "./metrics.ts";
import { replyLimit } from "./reply-limit.ts";
import { Room } from "./room.ts";

export { HostedGeneration, Inbox, Room };

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

const HANDLE_RE = /^[a-z0-9_]{2,32}$/;
const QUOTA_CLASSES = new Set(["api_key", "operator_personal"]);
const ATTENTION_MODES = new Set(["silent", "mention", "keyword", "ambient"]);

app.use("/api/*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
    return next();
  }
  if (authorizationBearer(c) != null) return next();
  if (!csrfOk(c)) return unauthorized(c, "CSRF token missing or mismatch");
  return next();
});

app.get("/api/csrf", (c) => {
  const token = randomToken(32);
  setCsrfCookie(c, token);
  return c.json({ csrf: token });
});

app.post("/api/auth/login", async (c) => {
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["username", "handle", "password"]).length > 0) {
    return invalid(c, "unknown field");
  }
  const handle = (typeof obj.handle === "string" ? obj.handle : typeof obj.username === "string" ? obj.username : "")
    .trim();
  const password = typeof obj.password === "string" ? obj.password : "";
  if (!handle || !password) return invalid(c, "handle and password required");

  const member = await c.env.DB.prepare(
    `SELECT id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, disabled_at
     FROM members WHERE handle = ? COLLATE NOCASE`,
  )
    .bind(handle)
    .first<MemberRow>();
  if (!member || member.kind !== "human" || !member.password_hash || member.disabled_at) {
    return unauthorized(c, "invalid credentials");
  }
  const ok = await verifyPassword(password, member.password_hash);
  if (!ok) return unauthorized(c, "invalid credentials");

  const previous = getCookie(c, SESSION_COOKIE);
  await destroySession(c.env, previous);
  const sessionId = await createSession(c.env, member.id);
  setSessionCookie(c, sessionId);
  return c.json({ ok: true, member: publicMember(member) });
});

app.post("/api/auth/logout", async (c) => {
  const previous = getCookie(c, SESSION_COOKIE);
  await destroySession(c.env, previous);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  return c.json(publicMember(auth.member));
});

app.get("/api/rooms", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const result = await c.env.DB.prepare(
    `SELECT r.id, r.slug, r.name, r.created_at, rm.role
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.member_id = ?
     ORDER BY r.created_at ASC`,
  )
    .bind(auth.member.id)
    .all();
  return c.json({ rooms: result.results ?? [] });
});

app.post("/api/rooms", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["slug", "name"]).length > 0) return invalid(c, "unknown field");
  const slug = typeof obj.slug === "string" ? obj.slug : "";
  const name = typeof obj.name === "string" ? obj.name : "";
  if (!slug || !name) return invalid(c, "slug and name required");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, slug, name, auth.member.id, createdAt)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)
       VALUES (?, ?, 'owner', 'mention', '[]', 15000, 2000, 'heuristic', 1)`,
    )
      .bind(id, auth.member.id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(message)) return c.json(errorBody("handle_taken", "slug taken"), 409);
    return c.json(errorBody("not_ready", "failed to create room"), 503);
  }
  return c.json({ id, slug, name, created_at: createdAt });
});

app.get("/api/rooms/:id/messages", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
  const url = new URL(c.req.url);
  const afterRaw = url.searchParams.get("after_seq");
  const beforeRaw = url.searchParams.get("before_seq");
  const limitRaw = url.searchParams.get("limit");
  const kindRaw = url.searchParams.get("kind") ?? "message";
  const afterSeq = afterRaw == null || afterRaw === "" ? -1 : Number(afterRaw);
  const beforeSeq = beforeRaw == null || beforeRaw === "" ? null : Number(beforeRaw);
  const limit = Math.min(50, Math.max(1, limitRaw ? Number(limitRaw) : 50));
  if (!Number.isFinite(afterSeq) || (beforeSeq != null && !Number.isFinite(beforeSeq)) || !Number.isFinite(limit)) {
    return invalid(c, "invalid query");
  }
  const kinds = kindRaw.split(",").map((k) => k.trim()).filter(Boolean);
  if (kinds.some((k) => k !== "message" && k !== "trace")) return invalid(c, "invalid kind");
  const placeholders = kinds.map(() => "?").join(",");
  const params: unknown[] = [roomId, afterSeq];
  let sql = `SELECT id, room_id, seq, kind, thread_id, reply_to, sender_id, body, mentions_json,
                    generation_id, client_message_id, origin, created_at
             FROM messages
             WHERE room_id = ? AND seq > ? AND kind IN (${placeholders})`;
  params.push(...kinds);
  if (beforeSeq != null) {
    sql += ` AND seq < ?`;
    params.push(beforeSeq);
  }
  sql += ` ORDER BY seq ASC LIMIT ?`;
  params.push(limit);
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ messages: result.results ?? [] });
});

app.post("/api/rooms/:id/messages", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
  const text = await c.req.text();
  const obj = parseObject(text);
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["body", "client_message_id", "thread_id", "generation_id", "kind"]).length > 0) {
    return invalid(c, "unknown field");
  }
  if (obj.kind !== undefined && obj.kind !== "message" && obj.kind !== "trace") {
    return invalid(c, "invalid kind");
  }
  return forwardSend(c.env, roomId, auth.member.id, text);
});

app.get("/api/rooms/:id/members", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
  const result = await c.env.DB.prepare(
    `SELECT m.id, m.kind, m.handle, m.display_name, m.quota_class, m.is_operator,
            rm.role, rm.attention_mode, rm.keywords_json, rm.policy_epoch
     FROM room_members rm
     JOIN members m ON m.id = rm.member_id
     WHERE rm.room_id = ?`,
  )
    .bind(roomId)
    .all();
  const members = (result.results ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ...r,
      operator_only: r.quota_class === "operator_personal",
      reply_limit: replyLimit({
        kind: typeof r.kind === "string" ? r.kind : "",
        quotaClass: typeof r.quota_class === "string" ? r.quota_class : "",
        sidecarOn: flagOn(c.env.ff_sidecar),
        hasApiKey: Boolean(c.env.XAI_API_KEY),
        fakeText: c.env.FAKE_LLM_TEXT,
      }),
    };
  });
  return c.json({ members });
});

app.post("/api/rooms/:id/members", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["member_id", "handle", "role"]).length > 0) return invalid(c, "unknown field");
  const hasIdKey = Object.prototype.hasOwnProperty.call(obj, "member_id");
  const hasHandleKey = Object.prototype.hasOwnProperty.call(obj, "handle");
  if (hasIdKey === hasHandleKey) return invalid(c, "member_id or handle required");
  const role = obj.role === undefined ? "member" : obj.role;
  if (role !== "member" && role !== "owner") return invalid(c, "invalid role");
  let target: MemberRow | null;
  if (hasHandleKey) {
    if (typeof obj.handle !== "string" || obj.handle.trim() === "") return invalid(c, "handle required");
    target = await loadActiveMemberByHandle(c.env, obj.handle.trim());
    if (!target) return c.json(errorBody("not_found", "handle not found"), 404);
  } else {
    if (typeof obj.member_id !== "string" || obj.member_id === "") return invalid(c, "member_id required");
    target = await loadMember(c.env, obj.member_id);
    if (!target || target.disabled_at) return c.json(errorBody("not_found", "member not found"), 404);
  }
  const memberId = target.id;
  if (target.kind !== "human" && target.kind !== "agent") return invalid(c, "invalid member kind");
  if (role === "owner" && target.kind === "agent") return forbidden(c, "agent cannot be owner");
  const already = await isRoomMember(c.env, roomId, memberId);
  if (already) return c.json(errorBody("already_member", "already a member"), 409);
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?`)
    .bind(roomId)
    .first<{ n: number }>();
  const nextCount = Number(countRow?.n ?? 0) + 1;
  if (nextCount > MEMBERS_PER_ROOM || !rejectMemberCount(nextCount).ok) {
    return c.json(errorBody("room_full", "room is full"), 409);
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)
       VALUES (?, ?, ?, 'mention', '[]', 15000, 2000, 'heuristic', 1)`,
    )
      .bind(roomId, memberId, role)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/agent cannot be owner/i.test(message)) return forbidden(c, "agent cannot be owner");
    throw err;
  }
  return c.json({ ok: true, member_id: memberId, role });
});

app.patch("/api/rooms/:id/members/:mid/attention", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  const mid = c.req.param("mid");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  const attentionText = await c.req.text();
  const obj = attentionText.trim() === "" ? {} : parseObject(attentionText);
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["mode", "keywords", "cooldown_ms", "debounce_ms"]).length > 0) {
    return invalid(c, "unknown field");
  }
  const row = await c.env.DB.prepare(
    `SELECT attention_mode, keywords_json, cooldown_ms, debounce_ms, policy_epoch
     FROM room_members WHERE room_id = ? AND member_id = ?`,
  )
    .bind(roomId, mid)
    .first<{
      attention_mode: string;
      keywords_json: string;
      cooldown_ms: number;
      debounce_ms: number;
      policy_epoch: number;
    }>();
  if (!row) return c.json(errorBody("not_found", "membership not found"), 404);
  let mode = row.attention_mode;
  let keywordsJson = row.keywords_json;
  let cooldownMs = Number(row.cooldown_ms);
  let debounceMs = Number(row.debounce_ms);
  if (obj.mode !== undefined) {
    if (typeof obj.mode !== "string" || !ATTENTION_MODES.has(obj.mode)) return invalid(c, "invalid mode");
    mode = obj.mode;
  }
  if (obj.keywords !== undefined) {
    if (!Array.isArray(obj.keywords) || obj.keywords.some((k) => typeof k !== "string")) {
      return invalid(c, "invalid keywords");
    }
    keywordsJson = JSON.stringify(obj.keywords);
  }
  if (obj.cooldown_ms !== undefined) {
    const n = asInt(obj.cooldown_ms);
    if (n === undefined || n < 0) return invalid(c, "invalid cooldown_ms");
    cooldownMs = n;
  }
  if (obj.debounce_ms !== undefined) {
    const n = asInt(obj.debounce_ms);
    if (n === undefined || n < 0) return invalid(c, "invalid debounce_ms");
    debounceMs = n;
  }
  await c.env.DB.prepare(
    `UPDATE room_members
     SET attention_mode = ?, keywords_json = ?, cooldown_ms = ?, debounce_ms = ?, policy_epoch = policy_epoch + 1
     WHERE room_id = ? AND member_id = ?`,
  )
    .bind(mode, keywordsJson, cooldownMs, debounceMs, roomId, mid)
    .run();
  const updated = await c.env.DB.prepare(
    `SELECT attention_mode, keywords_json, cooldown_ms, debounce_ms, policy_epoch
     FROM room_members WHERE room_id = ? AND member_id = ?`,
  )
    .bind(roomId, mid)
    .first<{
      attention_mode: string;
      keywords_json: string;
      cooldown_ms: number;
      debounce_ms: number;
      policy_epoch: number;
    }>();
  return c.json({
    ok: true,
    member_id: mid,
    attention_mode: updated?.attention_mode ?? mode,
    keywords_json: updated?.keywords_json ?? keywordsJson,
    cooldown_ms: Number(updated?.cooldown_ms ?? cooldownMs),
    debounce_ms: Number(updated?.debounce_ms ?? debounceMs),
    policy_epoch: Number(updated?.policy_epoch ?? Number(row.policy_epoch) + 1),
  });
});

app.delete("/api/rooms/:id/members/:mid", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  const mid = c.req.param("mid");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  if (!(await isRoomMember(c.env, roomId, mid))) return c.json(errorBody("not_found", "membership not found"), 404);
  const owner = await c.env.DB.prepare(
    `SELECT member_id FROM room_members WHERE room_id = ? AND role = 'owner'`,
  )
    .bind(roomId)
    .all<{ member_id: string }>();
  const owners = owner.results ?? [];
  if (owners.length === 1 && owners[0]!.member_id === mid) {
    return c.json(errorBody("last_owner", "cannot remove the last owner"), 409);
  }
  await c.env.DB.prepare(`DELETE FROM room_members WHERE room_id = ? AND member_id = ?`).bind(roomId, mid).run();
  return c.json({ ok: true });
});

app.get("/api/rooms/:id/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
  const stub = roomStub(c.env, roomId);
  const internal = new Request(`${INTERNAL_ORIGIN}/rooms/${roomId}/ws?room_id=${encodeURIComponent(roomId)}`, {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      [INTERNAL_HEADER]: "1",
      [MEMBER_HEADER]: auth.member.id,
      [ROOM_HEADER]: roomId,
    },
  });
  return stub.fetch(internal);
});

app.post("/api/agents", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["handle", "display_name", "quota_class"]).length > 0) return invalid(c, "unknown field");
  const handle = typeof obj.handle === "string" ? obj.handle : "";
  const displayName = typeof obj.display_name === "string" ? obj.display_name : "";
  if (!HANDLE_RE.test(handle)) return invalid(c, "invalid handle");
  if (!displayName) return invalid(c, "display_name required");
  let quotaClass = "api_key";
  if (obj.quota_class !== undefined) {
    if (typeof obj.quota_class !== "string" || !QUOTA_CLASSES.has(obj.quota_class)) {
      return invalid(c, "invalid quota_class");
    }
    quotaClass = obj.quota_class;
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'agent', ?, ?, NULL, '[]', ?, 0, ?)`,
    )
      .bind(id, handle, displayName, quotaClass, createdAt)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(message)) return c.json(errorBody("handle_taken", "handle taken"), 409);
    return c.json(errorBody("not_ready", "failed to create agent"), 503);
  }
  const member = await loadMember(c.env, id);
  if (!member) return c.json(errorBody("not_ready", "failed to create agent"), 503);
  return c.json({ ...publicMember(member), created_at: createdAt });
});

app.post("/api/agents/:id/tokens", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const agentId = c.req.param("id");
  const agent = await loadMember(c.env, agentId);
  if (!agent || agent.kind !== "agent") return c.json(errorBody("not_found", "agent not found"), 404);
  const tokenText = await c.req.text();
  const obj = tokenText.trim() === "" ? {} : parseObject(tokenText);
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["room_scope_json", "expires_at"]).length > 0) return invalid(c, "unknown field");
  let roomScopeJson = "[]";
  if (obj.room_scope_json !== undefined) {
    if (Array.isArray(obj.room_scope_json)) {
      roomScopeJson = JSON.stringify(obj.room_scope_json);
    } else if (typeof obj.room_scope_json === "string") {
      try {
        const parsed: unknown = JSON.parse(obj.room_scope_json);
        if (!Array.isArray(parsed)) return invalid(c, "invalid room_scope_json");
        roomScopeJson = JSON.stringify(parsed);
      } catch {
        return invalid(c, "invalid room_scope_json");
      }
    } else {
      return invalid(c, "invalid room_scope_json");
    }
  }
  let expiresAt: string | null = null;
  if (obj.expires_at !== undefined) {
    if (typeof obj.expires_at !== "string" || Number.isNaN(Date.parse(obj.expires_at))) {
      return invalid(c, "invalid expires_at");
    }
    expiresAt = obj.expires_at;
  }
  const plaintext = issueBotToken();
  const tokenHash = await hashBotToken(plaintext);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO bot_tokens (id, member_id, token_hash, room_scope_json, created_at, expires_at, revoked_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  )
    .bind(id, agentId, tokenHash, roomScopeJson, createdAt, expiresAt)
    .run();
  return c.json({
    id,
    token: plaintext,
    created_at: createdAt,
    expires_at: expiresAt,
    room_scope_json: roomScopeJson,
  });
});

app.get("/api/agents/:id/tokens", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const agentId = c.req.param("id");
  const agent = await loadMember(c.env, agentId);
  if (!agent || agent.kind !== "agent") return c.json(errorBody("not_found", "agent not found"), 404);
  const result = await c.env.DB.prepare(
    `SELECT id, created_at, expires_at, revoked_at, last_used_at, room_scope_json
     FROM bot_tokens WHERE member_id = ? ORDER BY created_at ASC`,
  )
    .bind(agentId)
    .all();
  return c.json({ tokens: result.results ?? [] });
});

app.delete("/api/agents/:id/tokens/:tid", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const agentId = c.req.param("id");
  const tokenId = c.req.param("tid");
  const row = await c.env.DB.prepare(`SELECT id FROM bot_tokens WHERE id = ? AND member_id = ?`)
    .bind(tokenId, agentId)
    .first<{ id: string }>();
  if (!row) return c.json(errorBody("not_found", "token not found"), 404);
  await c.env.DB.prepare(`UPDATE bot_tokens SET revoked_at = ? WHERE id = ? AND member_id = ?`)
    .bind(new Date().toISOString(), tokenId, agentId)
    .run();
  return c.json({ ok: true });
});

app.get("/api/metrics", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  return c.json(snapshot());
});

app.post("/mcp", (c) => handleMcpPost(c));
app.get("/mcp/events", (c) => handleMcpEvents(c));

app.notFound((c) => c.json(errorBody("not_found", "not found"), 404));

function publicMember(member: MemberRow) {
  return {
    id: member.id,
    kind: member.kind,
    handle: member.handle,
    display_name: member.display_name,
    capabilities_json: member.capabilities_json,
    quota_class: member.quota_class,
    is_operator: member.is_operator,
  };
}

function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`));
}

async function forwardSend(env: Env, roomId: string, memberId: string, jsonText: string): Promise<Response> {
  const stub = roomStub(env, roomId);
  return stub.fetch(
    new Request(`${INTERNAL_ORIGIN}/rooms/${roomId}/send?room_id=${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_HEADER]: "1",
        [MEMBER_HEADER]: memberId,
        [ROOM_HEADER]: roomId,
      },
      body: jsonText,
    }),
  );
}

app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path === "/mcp" || path.startsWith("/mcp/")) {
    return c.json(errorBody("not_found", "not found"), 404);
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json(errorBody("not_found", "not found"), 404);
});

export default {
  fetch: app.fetch.bind(app),
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(gcAllRooms(env.DB));
  },
};
