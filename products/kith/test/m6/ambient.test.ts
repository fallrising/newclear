import { applyD1Migrations, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import type { PendingAmbient } from "../../src/notify.ts";
import {
  INTERNAL_HEADER,
  INTERNAL_ORIGIN,
  MEMBER_HEADER,
  ROOM_HEADER,
  type Env,
} from "../../worker/env.ts";
import type { InboxNotifyPayload } from "../../worker/inbox.ts";
import type { BeginInput, BeginResult } from "../../worker/hosted/generation.ts";
import type { AmbientLock } from "../../worker/room.ts";

const PASSWORD = "test-pass-m6-ambient";
let HASH = "";

type Seed = {
  operatorId: string;
  roomId: string;
  agentId: string;
  agentBId: string;
  agentHandle: string;
};

type InboxRpc = {
  notify(payload: InboxNotifyPayload): Promise<{ accepted: boolean }>;
  lastRejectCode(): Promise<string | null>;
  lastNotifyElapsedMs(): Promise<number | null>;
  lastHeuristicRan(): Promise<boolean>;
  lastAlarmDelayMs(): Promise<number | null>;
  pendingAmbient(): Promise<PendingAmbient | null>;
  alarmAt(): Promise<number | null>;
  runScheduled(): Promise<void>;
};

type HostedRpc = {
  begin(input: BeginInput): Promise<BeginResult>;
  runScheduled(): Promise<void>;
};

type RoomRpc = {
  ambientLock(): Promise<AmbientLock | null>;
};

function inboxStub(roomId: string, memberId: string) {
  return env.INBOX.get(env.INBOX.idFromName(`${roomId}:${memberId}`));
}

function inboxRpc(roomId: string, memberId: string): InboxRpc {
  return inboxStub(roomId, memberId) as unknown as InboxRpc;
}

function hostedStub(generationId: string) {
  return env.HOSTED.get(env.HOSTED.idFromName(generationId));
}

function hostedRpc(generationId: string): HostedRpc {
  return hostedStub(generationId) as unknown as HostedRpc;
}

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

async function seed(options: { debounceMs?: number } = {}): Promise<Seed> {
  const operatorId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const agentBId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const operatorHandle = `op_${operatorId.replaceAll("-", "").slice(0, 10)}`;
  const agentHandle = "grok";
  const debounceMs = options.debounceMs ?? 2_000;
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
    ).bind(agentBId, "codex", "Codex", now),
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
      `INSERT INTO room_members (room_id, member_id, role, attention_mode, debounce_ms) VALUES (?, ?, 'member', 'ambient', ?)`,
    ).bind(roomId, agentId, debounceMs),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'mention')`,
    ).bind(roomId, agentBId),
  ]);
  return { operatorId, roomId, agentId, agentBId, agentHandle };
}

function humanNotify(
  s: Seed,
  over: Partial<InboxNotifyPayload> & { body?: string; created_at?: string } = {},
): InboxNotifyPayload {
  return {
    seq: over.seq ?? 1,
    kind: "message",
    room_id: s.roomId,
    id: over.id ?? crypto.randomUUID(),
    body: over.body ?? "are you there?",
    sender_id: over.sender_id ?? s.operatorId,
    origin: "local",
    member_id: s.agentId,
    mentions: over.mentions ?? [],
    sender_kind: over.sender_kind ?? "human",
    thread_id: null,
    created_at: over.created_at ?? new Date(Date.now() - 60_000).toISOString(),
  };
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

async function generationCount(roomId: string, agentId?: string): Promise<number> {
  if (agentId) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM generations WHERE room_id = ? AND agent_id = ?`)
      .bind(roomId, agentId)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM generations WHERE room_id = ?`)
    .bind(roomId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function agentMessageCount(roomId: string, agentId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND sender_id = ? AND kind = 'message'`,
  )
    .bind(roomId, agentId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function waitGeneration(roomId: string, agentId: string): Promise<{ id: string; state: string }> {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const row = await env.DB.prepare(
      `SELECT id, state FROM generations WHERE room_id = ? AND agent_id = ? ORDER BY created_at ASC`,
    )
      .bind(roomId, agentId)
      .first<{ id: string; state: string }>();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("generation row not created");
}

async function runInboxAlarm(roomId: string, memberId: string): Promise<void> {
  const ran = await runDurableObjectAlarm(inboxStub(roomId, memberId));
  if (!ran) await inboxRpc(roomId, memberId).runScheduled();
}

async function runHostedAlarm(generationId: string): Promise<void> {
  const ran = await runDurableObjectAlarm(hostedStub(generationId));
  if (!ran) await hostedRpc(generationId).runScheduled();
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

describe("kith M6 Inbox ambient alarm", () => {
  it("M6-US-06: ambient human question dispatches one agent message; self-send and agent-to-agent non-@ drop", async () => {
    const s = await seed({ debounceMs: 0 });
    const inbox = inboxRpc(s.roomId, s.agentId);
    const sent = await roomSend(s.roomId, s.operatorId, "are you there?", "01M6US06HUMANQ01");
    expect(sent.status).toBe(200);
    expect(await inbox.lastHeuristicRan()).toBe(false);

    await runInboxAlarm(s.roomId, s.agentId);
    const gen = await waitGeneration(s.roomId, s.agentId);
    if ((await agentMessageCount(s.roomId, s.agentId)) === 0) {
      await runHostedAlarm(gen.id);
    }
    expect(await agentMessageCount(s.roomId, s.agentId)).toBe(1);
    const reply = await env.DB.prepare(
      `SELECT body, generation_id FROM messages WHERE room_id = ? AND sender_id = ? AND kind = 'message'`,
    )
      .bind(s.roomId, s.agentId)
      .first<{ body: string; generation_id: string }>();
    expect(reply?.body).toBe("hello from grok");
    expect(reply?.generation_id).toBe(gen.id);
    expect(await roomRpc(s.roomId).ambientLock()).toBeNull();

    const gensBefore = await generationCount(s.roomId, s.agentId);
    const selfDrop = await inbox.notify(
      humanNotify(s, {
        seq: 90,
        sender_id: s.agentId,
        sender_kind: "agent",
        body: "are you there? from me",
        mentions: [s.agentId],
      }),
    );
    expect(selfDrop.accepted).toBe(true);
    expect(await inbox.lastRejectCode()).toBe("self");

    const peerDrop = await inbox.notify(
      humanNotify(s, {
        seq: 91,
        sender_id: s.agentBId,
        sender_kind: "agent",
        body: "are you there? peer",
        mentions: [],
      }),
    );
    expect(peerDrop.accepted).toBe(true);
    expect(await inbox.lastRejectCode()).toBe("agent_non_mention");
    expect(await generationCount(s.roomId, s.agentId)).toBe(gensBefore);
    expect(await agentMessageCount(s.roomId, s.agentId)).toBe(1);
  });

  it("ATT-03: Inbox.notify ambient elapsed <20ms and heuristic is not run", async () => {
    const s = await seed();
    const inbox = inboxRpc(s.roomId, s.agentId);
    const accepted = await inbox.notify(humanNotify(s));
    expect(accepted.accepted).toBe(true);
    const elapsed = await inbox.lastNotifyElapsedMs();
    expect(elapsed).toBeTypeOf("number");
    expect(elapsed!).toBeLessThan(20);
    expect(await inbox.lastHeuristicRan()).toBe(false);
    expect(await inbox.pendingAmbient()).not.toBeNull();
    expect(await generationCount(s.roomId, s.agentId)).toBe(0);
  });

  it("ATT-04: debounce elapsed → alarm delay 0 / next tick; heuristic still false until alarm", async () => {
    const s = await seed({ debounceMs: 2_000 });
    const inbox = inboxRpc(s.roomId, s.agentId);
    const before = Date.now();
    await inbox.notify(humanNotify(s, { created_at: new Date(before - 10_000).toISOString() }));
    expect(await inbox.lastAlarmDelayMs()).toBe(0);
    expect(await inbox.lastHeuristicRan()).toBe(false);
    const alarmAt = await inbox.alarmAt();
    expect(alarmAt).toBeTypeOf("number");
    expect(alarmAt!).toBeGreaterThanOrEqual(before - 50);
    expect(alarmAt!).toBeLessThan(before + 1_000);
    expect(await inbox.pendingAmbient()).not.toBeNull();
    expect(await generationCount(s.roomId, s.agentId)).toBe(0);
  });

  it("ATT-10: same agent two rooms two Inbox DOs set different alarm deadlines without clobbering pending", async () => {
    const operatorId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const roomA = crypto.randomUUID();
    const roomB = crypto.randomUUID();
    const now = "2026-09-20T00:00:00Z";
    const opHandle = `op_${operatorId.replaceAll("-", "").slice(0, 10)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
         VALUES (?, 'human', ?, ?, ?, '[]', 'api_key', 1, ?)`,
      ).bind(operatorId, opHandle, "Operator", HASH, now),
      env.DB.prepare(
        `INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
         VALUES (?, 'agent', 'grok', 'Grok', NULL, '[]', 'api_key', 0, ?)`,
      ).bind(agentId, now),
      env.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'A', ?, ?)`).bind(
        roomA,
        `a_${roomA.replaceAll("-", "").slice(0, 10)}`,
        operatorId,
        now,
      ),
      env.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'B', ?, ?)`).bind(
        roomB,
        `b_${roomB.replaceAll("-", "").slice(0, 10)}`,
        operatorId,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'mention')`,
      ).bind(roomA, operatorId),
      env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'mention')`,
      ).bind(roomB, operatorId),
      env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode, debounce_ms) VALUES (?, ?, 'member', 'ambient', 3000)`,
      ).bind(roomA, agentId),
      env.DB.prepare(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode, debounce_ms) VALUES (?, ?, 'member', 'ambient', 8000)`,
      ).bind(roomB, agentId),
    ]);

    const inboxA = inboxRpc(roomA, agentId);
    const inboxB = inboxRpc(roomB, agentId);
    const seedA: Seed = {
      operatorId,
      roomId: roomA,
      agentId,
      agentBId: agentId,
      agentHandle: "grok",
    };
    const seedB: Seed = { ...seedA, roomId: roomB };
    const createdAt = new Date().toISOString();
    await inboxA.notify(humanNotify(seedA, { created_at: createdAt }));
    await inboxB.notify(humanNotify(seedB, { created_at: createdAt }));

    const pendingA = await inboxA.pendingAmbient();
    const pendingB = await inboxB.pendingAmbient();
    expect(pendingA?.envelope.room_id).toBe(roomA);
    expect(pendingB?.envelope.room_id).toBe(roomB);
    expect(pendingA?.envelope.event.body).toBe("are you there?");
    expect(pendingB?.envelope.event.body).toBe("are you there?");
    const delayA = await inboxA.lastAlarmDelayMs();
    const delayB = await inboxB.lastAlarmDelayMs();
    expect(delayA).toBeGreaterThan(1_000);
    expect(delayA).toBeLessThanOrEqual(3_000);
    expect(delayB).toBeGreaterThan(delayA!);
    expect(delayB).toBeLessThanOrEqual(8_000);
    const alarmA = await inboxA.alarmAt();
    const alarmB = await inboxB.alarmAt();
    expect(alarmA).toBeTypeOf("number");
    expect(alarmB).toBeTypeOf("number");
    expect(alarmB!).toBeGreaterThan(alarmA! + 1_000);
    expect(await inboxA.lastHeuristicRan()).toBe(false);
    expect(await inboxB.lastHeuristicRan()).toBe(false);
  });

  it("ATT-H4: 10 prior agent messages then human question → alarm does not dispatch", async () => {
    const s = await seed({ debounceMs: 0 });
    for (let i = 1; i <= 10; i++) {
      await insertMessage(s.roomId, s.agentId, i, `agent prior ${i}`);
    }
    const inbox = inboxRpc(s.roomId, s.agentId);
    await inbox.notify(humanNotify(s, { seq: 11, body: "are you there?" }));
    expect(await inbox.lastHeuristicRan()).toBe(false);
    expect(await inbox.pendingAmbient()).not.toBeNull();

    await runInboxAlarm(s.roomId, s.agentId);
    expect(await inbox.lastHeuristicRan()).toBe(true);
    expect(await inbox.pendingAmbient()).toBeNull();
    expect(await generationCount(s.roomId, s.agentId)).toBe(0);
    expect(await agentMessageCount(s.roomId, s.agentId)).toBe(10);
    expect(await roomRpc(s.roomId).ambientLock()).toBeNull();
  });
});
