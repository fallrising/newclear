import { SELF, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FANOUT_CHUNK } from "../../src/caps.ts";
import { hashPassword } from "../../src/password.ts";
import type { Env } from "../../worker/env.ts";
import type { InboxNotifyPayload } from "../../worker/inbox.ts";

const PASSWORD = "test-pass-m3";
let HASH = "";

type Seed = {
  operatorId: string;
  roomId: string;
  operatorHandle: string;
};

type RoomRpc = {
  lastFanoutBatches(): Promise<number[]>;
  agentIds(): Promise<string[]>;
};

type InboxRpc = {
  notifyCount(): Promise<number>;
  liveAfter(cursorSeq: number): Promise<InboxNotifyPayload[]>;
  notify(payload: InboxNotifyPayload): Promise<{ accepted: boolean }>;
};

function roomRpc(roomId: string): RoomRpc {
  return env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`)) as unknown as RoomRpc;
}

function inboxRpc(roomId: string, memberId: string): InboxRpc {
  const ns = (env as Env).INBOX;
  return ns.get(ns.idFromName(`${roomId}:${memberId}`)) as unknown as InboxRpc;
}

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

async function seedOperatorRoom(): Promise<Seed> {
  const operatorId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const operatorHandle = `op_${operatorId.replaceAll("-", "").slice(0, 10)}`;
  const now = "2026-09-20T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 1, ?)`,
    ).bind(operatorId, operatorHandle, "Operator", HASH, now),
    env.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'Lobby', ?, ?)`).bind(
      roomId,
      `slug_${roomId.replaceAll("-", "").slice(0, 10)}`,
      operatorId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'mention')`,
    ).bind(roomId, operatorId),
  ]);
  return { operatorId, roomId, operatorHandle };
}

async function insertAgents(roomId: string, n: number): Promise<string[]> {
  const now = "2026-09-20T00:00:00Z";
  const ids: string[] = [];
  const memberStmts = [];
  const roomStmts = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    const handle = `ag${String(i).padStart(2, "0")}_${id.replaceAll("-", "").slice(0, 8)}`;
    memberStmts.push(
      env.DB.prepare(
        `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
         VALUES (?, 'agent', ?, ?, NULL, '[]', 'api_key', 0, ?)`,
      ).bind(id, handle, `Agent ${i}`, now),
    );
    roomStmts.push(
      env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
      ).bind(roomId, id),
    );
  }
  await env.DB.batch(memberStmts);
  await env.DB.batch(roomStmts);
  return ids;
}

async function sumNotifyCounts(roomId: string, ids: string[]): Promise<number> {
  const counts = await Promise.all(ids.map((id) => inboxRpc(roomId, id).notifyCount()));
  return counts.reduce((a, b) => a + b, 0);
}

async function waitNotifySum(roomId: string, ids: string[], want: number): Promise<number> {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < 8000) {
    last = await sumNotifyCounts(roomId, ids);
    if (last === want) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  return last;
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

describe("kith M3 fanout", () => {
  it("FAN-01: 32 agents + one human message → total Inbox.notify count 32 and every batch size <= 6", async () => {
    const s = await seedOperatorRoom();
    const agentIds = await insertAgents(s.roomId, 32);
    expect(agentIds).toHaveLength(32);

    const op = await login(s.operatorHandle);
    const res = await api("POST", `/api/rooms/${s.roomId}/messages`, op.cookie, op.csrf, {
      body: "hello agents",
      client_message_id: "01FAN01CLIENTMSG",
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as { seq: number; kind: string; id: string };
    expect(row.kind).toBe("message");

    const batches = await roomRpc(s.roomId).lastFanoutBatches();
    expect(batches.every((n) => n <= FANOUT_CHUNK)).toBe(true);
    expect(Math.max(0, ...batches)).toBeLessThanOrEqual(6);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(32);
    expect(batches).toEqual([6, 6, 6, 6, 6, 2]);

    const listed = await roomRpc(s.roomId).agentIds();
    expect(listed).toHaveLength(32);

    const total = await waitNotifySum(s.roomId, agentIds, 32);
    expect(total).toBe(32);

    const live = await inboxRpc(s.roomId, agentIds[0]!).liveAfter(-1);
    expect(live.some((item) => item.id === row.id && item.seq === row.seq)).toBe(true);
  }, 30_000);

  it("Inbox.notify drops status, accepts message|trace, liveAfter filters by seq", async () => {
    const roomId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const stub = inboxRpc(roomId, memberId);
    const dropped = await stub.notify({
      seq: 1,
      kind: "status",
      room_id: roomId,
      id: "st1",
      body: "typing",
      sender_id: "h1",
      origin: "local",
    });
    expect(dropped.accepted).toBe(false);
    expect(await stub.notifyCount()).toBe(0);

    await stub.notify({
      seq: 0,
      kind: "message",
      room_id: roomId,
      id: "m0",
      body: "one",
      sender_id: "h1",
      origin: "local",
    });
    await stub.notify({
      seq: 1,
      kind: "trace",
      room_id: roomId,
      id: "t1",
      body: "trace",
      sender_id: "h1",
      origin: "local",
    });
    expect(await stub.notifyCount()).toBe(2);
    const after0 = await stub.liveAfter(0);
    expect(after0.map((item) => item.id)).toEqual(["t1"]);
    expect(after0[0]?.kind).toBe("trace");
  });
});
