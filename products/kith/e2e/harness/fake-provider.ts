/**
 * E2E fake LLM provider (W4 §5.1.1, extended in W5 §5.1.1). One HTTP server, four dialects:
 *   /openai/v1/*      openai_chat (chat/completions) and openai_responses (responses); GET models
 *   /anthropic/v1/*   anthropic_messages; GET models
 *   /google/v1beta/*  gemini generateContent / streamGenerateContent?alt=sse; GET models
 * The only accepted key is the per-run canary. Directives in the prompt use the worker fake's grammar
 * (W3 §4.2.1) plus W5's streaming controls: [[fake:text=…;delay_ms=…;status=…;chunks=…;chunk_ms=…;cut_after=…]].
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeFormat = "openai_chat" | "openai_responses" | "anthropic_messages" | "gemini";
export type FakeProviderLogEntry = { at: string; format: FakeFormat; path: string; model: string | null; auth_ok: boolean; status: number; stream: boolean };
export type FakeProvider = { url: string; log: FakeProviderLogEntry[]; close(): Promise<void> };

const MODELS: Record<"openai" | "anthropic" | "google", string[]> = {
  openai: ["fake-chat", "fake-chat-mini"],
  anthropic: ["fake-claude", "fake-claude-haiku"],
  google: ["fake-gemini", "fake-gemini-flash"],
};

type Directive = { text?: string; delay_ms?: number; status?: number; chunks?: number; chunk_ms?: number; cut_after?: number };

export function parseDirective(source: string): Directive {
  const match = /\[\[fake:([^\]]*)\]\]/.exec(source);
  if (!match) return {};
  const out: Directive = {};
  for (const part of match[1]!.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      continue;
    }
    const n = Number(value);
    const int = (lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
    if (name === "text") out.text = value;
    else if (name === "delay_ms" && int(0, 30_000)) out.delay_ms = n;
    else if (name === "status" && int(400, 599)) out.status = n;
    else if (name === "chunks" && int(1, 200)) out.chunks = n;
    else if (name === "chunk_ms" && int(0, 5_000)) out.chunk_ms = n;
    else if (name === "cut_after" && int(0, 200)) out.cut_after = n;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function split(text: string, n: number): string[] {
  const chars = [...text];
  const size = Math.max(1, Math.ceil(chars.length / n));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.length > 0 ? out : [""];
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function promptOf(format: FakeFormat, body: Record<string, unknown>): string {
  if (format === "openai_responses") return typeof body.input === "string" ? body.input : "";
  if (format === "gemini") {
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const parts = (contents.at(-1) as { parts?: Array<{ text?: unknown }> } | undefined)?.parts ?? [];
    return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const users = messages.filter((m) => m && typeof m === "object" && (m as { role?: unknown }).role === "user");
  const content = (users.at(-1) as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : "";
}

function errorBody(format: FakeFormat, status: number): Record<string, unknown> {
  if (format === "anthropic_messages") {
    const type = status === 401 ? "authentication_error" : status === 404 ? "not_found_error" : status === 429 ? "rate_limit_error"
      : status === 529 ? "overloaded_error" : status === 400 ? "invalid_request_error" : "api_error";
    return { type: "error", error: { type, message: `fake ${status}` }, request_id: null };
  }
  if (format === "gemini") {
    const s = status === 401 ? "UNAUTHENTICATED" : status === 404 ? "NOT_FOUND" : status === 429 ? "RESOURCE_EXHAUSTED"
      : status === 503 ? "UNAVAILABLE" : status === 400 ? "INVALID_ARGUMENT" : "INTERNAL";
    return { error: { code: status, message: `fake ${status}`, status: s } };
  }
  return { error: { message: `fake ${status}`, type: "fake_error", param: null, code: null } };
}

/** Whole non-streamed reply in the dialect's shape. */
function fullReply(format: FakeFormat, model: string, text: string): Record<string, unknown> {
  switch (format) {
    case "openai_chat":
      return { id: "chatcmpl-fake", object: "chat.completion", created: 0, model,
        choices: [{ index: 0, message: { role: "assistant", content: text, refusal: null }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } };
    case "openai_responses":
      return responseObject(model, text);
    case "anthropic_messages":
      return { id: "msg_fake", type: "message", role: "assistant", model, content: [{ type: "text", text }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 11, output_tokens: 3 } };
    case "gemini":
      return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 } };
  }
}

