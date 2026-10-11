import type { Context } from "hono";
import { spliceEvents, type SpliceRow } from "../src/splice.ts";
import { wakeHint, type WakeHint } from "../src/wake.ts";
import {
  authorizationBearer,
  forbidden,
  invalid,
  isRoomMember,
  requireAuth,
  unauthorized,
} from "./auth.ts";
import { flagOn, type Env } from "./env.ts";
import { errorBody } from "./errors.ts";
import { utf8Bytes } from "./json.ts";
import type { InboxNotifyPayload } from "./inbox.ts";

type AppEnv = { Bindings: Env };

type InboxRpc = {
  liveAfter(cursorSeq: number): Promise<InboxNotifyPayload[]>;
  waitAfter(cursorSeq: number, waiterId?: string, timeoutMs?: number): Promise<InboxNotifyPayload[]>;
  cancelWait(waiterId: string): Promise<void>;
};

type EventRoomRpc = {
  admitEventStream(streamId: string): Promise<{ ok: boolean; code?: string }>;
  releaseEventStream(streamId: string): Promise<void>;
};

type MessageCatchup = {
  id: string;
  room_id: string;
  seq: number;
  kind: string;
  thread_id: string | null;
  reply_to: string | null;
  sender_id: string;
  body: string;
  mentions_json: string;
  generation_id: string | null;
  client_message_id: string;
  origin: string;
  created_at: string;
};

const SSE_DATA_MAX = 64 * 1024;
export const EVENT_STREAM_MAX_MS = 300_000;
export const EVENT_CATCHUP_MAX_PAGES = 20;
const EVENT_WAIT_MAX_MS = 30_000;

function inboxStub(env: Env, roomId: string, memberId: string): InboxRpc {
  return env.INBOX.get(env.INBOX.idFromName(`${roomId}:${memberId}`)) as unknown as InboxRpc;
}

function numericOrNull(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function sseDataJson(obj: Record<string, unknown>): string {
  let json = JSON.stringify(obj);
  if (utf8Bytes(json) <= SSE_DATA_MAX) return json;
  json = JSON.stringify({ ...obj, body: typeof obj.body === "string" ? obj.body.slice(0, 1024) : obj.body });
  if (utf8Bytes(json) <= SSE_DATA_MAX) return json;
  return JSON.stringify({ seq: obj.seq, kind: obj.kind, replay: obj.replay });
}

function formatEvent(event: string, id: number, data: Record<string, unknown>): string {
  return `id: ${id}\nevent: ${event}\ndata: ${sseDataJson(data)}\n\n`;
}

function catchupPayload(row: MessageCatchup): Record<string, unknown> {
  let mentions: unknown = [];
  try {
    mentions = JSON.parse(row.mentions_json);
  } catch {
    mentions = [];
  }
  return {
    id: row.id,
    room_id: row.room_id,
    seq: row.seq,
    kind: row.kind,
    thread_id: row.thread_id,
    reply_to: row.reply_to,
    sender_id: row.sender_id,
    body: row.body,
    mentions,
    generation_id: row.generation_id,
    client_message_id: row.client_message_id,
    origin: row.origin,
    created_at: row.created_at,
    replay: true,
  };
}

function livePayload(item: InboxNotifyPayload, wake: WakeHint | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    room_id: item.room_id,
    seq: item.seq,
    kind: item.kind,
    body: item.body,
    sender_id: item.sender_id,
    origin: item.origin,
    replay: false,
  };
  // B-12 (W6): additive fields; v1 clients ignore them. `wake` only on live messages, never on replay.
  if (item.thread_id !== undefined) out.thread_id = item.thread_id;
  if (Array.isArray(item.mentions)) out.mentions = item.mentions;
  if (wake) out.wake = wake;
  return out;
}

type WakePolicyRow = { attention_mode: string; keywords_json: string; quota_class: string; operator_id: string | null };

/** Current attention + quota for this agent in this room (re-read per batch: the operator may change it). */
async function loadWakePolicy(env: Env, roomId: string, memberId: string): Promise<WakePolicyRow | null> {
  return env.DB.prepare(
    `SELECT rm.attention_mode, rm.keywords_json, m.quota_class,
            (SELECT id FROM members WHERE is_operator = 1 AND disabled_at IS NULL LIMIT 1) AS operator_id
     FROM room_members rm JOIN members m ON m.id = rm.member_id
     WHERE rm.room_id = ? AND rm.member_id = ?`,
  )
    .bind(roomId, memberId)
    .first<WakePolicyRow>();
}

