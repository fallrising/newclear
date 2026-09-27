import { failFromResponse, isEventStream, joinUrl, nonNegativeInt, readJsonObject, send } from "./http.ts";
import { parseJsonObject, readSse } from "./sse.ts";
import { LlmError, type LlmAdapter, type LlmErrorClass, type NormalizedResult } from "./types.ts";

/** OpenAI Chat Completions and compatibles (xAI, DeepSeek, Mistral, Groq, OpenRouter, vLLM …). */
export const openaiChat: LlmAdapter = {
  format: "openai_chat",

  async listModels(conn, fetchImpl, signal) {
    const res = await send(fetchImpl, joinUrl(conn.base_url, "models"), { method: "GET", headers: headers(conn) }, signal);
    if (!res.ok) return failFromResponse(res);
    const body = await readJsonObject(res);
    if (!body || !Array.isArray(body.data)) throw new LlmError("protocol", res.status);
    return body.data
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).id : undefined))
      .filter((id): id is string => typeof id === "string");
  },

  async complete(conn, req, fetchImpl, signal, onDelta) {
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.transcript },
      ],
      [conn.token_param]: req.max_output_tokens,
      stream: req.stream,
    };
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.stop && req.stop.length > 0) payload.stop = req.stop;
    // RT-05 / INV-09: no `tools` key at all. No `stream_options` either: not every compatible server accepts it,
    // so streamed replies may have no usage (FM-LLM-14 allows that).
    const res = await send(
      fetchImpl,
      joinUrl(conn.base_url, "chat/completions"),
      {
        method: "POST",
        headers: { ...headers(conn), "content-type": "application/json", accept: req.stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );
    if (!res.ok) return failFromResponse(res, (status, body) => refineError(status, body?.error));
    // A server that ignores stream:true answers with plain JSON; accept it.
    if (req.stream && isEventStream(res)) return readStream(res, onDelta, signal);
    const body = await readJsonObject(res);
    if (!body) throw new LlmError("protocol", res.status);
    const choice = Array.isArray(body.choices) ? (body.choices[0] as Record<string, unknown> | undefined) : undefined;
    const message = choice && typeof choice.message === "object" && choice.message ? (choice.message as Record<string, unknown>) : null;
    if (!choice || !message) throw new LlmError("protocol", res.status);
    const text = contentText(message.content);
    if (text === null) {
      if (typeof message.refusal === "string" && message.refusal.length > 0) throw new LlmError("content_filter", res.status);
      if (message.content === null && choice.finish_reason === "content_filter") throw new LlmError("content_filter", res.status);
      if (message.content === null) return { text: "", finish: finish(choice.finish_reason), usage: usage(body.usage) };
      throw new LlmError("protocol", res.status);
    }
    if (text === "" && choice.finish_reason === "content_filter") throw new LlmError("content_filter", res.status);
    return { text, finish: finish(choice.finish_reason), usage: usage(body.usage) };
  },
};

/** chat.completion.chunk stream. Ends properly on `[DONE]` or a non-null finish_reason (FM-LLM-08). */
async function readStream(
  res: Response,
  onDelta?: (d: { type: "text"; text: string }) => void,
  signal?: AbortSignal,
): Promise<NormalizedResult> {
  let text = "";
  let finishReason: unknown = null;
  let sawEnd = false;
  let refused = false;
  let usageRaw: unknown;
  for await (const ev of readSse(res, signal)) {
    if (ev.data === "[DONE]") {
      sawEnd = true;
      break;
    }
    const chunk = parseJsonObject(ev.data);
    if (!chunk) throw new LlmError("protocol", res.status);
    if (chunk.error && typeof chunk.error === "object") {
      throw new LlmError(refineError(res.status, chunk.error) ?? "unknown", res.status); // FM-LLM-09
    }
    if (chunk.usage) usageRaw = chunk.usage;
    const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as Record<string, unknown> | undefined) : undefined;
    const delta = choice && typeof choice.delta === "object" && choice.delta ? (choice.delta as Record<string, unknown>) : null;
    if (delta && typeof delta.content === "string" && delta.content.length > 0) {
      text += delta.content;
      onDelta?.({ type: "text", text: delta.content });
    }
    if (delta && typeof delta.refusal === "string" && delta.refusal.length > 0) refused = true;
    if (choice && choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finishReason = choice.finish_reason;
      sawEnd = true;
    }
  }
  if (!sawEnd) throw new LlmError("protocol", res.status);
  if (text === "" && (refused || finishReason === "content_filter")) throw new LlmError("content_filter", res.status);
  return { text, finish: finish(finishReason), usage: usage(usageRaw) };
}

function refineError(status: number, error: unknown): LlmErrorClass | undefined {
  const e = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  if (e?.code === "context_length_exceeded") return "context_length";
  if (e?.code === "rate_limit_exceeded") return "rate_limited";
  if (status >= 200 && status < 300) return e ? "unknown" : undefined; // error inside a 200 stream
  return undefined;
}

function headers(conn: { secret: string; extra_headers: Record<string, string> }): Record<string, string> {
  const h: Record<string, string> = { ...conn.extra_headers, accept: "application/json" };
  if (conn.secret) h.authorization = `Bearer ${conn.secret}`;
  return h;
}

/** string → itself; array of {type:"text", text} parts → joined (FM-LLM-02); anything else → null. */
function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string);
  return parts.length > 0 ? parts.join("") : null;
}

function finish(reason: unknown): NormalizedResult["finish"] {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  return "other"; // FM-LLM-12
}

function usage(raw: unknown): NormalizedResult["usage"] {
  if (!raw || typeof raw !== "object") return undefined; // FM-LLM-14
  const u = raw as Record<string, unknown>;
  const input = nonNegativeInt(u.prompt_tokens);
  const output = nonNegativeInt(u.completion_tokens);
  return input === undefined && output === undefined ? undefined : { input_tokens: input, output_tokens: output };
}