function responseObject(model: string, text: string): Record<string, unknown> {
  return { id: "resp_fake", object: "response", status: "completed", model,
    output: [{ type: "message", id: "msg_fake", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 } };
}

/** SSE frames: [event name | null, data][] — pieces first, then the dialect's terminal frames. */
function streamFrames(format: FakeFormat, model: string, pieces: string[], full: string): { body: Array<[string | null, string]>; tail: Array<[string | null, string]> } {
  const j = (o: unknown) => JSON.stringify(o);
  switch (format) {
    case "openai_chat":
      return {
        body: pieces.map((p) => [null, j({ id: "c", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })]),
        tail: [[null, j({ id: "c", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })], [null, "[DONE]"]],
      };
    case "openai_responses":
      return {
        body: pieces.map((p) => ["response.output_text.delta", j({ type: "response.output_text.delta", item_id: "msg_fake", output_index: 0, content_index: 0, delta: p, sequence_number: 1 })]),
        tail: [["response.completed", j({ type: "response.completed", sequence_number: 2, response: responseObject(model, full) })]],
      };
    case "anthropic_messages":
      return {
        body: [
          ["message_start", j({ type: "message_start", message: { id: "msg_fake", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 11, output_tokens: 1 } } })],
          ...pieces.map((p): [string, string] => ["content_block_delta", j({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } })]),
        ],
        tail: [
          ["message_delta", j({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } })],
          ["message_stop", j({ type: "message_stop" })],
        ],
      };
    case "gemini":
      return {
        body: pieces.slice(0, -1).map((p) => [null, j({ candidates: [{ content: { role: "model", parts: [{ text: p }] }, index: 0 }] })]),
        tail: [[null, j({ candidates: [{ content: { role: "model", parts: [{ text: pieces.at(-1) ?? "" }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 } })]],
      };
  }
}

function route(method: string, path: string): { format: FakeFormat; kind: "models" | "complete"; family: keyof typeof MODELS; model?: string; stream?: boolean } | null {
  if (method === "GET" && path === "/openai/v1/models") return { format: "openai_chat", kind: "models", family: "openai" };
  if (method === "GET" && path === "/anthropic/v1/models") return { format: "anthropic_messages", kind: "models", family: "anthropic" };
  if (method === "GET" && path === "/google/v1beta/models") return { format: "gemini", kind: "models", family: "google" };
  if (method !== "POST") return null;
  if (path === "/openai/v1/chat/completions") return { format: "openai_chat", kind: "complete", family: "openai" };
  if (path === "/openai/v1/responses") return { format: "openai_responses", kind: "complete", family: "openai" };
  if (path === "/anthropic/v1/messages") return { format: "anthropic_messages", kind: "complete", family: "anthropic" };
  const g = /^\/google\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(path);
  if (g) return { format: "gemini", kind: "complete", family: "google", model: decodeURIComponent(g[1]!), stream: g[2] === "streamGenerateContent" };
  return null;
}

function authOk(format: FakeFormat, req: IncomingMessage, key: string): boolean {
  if (format === "anthropic_messages") return req.headers["x-api-key"] === key && req.headers["anthropic-version"] === "2023-06-01";
  if (format === "gemini") return req.headers["x-goog-api-key"] === key;
  return req.headers.authorization === `Bearer ${key}`;
}

export async function startFakeProvider(key: string, port = 0): Promise<FakeProvider> {
  const log: FakeProviderLogEntry[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(log)); // no secrets in the log
      return;
    }
    const r = route(req.method ?? "GET", url.pathname);
    const format: FakeFormat = r?.format ?? (url.pathname.startsWith("/anthropic/") ? "anthropic_messages" : url.pathname.startsWith("/google/") ? "gemini" : "openai_chat");
    const entry: FakeProviderLogEntry = { at: new Date().toISOString(), format, path: url.pathname, model: null, auth_ok: authOk(format, req, key), status: 200, stream: false };
    log.push(entry);
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (!entry.auth_ok) return reply(401, errorBody(format, 401));
    if (!r) return reply(404, errorBody(format, 404));
    if (r.kind === "models") {
      const ids = MODELS[r.family];
      if (r.family === "openai") return reply(200, { object: "list", data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "fake" })) });
      if (r.family === "anthropic") return reply(200, { data: ids.map((id) => ({ id, type: "model", display_name: id, created_at: "2026-01-01T00:00:00Z" })), has_more: false, first_id: ids[0], last_id: ids.at(-1) });
      return reply(200, { models: ids.map((id) => ({ name: `models/${id}`, displayName: id })) });
    }
    const body = await readBody(req);
    const model = r.model ?? (typeof body.model === "string" ? body.model : "");
    entry.model = model;
    if (!MODELS[r.family].includes(model)) return reply(404, errorBody(format, 404));
    if ("tools" in body) return reply(400, errorBody(format, 400)); // RT-05
    const stream = r.format === "gemini" ? r.stream === true && url.searchParams.get("alt") === "sse" : body.stream === true;
    entry.stream = stream;
    const d = parseDirective(promptOf(format, body));
    // W4 E2E-W4-02: no delay_ms still waits 500ms so "is replying" stays visible. Explicit 0 does not wait.
    const pause = d.delay_ms ?? 500;
    if (pause > 0) await sleep(pause);
    if (d.status) return reply(d.status, errorBody(format, d.status), d.status === 429 ? { "retry-after": "0" } : {});
    const text = d.text ?? `hello from ${model}`;
    if (!stream) return reply(200, fullReply(format, model, text));
    const frames = streamFrames(format, model, split(text, d.chunks ?? 4), text);
    entry.status = 200;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const write = ([event, data]: [string | null, string]) => res.write(`${event ? `event: ${event}\n` : ""}data: ${data}\n\n`);
    let sent = 0;
    for (const frame of frames.body) {
      if (d.cut_after !== undefined && sent >= d.cut_after) {
        res.socket?.destroy(); // FM-LLM-08: connection drops before any terminal frame
        return;
      }
      write(frame);
      sent++;
      await sleep(d.chunk_ms ?? 150);
    }
    if (d.cut_after !== undefined) {
      res.socket?.destroy();
      return;
    }
    for (const frame of frames.tail) write(frame);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  return { url: `http://127.0.0.1:${actual}`, log, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fp = await startFakeProvider(process.env.FAKE_PROVIDER_KEY ?? "sk-fake", Number(process.env.FAKE_PROVIDER_PORT ?? 0));
  process.stdout.write(`${fp.url}\n`);
}
