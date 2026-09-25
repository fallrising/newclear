/**
 * E2E fake LLM provider (W4 §5.1). Speaks openai_chat under /openai/v1 and anthropic_messages under /anthropic.
 * The expected key is FAKE_PROVIDER_KEY (the per-run canary). Directives in the prompt, same grammar as the
 * worker's v1 fake (W3 §4.2.1): [[fake:text=…;delay_ms=…;status=…]].
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeProviderLogEntry = { at: string; format: "openai_chat" | "anthropic_messages"; path: string; model: string | null; auth_ok: boolean; status: number };

export type FakeProvider = { url: string; log: FakeProviderLogEntry[]; close(): Promise<void> };

const OPENAI_MODELS = ["fake-chat", "fake-chat-mini"];
const ANTHROPIC_MODELS = ["fake-claude", "fake-claude-haiku"];

type Directive = { text?: string; delay_ms?: number; status?: number };

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
    if (name === "text") out.text = value;
    else if (name === "delay_ms" && Number.isInteger(n) && n >= 0 && n <= 30_000) out.delay_ms = n;
    else if (name === "status" && Number.isInteger(n) && n >= 400 && n <= 599) out.status = n;
  }
  return out;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
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

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const users = messages.filter((m) => m && typeof m === "object" && (m as { role?: unknown }).role === "user");
  const content = (users.at(-1) as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : "";
}

function errorFor(format: FakeProviderLogEntry["format"], status: number): Record<string, unknown> {
  if (format === "anthropic_messages") {
    const type = status === 401 ? "authentication_error" : status === 404 ? "not_found_error" : status === 429 ? "rate_limit_error"
      : status === 529 ? "overloaded_error" : status === 400 ? "invalid_request_error" : "api_error";
    return { type: "error", error: { type, message: `fake ${status}` }, request_id: null };
  }
  return { error: { message: `fake ${status}`, type: "fake_error", param: null, code: null } };
}

export async function startFakeProvider(key: string, port = 0): Promise<FakeProvider> {
  const log: FakeProviderLogEntry[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/__log") return send(res, 200, log); // no secrets in the log
    const format: FakeProviderLogEntry["format"] = url.pathname.startsWith("/anthropic/") ? "anthropic_messages" : "openai_chat";
    const authOk = format === "anthropic_messages"
      ? req.headers["x-api-key"] === key && req.headers["anthropic-version"] === "2023-06-01"
      : req.headers.authorization === `Bearer ${key}`;
    const entry: FakeProviderLogEntry = { at: new Date().toISOString(), format, path: url.pathname, model: null, auth_ok: authOk, status: 200 };
    log.push(entry);
    const reply = (status: number, body: unknown, headers?: Record<string, string>) => {
      entry.status = status;
      send(res, status, body, headers);
    };
    if (!authOk) return reply(401, errorFor(format, 401));
    if (req.method === "GET" && url.pathname === "/openai/v1/models") {
      return reply(200, { object: "list", data: OPENAI_MODELS.map((id) => ({ id, object: "model", created: 0, owned_by: "fake" })) });
    }
    if (req.method === "GET" && url.pathname === "/anthropic/v1/models") {
      return reply(200, { data: ANTHROPIC_MODELS.map((id) => ({ id, type: "model", display_name: id, created_at: "2026-01-01T00:00:00Z" })), has_more: false, first_id: ANTHROPIC_MODELS[0], last_id: ANTHROPIC_MODELS.at(-1) });
    }
    const isChat = req.method === "POST" && url.pathname === "/openai/v1/chat/completions";
    const isMessages = req.method === "POST" && url.pathname === "/anthropic/v1/messages";
    if (!isChat && !isMessages) return reply(404, errorFor(format, 404));
    const body = await readBody(req);
    const model = typeof body.model === "string" ? body.model : "";
    entry.model = model;
    const known = isChat ? OPENAI_MODELS : ANTHROPIC_MODELS;
    if (!known.includes(model)) return reply(404, errorFor(format, 404));
    if ("tools" in body) return reply(400, errorFor(format, 400)); // RT-05: hosted must not send tools
    const directive = parseDirective(lastUserText(body.messages));
    // Default pause keeps "is replying" on screen long enough for the e2e poll.
    const pause = directive.delay_ms ?? 500;
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    if (directive.status) {
      return reply(directive.status, errorFor(format, directive.status), directive.status === 429 ? { "retry-after": "0" } : {});
    }
    const text = directive.text ?? `hello from ${model}`;
    if (isChat) {
      return reply(200, { id: "chatcmpl-fake", object: "chat.completion", created: 0, model,
        choices: [{ index: 0, message: { role: "assistant", content: text, refusal: null }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } });
    }
    return reply(200, { id: "msg_fake", type: "message", role: "assistant", model, content: [{ type: "text", text }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 11, output_tokens: 3 } });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actual}`,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fp = await startFakeProvider(process.env.FAKE_PROVIDER_KEY ?? "sk-fake", Number(process.env.FAKE_PROVIDER_PORT ?? 0));
  process.stdout.write(`${fp.url}\n`);
}
