import { SELF, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/password.ts";

const PASSWORD = "test-pass-m3-mcp";
let HASH = "";

const TOOL_NAMES = ["list_rooms", "read_history", "send_message", "post_status"] as const;
const RESULT_MAX = 256 * 1024;

type Seed = {
  operatorId: string;
  roomId: string;
  operatorHandle: string;
  agentId: string;
  agentHandle: string;
  token: string;
};

type JsonRpc = {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
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

async function mcp(
  token: string | null,
  method: string,
  params?: unknown,
  id: number | string = 1,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch("https://kith.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

function toolPayload(body: JsonRpc): Record<string, unknown> {
  const result = body.result as { content?: Array<{ text?: string }> } | undefined;
  const text = result?.content?.[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text as string) as Record<string, unknown>;
}

async function seed(): Promise<Seed> {
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
    handle: "codex",
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

async function messageCount(roomId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ?`)
    .bind(roomId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
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

describe("kith M3 MCP", () => {
  it("POST /mcp without Bearer is 401 when ff_mcp=on", async () => {
    const res = await mcp(null, "initialize", {});
    expect(res.status).toBe(401);
  });

  it("MCP-01: tools/list matches four names; round-trip call each tool; result JSON string length <= 256KiB", async () => {
    const s = await seed();
    const init = await mcp(s.token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as JsonRpc;
    const initResult = initBody.result as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string };
    };
    expect(initResult.protocolVersion).toBe("2025-03-26");
    expect(initResult.capabilities).toHaveProperty("tools");
    expect(initResult.serverInfo.name).toBe("kith");

    const listed = await mcp(s.token, "tools/list", {});
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as JsonRpc;
    expect(JSON.stringify(listBody).length).toBeLessThanOrEqual(RESULT_MAX);
    const tools = (listBody.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);

    const roomsRes = await mcp(s.token, "tools/call", { name: "list_rooms", arguments: {} });
    expect(roomsRes.status).toBe(200);
    const roomsRpc = (await roomsRes.json()) as JsonRpc;
    expect(JSON.stringify(roomsRpc).length).toBeLessThanOrEqual(RESULT_MAX);
    const rooms = toolPayload(roomsRpc);
    expect(Array.isArray(rooms.rooms)).toBe(true);
    const room0 = (rooms.rooms as Array<{ id: string; name: string; role: string; attention: string }>)[0];
    expect(room0?.id).toBe(s.roomId);
    expect(room0?.name).toBe("Lobby");
    expect(room0?.role).toBe("member");
    expect(room0?.attention).toBe("mention");

    const histRes = await mcp(s.token, "tools/call", {
      name: "read_history",
      arguments: { room_id: s.roomId },
    });
    expect(histRes.status).toBe(200);
    const histRpc = (await histRes.json()) as JsonRpc;
    expect(JSON.stringify(histRpc).length).toBeLessThanOrEqual(RESULT_MAX);
    const hist = toolPayload(histRpc);
    expect(Array.isArray(hist.messages)).toBe(true);

    const sendRes = await mcp(s.token, "tools/call", {
      name: "send_message",
      arguments: {
        room_id: s.roomId,
        body: "hello from mcp",
        client_message_id: "01MCP01SENDMSG1",
      },
    });
    expect(sendRes.status).toBe(200);
    const sendRpc = (await sendRes.json()) as JsonRpc;
    expect(JSON.stringify(sendRpc).length).toBeLessThanOrEqual(RESULT_MAX);
    const sent = toolPayload(sendRpc);
    expect(typeof sent.seq).toBe("number");

    const statusRes = await mcp(s.token, "tools/call", {
      name: "post_status",
      arguments: { room_id: s.roomId, state: "idle" },
    });
    expect(statusRes.status).toBe(200);
    const statusRpc = (await statusRes.json()) as JsonRpc;
    expect(JSON.stringify(statusRpc).length).toBeLessThanOrEqual(RESULT_MAX);
    const status = toolPayload(statusRpc);
    expect(status.ok).toBe(true);
  });

  it("M3-US-03: four tools each one call; send_message has seq; post_status D1 COUNT unchanged", async () => {
    const s = await seed();
    const before = await messageCount(s.roomId);

    const listRes = await mcp(s.token, "tools/call", { name: "list_rooms", arguments: {} });
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("content-type") ?? "").toMatch(/json/);

    const histRes = await mcp(s.token, "tools/call", {
      name: "read_history",
      arguments: { room_id: s.roomId },
    });
    expect(histRes.status).toBe(200);

    const sendRes = await mcp(s.token, "tools/call", {
      name: "send_message",
      arguments: {
        room_id: s.roomId,
        body: "agent line",
        client_message_id: "01M3US03SENDMSG",
      },
    });
    expect(sendRes.status).toBe(200);
    const sent = toolPayload((await sendRes.json()) as JsonRpc);
    expect(typeof sent.seq).toBe("number");
    expect(sent.body).toBe("agent line");
    const afterSend = await messageCount(s.roomId);
    expect(afterSend).toBe(before + 1);

    const statusRes = await mcp(s.token, "tools/call", {
      name: "post_status",
      arguments: { room_id: s.roomId, state: "running", body: "working" },
    });
    expect(statusRes.status).toBe(200);
    expect(await messageCount(s.roomId)).toBe(afterSend);
  });

  it("MCP-02: subscribe_events as method or tools/call name returns method-not-found", async () => {
    const s = await seed();
    const asMethod = await mcp(s.token, "subscribe_events", {});
    expect(asMethod.status).toBe(200);
    const methodBody = (await asMethod.json()) as JsonRpc;
    expect(methodBody.error?.code).toBe(-32601);
    expect(methodBody.error?.message ?? "").toContain("method-not-found");

    const asTool = await mcp(s.token, "tools/call", { name: "subscribe_events", arguments: {} });
    expect(asTool.status).toBe(200);
    const toolBody = (await asTool.json()) as JsonRpc;
    expect(toolBody.error?.code).toBe(-32601);
    expect(toolBody.error?.message ?? "").toContain("method-not-found");
  });

  it("read_history for a room the agent is not in is 403", async () => {
    const s = await seed();
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
    const res = await mcp(s.token, "tools/call", {
      name: "read_history",
      arguments: { room_id: otherRoom },
    });
    expect(res.status).toBe(403);
  });
});
