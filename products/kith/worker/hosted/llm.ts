import { DEFAULT_MODEL_ID, HOSTED_TOOL_ALLOWLIST, type ChatMessage } from "./prompt.ts";
import { readJsonObject } from "../providers/http.ts";

/** Official xAI only. No Anthropic, thinrouter, or loopback. */
export const XAI_BASE = "https://api.x.ai/v1";
export const XAI_MODELS_URL = `${XAI_BASE}/models`;
export const XAI_CHAT_URL = `${XAI_BASE}/chat/completions`;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const HOSTED_OUTPUT_DEFAULT = 1024;
export const HOSTED_OUTPUT_MAX = 8192;
export const HOSTED_REQUEST_TIMEOUT_MS = 60_000;
export type LlmRequestOptions = { signal?: AbortSignal; timeoutMs?: number; maxOutputTokens?: number };

async function boundedRequest<T>(options: LlmRequestOptions, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? HOSTED_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300_000) throw new Error("invalid hosted timeout");
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  let rejectAbort: (() => void) | undefined;
  try {
    if (controller.signal.aborted) throw new DOMException("hosted request timed out", "TimeoutError");
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new DOMException("hosted request timed out", "TimeoutError"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([run(controller.signal), stopped]);
  } catch (err) {
    if (controller.signal.aborted) throw new DOMException("hosted request timed out", "TimeoutError");
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export type FakeLlm = {
  text: string;
  models?: string[];
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function assertXaiUrl(url: string): void {
  const normalized = url.replace(/\/$/, "");
  if (normalized === XAI_MODELS_URL || normalized === XAI_CHAT_URL) return;
  throw new Error(`hosted LLM may only call ${XAI_MODELS_URL} or ${XAI_CHAT_URL}`);
}

export function createFakeFetch(fake: FakeLlm): FetchLike {
  const models = fake.models ?? [DEFAULT_MODEL_ID];
  return async (input, init) => {
    const url = requestUrl(input).replace(/\/$/, "");
    assertXaiUrl(url);
    if (url === XAI_MODELS_URL) {
      return Response.json({ data: models.map((id) => ({ id })) });
    }
    const directive = parseFakeDirective(typeof init?.body === "string" ? init.body : "");
    if (directive.delay_ms !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, directive.delay_ms));
    }
    if (directive.status !== undefined) {
      return Response.json({ error: { message: "fake upstream error" } }, { status: directive.status });
    }
    return Response.json({
      choices: [{ message: { role: "assistant", content: directive.text ?? fake.text } }],
    });
  };
}

/** Test-only directives for the in-worker fake (used only when there is no XAI_API_KEY and FAKE_LLM_TEXT is set). */
export type FakeDirective = { text?: string; delay_ms?: number; status?: number };

export function parseFakeDirective(source: string): FakeDirective {
  const match = /\[\[fake:([^\]]*)\]\]/.exec(source);
  if (!match) return {};
  const out: FakeDirective = {};
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
    if (name === "text") {
      out.text = value;
    } else if (name === "delay_ms") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 0 && n <= 30_000) out.delay_ms = n;
    } else if (name === "status") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 400 && n <= 599) out.status = n;
    }
  }
  return out;
}

export async function listModelIds(fetchImpl: FetchLike, apiKey: string, options: LlmRequestOptions = {}): Promise<string[]> {
  return boundedRequest(options, async (signal) => {
    const res = await fetchImpl(XAI_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`GET /v1/models failed: ${res.status}`);
    const json = await readJsonObject(res);
    if (!json || !Array.isArray(json.data)) throw new Error("invalid hosted model list");
    const ids: string[] = [];
    for (const row of json.data as Array<{ id?: unknown }>) {
      if (typeof row?.id === "string") ids.push(row.id);
    }
    return ids;
  });
}

/** Refuse start when the configured id is absent. Never silently switch to grok-4.6. */
export function configuredModelAvailable(ids: readonly string[], modelId = DEFAULT_MODEL_ID): boolean {
  return ids.includes(modelId);
}

export async function chatCompletion(
  fetchImpl: FetchLike,
  apiKey: string,
  messages: ChatMessage[],
  modelId = DEFAULT_MODEL_ID,
  options: LlmRequestOptions = {},
): Promise<string> {
  const max = options.maxOutputTokens ?? HOSTED_OUTPUT_DEFAULT;
  if (!Number.isInteger(max) || max < 1 || max > HOSTED_OUTPUT_MAX) throw new Error("invalid hosted output limit");
  return boundedRequest(options, async (signal) => {
    const res = await fetchImpl(XAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        max_tokens: max,
        messages,
        tools: [...HOSTED_TOOL_ALLOWLIST],
      }),
      signal,
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`POST /v1/chat/completions failed: ${res.status}`);
    const json = (await readJsonObject(res)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    if (!json) throw new Error("invalid hosted response");
    const content = json.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  });
}
