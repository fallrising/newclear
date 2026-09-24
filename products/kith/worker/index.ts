import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { MEMBERS_PER_ROOM } from "../src/caps.ts";
import { rejectMemberCount } from "../src/reject.ts";
import { hashPassword, verifyPassword } from "../src/password.ts";
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
import { mountProviderRoutes } from "./routes/providers.ts";

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
    `SELECT id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, disabled_at, must_change_password
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
  const operator = await c.env.DB.prepare(`SELECT display_name, handle FROM members WHERE is_operator = 1`).first<{
    display_name: string;
    handle: string;
  }>();
  return c.json({ ...publicMember(auth.member), operator_display_name: operator ? operator.display_name || operator.handle : null });
});

app.patch("/api/me", async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["display_name"]).length > 0) return invalid(c, "unknown field");
  if (typeof obj.display_name !== "string") return invalid(c, "display_name required");
  const displayName = obj.display_name.trim();
  if (displayName.length < 1 || displayName.length > 64) return invalid(c, "display_name must be 1-64 characters");
  await c.env.DB.prepare(`UPDATE members SET display_name = ? WHERE id = ?`).bind(displayName, auth.member.id).run();
  const member = await loadMember(c.env, auth.member.id);
  if (!member) return unauthorized(c);
  return c.json(publicMember(member));
});

app.get("/api/rooms", async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const all = new URL(c.req.url).searchParams.get("all");
  if (all !== null && all !== "1") return invalid(c, "invalid all");
  if (all === "1" && (auth.via !== "session" || auth.member.is_operator !== 1)) return forbidden(c, "operator required");
  const rooms = await roomSummaries(c.env, auth.member.id, { all: all === "1" });
  return c.json({ rooms });
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

app.patch("/api/rooms/:id", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const roomId = c.req.param("id");
  if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["name", "archived"]).length > 0) return invalid(c, "unknown field");
  if (obj.name === undefined && obj.archived === undefined) return invalid(c, "name or archived required");
  let name: string | null = null;
  if (obj.name !== undefined) {
    if (typeof obj.name !== "string") return invalid(c, "invalid name");
    name = obj.name.trim();
    if (name.length < 1 || name.length > 80) return invalid(c, "name must be 1-80 characters");
  }
  if (obj.archived !== undefined && typeof obj.archived !== "boolean") return invalid(c, "archived must be boolean");
  if (name !== null) {
    await c.env.DB.prepare(`UPDATE rooms SET name = ? WHERE id = ?`).bind(name, roomId).run();
  }
  if (obj.archived === true) {
    await c.env.DB.prepare(`UPDATE rooms SET archived_at = COALESCE(archived_at, ?) WHERE id = ?`)
      .bind(new Date().toISOString(), roomId)
      .run();
  } else if (obj.archived === false) {
    await c.env.DB.prepare(`UPDATE rooms SET archived_at = NULL WHERE id = ?`).bind(roomId).run();
  }
  const [room] = await roomSummaries(c.env, auth.member.id, { all: true, roomId });
  return c.json(room);
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
  const orderRaw = url.searchParams.get("order");
  const afterSeq = afterRaw == null || afterRaw === "" ? -1 : Number(afterRaw);
  const beforeSeq = beforeRaw == null || beforeRaw === "" ? null : Number(beforeRaw);
  const limit = Math.min(50, Math.max(1, limitRaw ? Number(limitRaw) : 50));
  if (!Number.isFinite(afterSeq) || (beforeSeq != null && !Number.isFinite(beforeSeq)) || !Number.isFinite(limit)) {
    return invalid(c, "invalid query");
  }
  if (orderRaw !== null && orderRaw !== "asc" && orderRaw !== "desc") return invalid(c, "invalid order");
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
  if (orderRaw === null) {
    sql += ` ORDER BY seq ASC LIMIT ?`;
    params.push(limit);
    const result = await c.env.DB.prepare(sql).bind(...params).all();
    return c.json({ messages: result.results ?? [] });
  }
  sql += orderRaw === "desc" ? ` ORDER BY seq DESC LIMIT ?` : ` ORDER BY seq ASC LIMIT ?`;
  params.push(limit + 1);
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows.slice();
  if (orderRaw === "desc") page.reverse();
  return c.json({ messages: page, has_more: hasMore });
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

app.get("/api/members", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kind = url.searchParams.get("kind");
  const includeDisabled = url.searchParams.get("include_disabled");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 20 : Number(limitRaw);
  if (q.length > 64) return invalid(c, "q too long");
  if (kind !== null && kind !== "human" && kind !== "agent") return invalid(c, "invalid kind");
  if (includeDisabled !== null && includeDisabled !== "0" && includeDisabled !== "1") return invalid(c, "invalid include_disabled");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return invalid(c, "limit must be 1-100");
  const where: string[] = [];
  const params: unknown[] = [];
  if (includeDisabled !== "1") where.push("disabled_at IS NULL");
  if (kind !== null) {
    where.push("kind = ?");
    params.push(kind);
  }
  if (q !== "") {
    const pattern = q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%";
    where.push("(handle LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const sql = `SELECT ${ADMIN_MEMBER_COLUMNS} FROM members${where.length > 0 ? " WHERE " + where.join(" AND ") : ""}
               ORDER BY handle COLLATE NOCASE ASC LIMIT ?`;
  params.push(limit);
  const result = await c.env.DB.prepare(sql).bind(...params).all<AdminMemberRow>();
  return c.json({ members: (result.results ?? []).map(adminMember) });
});

app.post("/api/members", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["handle", "display_name", "password"]).length > 0) return invalid(c, "unknown field");
  const handle = typeof obj.handle === "string" ? obj.handle.trim() : "";
  const displayName = typeof obj.display_name === "string" ? obj.display_name.trim() : "";
  const password = typeof obj.password === "string" ? obj.password : "";
  if (!HANDLE_RE.test(handle)) return invalid(c, "handle must match [a-z0-9_]{2,32}");
  if (displayName.length < 1 || displayName.length > 64) return invalid(c, "display_name must be 1-64 characters");
  if (password.length < 12 || password.length > 128) return invalid(c, "password must be 12-128 characters");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at, must_change_password)
       VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 0, ?, 1)`,
    )
      .bind(id, handle, displayName, passwordHash, createdAt)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(message)) return c.json(errorBody("handle_taken", "handle taken"), 409);
    return c.json(errorBody("not_ready", "failed to create member"), 503);
  }
  const row = await c.env.DB.prepare(`SELECT ${ADMIN_MEMBER_COLUMNS} FROM members WHERE id = ?`).bind(id).first<AdminMemberRow>();
  return c.json(adminMember(row!), 201);
});

