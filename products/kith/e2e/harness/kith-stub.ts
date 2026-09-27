/**
 * Scripted Kith for E2E-W6-04 test 2 only (W6 §5.1.3, §7.4).
 * First GET /mcp/events sends live seq 11 then `: gap` and closes.
 * Later connections record after_seq, send replay seq 11, live seq 12, and live seq 12 again, then stay open.
 * Bearer must be canaryBotToken(). The token is never written to a log.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { canaryBotToken } from "../fixtures/accounts.ts";

export type McpCall = { name: string; args: Record<string, unknown> };

export type KithStub = {
  url: string;
  /** `after_seq` values in the order GET /mcp/events arrived. */
  afterSeq: number[];
  mcpCalls: McpCall[];
  close(): Promise<void>;
};

const TOKEN = canaryBotToken();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function message(seq: number, text: string, replay: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    replay,
    seq,
    kind: "message",
    id: `m${seq}`,
    room_id: "r1",
    thread_id: null,
    sender_id: "m-other",
    body: `@stubby [[cli:text=${encodeURIComponent(text)}]]`,
    mentions: ["stubby"],
  };
  if (!replay) row.wake = { mentioned: true, wake_allowed: true };
  return row;
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function startKithStub(): Promise<KithStub> {
  const afterSeq: number[] = [];
  const mcpCalls: McpCall[] = [];
  const hanging: ServerResponse[] = [];
  const sockets = new Set<Socket>();
  let eventsSeen = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!authorized(req)) {
      if (req.method === "POST") await rawBody(req);
      json(res, 401, { error: { code: "unauthorized", message: "bot token rejected" } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      json(res, 200, { id: "a1", handle: "stubby" });
      return;
    }
    if (req.method === "GET" && /^\/api\/rooms\/[^/]+\/messages$/.test(url.pathname)) {
      json(res, 200, { messages: [{ seq: 10, id: "m10", kind: "message", body: "seed", sender_id: "m-other", thread_id: null }] });
      return;
    }
    if (req.method === "GET" && url.pathname === "/mcp/events") {
      const raw = url.searchParams.get("after_seq");
      afterSeq.push(raw === null ? Number.NaN : Number(raw));
      eventsSeen += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (eventsSeen === 1) {
        res.write(frame(message(11, "ok11", false)));
        res.write(": gap\n\n");
        res.end();
        return;
      }
      res.write(frame(message(11, "ok11", true)));
      res.write(frame(message(12, "ok12", false)));
      res.write(frame(message(12, "ok12", false)));
      hanging.push(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      let parsed: { id?: unknown; params?: { name?: unknown; arguments?: unknown } } = {};
      try {
        const value: unknown = JSON.parse(await rawBody(req));
        if (value && typeof value === "object") parsed = value as typeof parsed;
      } catch {
        parsed = {};
      }
      const params = parsed.params;
      const name = params && typeof params.name === "string" ? params.name : "";
      const argsValue = params?.arguments;
      const args = argsValue && typeof argsValue === "object" && !Array.isArray(argsValue) ? (argsValue as Record<string, unknown>) : {};
      mcpCalls.push({ name, args });
      const text = name === "list_rooms" ? JSON.stringify({ rooms: [] }) : "{}";
      json(res, 200, { jsonrpc: "2.0", id: parsed.id ?? 1, result: { content: [{ type: "text", text }] } });
      return;
    }
    const trace = /^\/api\/rooms\/([^/]+)\/traces$/.exec(url.pathname);
    if (req.method === "POST" && trace) {
      await rawBody(req);
      json(res, 200, { message_id: "t-stub", seq: 0, full_stored: true });
      return;
    }
    if (req.method === "POST") await rawBody(req);
    json(res, 404, { error: { code: "not_found", message: "stub has no such route" } });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("kith stub failed to listen"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        afterSeq,
        mcpCalls,
        async close(): Promise<void> {
          for (const res of hanging) {
            if (!res.writableEnded) res.end();
          }
          hanging.length = 0;
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
  });
}

/** Resolves once `name` has been recorded `count` times, or rejects at `timeoutMs`. */
export async function waitForMcp(stub: KithStub, name: string, count: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const seen = (): number => stub.mcpCalls.filter((call) => call.name === name).length;
  while (seen() < count && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  if (seen() < count) throw new Error(`timed out waiting for ${count} ${name} (saw ${seen()})`);
}