function hintFor(item: InboxNotifyPayload, self: string, policy: WakePolicyRow | null): WakeHint | null {
  if (!policy || item.kind !== "message" || item.origin !== "local") return null;
  let keywords: string[] = [];
  try {
    const parsed: unknown = JSON.parse(policy.keywords_json);
    if (Array.isArray(parsed)) keywords = parsed.filter((k): k is string => typeof k === "string");
  } catch {
    keywords = [];
  }
  const mode = ["silent", "mention", "keyword", "ambient"].includes(policy.attention_mode)
    ? (policy.attention_mode as "silent" | "mention" | "keyword" | "ambient")
    : "silent";
  return wakeHint({
    self,
    mode,
    keywords,
    quota_class: policy.quota_class === "operator_personal" ? "operator_personal" : "api_key",
    operator_member_id: policy.operator_id ?? "",
    sender_id: item.sender_id,
    sender_kind: item.sender_kind === "agent" ? "agent" : "human",
    mentions: Array.isArray(item.mentions) ? item.mentions : [],
    body: item.body,
  });
}

const RUNNER_SEEN_EVERY_MS = 60_000;

/** W6: a runner's event stream is its heartbeat (runtime_status runner_offline after 5 min without one). */
async function noteRunnerSeen(env: Env, memberId: string): Promise<void> {
  if (!flagOn(env.ff_providers)) return;
  try {
    await env.DB.prepare(`UPDATE agent_runtimes SET runner_last_seen_at = ? WHERE agent_id = ? AND runtime = 'runner'`)
      .bind(new Date().toISOString(), memberId)
      .run();
  } catch {
    /* table absent before migration 0003 */
  }
}