app.patch("/api/members/:id", async (c) => {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  const memberId = c.req.param("id");
  const target = await loadMember(c.env, memberId);
  if (!target) return c.json(errorBody("not_found", "member not found"), 404);
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (extraKeys(obj, ["display_name", "disabled"]).length > 0) return invalid(c, "unknown field");
  if (obj.display_name === undefined && obj.disabled === undefined) return invalid(c, "display_name or disabled required");
  let displayName: string | null = null;
  if (obj.display_name !== undefined) {
    if (typeof obj.display_name !== "string") return invalid(c, "invalid display_name");
    displayName = obj.display_name.trim();
    if (displayName.length < 1 || displayName.length > 64) return invalid(c, "display_name must be 1-64 characters");
  }
  if (obj.disabled !== undefined && typeof obj.disabled !== "boolean") return invalid(c, "disabled must be boolean");
  if (obj.disabled === true && target.is_operator === 1) return forbidden(c, "cannot disable the operator");
  if (displayName !== null) {
    await c.env.DB.prepare(`UPDATE members SET display_name = ? WHERE id = ?`).bind(displayName, memberId).run();
  }
  if (obj.disabled === true) {
    await c.env.DB.prepare(`UPDATE members SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ?`)
      .bind(new Date().toISOString(), memberId)
      .run();
  } else if (obj.disabled === false) {
    await c.env.DB.prepare(`UPDATE members SET disabled_at = NULL WHERE id = ?`).bind(memberId).run();
  }
  const row = await c.env.DB.prepare(`SELECT ${ADMIN_MEMBER_COLUMNS} FROM members WHERE id = ?`).bind(memberId).first<AdminMemberRow>();
  return c.json(adminMember(row!));
});

