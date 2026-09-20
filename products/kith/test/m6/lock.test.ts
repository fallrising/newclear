import { applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import {
  INTERNAL_HEADER,
  INTERNAL_ORIGIN,
  MEMBER_HEADER,
  ROOM_HEADER,
  type Env,
} from "../../worker/env.ts";
import {
  Room,
  type AcquireAmbientResult,
  type AmbientLock,
  type ConsumeWakeBudgetResult,
  type RoomActivity,
} from "../../worker/room.ts";

const PASSWORD = "test-pass-m6";
let HASH = "";

type Seed = {
  operatorId: string;
  roomId: string;
  operatorHandle: string;
  agentId: string;
  agentBId: string;
  agentHandle: string;
};

type RoomRpc = {
  activity(roomId: string): Promise<RoomActivity>;
  tryAcquireAmbient(roomId: string, agentId: string, generationId: string): Promise<AcquireAmbientResult>;
  consumeWakeBudget(): Promise<ConsumeWakeBudgetResult>;
  releaseAmbient(generationId: string): Promise<void>;
  ambientLock(): Promise<AmbientLock | null>;
  postStatus(
    roomId: string,
    memberId: string,
    state: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
};

function roomRpc(roomId: string): RoomRpc {
  return env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`)) as unknown as RoomRpc;
}

async function roomSend(
  roomId: string,
  memberId: string,
  body: string,
  clientMessageId: string,
): Promise<Response> {
  const stub = env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`));
  return stub.fetch(
    new Request(`${INTERNAL_ORIGIN}/rooms/${roomId}/send?room_id=${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_HEADER]: "1",
        [MEMBER_HEADER]: memberId,
        [ROOM_HEADER]: roomId,
      },
      body: JSON.stringify({
        body,
        client_message_id: clientMessageId,
        thread_id: null,
        generation_id: null,
      }),
    }),
  );
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
  const agentId = crypto.randomUUID();
  const agentBId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const operatorHandle = `op_${operatorId.replaceAll("-", "").slice(0, 10)}`;
  const agentHandle = "grok";
  const agentBHandle = "codex";
  const now = "2026-09-20T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 1, ?)`,
    ).bind(operatorId, operatorHandle, "Operator", HASH, now),
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'agent', ?, ?, NULL, '[]', 'api_key', 0, ?)`,
    ).bind(agentId, agentHandle, "Grok", now),
    env.DB.prepare(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
       VALUES (?, 'agent', ?, ?, NULL, '[]', 'api_key', 0, ?)`,
    ).bind(agentBId, agentBHandle, "Codex", now),
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
    ).bind(roomId, agentId),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
    ).bind(roomId, agentBId),
  ]);
  return { operatorId, roomId, operatorHandle, agentId, agentBId, agentHandle };
}

async function insertMessage(roomId: string, senderId: string, seq: number, body: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (
       id, room_id, seq, kind, thread_id, reply_to, sender_id, body,
       mentions_json, generation_id, client_message_id, origin, created_at
     ) VALUES (?, ?, ?, 'message', NULL, NULL, ?, ?, '[]', NULL, ?, 'local', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      roomId,
      seq,
      senderId,
      body,
      `cid_${seq}_${senderId.replaceAll("-", "").slice(0, 8)}`,
      "2026-09-20T00:00:00.000Z",
    )
    .run();
}

beforeAll(async () => {
  if ((env as Env).TEST_MIGRATIONS) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  }
  HASH = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetStorage();
});

