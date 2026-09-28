// Loopback demo Worker (S0 mock chain, docs/S0-MOCK-CHAIN.md). Input is validated with the M0
// strict JSON profile and telemetry parser; persistence is the M0 SqlDatabase port (D1 in workerd,
// node:sqlite in local tests). Identity is a plaintext mock: this Worker refuses to serve unless
// MODE=demo AND the request URL is loopback. There is no live mode.

import { D1Database, type D1DatabaseLike } from "./adapters/d1/d1Database.ts";
import type { SqlDatabase } from "./adapters/sql/sqlDatabase.ts";
import { sha256, toHex } from "./domain/contract/bytes.ts";
import { formatUtcSeconds, parseUtcSeconds } from "./domain/contract/fields.ts";
import { isJsonObject, parseStrictJson, type JsonObject } from "./domain/contract/strictJson.ts";
import { parseTelemetryReport, TELEMETRY_MAX_BYTES } from "./domain/contract/telemetry.ts";
import { DEMO_NODE, DemoStore, WORKSPACE } from "./demo/demoStore.ts";
import { fromContract, HttpError, requireThat } from "./demo/http.ts";

export interface DemoEnv {
  db: SqlDatabase;
  mode?: string | undefined;
}

const SMALL_BODY = 4 * 1024;
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
const DEV_UI_ORIGIN = "http://127.0.0.1:5173";

async function body(req: Request, max: number): Promise<Uint8Array> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    throw new HttpError(415, "json_required", "Content-Type must be application/json");
  }
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new HttpError(413, "payload_too_large", `Maximum body is ${max} bytes`);
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "empty_body", "JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, "payload_too_large", `Maximum body is ${max} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}

/** Small demo control bodies: strict JSON, exactly the listed keys. */
async function fields(req: Request, keys: string[]): Promise<JsonObject> {
  let doc;
  try {
    doc = parseStrictJson(await body(req, SMALL_BODY), SMALL_BODY);
  } catch (err) {
    throw fromContract(err);
  }
  requireThat(isJsonObject(doc), "Expected an object");
  requireThat(Object.keys(doc).length === keys.length && keys.every((k) => Object.hasOwn(doc, k)), "Missing or unknown fields");
  return doc;
}

function human(req: Request, operator = false): string {
  // Deliberately fake identity adapter, reachable only in the explicit loopback demo.
  const role = req.headers.get("x-edge-demo-role");
  if (!["viewer", "operator", "outsider"].includes(role ?? "")) throw new HttpError(401, "demo_identity_required", "Select a mock identity");
  if (operator && role !== "operator") throw new HttpError(403, "forbidden", "Mock operator role required");
  return role === "outsider" ? "ws_other" : WORKSPACE;
}

function machine(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const id = header.replace(/^Demo /, "");
  if (header !== `Demo ${id}` || !DEMO_NODE.test(id)) throw new HttpError(401, "demo_agent_required", "Synthetic Agent identity required");
  return id;
}

function utcSeconds(value: string): number {
  const t = parseUtcSeconds(value);
  requireThat(t !== null, "Use UTC RFC 3339 timestamps (YYYY-MM-DDTHH:MM:SSZ)");
  return t;
}