app.post("/api/members/:id/password", async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;
  const memberId = c.req.param("id");
  const target = await loadMember(c.env, memberId);
  if (!target || target.kind !== "human") return c.json(errorBody("not_found", "member not found"), 404);
  const obj = parseObject(await c.req.text());
  if (!obj) return invalid(c, "invalid json");
  if (target.id === auth.member.id) {
    if (extraKeys(obj, ["old_password", "new_password"]).length > 0) return invalid(c, "unknown field");
    const oldPassword = typeof obj.old_password === "string" ? obj.old_password : "";
    const newPassword = typeof obj.new_password === "string" ? obj.new_password : "";
    if (newPassword.length < 12 || newPassword.length > 128) return invalid(c, "password must be 12-128 characters");
    if (!target.password_hash || !(await verifyPassword(oldPassword, target.password_hash))) {
      return c.json(errorBody("wrong_password", "old password does not match"), 400);
    }
    const passwordHash = await hashPassword(newPassword);
    await c.env.DB.prepare(`UPDATE members SET password_hash = ?, must_change_password = 0 WHERE id = ?`)
      .bind(passwordHash, memberId)
      .run();
    return c.json({ ok: true });
  }
  if (auth.member.is_operator !== 1) return forbidden(c, "operator required");
  if (extraKeys(obj, ["password"]).length > 0) return invalid(c, "unknown field");
  const password = typeof obj.password === "string" ? obj.password : "";
  if (password.length < 12 || password.length > 128) return invalid(c, "password must be 12-128 characters");
  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(`UPDATE members SET password_hash = ?, must_change_password = 1 WHERE id = ?`)
    .bind(passwordHash, memberId)
    .run();
  return c.json({ ok: true });
});

mountProviderRoutes(app);

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
    must_change_password: member.must_change_password === 1,
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

type RoomSummaryRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  role: string | null;
  archived_at: string | null;
  last_seq: number | null;
  member_count: number;
  lm_seq: number | null;
  lm_sender_id: string | null;
  lm_body_preview: string | null;
  lm_created_at: string | null;
  lm_sender_display_name: string | null;
  lm_sender_handle: string | null;
};

async function roomSummaries(
  env: Env,
  memberId: string,
  options: { all: boolean; roomId?: string },
): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [memberId];
  let sql = `SELECT r.id, r.slug, r.name, r.created_at, rm.role, r.archived_at,
                    (SELECT MAX(m.seq) FROM messages m WHERE m.room_id = r.id) AS last_seq,
                    (SELECT COUNT(*) FROM room_members x WHERE x.room_id = r.id) AS member_count,
                    lm.seq AS lm_seq, lm.sender_id AS lm_sender_id,
                    substr(lm.body, 1, 140) AS lm_body_preview, lm.created_at AS lm_created_at,
                    sm.display_name AS lm_sender_display_name, sm.handle AS lm_sender_handle
             FROM rooms r
             ${options.all ? "LEFT JOIN" : "JOIN"} room_members rm ON rm.room_id = r.id AND rm.member_id = ?
             LEFT JOIN messages lm ON lm.room_id = r.id
               AND lm.seq = (SELECT MAX(m2.seq) FROM messages m2 WHERE m2.room_id = r.id AND m2.kind = 'message')
             LEFT JOIN members sm ON sm.id = lm.sender_id`;
  if (options.roomId !== undefined) {
    sql += ` WHERE r.id = ?`;
    params.push(options.roomId);
  }
  sql += ` ORDER BY r.created_at ASC`;
  const result = await env.DB.prepare(sql).bind(...params).all<RoomSummaryRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    created_at: row.created_at,
    role: row.role,
    archived_at: row.archived_at,
    last_seq: row.last_seq,
    member_count: row.member_count,
    last_message:
      row.lm_seq === null
        ? null
        : {
            seq: row.lm_seq,
            sender_id: row.lm_sender_id,
            sender_display_name: row.lm_sender_display_name,
            sender_handle: row.lm_sender_handle,
            body_preview: row.lm_body_preview,
            created_at: row.lm_created_at,
          },
  }));
}

const ADMIN_MEMBER_COLUMNS = `id, kind, handle, display_name, is_operator, quota_class, created_at, disabled_at, must_change_password`;

type AdminMemberRow = {
  id: string;
  kind: string;
  handle: string;
  display_name: string;
  is_operator: number;
  quota_class: string;
  created_at: string;
  disabled_at: string | null;
  must_change_password: number;
};

function adminMember(row: AdminMemberRow) {
  return {
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    display_name: row.display_name,
    is_operator: row.is_operator,
    quota_class: row.quota_class,
    created_at: row.created_at,
    disabled_at: row.disabled_at,
    must_change_password: row.must_change_password === 1,
  };
}
