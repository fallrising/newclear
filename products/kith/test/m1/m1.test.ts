import { SELF, applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import { Room } from "../../worker/room.ts";

const PASSWORD = "test-pass-m1";
let HASH = "";

type Seed = {
  operatorId: string;
  guestId: string;
  roomId: string;
  operatorHandle: string;
  guestHandle: string;
};

type RoomRpc = {
  clearNextSeq(): Promise<void>;
  injectD1TimeoutOnce(): Promise<void>;
  crashBeforePersistNextSeqOnce(): Promise<void>;
  tryBroadcastFirst(): Promise<{ rejected: true; message: string }>;
  getNextSeqCache(): Promise<number | null>;
};

function roomRpc(roomId: string): RoomRpc {
  return env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`)) as unknown as RoomRpc;
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

async function openWs(roomId: string, cookie: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://kith.test/api/rooms/${roomId}/ws`, {
    headers: { Upgrade: "websocket", Cookie: cookie },
  });
  const ws = res.webSocket;
  if (!ws) {
    throw new Error(`expected websocket, status=${res.status}`);
  }
  ws.accept();
  return ws;
}

function listen(ws: WebSocket): { messages: Record<string, unknown>[]; wait: (n: number, ms?: number) => Promise<void> } {
  const messages: Record<string, unknown>[] = [];
  ws.addEventListener("message", (event: MessageEvent) => {
    const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    messages.push(JSON.parse(raw) as Record<string, unknown>);
  });
  return {
    messages,
    wait(n: number, ms = 4000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          if (messages.length >= n) {
            resolve();
            return;
          }
          if (Date.now() - start > ms) {
            reject(new Error(`ws timeout have=${messages.length} want=${n} last=${JSON.stringify(messages.at(-1))}`));
            return;
          }
          setTimeout(tick, 15);
        };
        tick();
      });
    },
  };
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

