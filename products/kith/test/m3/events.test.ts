import { SELF, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";
import type { Env } from "../../worker/env.ts";
import type { InboxNotifyPayload } from "../../worker/inbox.ts";

const PASSWORD = "test-pass-m3-ev";
let HASH = "";

type Seed = {
  operatorId: string;
  roomId: string;
  operatorHandle: string;
  agentId: string;
  agentHandle: string;
  token: string;
};

type SseParsed = {
  id?: string;
  event?: string;
  data?: Record<string, unknown>;
  comment?: string;
};

type InboxRpc = {
  notify(payload: InboxNotifyPayload): Promise<{ accepted: boolean }>;
  liveAfter(cursorSeq: number): Promise<InboxNotifyPayload[]>;
};

function inboxRpc(roomId: string, memberId: string): InboxRpc {
  const ns = (env as Env).INBOX;
  return ns.get(ns.idFromName(`${roomId}:${memberId}`)) as unknown as InboxRpc;
}

/** Fake CLI helper (not a product sidecar). Increments only on live self-mentions. */
function countExec(events: Array<{ replay?: boolean; body?: string }>, handle: string): number {
  const ascii = `@${handle}`;
  const fullwidth = `＠${handle}`;
  let n = 0;
  for (const ev of events) {
    if (ev.replay !== false) continue;
    const body = ev.body ?? "";
    if (body.includes(ascii) || body.includes(fullwidth)) n += 1;
  }
  return n;
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

async function seed(handle = "codex"): Promise<Seed> {
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
  const op = await login(operatorHandle);
  const agentRes = await api("POST", "/api/agents", op.cookie, op.csrf, {
    handle,
    display_name: "Codex",
  });
  expect(agentRes.status).toBe(200);
  const agent = (await agentRes.json()) as { id: string; handle: string };
  const tokenRes = await api("POST", `/api/agents/${agent.id}/tokens`, op.cookie, op.csrf, {});
  expect(tokenRes.status).toBe(200);
  const tokenBody = (await tokenRes.json()) as { token: string };
  const add = await api("POST", `/api/rooms/${roomId}/members`, op.cookie, op.csrf, { member_id: agent.id });
  expect(add.status).toBe(200);
  return {
    operatorId,
    roomId,
    operatorHandle,
    agentId: agent.id,
    agentHandle: agent.handle,
    token: tokenBody.token,
  };
}

async function insertPersisted(
  roomId: string,
  senderId: string,
  rows: Array<{ seq: number; kind: string; body: string }>,
): Promise<void> {
  const now = "2026-09-20T00:00:00Z";
  const stmts = rows.map((row) =>
    env.DB.prepare(
      `INSERT INTO messages (id, room_id, seq, kind, thread_id, reply_to, sender_id, body, mentions_json, generation_id, client_message_id, origin, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, '[]', NULL, ?, 'local', ?)`,
    ).bind(crypto.randomUUID(), roomId, row.seq, row.kind, senderId, row.body, `cid_${row.seq}_${crypto.randomUUID().slice(0, 8)}`, now),
  );
  await env.DB.batch(stmts);
}

function parseBlock(block: string): SseParsed {
  const ev: SseParsed = {};
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) {
      ev.comment = `${ev.comment ?? ""}${line.slice(1).trim()}`.trim();
    } else if (line.startsWith("id:")) {
      ev.id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      ev.event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const raw = line.slice(5).trim();
      try {
        ev.data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        ev.data = { raw };
      }
    }
  }
  return ev;
}

async function collectSse(
  res: Response,
  opts: {
    timeoutMs: number;
    stopWhen?: (events: SseParsed[]) => boolean;
  },
): Promise<{ events: SseParsed[]; gap: boolean; closed: boolean }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const events: SseParsed[] = [];
  let gap = false;
  let closed = false;
  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    return { events, gap, closed: true };
  }
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!ac.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        closed = true;
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim() === "") continue;
        const parsed = parseBlock(part);
        if (parsed.comment && parsed.comment.includes("gap")) gap = true;
        events.push(parsed);
      }
      if (gap || (opts.stopWhen && opts.stopWhen(events))) {
        ac.abort();
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
    }
  } catch {
    /* aborted */
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return { events, gap, closed };
}

function dataEvents(parsed: SseParsed[]): Array<{ replay?: boolean; body?: string; seq?: number; kind?: string }> {
  return parsed
    .filter((e) => e.data)
    .map((e) => {
      const d = e.data as Record<string, unknown>;
      return {
        replay: d.replay as boolean | undefined,
        body: typeof d.body === "string" ? d.body : undefined,
        seq: typeof d.seq === "number" ? d.seq : undefined,
        kind: typeof d.kind === "string" ? d.kind : undefined,
      };
    });
}

