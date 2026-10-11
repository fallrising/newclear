import { DurableObject } from "cloudflare:workers";
import { BODY_MAX_BYTES, FANOUT_CHUNK, MEMBERS_PER_ROOM, STATUS_MAX_BYTES } from "../src/caps.ts";
import { chunks } from "../src/fanout.ts";
import { tokenizeMentions } from "../src/mention.ts";
import { consumeWake, rejectBody, rejectStatus } from "../src/reject.ts";
import type { InboxNotifyPayload } from "./inbox.ts";
import {
  INTERNAL_HEADER,
  MEMBER_HEADER,
  ROOM_HEADER,
  type Env,
} from "./env.ts";
import { errorResponse } from "./errors.ts";
import { extraKeys, parseObject, utf8Bytes } from "./json.ts";
import { inc } from "./metrics.ts";
import { paidLimits, reserveLedger, PAID_LEASE_MS, type PaidAttempt, type PaidLedger } from "./cost-controls.ts";

const TRACE_MAX_BYTES = 2048;
const TYPING_TTL_MS = 90_000;
const AMBIENT_LOCK_TTL_MS = 120_000;
const WAKE_WINDOW_MS = 60_000;
const SEND_HTTP_KEYS = ["body", "client_message_id", "thread_id", "generation_id", "kind"] as const;
export const WS_FRAME_MAX_BYTES = 16 * 1024;
export const WS_MEMBER_FRAMES_PER_MINUTE = 120;
export const WS_ROOM_FRAMES_PER_MINUTE = 1000;

export type AmbientLock = {
  generation_id: string;
  agent_id: string;
  expires_at: number;
};

export type RoomActivity = {
  last_human_at: string | null;
  humans_typing: boolean;
  recent_10_has_agent: boolean;
};

export type AcquireAmbientResult = { ok: true } | { ok: false };
export type ConsumeWakeBudgetResult = { ok: true } | { ok: false; code: "wake_budget_exhausted" };

export type MessageRow = {
  id: string;
  room_id: string;
  seq: number;
  kind: "message" | "trace";
  thread_id: string | null;
  reply_to: string | null;
  sender_id: string;
  body: string;
  mentions_json: string;
  generation_id: string | null;
  client_message_id: string;
  origin: "local";
  created_at: string;
};

type PersistOk = { ok: true; row: MessageRow; uniqueHit: boolean };
type PersistFail = { ok: false; status: number; code: string; message: string };
type PersistResult = PersistOk | PersistFail;

const SEND_KEYS = ["v", "type", "client_message_id", "body", "thread_id", "generation_id"] as const;
const ACK_KEYS = ["v", "type", "seq"] as const;
const STATUS_KEYS = ["v", "type", "body"] as const;

type InboxNotifyStub = DurableObjectStub & {
  notify(payload: InboxNotifyPayload): Promise<unknown>;
};

export class Room extends DurableObject<Env> {
  private d1TimeoutOnce = false;
  private crashBeforeNextSeqOnce = false;
  private lastFanoutBatchSizes: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /** Instance-wide accounting; every reservation is serialized before external work. */
  async reservePaidAttempt(input: PaidAttempt): Promise<boolean> {
    const caps = paidLimits(this.env);
    if (!caps) return false;
    return this.ctx.storage.transaction(async (tx) => {
      const next = reserveLedger(await tx.get<PaidLedger>("paid_ledger"), input, caps, Date.now());
      if (!next) return false;
      await tx.put("paid_ledger", next);
      return true;
    });
  }

