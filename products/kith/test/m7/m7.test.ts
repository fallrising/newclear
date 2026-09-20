import { SELF, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import { hashBotToken, issueBotToken } from "../../src/token.ts";
import { gcTraces } from "../../worker/gc.ts";
import { reset as resetMetrics, snapshot, type MetricsSnapshot } from "../../worker/metrics.ts";

const PASSWORD = "test-pass-m7";
let HASH = "";

type Seed = {
  operatorId: string;
  guestId: string;
  roomId: string;
  operatorHandle: string;
  guestHandle: string;
  agentId: string;
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
  const agentId = crypto.randomUUID();
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
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'agent', ?, ?, NULL, '[]', 'api_key', 0, ?)`,
    ).bind(agentId, `ag_${agentId.replaceAll("-", "").slice(0, 10)}`, "Agent", now),
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
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
    ).bind(roomId, agentId),
  ]);
  return { operatorId, guestId, roomId, operatorHandle, guestHandle, agentId };
}

async function insertRow(input: {
  roomId: string;
  senderId: string;
  seq: number;
  kind: "message" | "trace";
  createdAt: string;
  client: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (
       id, room_id, seq, kind, thread_id, reply_to, sender_id, body,
       mentions_json, generation_id, client_message_id, origin, created_at
     ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, '[]', NULL, ?, 'local', ?)`,
  )
    .bind(crypto.randomUUID(), input.roomId, input.seq, input.kind, input.senderId, `body-${input.seq}`, input.client, input.createdAt)
    .run();
}

async function rowsByKind(roomId: string): Promise<{ kind: string; seq: number }[]> {
  const result = await env.DB.prepare(`SELECT kind, seq FROM messages WHERE room_id = ? ORDER BY seq ASC`)
    .bind(roomId)
    .all<{ kind: string; seq: number }>();
  return result.results ?? [];
}

async function countRows(roomId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ?`)
    .bind(roomId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function maxSeq(roomId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT MAX(seq) AS m FROM messages WHERE room_id = ?`)
    .bind(roomId)
    .first<{ m: number | null }>();
  return Number(row?.m ?? -1);
}

async function restSend(
  roomId: string,
  cookie: string,
  csrf: string,
  body: string,
  clientMessageId: string,
  extra?: { generation_id?: string; kind?: "message" | "trace" },
): Promise<Response> {
  return api("POST", `/api/rooms/${roomId}/messages`, cookie, csrf, {
    body,
    client_message_id: clientMessageId,
    ...extra,
  });
}

beforeAll(async () => {
  if (env.TEST_MIGRATIONS) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  }
  HASH = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetStorage();
  resetMetrics();
});