export async function handle(req: Request, env: DemoEnv, clock: () => number = Date.now): Promise<Response> {
  const request_id = crypto.randomUUID();
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": request_id, "x-content-type-options": "nosniff" };
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, request_id }), { status, headers });
  try {
    const url = new URL(req.url);
    const p = url.pathname;
    const method = req.method;
    if (env.mode !== "demo" || !LOOPBACK.includes(url.hostname)) {
      throw new HttpError(503, "demo_disabled", "Only explicit loopback demo mode is implemented; live mode is unavailable");
    }
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin && origin !== DEV_UI_ORIGIN) throw new HttpError(403, "cross_origin_denied", "Same-origin demo access only");
    const store = new DemoStore(env.db);

    if (method === "GET" && p === "/healthz") return ok({ mode: "demo", auth: "mock-loopback-only", ready: true });

    if (method === "POST" && p === "/agent/v1/enroll") {
      const id = machine(req);
      const b = await fields(req, ["node_id", "display_name"]);
      requireThat(typeof b.node_id === "string" && DEMO_NODE.test(b.node_id), "Only synthetic node_demo01..10 are allowed");
      if (b.node_id !== id) throw new HttpError(403, "node_mismatch", "Agent cannot enroll another node");
      const name = b.display_name;
      requireThat(typeof name === "string" && name.length >= 1 && name.length <= 60 && !/[\u0000-\u001f]/.test(name), "Invalid display name");
      await store.enroll(id, name, await store.now(clock));
      return ok({ node_id: id, enrollment_generation: 1, auth: "mock-loopback-only" }, 201);
    }

    if (method === "POST" && p === "/agent/v1/telemetry") {
      const id = machine(req);
      const bytes = await body(req, TELEMETRY_MAX_BYTES);
      let report;
      try {
        report = parseTelemetryReport(bytes);
      } catch (err) {
        throw fromContract(err);
      }
      if (report.node_id !== id) throw new HttpError(403, "node_mismatch", "Agent cannot report another node");
      const payload = new TextDecoder().decode(bytes);
      return ok(await store.ingest(report, payload, toHex(await sha256(bytes)), await store.now(clock)));
    }

    if (p.startsWith("/agent/")) throw new HttpError(501, "capability_not_implemented", "No job, command, log, or bootstrap channel exists");

    if (method === "POST" && p === "/demo/v1/reset") {
      human(req, true);
      const b = await fields(req, ["confirm"]);
      // The exact phrase stops accidental calls from ordinary read clients; the reset is one batch.
      requireThat(b.confirm === "RESET_SYNTHETIC_DATA", "Explicit synthetic reset confirmation required");
      await store.reset();
      return ok({ reset: true });
    }

    if (method === "POST" && p === "/demo/v1/clock") {
      human(req, true);
      const b = await fields(req, ["advance_seconds"]);
      const s = b.advance_seconds;
      requireThat(typeof s === "number" && Number.isInteger(s) && s > 0 && s <= 3600, "Advance must be 1..3600 seconds");
      await store.advance(s);
      return ok({ server_time: formatUtcSeconds(await store.now(clock)) });
    }

    const workspace = human(req);
    const now = await store.now(clock);
    if (method === "GET" && p === "/api/v1/nodes") {
      requireThat([...url.searchParams].length === 0, "Unexpected query parameters");
      return ok({
        mode: "demo",
        auth: "mock-loopback-only",
        transport: "http-poll",
        server_time: formatUtcSeconds(now),
        nodes: await store.list(now, workspace),
        capabilities: { telemetry: true, logs: false, jobs: false, bootstrap: false },
      });
    }

    const match = p.match(/^\/api\/v1\/nodes\/(node_demo(?:0[1-9]|10))(\/metrics)?$/);
    if (method === "GET" && match) {
      const row = await store.row(match[1]!, workspace);
      if (!match[2]) return ok(await store.view(row, now));
      const q = url.searchParams;
      requireThat([...q.keys()].every((k) => ["from", "to", "limit"].includes(k)) && ["from", "to", "limit"].every((k) => q.getAll(k).length <= 1), "Unexpected or duplicate query parameter");
      const from = q.has("from") ? utcSeconds(q.get("from")!) : now - 3600;
      const to = q.has("to") ? utcSeconds(q.get("to")!) : now;
      const limit = Number(q.get("limit") ?? "120");
      requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 240, "limit must be 1..240");
      requireThat(from <= to && to - from <= 7 * 86400, "History range must be ordered and at most 7 days");
      return ok({ node_id: row.id, from: formatUtcSeconds(from), to: formatUtcSeconds(to), ...(await store.history(row.id, from, to, limit)) });
    }

    if (["/jobs", "/logs", "/recipes", "/bootstrap"].some((x) => p.includes(x))) {
      throw new HttpError(501, "capability_not_implemented", "This slice supports telemetry only");
    }
    throw new HttpError(404, "not_found", "Route not found");
  } catch (e) {
    const error = e instanceof HttpError ? e : new HttpError(503, "storage_unavailable", "Backend unavailable; no success receipt issued");
    return new Response(JSON.stringify({ code: error.code, message: error.message, retryable: error.status === 503, request_id }), { status: error.status, headers });
  }
}

export interface Env {
  DB: D1DatabaseLike;
  MODE?: string;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, { db: new D1Database(env.DB), mode: env.MODE });
  },
};