async function openEvents(
  token: string,
  roomId: string,
  afterSeq: number,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`https://kith.test/mcp/events?room_id=${encodeURIComponent(roomId)}&after_seq=${afterSeq}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      ...extraHeaders,
    },
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

describe("kith M3 events", () => {
  it("GET /mcp/events without Bearer is 401; agent not in room is 403", async () => {
    const s = await seed("codex");
    const noAuth = await SELF.fetch(`https://kith.test/mcp/events?room_id=${s.roomId}&after_seq=0`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(noAuth.status).toBe(401);

    const otherRoom = crypto.randomUUID();
    const now = "2026-09-20T00:00:00Z";
    await env.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'Other', ?, ?)`).bind(
      otherRoom,
      `slug_${otherRoom.replaceAll("-", "").slice(0, 10)}`,
      s.operatorId,
      now,
    ).run();
    await env.DB.prepare(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'mention')`,
    )
      .bind(otherRoom, s.operatorId)
      .run();
    const forbidden = await openEvents(s.token, otherRoom, 0);
    expect(forbidden.status).toBe(403);
  });

  it("EV-01: D1 5 persisted + Inbox live 2 contiguous → replay:true then replay:false; live jump → gap; Last-Event-ID vs after_seq takes max", async () => {
    const s = await seed("evbot");
    const kinds = ["message", "message", "trace", "message", "message"] as const;
    await insertPersisted(
      s.roomId,
      s.operatorId,
      kinds.map((kind, i) => ({ seq: i + 1, kind, body: `d1-${i + 1}` })),
    );
    await inboxRpc(s.roomId, s.agentId).notify({
      seq: 6,
      kind: "message",
      room_id: s.roomId,
      id: "live-6",
      body: "live-6",
      sender_id: s.operatorId,
      origin: "local",
    });
    await inboxRpc(s.roomId, s.agentId).notify({
      seq: 7,
      kind: "message",
      room_id: s.roomId,
      id: "live-7",
      body: "live-7",
      sender_id: s.operatorId,
      origin: "local",
    });

    const contiguous = await openEvents(s.token, s.roomId, 0);
    expect(contiguous.status).toBe(200);
    expect(contiguous.headers.get("content-type") ?? "").toContain("text/event-stream");
    const got = await collectSse(contiguous, {
      timeoutMs: 4000,
      stopWhen: (events) => dataEvents(events).length >= 7,
    });
    const rows = dataEvents(got.events);
    expect(rows.map((r) => ({ seq: r.seq, kind: r.kind, replay: r.replay }))).toEqual([
      { seq: 1, kind: "message", replay: true },
      { seq: 2, kind: "message", replay: true },
      { seq: 3, kind: "trace", replay: true },
      { seq: 4, kind: "message", replay: true },
      { seq: 5, kind: "message", replay: true },
      { seq: 6, kind: "message", replay: false },
      { seq: 7, kind: "message", replay: false },
    ]);
    expect(got.gap).toBe(false);

    const lastId = await openEvents(s.token, s.roomId, 0, { "Last-Event-ID": "3" });
    expect(lastId.status).toBe(200);
    const fromLast = await collectSse(lastId, {
      timeoutMs: 4000,
      stopWhen: (events) => dataEvents(events).length >= 4,
    });
    expect(dataEvents(fromLast.events).map((r) => r.seq)).toEqual([4, 5, 6, 7]);

    await resetStorage();
    const gapSeed = await seed("gapbot");
    await insertPersisted(
      gapSeed.roomId,
      gapSeed.operatorId,
      kinds.map((kind, i) => ({ seq: i + 1, kind, body: `d1-${i + 1}` })),
    );
    await inboxRpc(gapSeed.roomId, gapSeed.agentId).notify({
      seq: 8,
      kind: "message",
      room_id: gapSeed.roomId,
      id: "live-8",
      body: "live-8",
      sender_id: gapSeed.operatorId,
      origin: "local",
    });
    await inboxRpc(gapSeed.roomId, gapSeed.agentId).notify({
      seq: 9,
      kind: "message",
      room_id: gapSeed.roomId,
      id: "live-9",
      body: "live-9",
      sender_id: gapSeed.operatorId,
      origin: "local",
    });
    const gapRes = await openEvents(gapSeed.token, gapSeed.roomId, 0);
    expect(gapRes.status).toBe(200);
    const gapped = await collectSse(gapRes, {
      timeoutMs: 4000,
      stopWhen: (events) => events.some((e) => e.comment?.includes("gap")),
    });
    expect(gapped.gap).toBe(true);
    expect(dataEvents(gapped.events).map((r) => ({ seq: r.seq, replay: r.replay }))).toEqual([
      { seq: 1, replay: true },
      { seq: 2, replay: true },
      { seq: 3, replay: true },
      { seq: 4, replay: true },
      { seq: 5, replay: true },
    ]);
  }, 20_000);

  it("EV-02: 10 old @codex + 1 live human @codex → fake CLI exec=1 after_seq=MAX; after_seq=0 dump exec=0", async () => {
    const s = await seed("codex");
    await insertPersisted(
      s.roomId,
      s.operatorId,
      Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        kind: "message",
        body: "@codex please",
      })),
    );

    const dumpRes = await openEvents(s.token, s.roomId, 0);
    expect(dumpRes.status).toBe(200);
    const dump = await collectSse(dumpRes, {
      timeoutMs: 4000,
      stopWhen: (events) => {
        const rows = dataEvents(events);
        return rows.filter((r) => r.replay === true).length >= 10;
      },
    });
    const dumpRows = dataEvents(dump.events).filter((r) => r.replay === true);
    expect(dumpRows).toHaveLength(10);
    expect(dumpRows.every((r) => r.replay === true)).toBe(true);
    expect(countExec(dumpRows, "codex")).toBe(0);

    const op = await login(s.operatorHandle);
    const liveRes = await openEvents(s.token, s.roomId, 10);
    expect(liveRes.status).toBe(200);
    const liveCollected = collectSse(liveRes, {
      timeoutMs: 8000,
      stopWhen: (events) => dataEvents(events).some((r) => r.replay === false),
    });
    await new Promise((r) => setTimeout(r, 80));
    const send = await api("POST", `/api/rooms/${s.roomId}/messages`, op.cookie, op.csrf, {
      body: "@codex live now",
      client_message_id: "01EV02LIVEMSG01",
    });
    expect(send.status).toBe(200);
    const live = await liveCollected;
    const liveRows = dataEvents(live.events);
    expect(liveRows.some((r) => r.replay === true)).toBe(false);
    expect(countExec(liveRows, "codex")).toBe(1);
  }, 20_000);
});
