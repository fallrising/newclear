import type { Context } from "hono";
import mcpToolsDoc from "../contracts/mcp-tools-v1.json" with { type: "json" };
import { rejectStatus } from "../src/reject.ts";
import {
  authorizationBearer,
  forbidden,
  invalid,
  isRoomMember,
  requireAuth,
  unauthorized,
} from "./auth.ts";
import { INTERNAL_HEADER, INTERNAL_ORIGIN, MEMBER_HEADER, ROOM_HEADER, flagOn, type Env } from "./env.ts";
import { errorBody } from "./errors.ts";
import { asInt, asNullableString, extraKeys, parseObject, utf8Bytes } from "./json.ts";

type AppEnv = { Bindings: Env };

const MCP_TOOLS = mcpToolsDoc.tools;
const TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));
const RESULT_MAX = 256 * 1024;
const HISTORY_PAGE_MAX = 64 * 1024;
const STATUS_STATES = new Set(["accepted", "running", "blocked", "idle"]);
const POST_STATUS_KEYS = ["room_id", "state", "body", "thread_id", "generation_id"] as const;
const SEND_KEYS = ["room_id", "body", "client_message_id", "thread_id", "generation_id"] as const;
const READ_KEYS = ["room_id", "before_seq", "after_seq", "limit", "kind"] as const;
const LIST_KEYS = [] as const;

type RoomStatusStub = DurableObjectStub & {
  postStatus(
    roomId: string,
    memberId: string,
    state: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
};

function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(`room:${roomId}`));
}

function rpcResult(id: unknown, result: unknown): Response {
  const payload: Record<string, unknown> = { jsonrpc: "2.0", id, result };
  let text = JSON.stringify(payload);
  if (text.length > RESULT_MAX) {
    const truncated = {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: text.slice(0, RESULT_MAX - 128) }],
        isError: false,
      },
    };
    text = JSON.stringify(truncated);
    if (text.length > RESULT_MAX) text = text.slice(0, RESULT_MAX);
  }
  return new Response(text, { headers: { "content-type": "application/json" } });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(id: unknown, data: unknown): Response {
  const text = JSON.stringify(data);
  return rpcResult(id, {
    content: [{ type: "text", text }],
  });
}

function asArgs(params: Record<string, unknown> | null): Record<string, unknown> {
  const raw = params?.arguments;
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export async function handleMcpPost(c: Context<AppEnv>): Promise<Response> {
  if (!flagOn(c.env.ff_mcp)) {
    return c.json(errorBody("not_ready", "MCP is not enabled"), 503);
  }
  if (authorizationBearer(c) == null) return unauthorized(c);
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  if (auth.via !== "bearer" || auth.member.kind !== "agent") return unauthorized(c);

  const raw = await c.req.text();
  const obj = parseObject(raw);
  if (!obj) return rpcError(null, -32700, "parse error");
  if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
    return rpcError(obj.id ?? null, -32600, "invalid request");
  }
  const id = obj.id ?? null;
  const method = obj.method;
  const params =
    obj.params === undefined || obj.params === null
      ? {}
      : typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : null;
  if (params === null) return rpcError(id, -32602, "invalid params");

  if (method === "subscribe_events") {
    return rpcError(id, -32601, "method-not-found");
  }
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "kith", version: "0.0.0" },
    });
  }
  if (method === "tools/list") {
    return rpcResult(id, { tools: MCP_TOOLS });
  }
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (name === "subscribe_events" || !TOOL_NAMES.has(name)) {
      return rpcError(id, -32601, "method-not-found");
    }
    const args = asArgs(params);
    if (name === "list_rooms") return listRooms(c, id, auth.member.id, args);
    if (name === "read_history") return readHistory(c, id, auth.member.id, args);
    if (name === "send_message") return sendMessage(c, id, auth.member.id, args);
    if (name === "post_status") return postStatus(c, id, auth.member.id, args);
    return rpcError(id, -32601, "method-not-found");
  }
  return rpcError(id, -32601, "method-not-found");
}

async function listRooms(
  c: Context<AppEnv>,
  id: unknown,
  memberId: string,
  args: Record<string, unknown>,
): Promise<Response> {
  if (extraKeys(args, LIST_KEYS).length > 0) return invalid(c, "unknown field");
  const result = await c.env.DB.prepare(
    `SELECT r.id, r.name, rm.role, rm.attention_mode AS attention
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.member_id = ?
     ORDER BY r.created_at ASC`,
  )
    .bind(memberId)
    .all();
  const rooms = (result.results ?? []).map((row) => {
    const r = row as { id: string; name: string; role: string; attention: string };
    return { id: r.id, name: r.name, role: r.role, attention: r.attention };
  });
  return toolResult(id, { rooms });
}

