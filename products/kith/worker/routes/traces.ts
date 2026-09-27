import type { Hono } from "hono";
import { forbidden, invalid, isRoomMember, requireAuth, roomExists } from "../auth.ts";
import { INTERNAL_HEADER, INTERNAL_ORIGIN, MEMBER_HEADER, ROOM_HEADER, type Env } from "../env.ts";
import { errorBody } from "../errors.ts";
import { extraKeys, parseObject, utf8Bytes } from "../json.ts";

type AppEnv = { Bindings: Env };

export const TRACE_FULL_MAX_BYTES = 1024 * 1024; // 04 B-13
const TRACE_KEYS = ["client_message_id", "summary", "full", "thread_id"] as const;

function traceKey(roomId: string, messageId: string): string {
  return `traces/${roomId}/${messageId}`;
}

/**
 * B-13. POST stores a trace: the ≤ 2 KiB summary becomes a normal `kind=trace` message (same Room send path, same
 * seq, same idempotency by client_message_id); the full text (≤ 1 MiB) goes to R2 under the message id.
 * GET returns the full text to any room member. Without the TRACES binding only the summary is kept.
 */
export function mountTraceRoutes(app: Hono<AppEnv>): void {
  app.post("/api/rooms/:id/traces", async (c) => {
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    if (auth.member.kind !== "agent") return forbidden(c, "agents only");
    const roomId = c.req.param("id");
    if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
    if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
    const text = await c.req.text();
    if (utf8Bytes(text) > TRACE_FULL_MAX_BYTES + 16 * 1024) return c.json(errorBody("payload_too_large", "trace too large"), 400);
    const obj = parseObject(text);
    if (!obj) return invalid(c, "invalid json");
    if (extraKeys(obj, TRACE_KEYS).length > 0) return invalid(c, "unknown field");
    if (typeof obj.summary !== "string" || typeof obj.client_message_id !== "string") return invalid(c, "summary and client_message_id required");
    if (obj.full !== undefined && typeof obj.full !== "string") return invalid(c, "invalid full");
    if (obj.thread_id !== undefined && obj.thread_id !== null && typeof obj.thread_id !== "string") return invalid(c, "invalid thread_id");
    const full = typeof obj.full === "string" ? obj.full : null;
    if (full !== null && utf8Bytes(full) > TRACE_FULL_MAX_BYTES) return c.json(errorBody("payload_too_large", "full exceeds 1 MiB"), 400);

    const stub = c.env.ROOM.get(c.env.ROOM.idFromName(`room:${roomId}`));
    const res = await stub.fetch(
      new Request(`${INTERNAL_ORIGIN}/rooms/${roomId}/send?room_id=${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_HEADER]: "1", [MEMBER_HEADER]: auth.member.id, [ROOM_HEADER]: roomId },
        body: JSON.stringify({
          kind: "trace",
          body: obj.summary,
          client_message_id: obj.client_message_id,
          thread_id: typeof obj.thread_id === "string" ? obj.thread_id : null,
          generation_id: null,
        }),
      }),
    );
    if (!res.ok) return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
    const sent = (await res.json()) as { id?: string; seq?: number; message?: { id?: string; seq?: number } };
    const messageId = sent.message?.id ?? sent.id ?? "";
    const seq = sent.message?.seq ?? sent.seq ?? null;
    let fullStored = false;
    if (full !== null && c.env.TRACES && messageId) {
      try {
        await c.env.TRACES.put(traceKey(roomId, messageId), full, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
        fullStored = true;
      } catch {
        fullStored = false; // the summary is already in the room; the card shows "full text unavailable"
      }
    }
    return c.json({ message_id: messageId, seq, full_stored: fullStored });
  });

  app.get("/api/rooms/:id/traces/:message_id", async (c) => {
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const roomId = c.req.param("id");
    if (!(await roomExists(c.env, roomId))) return c.json(errorBody("not_found", "room not found"), 404);
    if (!(await isRoomMember(c.env, roomId, auth.member.id))) return forbidden(c);
    const messageId = c.req.param("message_id");
    const row = await c.env.DB.prepare(`SELECT id FROM messages WHERE id = ? AND room_id = ? AND kind = 'trace'`)
      .bind(messageId, roomId)
      .first<{ id: string }>();
    if (!row || !c.env.TRACES) return c.json(errorBody("not_found", "trace not found"), 404);
    const obj = await c.env.TRACES.get(traceKey(roomId, messageId));
    if (!obj) return c.json(errorBody("not_found", "trace not found"), 404);
    return c.json({ message_id: messageId, body: await obj.text() });
  });
}