  async releasePaidAttempt(generationId: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const ledger = await tx.get<PaidLedger>("paid_ledger");
      if (!ledger) return;
      delete ledger.leases[generationId];
      await tx.put("paid_ledger", ledger);
    });
  }

  /** All mention and ambient wakes share this admission gate. */
  async admitHosted(generationId: string): Promise<{ ok: boolean; code?: string }> {
    if (!generationId || generationId.length > 128) return { ok: false, code: "invalid_request" };
    return this.ctx.storage.transaction(async (tx) => {
      const now = Date.now();
      const active = await tx.get<{ id: string; expires: number }>("hosted_active");
      if (active && active.expires > now) {
        return active.id === generationId ? { ok: true } : { ok: false, code: "hosted_busy" };
      }
      const stamps = ((await tx.get<number[]>("wake_budget")) ?? []).filter((ts) => now - ts < WAKE_WINDOW_MS);
      if (!consumeWake(stamps.length).ok) return { ok: false, code: "wake_budget_exhausted" };
      stamps.push(now);
      await tx.put({ wake_budget: stamps, hosted_active: { id: generationId, expires: now + PAID_LEASE_MS } });
      return { ok: true };
    });
  }

  async releaseHosted(generationId: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const active = await tx.get<{ id: string }>("hosted_active");
      if (active?.id === generationId) await tx.delete("hosted_active");
    });
  }

  async admitEventStream(streamId: string): Promise<{ ok: boolean; code?: string }> {
    if (!streamId || streamId.length > 128) return { ok: false, code: "invalid_request" };
    return this.ctx.storage.transaction(async (tx) => {
      const now = Date.now();
      const leases = (await tx.get<Record<string, number>>("event_streams")) ?? {};
      for (const [id, expiry] of Object.entries(leases)) if (expiry <= now) delete leases[id];
      if (!Object.hasOwn(leases, streamId) && Object.keys(leases).length >= 16) return { ok: false, code: "stream_limit" };
      leases[streamId] = now + PAID_LEASE_MS;
      await tx.put("event_streams", leases);
      return { ok: true };
    });
  }

  async releaseEventStream(streamId: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const leases = (await tx.get<Record<string, number>>("event_streams")) ?? {};
      delete leases[streamId];
      await tx.put("event_streams", leases);
    });
  }

  async gcCursor(): Promise<string> { return (await this.ctx.storage.get<string>("gc_cursor")) ?? ""; }
  async advanceGcCursor(cursor: string): Promise<void> { await this.ctx.storage.put("gc_cursor", cursor); }

  async admitApiRequest(client: string, login = false): Promise<boolean> {
    if (!client || client.length > 128) return false;
    const raw = login ? this.env.KITH_MAX_LOGIN_ATTEMPTS_PER_MINUTE : this.env.KITH_MAX_API_REQUESTS_PER_MINUTE;
    const cap = raw === undefined ? (login ? 10 : 120) : /^[1-9][0-9]*$/.test(raw) ? Number(raw) : 0;
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1000) return false;
    return this.ctx.storage.transaction(async (tx) => {
      const minute = Math.floor(Date.now() / 60_000);
      const storageKey = login ? "login_requests" : "api_requests";
      const prior = await tx.get<{ minute: number; total: number; clients: Record<string, number> }>(storageKey);
      const ledger = prior?.minute === minute ? prior : { minute, total: 0, clients: {} };
      const key = `client:${client}`;
      if (ledger.total >= 5000 || (ledger.clients[key] ?? 0) >= cap || (!Object.hasOwn(ledger.clients, key) && Object.keys(ledger.clients).length >= 512)) return false;
      ledger.total++; ledger.clients[key] = (ledger.clients[key] ?? 0) + 1;
      await tx.put(storageKey, ledger);
      return true;
    });
  }

  async claimTraceUpload(roomId: string, messageId: string, agentId: string): Promise<{ ok: boolean; stored: boolean; code?: string }> {
    return this.ctx.blockConcurrencyWhile(async () => {
    const row = await this.env.DB.prepare(`SELECT trace_full_state FROM messages WHERE id = ? AND room_id = ? AND sender_id = ? AND kind = 'trace'`)
      .bind(messageId, roomId, agentId).first<{ trace_full_state: string | null }>();
    if (!row || row.trace_full_state) return { ok: false, stored: row?.trace_full_state === "stored" };
    const admitted = await this.ctx.storage.transaction(async (tx) => {
      const day = new Date().toISOString().slice(0, 10);
      const previous = await tx.get<{ day: string; total: number; agents: Record<string, number> }>("trace_quota");
      const quota = previous?.day === day ? previous : { day, total: 0, agents: {} };
      const key = `agent:${agentId}`;
      if (quota.total >= 128 || (quota.agents[key] ?? 0) >= 32) return false;
      quota.total++;
      quota.agents[key] = (quota.agents[key] ?? 0) + 1;
      await tx.put("trace_quota", quota);
      return true;
    });
    if (!admitted) return { ok: false, stored: false, code: "trace_quota_exhausted" };
    const claimed = await this.env.DB.prepare(`UPDATE messages SET trace_full_state = 'claimed' WHERE id = ? AND room_id = ? AND sender_id = ? AND kind = 'trace' AND trace_full_state IS NULL`)
      .bind(messageId, roomId, agentId).run();
    if (claimed.meta.changes === 1) return { ok: true, stored: false };
    const after = await this.env.DB.prepare(`SELECT trace_full_state FROM messages WHERE id = ?`).bind(messageId).first<{ trace_full_state: string | null }>();
    return { ok: false, stored: after?.trace_full_state === "stored" };
    });
  }

  async completeTraceUpload(messageId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(`UPDATE messages SET trace_full_state = 'stored' WHERE id = ? AND kind = 'trace' AND trace_full_state = 'claimed'`).bind(messageId).run();
    return result.meta.changes === 1;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get(INTERNAL_HEADER) !== "1") {
      return errorResponse(401, "unauthorized", "missing internal principal");
    }
    const memberId = request.headers.get(MEMBER_HEADER) ?? "";
    const roomId = request.headers.get(ROOM_HEADER) ?? new URL(request.url).searchParams.get("room_id") ?? "";
    if (!memberId || !roomId) {
      return errorResponse(401, "unauthorized", "missing principal");
    }
    await this.ctx.storage.put("room_id", roomId);
    const memberOk = await this.memberInRoom(roomId, memberId);
    if (!memberOk) return errorResponse(403, "forbidden", "not a room member");

    const upgrade = request.headers.get("Upgrade");
    if (upgrade === "websocket") {
      return this.acceptSocket(roomId, memberId);
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/send")) {
      const text = await request.text();
      const body = parseObject(text);
      if (!body) return errorResponse(400, "invalid_request", "invalid json");
      if (extraKeys(body, SEND_HTTP_KEYS).length > 0) {
        return errorResponse(400, "invalid_request", "unknown field");
      }
      const kind = parseSendKind(body.kind);
      if (!kind) return errorResponse(400, "invalid_request", "invalid kind");
      const result = await this.persistSend({
        roomId,
        senderId: memberId,
        body: typeof body.body === "string" ? body.body : "",
        clientMessageId: typeof body.client_message_id === "string" ? body.client_message_id : "",
        threadId: body.thread_id === null || typeof body.thread_id === "string" ? (body.thread_id as string | null) : null,
        generationId:
          body.generation_id === null || typeof body.generation_id === "string"
            ? (body.generation_id as string | null)
            : null,
        kind,
      });
      if (!result.ok) return errorResponse(result.status, result.code, result.message);
      return Response.json(this.publicRow(result.row));
    }

    return errorResponse(404, "not_found", "unknown room path");
  }

  /** Ephemeral status: WS broadcast only. No D1 INSERT and no seq. */
  async postStatus(
    roomId: string,
    memberId: string,
    state: string,
    body: string,
  ): Promise<{ ok: true } | PersistFail> {
    await this.ctx.storage.put("room_id", roomId);
    if (!(await this.memberInRoom(roomId, memberId))) {
      return { ok: false, status: 403, code: "forbidden", message: "not a room member" };
    }
    const text = body.length > 0 ? body : state;
    if (utf8Bytes(text) > STATUS_MAX_BYTES) {
      return { ok: false, status: 400, code: "payload_too_large", message: "status exceeds 512 UTF-8 bytes" };
    }
    const rejected = rejectStatus(utf8Bytes(text));
    if (!rejected.ok) {
      return { ok: false, status: 400, code: "payload_too_large", message: "status exceeds 512 UTF-8 bytes" };
    }
    await this.noteTyping(memberId);
    this.broadcastStatus(memberId, text);
    return { ok: true };
  }

  /** B-11: ephemeral `reply failed`. Only the operator's sockets get error_class. No D1 INSERT, no seq. */
  async postReplyFailed(roomId: string, memberId: string, errorClass: string): Promise<{ ok: true } | PersistFail> {
    await this.ctx.storage.put("room_id", roomId);
    if (!(await this.memberInRoom(roomId, memberId))) {
      return { ok: false, status: 403, code: "forbidden", message: "not a room member" };
    }
    const operator = await this.env.DB.prepare(`SELECT id FROM members WHERE is_operator = 1`).first<{ id: string }>();
    const plain = JSON.stringify({ v: 1, type: "status", member_id: memberId, body: "reply failed" });
    const detailed = JSON.stringify({
      v: 1,
      type: "status",
      member_id: memberId,
      body: "reply failed",
      error_class: errorClass,
    });
    for (const ws of this.sockets()) {
      const attachment = (ws.deserializeAttachment?.() ?? {}) as { member_id?: string };
      try {
        ws.send(operator && attachment.member_id === operator.id ? detailed : plain);
      } catch {
        /* drop closed */
      }
    }
    return { ok: true };
  }

  /**
   * B-10: ephemeral full-text draft from HostedGeneration. No D1 write, no seq, not in /mcp/events, no Inbox
   * notify (V2-INV-03). Internal RPC only; the caller already checked membership when the generation began.
   */
  async postDraft(roomId: string, memberId: string, generationId: string, text: string): Promise<{ ok: true } | PersistFail> {
    await this.ctx.storage.put("room_id", roomId);
    if (utf8Bytes(text) > BODY_MAX_BYTES) {
      return { ok: false, status: 400, code: "payload_too_large", message: "draft exceeds 8192 UTF-8 bytes" };
    }
    const frame = JSON.stringify({ v: 1, type: "draft", member_id: memberId, generation_id: generationId, text, done: false });
    for (const ws of this.sockets()) {
      try {
        ws.send(frame);
      } catch {
        /* drop closed */
      }
    }
    return { ok: true };
  }

  async activity(roomId: string): Promise<RoomActivity> {
    await this.ctx.storage.put("room_id", roomId);
    const lastHumanAt = (await this.ctx.storage.get<string>("last_human_at")) ?? null;
    const typing = (await this.ctx.storage.get<Record<string, number>>("typing")) ?? {};
    const now = Date.now();
    const humansTyping = Object.values(typing).some((ts) => now - ts < TYPING_TTL_MS);
    const recent = await this.env.DB.prepare(
      `SELECT m.kind AS kind
       FROM messages msg
       JOIN members m ON m.id = msg.sender_id
       WHERE msg.room_id = ? AND msg.kind = 'message'
       ORDER BY msg.seq DESC
       LIMIT 10`,
    )
      .bind(roomId)
      .all<{ kind: string }>();
    const recent10HasAgent = (recent.results ?? []).some((row) => row.kind === "agent");
    return {
      last_human_at: lastHumanAt,
      humans_typing: humansTyping,
      recent_10_has_agent: recent10HasAgent,
    };
  }

  async tryAcquireAmbient(roomId: string, agentId: string, generationId: string): Promise<AcquireAmbientResult> {
    await this.ctx.storage.put("room_id", roomId);
    return this.ctx.storage.transaction(async (tx) => {
    const existing = await tx.get<AmbientLock>("ambient_lock");
    if (existing && existing.expires_at > Date.now()) {
      return { ok: false };
    }
    const lock: AmbientLock = {
      generation_id: generationId,
      agent_id: agentId,
      expires_at: Date.now() + AMBIENT_LOCK_TTL_MS,
    };
    await tx.put("ambient_lock", lock);
    return { ok: true };
    });
  }

  async consumeWakeBudget(): Promise<ConsumeWakeBudgetResult> {
    return this.ctx.storage.transaction(async (tx) => {
    const now = Date.now();
    const stamps = ((await tx.get<number[]>("wake_budget")) ?? []).filter(
      (ts) => now - ts < WAKE_WINDOW_MS,
    );
    const result = consumeWake(stamps.length);
    if (!result.ok) {
      inc("ambient_budget_exhausted");
      await tx.put("wake_budget", stamps);
      return { ok: false, code: "wake_budget_exhausted" };
    }
    stamps.push(now);
    await tx.put("wake_budget", stamps);
    return { ok: true };
    });
  }

  async releaseAmbient(generationId: string): Promise<void> {
    const lock = await this.ctx.storage.get<AmbientLock>("ambient_lock");
    if (!lock || lock.generation_id !== generationId) return;
    await this.ctx.storage.delete("ambient_lock");
  }

  /** Test RPC: current ambient lock, or null if none. */
  async ambientLock(): Promise<AmbientLock | null> {
    return (await this.ctx.storage.get<AmbientLock>("ambient_lock")) ?? null;
  }

  /** Test hook: next messages INSERT runs, then fails closed as timeout_unknown. */
  async injectD1TimeoutOnce(): Promise<void> {
    this.d1TimeoutOnce = true;
  }

  /** Test hook: clear cached next_seq (DO restart / crash before persist). */
  async clearNextSeq(): Promise<void> {
    await this.ctx.storage.delete("next_seq");
  }

  async getNextSeqCache(): Promise<number | null> {
    const stored = await this.ctx.storage.get<number>("next_seq");
    return stored === undefined ? null : stored;
  }

  /** Test hook: crash after D1 INSERT before persist next_seq. */
  async crashBeforePersistNextSeqOnce(): Promise<void> {
    this.crashBeforeNextSeqOnce = true;
  }

  /** There is no API that broadcasts before INSERT. */
  async tryBroadcastFirst(): Promise<{ rejected: true; message: string }> {
    return { rejected: true, message: "broadcast only after INSERT success" };
  }

  /** No timers or cross-object RPC: completed frame work remains compatible with WebSocket hibernation. */
  private async admitWebSocketFrame(memberId: string): Promise<boolean> {
    if (!memberId || memberId.length > 128) return false;
    try {
      return await this.ctx.storage.transaction(async (tx) => {
        const minute = Math.floor(Date.now() / 60_000);
        const prior = await tx.get<{ minute: number; total: number; members: Record<string, number> }>("ws_frames");
        const ledger = prior?.minute === minute ? prior : { minute, total: 0, members: {} };
        const key = `member:${memberId}`;
        const previous = Object.hasOwn(ledger.members, key) ? ledger.members[key] : 0;
        if (ledger.total >= WS_ROOM_FRAMES_PER_MINUTE || previous >= WS_MEMBER_FRAMES_PER_MINUTE
          || (!Object.hasOwn(ledger.members, key) && Object.keys(ledger.members).length >= MEMBERS_PER_ROOM)) return false;
        ledger.total++;
        ledger.members[key] = previous + 1;
        await tx.put("ws_frames", ledger);
        return true;
      });
    } catch {
      return false; // Unknown admission/storage results never authorize downstream work.
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" ? message.length > WS_FRAME_MAX_BYTES : message.byteLength > WS_FRAME_MAX_BYTES) {
      this.sendError(ws, "payload_too_large");
      return;
    }
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (utf8Bytes(raw) > WS_FRAME_MAX_BYTES) {
      this.sendError(ws, "payload_too_large");
      return;
    }
    const obj = parseObject(raw);
    if (!obj) {
      this.sendError(ws, "invalid_request");
      return;
    }
    const attachment = (ws.deserializeAttachment?.() ?? {}) as { member_id?: string; room_id?: string };
    const memberId = attachment.member_id;
    const roomId = attachment.room_id;
    if (!memberId || !roomId) {
      this.sendError(ws, "unauthorized");
      return;
    }
    const type = obj.type;
    if (obj.v !== 1) {
      this.sendError(ws, "invalid_request");
      return;
    }
    // ACK has no side effect. It must not turn an unlimited frame stream into D1 membership reads.
    if (type === "ack") {
      if (extraKeys(obj, ACK_KEYS).length > 0) this.sendError(ws, "invalid_request");
      return;
    }
    if (type !== "send" && type !== "status") {
      this.sendError(ws, "invalid_request");
      return;
    }
    if (!(await this.admitWebSocketFrame(memberId))) {
      this.sendError(ws, "rate_limited");
      return;
    }
    const memberOk = await this.memberInRoom(roomId, memberId);
    if (!memberOk) {
      this.sendError(ws, "forbidden");
      return;
    }
    if (type === "send") {
      if (extraKeys(obj, SEND_KEYS).length > 0) {
        this.sendError(ws, "invalid_request");
        return;
      }
      const result = await this.persistSend({
        roomId,
        senderId: memberId,
        body: typeof obj.body === "string" ? obj.body : "",
        clientMessageId: typeof obj.client_message_id === "string" ? obj.client_message_id : "",
        threadId: obj.thread_id === null || typeof obj.thread_id === "string" ? (obj.thread_id as string | null) : null,
        generationId:
          obj.generation_id === null || typeof obj.generation_id === "string"
            ? (obj.generation_id as string | null)
            : null,
      });
      if (!result.ok) {
        this.sendError(ws, result.code);
        return;
      }
      if (result.uniqueHit) {
        this.sendEvent(ws, result.row);
      }
      return;
    }
    if (type === "status") {
      if (extraKeys(obj, STATUS_KEYS).length > 0) {
        this.sendError(ws, "invalid_request");
        return;
      }
      const body = typeof obj.body === "string" ? obj.body : "";
      if (body.length < 1) {
        this.sendError(ws, "invalid_request");
        return;
      }
      const rejected = rejectStatus(utf8Bytes(body));
      if (!rejected.ok) {
        this.sendError(ws, "payload_too_large");
        return;
      }
      if (utf8Bytes(body) > STATUS_MAX_BYTES) {
        this.sendError(ws, "payload_too_large");
        return;
      }
      await this.noteTyping(memberId);
      this.broadcastStatus(memberId, body);
      return;
    }
    this.sendError(ws, "invalid_request");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private acceptSocket(roomId: string, memberId: string): Response {
    if (this.sockets().length >= 32) return errorResponse(429, "connection_limit", "room connection limit reached");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment = { member_id: memberId, room_id: roomId };
    if (typeof this.ctx.acceptWebSocket === "function") {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment?.(attachment);
    } else {
      server.accept();
      server.serializeAttachment?.(attachment);
      server.addEventListener("message", (event: MessageEvent) => {
        void this.webSocketMessage(server, event.data as string | ArrayBuffer);
      });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async memberInRoom(roomId: string, memberId: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
      `SELECT 1 AS ok
       FROM room_members rm
       JOIN members m ON m.id = rm.member_id
       WHERE rm.room_id = ? AND rm.member_id = ? AND m.disabled_at IS NULL`,
    )
      .bind(roomId, memberId)
      .first<{ ok: number }>();
    return row != null;
  }

  private async persistSend(input: {
    roomId: string;
    senderId: string;
    body: string;
    clientMessageId: string;
    threadId: string | null;
    generationId: string | null;
    kind?: "message" | "trace";
  }): Promise<PersistResult> {
    const kind = input.kind ?? "message";
    if (kind !== "message" && kind !== "trace") {
      return { ok: false, status: 400, code: "invalid_request", message: "invalid kind" };
    }
    if (input.clientMessageId.length < 8 || input.clientMessageId.length > 64) {
      return { ok: false, status: 400, code: "invalid_request", message: "client_message_id length" };
    }
    if (input.body.length < 1) {
      return { ok: false, status: 400, code: "invalid_request", message: "body required" };
    }
    const bytes = utf8Bytes(input.body);
    if (kind === "trace") {
      if (bytes > TRACE_MAX_BYTES) {
        return { ok: false, status: 400, code: "payload_too_large", message: "body exceeds 2048 UTF-8 bytes" };
      }
    } else {
      const rejected = rejectBody(bytes);
      if (!rejected.ok) {
        return { ok: false, status: 400, code: "payload_too_large", message: "body exceeds 8192 UTF-8 bytes" };
      }
    }

    const existing = await this.lookupByClientId(input.roomId, input.senderId, input.clientMessageId);
    if (existing) return { ok: true, row: existing, uniqueHit: true };

    const archived = await this.env.DB.prepare(`SELECT archived_at FROM rooms WHERE id = ?`)
      .bind(input.roomId)
      .first<{ archived_at: string | null }>();
    if (archived?.archived_at) {
      return { ok: false, status: 409, code: "room_archived", message: "room is archived" };
    }

    if (input.generationId != null) {
      const gen = await this.env.DB.prepare(`SELECT agent_id, state FROM generations WHERE id = ?`)
        .bind(input.generationId)
        .first<{ agent_id: string; state: string }>();
      const inflight = gen?.state === "dispatched" || gen?.state === "streaming";
      if (!gen || gen.agent_id !== input.senderId || !inflight) {
        inc("generation_dropped_total");
        return { ok: false, status: 409, code: "generation_dropped", message: "generation dropped" };
      }
    }

    const stored = (await this.ctx.storage.get<number>("next_seq")) ?? 0;
    const d1Next = await this.env.DB.prepare(
      `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE room_id = ?`,
    )
      .bind(input.roomId)
      .first<{ next: number }>();
    const seq = Math.max(Number(stored), Number(d1Next?.next ?? 0));

    const mentions = await this.mentionIds(input.roomId, input.body);
    const row: MessageRow = {
      id: crypto.randomUUID(),
      room_id: input.roomId,
      seq,
      kind,
      thread_id: input.threadId,
      reply_to: null,
      sender_id: input.senderId,
      body: input.body,
      mentions_json: JSON.stringify(mentions),
      generation_id: input.generationId,
      client_message_id: input.clientMessageId,
      origin: "local",
      created_at: new Date().toISOString(),
    };

    try {
      await this.insertMessage(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/timeout/i.test(message)) {
        return { ok: false, status: 503, code: "not_ready", message: "D1 timeout unknown" };
      }
      if (/UNIQUE/i.test(message) && /client_message_id/i.test(message)) {
        const original = await this.lookupByClientId(input.roomId, input.senderId, input.clientMessageId);
        if (original) return { ok: true, row: original, uniqueHit: true };
      }
      return { ok: false, status: 503, code: "not_ready", message: "insert failed" };
    }

    if (this.crashBeforeNextSeqOnce) {
      this.crashBeforeNextSeqOnce = false;
      return { ok: false, status: 503, code: "not_ready", message: "crashed before next_seq" };
    }

    await this.ctx.storage.put("next_seq", seq + 1);
    if (input.generationId != null) {
      await this.env.DB.prepare(
        `UPDATE generations SET state = 'completed', completed_at = ? WHERE id = ? AND state IN ('dispatched', 'streaming')`,
      )
        .bind(new Date().toISOString(), input.generationId)
        .run();
      await this.releaseAmbient(input.generationId);
    }
    const senderKind = await this.senderKind(input.senderId);
    if (senderKind === "human") {
      await this.ctx.storage.put("last_human_at", row.created_at);
    }
    this.broadcastEvent(row);
    await this.fanoutToAgents(input.roomId, row, senderKind);
    inc("messages_total", { kind });
    return { ok: true, row, uniqueHit: false };
  }

  /** Test RPC: last notify batch lengths (each ≤ FANOUT_CHUNK). */
  async lastFanoutBatches(): Promise<number[]> {
    const stored = await this.ctx.storage.get<number[]>("last_fanout_batches");
    return stored ?? this.lastFanoutBatchSizes;
  }

  /** Test RPC: agent member ids currently in this room. */
  async agentIds(): Promise<string[]> {
    const roomId = (await this.ctx.storage.get<string>("room_id")) ?? "";
    if (!roomId) return [];
    return this.listAgentIds(roomId);
  }

  private async listAgentIds(roomId: string): Promise<string[]> {
    const result = await this.env.DB.prepare(
      `SELECT m.id
       FROM room_members rm
       JOIN members m ON m.id = rm.member_id
       WHERE rm.room_id = ? AND m.kind = 'agent' AND m.disabled_at IS NULL
       ORDER BY m.id`,
    )
      .bind(roomId)
      .all<{ id: string }>();
    return (result.results ?? []).map((r) => r.id);
  }

  private inboxNotify(roomId: string, memberId: string, payload: InboxNotifyPayload): Promise<unknown> {
    const stub = this.env.INBOX.get(this.env.INBOX.idFromName(`${roomId}:${memberId}`)) as InboxNotifyStub;
    return stub.notify(payload);
  }

  private async noteTyping(memberId: string): Promise<void> {
    const typing = (await this.ctx.storage.get<Record<string, number>>("typing")) ?? {};
    typing[memberId] = Date.now();
    await this.ctx.storage.put("typing", typing);
  }

  private async senderKind(senderId: string): Promise<"human" | "agent"> {
    const row = await this.env.DB.prepare(`SELECT kind FROM members WHERE id = ?`)
      .bind(senderId)
      .first<{ kind: string }>();
    return row?.kind === "agent" ? "agent" : "human";
  }

  private fanoutPayload(
    row: MessageRow,
    senderKind: "human" | "agent",
    memberId: string,
  ): InboxNotifyPayload {
    return {
      id: row.id,
      room_id: row.room_id,
      seq: row.seq,
      kind: row.kind,
      body: row.body,
      sender_id: row.sender_id,
      origin: row.origin,
      member_id: memberId,
      mentions: parseMentionIds(row.mentions_json),
      sender_kind: senderKind,
      thread_id: row.thread_id,
      created_at: row.created_at,
    };
  }

  private async fanoutToAgents(
    roomId: string,
    row: MessageRow,
    senderKind: "human" | "agent",
  ): Promise<void> {
    if (row.kind !== "message" && row.kind !== "trace") return;
    const ids = await this.listAgentIds(roomId);
    const batches = chunks(ids, FANOUT_CHUNK);
    this.lastFanoutBatchSizes = batches.map((b) => b.length);
    await this.ctx.storage.put("last_fanout_batches", this.lastFanoutBatchSizes);
    if (batches.length === 0) return;

    const sendChunk = (chunk: readonly string[]) =>
      Promise.all(chunk.map((id) => this.inboxNotify(roomId, id, this.fanoutPayload(row, senderKind, id))));

    await sendChunk(batches[0]!);
    const remaining = batches.slice(1);
    if (remaining.length === 0) return;
    const flushRest = (async () => {
      for (const chunk of remaining) {
        await sendChunk(chunk);
      }
    })();
    // Remaining batches use waitUntil so the WS/HTTP response is not blocked; each batch still ≤ 6.
    if (typeof this.ctx.waitUntil === "function") {
      this.ctx.waitUntil(flushRest);
    } else {
      await flushRest;
    }
  }

  private async insertMessage(row: MessageRow): Promise<void> {
    const stmt = this.env.DB.prepare(
      `INSERT INTO messages (
         id, room_id, seq, kind, thread_id, reply_to, sender_id, body,
         mentions_json, generation_id, client_message_id, origin, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      row.room_id,
      row.seq,
      row.kind,
      row.thread_id,
      row.reply_to,
      row.sender_id,
      row.body,
      row.mentions_json,
      row.generation_id,
      row.client_message_id,
      row.origin,
      row.created_at,
    );
    await stmt.run();
    if (this.d1TimeoutOnce) {
      this.d1TimeoutOnce = false;
      throw new Error("D1 timeout unknown");
    }
  }

  private async lookupByClientId(
    roomId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<MessageRow | null> {
    return this.env.DB.prepare(
      `SELECT id, room_id, seq, kind, thread_id, reply_to, sender_id, body,
              mentions_json, generation_id, client_message_id, origin, created_at
       FROM messages WHERE room_id = ? AND sender_id = ? AND client_message_id = ?`,
    )
      .bind(roomId, senderId, clientMessageId)
      .first<MessageRow>();
  }

  private async mentionIds(roomId: string, body: string): Promise<string[]> {
    const result = await this.env.DB.prepare(
      `SELECT m.id, m.handle FROM room_members rm JOIN members m ON m.id = rm.member_id WHERE rm.room_id = ?`,
    )
      .bind(roomId)
      .all<{ id: string; handle: string }>();
    const rows = result.results ?? [];
    const handles = rows.map((r) => r.handle);
    const mentioned = tokenizeMentions(body, handles);
    const wanted = new Set(mentioned);
    return rows.filter((r) => wanted.has(r.handle.toLowerCase())).map((r) => r.id);
  }

  private sockets(): WebSocket[] {
    if (typeof this.ctx.getWebSockets === "function") return this.ctx.getWebSockets();
    return [];
  }

  private broadcastEvent(row: MessageRow): void {
    const payload = JSON.stringify({ v: 1, type: "event", event: this.publicRow(row) });
    for (const ws of this.sockets()) {
      try {
        ws.send(payload);
      } catch {
        /* drop closed */
      }
    }
  }

  private broadcastStatus(memberId: string, body: string): void {
    const payload = JSON.stringify({ v: 1, type: "status", member_id: memberId, body });
    for (const ws of this.sockets()) {
      try {
        ws.send(payload);
      } catch {
        /* drop closed */
      }
    }
  }

  private sendEvent(ws: WebSocket, row: MessageRow): void {
    try {
      ws.send(JSON.stringify({ v: 1, type: "event", event: this.publicRow(row) }));
    } catch {
      /* drop */
    }
  }

  private sendError(ws: WebSocket, code: string): void {
    try {
      ws.send(JSON.stringify({ v: 1, type: "error", code }));
    } catch {
      /* drop */
    }
  }

  private publicRow(row: MessageRow) {
    return {
      id: row.id,
      room_id: row.room_id,
      seq: row.seq,
      kind: row.kind,
      body: row.body,
      sender_id: row.sender_id,
      thread_id: row.thread_id,
      generation_id: row.generation_id,
      client_message_id: row.client_message_id,
      origin: row.origin,
      created_at: row.created_at,
    };
  }
}

function parseMentionIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function parseSendKind(value: unknown): "message" | "trace" | null {
  if (value === undefined) return "message";
  if (value === "message" || value === "trace") return value;
  return null;
}
