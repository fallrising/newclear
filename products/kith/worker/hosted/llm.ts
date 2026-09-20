import { DEFAULT_MODEL_ID, HOSTED_TOOL_ALLOWLIST, type ChatMessage } from "./prompt.ts";

/** Official xAI only. No Anthropic, thinrouter, or loopback. */
export const XAI_BASE = "https://api.x.ai/v1";
export const XAI_MODELS_URL = `${XAI_BASE}/models`;
export const XAI_CHAT_URL = `${XAI_BASE}/chat/completions`;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
  return async (input, _init) => {
    const url = requestUrl(input).replace(/\/$/, "");
    assertXaiUrl(url);
    if (url === XAI_MODELS_URL) {
      return Response.json({ data: models.map((id) => ({ id })) });
    }
    return Response.json({
      choices: [{ message: { role: "assistant", content: fake.text } }],
    });
  };
}

export async function listModelIds(fetchImpl: FetchLike, apiKey: string): Promise<string[]> {
  const res = await fetchImpl(XAI_MODELS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`GET /v1/models failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  const ids: string[] = [];
  for (const row of json.data ?? []) {
    if (typeof row?.id === "string") ids.push(row.id);
  }
  return ids;
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
): Promise<string> {
  const res = await fetchImpl(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      stream: false,
      messages,
      tools: [...HOSTED_TOOL_ALLOWLIST],
    }),
  });
  if (!res.ok) {
    throw new Error(`POST /v1/chat/completions failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
