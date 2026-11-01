import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { invalid, requireOperator } from "../auth.ts";
import type { Env } from "../env.ts";
import { errorBody } from "../errors.ts";
import { extraKeys, parseObject, utf8Bytes } from "../json.ts";
import { isExportEndpoint, mountReadingRoutes, requireExportCaller } from "./reading.ts";

type AppEnv = { Bindings: Env };
type Capture = { id: string; body: string; source: "web"; created_at: string; exported_commit: string | null };
type Cursor = { created_at: string; id: string };
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const COLUMNS = "id, body, source, created_at, exported_commit";

export function isReadingCapturePath(path: string): boolean {
  return ["/api/captures", "/api/notes", "/api/reading", "/api/reading-export"].some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

function validBody(body: unknown): body is string {
  if (typeof body !== "string" || body.includes("\0") || utf8Bytes(body) < 1 || utf8Bytes(body) > 16384) return false;
  // TextEncoder replaces isolated UTF-16 surrogates. Reject them rather than silently changing raw input.
  for (const character of body) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

function readCursor(value: string): Cursor | null {
  if (value.length < 1 || value.length > 512 || !/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  try {
    const obj = parseObject(atob(value));
    if (!obj || extraKeys(obj, ["created_at", "id"]).length || typeof obj.id !== "string" || !ID.test(obj.id)) return null;
    const date = obj.created_at;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)) return null;
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) return null;
    return { created_at: date, id: obj.id };
  } catch { return null; }
}

/** Boundaries accept injected clock/IDs; no provider, room, message or Runner dependency. */
export function mountReadingCaptureRoutes(app: Hono<AppEnv>, options: { now: () => string; id: () => string } = {
  now: () => new Date().toISOString(), id: () => crypto.randomUUID(),
}): void {
  app.use("/api/*", async (c, next) => {
    if (!isReadingCapturePath(c.req.path)) return next();
    if (isExportEndpoint(c.req.method,c.req.path)) {
      const denied = await requireExportCaller(c);
      if (denied) return denied;
      return next();
    }
    const auth = await requireOperator(c);
    if (auth instanceof Response) return auth;
    await next();
  });
  // JSON escaping can expand a valid 16 KiB string sixfold. The transport bound still rejects huge input.
  app.use("/api/captures", bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.json(errorBody("body_too_large", "request body too large"), 413) }));

  app.post("/api/captures", async (c) => {
    const obj = parseObject(await c.req.text());
    if (!obj || extraKeys(obj, ["body", "client_key"]).length || !validBody(obj.body) || typeof obj.client_key !== "string" || !ID.test(obj.client_key)) {
      return invalid(c, "expected body (1–16384 UTF-8 bytes) and a safe client_key (1–128 characters)");
    }
    // D1 batch is transactional; the UNIQUE constraint arbitrates concurrent requests, including a lost response.
    const results = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO captures(id, body, client_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_key) DO NOTHING")
        .bind(options.id(), obj.body, obj.client_key, options.now()),
      c.env.DB.prepare("SELECT id, body FROM captures WHERE client_key = ?").bind(obj.client_key),
    ]);
    const row = results[1]?.results[0] as { id: string; body: string } | undefined;
    if (!row) return c.json(errorBody("unavailable", "save result unavailable; retry with the same key"), 503);
    if (row.body !== obj.body) return c.json(errorBody("capture_conflict", "this key already belongs to a different capture"), 409);
    return c.json({ capture_id: row.id }, results[0]!.meta.changes === 1 ? 201 : 200);
  });

  app.get("/api/captures", async (c) => {
    const query = new URL(c.req.url).searchParams;
    if ([...query.keys()].some((key) => !["limit", "cursor"].includes(key) || query.getAll(key).length !== 1)) return invalid(c, "invalid pagination query");
    const rawLimit = query.get("limit") ?? "20";
    if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) return invalid(c, "limit must be 1–100");
    const limit = Number(rawLimit);
    const rawCursor = query.get("cursor");
    const cursor = rawCursor === null ? null : readCursor(rawCursor);
    if (rawCursor !== null && !cursor) return invalid(c, "invalid cursor");
    const statement = cursor
      ? c.env.DB.prepare(`SELECT ${COLUMNS} FROM captures WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).bind(cursor.created_at, cursor.id, limit + 1)
      : c.env.DB.prepare(`SELECT ${COLUMNS} FROM captures ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit + 1);
    const result = await statement.all<Capture>();
    const captures = result.results.slice(0, limit);
    const last = captures.at(-1);
    const next = result.results.length > limit && last ? btoa(JSON.stringify({ created_at: last.created_at, id: last.id })) : null;
    return c.json({ captures, next_cursor: next });
  });

  mountReadingRoutes(app,options,validBody);
}