async function readHistory(
  c: Context<AppEnv>,
  id: unknown,
  memberId: string,
  args: Record<string, unknown>,
): Promise<Response> {
  if (extraKeys(args, READ_KEYS).length > 0) return invalid(c, "unknown field");
  const roomId = typeof args.room_id === "string" ? args.room_id : "";
  if (!roomId) return invalid(c, "room_id required");
  if (!(await isRoomMember(c.env, roomId, memberId))) return forbidden(c);
  const afterSeq = args.after_seq === undefined ? -1 : asInt(args.after_seq);
  const beforeSeq = args.before_seq === undefined ? null : asInt(args.before_seq);
  let limit = 50;
  if (args.limit !== undefined) {
    const n = asInt(args.limit);
    if (n === undefined) return invalid(c, "invalid limit");
    limit = n;
  }
  if (afterSeq === undefined || (args.before_seq !== undefined && beforeSeq === undefined)) {
    return invalid(c, "invalid seq");
  }
  limit = Math.min(50, Math.max(1, limit));
  const kindRaw = typeof args.kind === "string" ? args.kind : "message";
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
  const rows = result.results ?? [];
  const messages: unknown[] = [];
  let size = 2;
  for (const row of rows) {
    const encoded = JSON.stringify(row);
    const extra = (messages.length === 0 ? 0 : 1) + encoded.length;
    if (messages.length > 0 && size + extra > HISTORY_PAGE_MAX) break;
    messages.push(row);
    size += extra;
  }
  return toolResult(id, { messages });
}

async function sendMessage(
  c: Context<AppEnv>,
  id: unknown,
  memberId: string,
  args: Record<string, unknown>,
): Promise<Response> {
  if (extraKeys(args, SEND_KEYS).length > 0) return invalid(c, "unknown field");
  const roomId = typeof args.room_id === "string" ? args.room_id : "";
  const body = typeof args.body === "string" ? args.body : "";
  const clientMessageId = typeof args.client_message_id === "string" ? args.client_message_id : "";
  if (!roomId || !body || !clientMessageId) return invalid(c, "room_id, body, client_message_id required");
  if (!(await isRoomMember(c.env, roomId, memberId))) return forbidden(c);
  const threadId = asNullableString(args.thread_id);
  const generationId = asNullableString(args.generation_id);
  if (args.thread_id !== undefined && threadId === undefined) return invalid(c, "invalid thread_id");
  if (args.generation_id !== undefined && generationId === undefined) return invalid(c, "invalid generation_id");
  const stub = roomStub(c.env, roomId);
  const res = await stub.fetch(
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
        thread_id: threadId ?? null,
        generation_id: generationId ?? null,
      }),
    }),
  );
  const text = await res.text();
  if (!res.ok) {
    return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  }
  const row = parseObject(text) ?? { seq: null };
  return toolResult(id, row);
}

async function postStatus(
  c: Context<AppEnv>,
  id: unknown,
  memberId: string,
  args: Record<string, unknown>,
): Promise<Response> {
  if (extraKeys(args, POST_STATUS_KEYS).length > 0) return invalid(c, "unknown field");
  const roomId = typeof args.room_id === "string" ? args.room_id : "";
  const state = typeof args.state === "string" ? args.state : "";
  if (!roomId || !state) return invalid(c, "room_id and state required");
  if (!STATUS_STATES.has(state)) return invalid(c, "invalid state");
  let body = "";
  if (args.body !== undefined) {
    if (typeof args.body !== "string") return invalid(c, "invalid body");
    body = args.body;
    if (utf8Bytes(body) > 512 || !rejectStatus(utf8Bytes(body)).ok) {
      return c.json(errorBody("payload_too_large", "status exceeds 512 UTF-8 bytes"), 400);
    }
  }
  if (!(await isRoomMember(c.env, roomId, memberId))) return forbidden(c);
  const stub = roomStub(c.env, roomId) as RoomStatusStub;
  const out = await stub.postStatus(roomId, memberId, state, body);
  if (!out.ok) return c.json(errorBody(out.code, out.message), out.status as 400 | 403);
  return toolResult(id, { ok: true, state });
}