describe("kith M6 Room ambient RPCs", () => {
  it("activity: last_human_at from human persistSend, humans_typing from status TTL, recent_10_has_agent from D1", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);

    const empty = await room.activity(s.roomId);
    expect(empty.last_human_at).toBeNull();
    expect(empty.humans_typing).toBe(false);
    expect(empty.recent_10_has_agent).toBe(false);

    const before = Date.now();
    const sent = await roomSend(s.roomId, s.operatorId, "hello room", "01M6HUMANMSG0001");
    expect(sent.status).toBe(200);
    const row = (await sent.json()) as { created_at: string };
    const afterHuman = await room.activity(s.roomId);
    expect(afterHuman.last_human_at).toBe(row.created_at);
    expect(Date.parse(afterHuman.last_human_at ?? "")).toBeGreaterThanOrEqual(before - 1000);
    expect(afterHuman.humans_typing).toBe(false);
    expect(afterHuman.recent_10_has_agent).toBe(false);
    expect(await room.ambientLock()).toBeNull();

    const typed = await room.postStatus(s.roomId, s.operatorId, "idle", "typing");
    expect(typed).toEqual({ ok: true });
    const typing = await room.activity(s.roomId);
    expect(typing.humans_typing).toBe(true);
    expect(typing.last_human_at).toBe(row.created_at);

    await insertMessage(s.roomId, s.agentId, 1, "agent already spoke");
    const withAgent = await room.activity(s.roomId);
    expect(withAgent.recent_10_has_agent).toBe(true);
  });

  it("mention persistSend does not call tryAcquireAmbient or take the ambient lock", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);
    const sent = await roomSend(s.roomId, s.operatorId, "@grok please look", "01M6MENTION00001");
    expect(sent.status).toBe(200);
    expect(await room.ambientLock()).toBeNull();
    const acquired = await room.tryAcquireAmbient(s.roomId, s.agentId, crypto.randomUUID());
    expect(acquired).toEqual({ ok: true });
  });

  it("tryAcquireAmbient holds until TTL; second acquire fails; expired lock can be taken", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);
    const generationId = crypto.randomUUID();
    expect(await room.tryAcquireAmbient(s.roomId, s.agentId, generationId)).toEqual({ ok: true });
    const lock = await room.ambientLock();
    expect(lock?.generation_id).toBe(generationId);
    expect(lock?.agent_id).toBe(s.agentId);
    expect(lock?.expires_at).toBeGreaterThan(Date.now());
    expect(lock?.expires_at).toBeLessThanOrEqual(Date.now() + 120_000 + 50);
    expect(await room.tryAcquireAmbient(s.roomId, s.agentBId, crypto.randomUUID())).toEqual({ ok: false });

    await runInDurableObject(env.ROOM.get(env.ROOM.idFromName(`room:${s.roomId}`)), async (_instance: Room, state) => {
      await state.storage.put("ambient_lock", {
        generation_id: generationId,
        agent_id: s.agentId,
        expires_at: Date.now() - 1,
      });
    });
    const nextGen = crypto.randomUUID();
    expect(await room.tryAcquireAmbient(s.roomId, s.agentBId, nextGen)).toEqual({ ok: true });
    expect((await room.ambientLock())?.generation_id).toBe(nextGen);
  });

  it("releaseAmbient clears only a matching generation_id and never wipes another lock", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);
    const generationId = crypto.randomUUID();
    expect(await room.tryAcquireAmbient(s.roomId, s.agentId, generationId)).toEqual({ ok: true });
    await room.releaseAmbient(crypto.randomUUID());
    expect((await room.ambientLock())?.generation_id).toBe(generationId);
    await room.releaseAmbient(generationId);
    expect(await room.ambientLock()).toBeNull();
  });

  it("ATT-08: 6 consumeWakeBudget ok, 7th fails wake_budget_exhausted; acquire then 7th fail then releaseAmbient leaves lock empty", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);
    const generationId = crypto.randomUUID();
    expect(await room.tryAcquireAmbient(s.roomId, s.agentId, generationId)).toEqual({ ok: true });
    expect(await room.ambientLock()).not.toBeNull();

    for (let i = 0; i < 6; i++) {
      expect(await room.consumeWakeBudget()).toEqual({ ok: true });
    }
    const seventh = await room.consumeWakeBudget();
    expect(seventh).toEqual({ ok: false, code: "wake_budget_exhausted" });
    expect(await room.consumeWakeBudget()).toEqual({ ok: false, code: "wake_budget_exhausted" });
    expect(await room.ambientLock()).not.toBeNull();

    await room.releaseAmbient(generationId);
    expect(await room.ambientLock()).toBeNull();
  });

  it("ATT-09: tryAcquireAmbient ok, consumeWakeBudget fail (pre-fill 6), releaseAmbient in finally leaves lock empty so another agent can acquire", async () => {
    const s = await seed();
    const room = roomRpc(s.roomId);
    for (let i = 0; i < 6; i++) {
      expect(await room.consumeWakeBudget()).toEqual({ ok: true });
    }

    const generationId = crypto.randomUUID();
    let acquired = false;
    let dispatched = false;
    try {
      const cas = await room.tryAcquireAmbient(s.roomId, s.agentId, generationId);
      expect(cas).toEqual({ ok: true });
      acquired = true;
      expect(await room.ambientLock()).not.toBeNull();
      const budget = await room.consumeWakeBudget();
      expect(budget).toEqual({ ok: false, code: "wake_budget_exhausted" });
    } finally {
      if (acquired && !dispatched) {
        await room.releaseAmbient(generationId);
      }
    }

    expect(await room.ambientLock()).toBeNull();
    const otherGen = crypto.randomUUID();
    expect(await room.tryAcquireAmbient(s.roomId, s.agentBId, otherGen)).toEqual({ ok: true });
    expect((await room.ambientLock())?.agent_id).toBe(s.agentBId);
    expect((await room.ambientLock())?.generation_id).toBe(otherGen);
  });
});