async function seed(joinSecond = true): Promise<Seed> {
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
  ]);
  if (joinSecond) {
    await env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
    )
      .bind(roomId, guestId)
      .run();
  }
  const agents = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE kind = 'agent'`).first<{ n: number }>();
  expect(Number(agents?.n ?? 0)).toBe(0);
  return { operatorId, guestId, roomId, operatorHandle, guestHandle };
}

async function messageCount(roomId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ?`)
    .bind(roomId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function restSend(
  roomId: string,
  cookie: string,
  csrf: string,
  body: string,
  clientMessageId: string,
): Promise<Response> {
  return api("POST", `/api/rooms/${roomId}/messages`, cookie, csrf, {
    body,
    client_message_id: clientMessageId,
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
});

describe("kith M1 worker", () => {
  it("M1-US-01: two sessions WS send; both receive type=event with same id and seq and body; after DO restart GET messages still has the row", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const guest = await login(s.guestHandle);
    const wsA = await openWs(s.roomId, op.cookie);
    const wsB = await openWs(s.roomId, guest.cookie);
    const a = listen(wsA);
    const b = listen(wsB);
    wsA.send(
      JSON.stringify({
        v: 1,
        type: "send",
        client_message_id: "01JUS01CLIENTMSG",
        body: "hello from operator",
      }),
    );
    await a.wait(1);
    await b.wait(1);
    const evA = a.messages[0] as { type: string; event: { id: string; seq: number; body: string; kind: string; origin: string } };
    const evB = b.messages[0] as { type: string; event: { id: string; seq: number; body: string; kind: string; origin: string } };
    expect(evA.type).toBe("event");
    expect(evB.type).toBe("event");
    expect(evA.event.id).toBe(evB.event.id);
    expect(evA.event.seq).toBe(evB.event.seq);
    expect(evA.event.body).toBe("hello from operator");
    expect(evB.event.body).toBe("hello from operator");
    expect(evA.event.kind).toBe("message");
    expect(evA.event.origin).toBe("local");

    await roomRpc(s.roomId).clearNextSeq();
    const id = env.ROOM.idFromName(`room:${s.roomId}`);
    const stub = env.ROOM.get(id);
    await runInDurableObject(stub, async (instance: Room, state) => {
      expect(instance).toBeInstanceOf(Room);
      await state.storage.delete("next_seq");
    });

    const hist = await api("GET", `/api/rooms/${s.roomId}/messages?after_seq=-1`, op.cookie, op.csrf);
    expect(hist.status).toBe(200);
    const histBody = (await hist.json()) as { messages: Array<{ id: string; seq: number; body: string }> };
    expect(histBody.messages.some((m) => m.id === evA.event.id && m.seq === evA.event.seq && m.body === evA.event.body)).toBe(
      true,
    );
  });

  it("M1-MEM-01: POST members adds existing human; 32nd ok; 33rd 409 room_full", async () => {
    const s = await seed(false);
    const op = await login(s.operatorHandle);
    const addGuest = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: s.guestId,
    });
    expect(addGuest.status).toBe(200);

    const now = "2026-09-20T00:00:00Z";
    const extraIds: string[] = [];
    const stmts = [];
    for (let i = 0; i < 31; i++) {
      const id = crypto.randomUUID();
      extraIds.push(id);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
           VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 0, ?)`,
        ).bind(id, `h${i}_${id.replaceAll("-", "").slice(0, 8)}`, `Human ${i}`, HASH, now),
      );
    }
    await env.DB.batch(stmts);
    for (let i = 0; i < 29; i++) {
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
      )
        .bind(s.roomId, extraIds[i]!)
        .run();
    }
    const count31 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?`)
      .bind(s.roomId)
      .first<{ n: number }>();
    expect(Number(count31?.n)).toBe(31);

    const add32 = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: extraIds[29]!,
    });
    expect(add32.status).toBe(200);
    const count32 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?`)
      .bind(s.roomId)
      .first<{ n: number }>();
    expect(Number(count32?.n)).toBe(32);

    const add33 = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: extraIds[30]!,
    });
    expect(add33.status).toBe(409);
    const err = (await add33.json()) as { error: { code: string } };
    expect(err.error.code).toBe("room_full");
  });

  it("M1-MEM-02: POST members accepts a human handle and rejects ambiguous or non-human handles", async () => {
    const s = await seed(false);
    const op = await login(s.operatorHandle);
    const added = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      handle: s.guestHandle.toUpperCase(),
    });
    expect(added.status).toBe(200);
    const addedBody = (await added.json()) as { ok: boolean; member_id: string; role: string };
    expect(addedBody).toEqual({ ok: true, member_id: s.guestId, role: "member" });

    const guest = await login(s.guestHandle);
    const rooms = await api("GET", "/api/rooms", guest.cookie, guest.csrf);
    expect(rooms.status).toBe(200);
    const roomBody = (await rooms.json()) as { rooms: Array<{ id: string }> };
    expect(roomBody.rooms.some((room) => room.id === s.roomId)).toBe(true);

    const again = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      handle: s.guestHandle,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("already_member");

    const both = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      member_id: s.guestId,
      handle: s.guestHandle,
    });
    expect(both.status).toBe(400);
    expect(((await both.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

    const neither = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {});
    expect(neither.status).toBe(400);
    expect(((await neither.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

    const missing = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      handle: "no_such_person",
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("not_found");

    const now = "2026-09-20T00:00:00Z";
    const agentId = crypto.randomUUID();
    const agentHandle = `ag_${agentId.replaceAll("-", "").slice(0, 8)}`;
    const disabledId = crypto.randomUUID();
    const disabledHandle = `off_${disabledId.replaceAll("-", "").slice(0, 8)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
         VALUES (?, 'agent', ?, 'Agent', NULL, '[]', 'api_key', 0, ?)`,
      ).bind(agentId, agentHandle, now),
      env.DB.prepare(
        `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at, disabled_at)
         VALUES (?, 'human', ?, 'Off', ?, '[]', 'api_key', 0, ?, ?)`,
      ).bind(disabledId, disabledHandle, HASH, now, now),
    ]);
    const agentAdd = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      handle: agentHandle.toUpperCase(),
    });
    expect(agentAdd.status).toBe(200);
    expect(((await agentAdd.json()) as { member_id: string }).member_id).toBe(agentId);
    const memberList = await api("GET", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf);
    expect(memberList.status).toBe(200);
    const listed = (await memberList.json()) as {
      members: Array<{ id: string; reply_limit: { code: string; fixed_text?: string } | null }>;
    };
    expect(listed.members.find((member) => member.id === agentId)?.reply_limit).toEqual({
      code: "fixed",
      fixed_text: "hello from grok",
    });
    expect(listed.members.find((member) => member.id === s.operatorId)?.reply_limit).toBeNull();
    const disabledAdd = await api("POST", `/api/rooms/${s.roomId}/members`, op.cookie, op.csrf, {
      handle: disabledHandle,
    });
    expect(disabledAdd.status).toBe(404);
    expect(((await disabledAdd.json()) as { error: { code: string } }).error.code).toBe("not_found");

    const guestAdd = await api("POST", `/api/rooms/${s.roomId}/members`, guest.cookie, guest.csrf, {
      handle: disabledHandle,
    });
    expect(guestAdd.status).toBe(403);
    expect(((await guestAdd.json()) as { error: { message: string } }).error.message).toBe("operator required");
  });

  it("POST /api/rooms with an empty-slug stand-in makes the operator the owner", async () => {
    const s = await seed(false);
    const op = await login(s.operatorHandle);
    const created = await api("POST", "/api/rooms", op.cookie, op.csrf, { name: "Design", slug: "design" });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { id: string; name: string; slug: string };
    expect(createdBody).toMatchObject({ name: "Design", slug: "design" });
    const membership = await env.DB.prepare(`SELECT member_id, role FROM room_members WHERE room_id = ?`)
      .bind(createdBody.id)
      .all<{ member_id: string; role: string }>();
    expect(membership.results).toEqual([{ member_id: s.operatorId, role: "owner" }]);
    const listed = await api("GET", "/api/rooms", op.cookie, op.csrf);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { rooms: Array<{ id: string; name: string }> };
    expect(listedBody.rooms.some((room) => room.id === createdBody.id && room.name === "Design")).toBe(true);
    const guest = await login(s.guestHandle);
    const guestRooms = await api("GET", "/api/rooms", guest.cookie, guest.csrf);
    const guestBody = (await guestRooms.json()) as { rooms: Array<{ id: string }> };
    expect(guestBody.rooms.some((room) => room.id === createdBody.id)).toBe(false);
  });

  it("ST-D1-01: simulate crash after D1 INSERT before persist next_seq; next send seq is MAX+1 not reuse", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const first = await restSend(s.roomId, op.cookie, op.csrf, "one", "01STD101CLIENT01");
    expect(first.status).toBe(200);
    const firstRow = (await first.json()) as { seq: number };
    expect(firstRow.seq).toBe(0);

    await roomRpc(s.roomId).crashBeforePersistNextSeqOnce();
    const crashed = await restSend(s.roomId, op.cookie, op.csrf, "two", "01STD101CLIENT02");
    expect(crashed.status).toBe(503);
    const inserted = await env.DB.prepare(`SELECT seq FROM messages WHERE room_id = ? ORDER BY seq`).bind(s.roomId).all<{
      seq: number;
    }>();
    expect((inserted.results ?? []).map((r) => r.seq)).toEqual([0, 1]);
    await runInDurableObject(env.ROOM.get(env.ROOM.idFromName(`room:${s.roomId}`)), async (_instance: Room, state) => {
      await state.storage.delete("next_seq");
    });
    expect(await roomRpc(s.roomId).getNextSeqCache()).toBeNull();

    const third = await restSend(s.roomId, op.cookie, op.csrf, "three", "01STD101CLIENT03");
    expect(third.status).toBe(200);
    const thirdRow = (await third.json()) as { seq: number };
    expect(thirdRow.seq).toBe(2);
    expect(thirdRow.seq).not.toBe(0);
    expect(thirdRow.seq).not.toBe(1);
  });

  it("ST-D1-02: injectable D1 timeout unknown: first send does not broadcast; retry same client_message_id returns original seq", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const guest = await login(s.guestHandle);
    const wsA = await openWs(s.roomId, op.cookie);
    const wsB = await openWs(s.roomId, guest.cookie);
    const a = listen(wsA);
    const b = listen(wsB);

    await roomRpc(s.roomId).injectD1TimeoutOnce();
    const first = await restSend(s.roomId, op.cookie, op.csrf, "timeout body", "01STD102CLIENTMSG");
    expect(first.status).toBe(503);
    await new Promise((r) => setTimeout(r, 80));
    expect(a.messages.filter((m) => m.type === "event")).toHaveLength(0);
    expect(b.messages.filter((m) => m.type === "event")).toHaveLength(0);
    expect(await messageCount(s.roomId)).toBe(1);

    const retry = await restSend(s.roomId, op.cookie, op.csrf, "timeout body", "01STD102CLIENTMSG");
    expect(retry.status).toBe(200);
    const row = (await retry.json()) as { seq: number; client_message_id: string };
    expect(row.seq).toBe(0);
    expect(row.client_message_id).toBe("01STD102CLIENTMSG");
    expect(await messageCount(s.roomId)).toBe(1);
  });

  it("ST-D1-03: broadcast only after INSERT; a test hook that tries broadcast-first is rejected; no event", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const wsA = await openWs(s.roomId, op.cookie);
    const a = listen(wsA);
    const rejected = await roomRpc(s.roomId).tryBroadcastFirst();
    expect(rejected.rejected).toBe(true);
    expect(rejected.message).toMatch(/broadcast only after INSERT/);
    await new Promise((r) => setTimeout(r, 80));
    expect(a.messages).toHaveLength(0);
    expect(await messageCount(s.roomId)).toBe(0);
  });

  it("ST-D1-04: delete a trace row leaving COUNT!=MAX (e.g. seq 0,1,2,3 delete 1 and 2); next send seq=4 not COUNT+1", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    for (let i = 0; i < 4; i++) {
      const res = await restSend(s.roomId, op.cookie, op.csrf, `m${i}`, `01STD104CLIENT0${i}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { seq: number }).seq).toBe(i);
    }
    await env.DB.prepare(`UPDATE messages SET kind = 'trace' WHERE room_id = ? AND seq IN (1, 2)`)
      .bind(s.roomId)
      .run();
    await env.DB.prepare(`DELETE FROM messages WHERE room_id = ? AND seq IN (1, 2)`).bind(s.roomId).run();
    const count = await messageCount(s.roomId);
    const maxRow = await env.DB.prepare(`SELECT MAX(seq) AS m FROM messages WHERE room_id = ?`)
      .bind(s.roomId)
      .first<{ m: number }>();
    expect(count).toBe(2);
    expect(Number(maxRow?.m)).toBe(3);
    expect(count).not.toBe(Number(maxRow?.m));

    const next = await restSend(s.roomId, op.cookie, op.csrf, "after-gc", "01STD104CLIENT99");
    expect(next.status).toBe(200);
    const nextRow = (await next.json()) as { seq: number };
    expect(nextRow.seq).toBe(4);
    expect(nextRow.seq).not.toBe(count + 1);
  });

  it("M1-GAP-01: client misses seq 1 of 0,1,2; GET after_seq=0 returns seq 1 and 2; no reuse", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    for (let i = 0; i < 3; i++) {
      const res = await restSend(s.roomId, op.cookie, op.csrf, `gap-${i}`, `01MGAP01CLIENT0${i}`);
      expect(((await res.json()) as { seq: number }).seq).toBe(i);
    }
    const hist = await api("GET", `/api/rooms/${s.roomId}/messages?after_seq=0`, op.cookie, op.csrf);
    expect(hist.status).toBe(200);
    const body = (await hist.json()) as { messages: Array<{ seq: number }> };
    expect(body.messages.map((m) => m.seq)).toEqual([1, 2]);
    const next = await restSend(s.roomId, op.cookie, op.csrf, "gap-next", "01MGAP01CLIENT99");
    expect(((await next.json()) as { seq: number }).seq).toBe(3);
  });

  it("M1-IDEM-01: same client_message_id twice → same seq", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const first = await restSend(s.roomId, op.cookie, op.csrf, "idem", "01MIDEM01CLIENT1");
    const second = await restSend(s.roomId, op.cookie, op.csrf, "idem", "01MIDEM01CLIENT1");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { id: string; seq: number };
    const b = (await second.json()) as { id: string; seq: number };
    expect(b.seq).toBe(a.seq);
    expect(b.id).toBe(a.id);
    expect(await messageCount(s.roomId)).toBe(1);
  });

  it("M1-CAP-01: body 8193 bytes → 400 payload_too_large, D1 count unchanged", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const before = await messageCount(s.roomId);
    const res = await restSend(s.roomId, op.cookie, op.csrf, "x".repeat(8193), "01MCAP01CLIENTXX");
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string } };
    expect(err.error.code).toBe("payload_too_large");
    expect(await messageCount(s.roomId)).toBe(before);
  });

  it("ST-STATUS-01: WS type=status typing; D1 COUNT unchanged; other WS client receives type=status without seq", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const guest = await login(s.guestHandle);
    const wsA = await openWs(s.roomId, op.cookie);
    const wsB = await openWs(s.roomId, guest.cookie);
    const b = listen(wsB);
    const before = await messageCount(s.roomId);
    wsA.send(JSON.stringify({ v: 1, type: "status", body: "typing" }));
    await b.wait(1);
    const msg = b.messages[0] as { type: string; body: string; member_id: string; seq?: number };
    expect(msg.type).toBe("status");
    expect(msg.body).toBe("typing");
    expect(msg.member_id).toBe(s.operatorId);
    expect("seq" in msg).toBe(false);
    expect(await messageCount(s.roomId)).toBe(before);
  });

  it("POST /mcp without a bearer token is 401 while ff_mcp is on", async () => {
    const s = await seed();
    const op = await login(s.operatorHandle);
    const mcp = await api("POST", "/mcp", op.cookie, op.csrf, {});
    expect(mcp.status).toBe(401);
    expect(((await mcp.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("GET /mcp/events without a bearer token is 401 while ff_mcp is on", async () => {
    const s = await seed();
    const res = await SELF.fetch(`https://kith.test/mcp/events?room_id=${s.roomId}&after_seq=0`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });
});