export async function handleMcpEvents(c: Context<AppEnv>): Promise<Response> {
  if (!flagOn(c.env.ff_mcp)) {
    return c.json(errorBody("not_ready", "MCP is not enabled"), 503);
  }
  if (authorizationBearer(c) == null) return unauthorized(c);
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  if (auth.via !== "bearer" || auth.member.kind !== "agent") return unauthorized(c);

  const url = new URL(c.req.url);
  const roomId = url.searchParams.get("room_id") ?? "";
  if (!roomId) return invalid(c, "room_id required");
  if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);

  const afterRaw = url.searchParams.get("after_seq");
  const afterSeq = afterRaw == null || afterRaw === "" ? 0 : Number(afterRaw);
  if (!Number.isFinite(afterSeq) || !Number.isInteger(afterSeq)) return invalid(c, "invalid after_seq");
  const lastEventId = numericOrNull(c.req.header("Last-Event-ID") ?? null);
  const initialCursor = lastEventId == null ? afterSeq : Math.max(afterSeq, lastEventId);

  const streamId = crypto.randomUUID();
  const room = c.env.ROOM.get(c.env.ROOM.idFromName(`room:${roomId}`)) as unknown as EventRoomRpc;
  try {
    if (!(await room.admitEventStream(streamId)).ok) return c.json(errorBody("event_stream_limit", "room event stream limit reached"), 429);
  } catch {
    return c.json(errorBody("not_ready", "event stream admission unavailable"), 503);
  }
  const inbox = inboxStub(c.env, roomId, auth.member.id);
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const requestSignal = c.req.raw.signal;
  const controller = new AbortController();
  const signal = controller.signal;
  const deadline = Date.now() + EVENT_STREAM_MAX_MS;
  const stop = () => controller.abort();
  const timer = setTimeout(stop, EVENT_STREAM_MAX_MS);
  requestSignal.addEventListener("abort", stop, { once: true });
  if (requestSignal.aborted) stop();
  // Reader cancellation rejects writer.closed even when the original request signal stays live.
  void writer.closed.catch(stop);
  const stopped = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("event stream ended", "AbortError")), { once: true });
  });
  void stopped.catch(() => {}); // expiry during cleanup must never become an unhandled rejection
  const bounded = async <T>(run: () => Promise<T>): Promise<T> => {
    if (signal.aborted || Date.now() >= deadline) throw new DOMException("event stream ended", "AbortError");
    // This bounds local waiting. An already-issued platform RPC can outlive the race.
    return Promise.race([run(), stopped]);
  };

  const write = async (chunk: string) => {
    await bounded(() => writer.write(encoder.encode(chunk)));
  };

  const run = async () => {
    let runnerSeenAt = Date.now();
    try {
      await bounded(() => noteRunnerSeen(c.env, auth.member.id));
      let cursor = initialCursor;
      for (let page = 0; page < EVENT_CATCHUP_MAX_PAGES; page++) {
        if (signal.aborted) break;
        const result = await bounded(() => c.env.DB.prepare(
          `SELECT id, room_id, seq, kind, thread_id, reply_to, sender_id, body, mentions_json,
                  generation_id, client_message_id, origin, created_at
           FROM messages
           WHERE room_id = ? AND seq > ? AND kind IN ('message', 'trace')
           ORDER BY seq ASC LIMIT 50`,
        )
          .bind(roomId, cursor)
          .all<MessageCatchup>());
        const rows = result.results ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
          await write(formatEvent("replay", row.seq, catchupPayload(row)));
          cursor = row.seq;
        }
        // Reconnect with the last emitted seq for the next bounded catch-up page group.
        if (rows.length === 50 && page === EVENT_CATCHUP_MAX_PAGES - 1) {
          await write(": catchup_limit\n\n");
          return;
        }
      }

      const emitLive = async (items: InboxNotifyPayload[]): Promise<boolean> => {
        const live: SpliceRow[] = items
          .filter((item) => item.seq > cursor)
          .map((item) => ({ seq: item.seq, kind: item.kind, body: item.body }));
        const spliced = spliceEvents({ d1_persisted: [], after_seq: cursor, live });
        if (spliced.gap) {
          await write(": gap\n\n");
          return true;
        }
        const bySeq = new Map(items.map((item) => [item.seq, item]));
        const policy = spliced.events.length > 0 ? await bounded(() => loadWakePolicy(c.env, roomId, auth.member.id)) : null;
        for (const ev of spliced.events) {
          const item = bySeq.get(ev.seq);
          if (!item) continue;
          await write(formatEvent("room", item.seq, livePayload(item, hintFor(item, auth.member.id, policy))));
          cursor = ev.seq;
        }
        return false;
      };

      const snapshot = await bounded(() => inbox.liveAfter(cursor));
      if (await emitLive(snapshot)) {
        return;
      }

      while (!signal.aborted) {
        if (Date.now() - runnerSeenAt >= RUNNER_SEEN_EVERY_MS) {
          await bounded(() => noteRunnerSeen(c.env, auth.member.id));
          runnerSeenAt = Date.now();
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const more = await bounded(() => inbox.waitAfter(cursor, streamId, Math.min(EVENT_WAIT_MAX_MS, remaining)));
        if (signal.aborted) break;
        if (more.length === 0) continue;
        if (await emitLive(more)) break;
      }
    } catch {
      /* client gone or write failed */
    } finally {
      // Attempt cleanup for request abort, body cancellation, time limit, gaps and catch-up limits alike.
      const cleanup = Promise.allSettled([
        Promise.resolve().then(() => inbox.cancelWait(streamId)),
        Promise.resolve().then(() => room.releaseEventStream(streamId)),
      ]);
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([cleanup, new Promise<void>((resolve) => { cleanupTimer = setTimeout(resolve, 2_000); })]);
      } finally { clearTimeout(cleanupTimer); }
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const closed = signal.aborted
          ? writer.abort(new DOMException("event stream ended", "AbortError"))
          : writer.close();
        // Keep the original expiry active during graceful close; also bound an uncooperative stream sink.
        await Promise.race([closed, new Promise<void>((resolve) => {
          closeTimer = setTimeout(() => {
            stop();
            void writer.abort(new DOMException("event stream ended", "AbortError")).catch(() => {});
            resolve();
          }, Math.min(2_000, Math.max(0, deadline - Date.now())));
        })]);
      } catch {
        /* already closed */
      } finally {
        clearTimeout(closeTimer);
        clearTimeout(timer);
        requestSignal.removeEventListener("abort", stop);
      }
    }
  };

  void run();
  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