describe("kith M7 GC and metrics", () => {
  it("M7-GC-01: insert traces over cap or old created_at, GC deletes traces, next send seq is MAX+1 not COUNT+1", async () => {
    const s = await seed();
    const old = "2020-01-01T00:00:00.000Z";
    const recent = "2026-09-20T00:00:00.000Z";
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 0, kind: "message", createdAt: recent, client: "m7gc01c0" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 1, kind: "trace", createdAt: old, client: "m7gc01c1" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 2, kind: "trace", createdAt: old, client: "m7gc01c2" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 3, kind: "trace", createdAt: recent, client: "m7gc01c3" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 4, kind: "message", createdAt: recent, client: "m7gc01c4" });

    const gc = await gcTraces(env.DB, { maxAgeMs: 30 * 24 * 3600 * 1000, maxRows: 3 });
    expect(gc.deleted).toBeGreaterThan(0);
    expect(gc.rooms).toBe(1);

    const left = await rowsByKind(s.roomId);
    expect(left.some((r) => r.kind === "message" && r.seq === 0)).toBe(true);
    expect(left.some((r) => r.kind === "message" && r.seq === 4)).toBe(true);
    expect(left.some((r) => r.seq === 1)).toBe(false);
    expect(left.some((r) => r.seq === 2)).toBe(false);

    const count = await countRows(s.roomId);
    const max = await maxSeq(s.roomId);
    expect(count).not.toBe(max);
    expect(max).toBe(4);

    const op = await login(s.operatorHandle);
    const next = await restSend(s.roomId, op.cookie, op.csrf, "after-gc", "01M7GC01AFTERGC01");
    expect(next.status).toBe(200);
    const nextRow = (await next.json()) as { seq: number };
    expect(nextRow.seq).toBe(max + 1);
    expect(nextRow.seq).not.toBe(count + 1);
    expect(nextRow.seq).toBe(5);
  });

  it("M7-GC-02: GC never deletes kind=message", async () => {
    const s = await seed();
    const old = "2019-06-01T00:00:00.000Z";
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 0, kind: "message", createdAt: old, client: "m7gc02c0" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 1, kind: "message", createdAt: old, client: "m7gc02c1" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 2, kind: "trace", createdAt: old, client: "m7gc02c2" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 3, kind: "trace", createdAt: old, client: "m7gc02c3" });
    await insertRow({ roomId: s.roomId, senderId: s.operatorId, seq: 4, kind: "message", createdAt: old, client: "m7gc02c4" });

    const gc = await gcTraces(env.DB, { maxAgeMs: 0, maxRows: 0 });
    expect(gc.deleted).toBe(2);

    const left = await rowsByKind(s.roomId);
    expect(left.map((r) => r.kind)).toEqual(["message", "message", "message"]);
    expect(left.map((r) => r.seq)).toEqual([0, 1, 4]);
    expect(left.every((r) => r.kind === "message")).toBe(true);
    expect(await countRows(s.roomId)).toBe(3);
  });

  it("M7-MET-01: persist increments messages_total; generation_dropped increments; GET /api/metrics operator 200, non-operator 403", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);

    const persist = await restSend(s.roomId, op.cookie, op.csrf, "hello", "01M7MET01PERSIST01");
    expect(persist.status).toBe(200);
    const persistRow = (await persist.json()) as { kind: string; seq: number };
    expect(persistRow.kind).toBe("message");

    const dropped = await restSend(s.roomId, op.cookie, op.csrf, "late", "01M7MET01DROPPED01", {
      generation_id: crypto.randomUUID(),
    });
    expect(dropped.status).toBe(409);
    const droppedBody = (await dropped.json()) as { error: { code: string } };
    expect(droppedBody.error.code).toBe("generation_dropped");

    const local = snapshot();
    expect(local.messages_total.message).toBeGreaterThanOrEqual(1);
    expect(local.generation_dropped_total).toBeGreaterThanOrEqual(1);

    const metricsRes = await api("GET", "/api/metrics", op.cookie, op.csrf);
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as MetricsSnapshot;
    expect(metrics.messages_total.message).toBeGreaterThanOrEqual(1);
    expect(metrics.generation_dropped_total).toBeGreaterThanOrEqual(1);
    expect(metrics.messages_total.trace).toBeGreaterThanOrEqual(0);
    expect(metrics.ambient_budget_exhausted).toBeGreaterThanOrEqual(0);

    const guest = await login(s.guestHandle);
    const guestRes = await api("GET", "/api/metrics", guest.cookie, guest.csrf);
    expect(guestRes.status).toBe(403);

    const token = issueBotToken();
    const tokenHash = await hashBotToken(token);
    await env.DB.prepare(
      `INSERT INTO bot_tokens (id, member_id, token_hash, room_scope_json, created_at, expires_at, revoked_at, last_used_at)
       VALUES (?, ?, ?, '[]', ?, NULL, NULL, NULL)`,
    )
      .bind(crypto.randomUUID(), s.agentId, tokenHash, "2026-09-20T00:00:00Z")
      .run();
    const bearerRes = await SELF.fetch("https://kith.test/api/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bearerRes.status).toBe(403);
  });
});
