import type { Context } from "hono";
import { spliceEvents, type SpliceRow } from "../src/splice.ts";
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
  waitAfter(cursorSeq: number): Promise<InboxNotifyPayload[]>;
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

function livePayload(item: InboxNotifyPayload): Record<string, unknown> {
  return {
    id: item.id,
    room_id: item.room_id,
    seq: item.seq,
    kind: item.kind,
    body: item.body,
    sender_id: item.sender_id,
    origin: item.origin,
    replay: false,
  };
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

  const inbox = inboxStub(c.env, roomId, auth.member.id);
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const signal = c.req.raw.signal;

  const write = async (chunk: string) => {
    await writer.write(encoder.encode(chunk));
  };

  const run = async () => {
    try {
      let cursor = initialCursor;
      for (;;) {
        if (signal.aborted) break;
        const result = await c.env.DB.prepare(
          `SELECT id, room_id, seq, kind, thread_id, reply_to, sender_id, body, mentions_json,
                  generation_id, client_message_id, origin, created_at
           FROM messages
           WHERE room_id = ? AND seq > ? AND kind IN ('message', 'trace')
           ORDER BY seq ASC LIMIT 50`,
        )
          .bind(roomId, cursor)
          .all<MessageCatchup>();
        const rows = result.results ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
          await write(formatEvent("replay", row.seq, catchupPayload(row)));
          cursor = row.seq;
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
        for (const ev of spliced.events) {
          const item = bySeq.get(ev.seq);
          if (!item) continue;
          await write(formatEvent("room", item.seq, livePayload(item)));
          cursor = ev.seq;
        }
        return false;
      };

      const snapshot = await inbox.liveAfter(cursor);
      if (await emitLive(snapshot)) {
        await writer.close();
        return;
      }

      while (!signal.aborted) {
        const more = await inbox.waitAfter(cursor);
        if (signal.aborted) break;
        if (more.length === 0) continue;
        if (await emitLive(more)) break;
      }
    } catch {
      /* client gone or write failed */
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
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
