import { failFromResponse, isEventStream, joinUrl, nonNegativeInt, readJsonObject, send } from "./http.ts";
import { openaiChat } from "./openai-chat.ts";
import { parseJsonObject, readSse } from "./sse.ts";
import { LlmError, type LlmAdapter, type LlmErrorClass, type NormalizedResult } from "./types.ts";

/**
 * OpenAI Responses API. `instructions` carries the system prompt, `input` the wrapped transcript (RT-04),
 * `store: false` so the provider keeps no conversation state. No `tools` (RT-05). The Responses API has no stop
 * sequences, so NormalizedRequest.stop is ignored here.
 */
export const openaiResponses: LlmAdapter = {
  format: "openai_responses",

  listModels: openaiChat.listModels, // same GET {base}/models

  async complete(conn, req, fetchImpl, signal, onDelta) {
    const payload: Record<string, unknown> = {
      model: req.model,
      instructions: req.system,
      input: req.transcript,
      max_output_tokens: req.max_output_tokens,
      store: false,
      stream: req.stream,
    };
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    const res = await send(
      fetchImpl,
      joinUrl(conn.base_url, "responses"),
      {
        method: "POST",
        headers: { ...headers(conn), "content-type": "application/json", accept: req.stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );
    if (!res.ok) {
      return failFromResponse(res, (status, body) => {
        const e = body && typeof body.error === "object" && body.error ? (body.error as Record<string, unknown>) : null;
        if (status === 400 && e?.code === "context_length_exceeded") return "context_length";
        return undefined;
      });
    }
    if (req.stream && isEventStream(res)) return readStream(res, onDelta, signal);
    const body = await readJsonObject(res);
    if (!body) throw new LlmError("protocol", res.status);
    return fromResponse(body, res.status);
  },
};

/** A Response object (non-streamed body, or the `response` of response.completed / incomplete / failed). */
function fromResponse(body: Record<string, unknown>, status: number): NormalizedResult {
  if (body.status === "failed") throw new LlmError(errorClass(body.error), status);
  if (!Array.isArray(body.output)) throw new LlmError("protocol", status);
  let text = "";
  let refused = false;
  let sawMessage = false;
  for (const item of body.output) {
    if (!item || typeof item !== "object" || (item as Record<string, unknown>).type !== "message") continue;
    sawMessage = true;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part && typeof part === "object" ? (part as Record<string, unknown>) : null;
      if (p?.type === "output_text" && typeof p.text === "string") text += p.text;
      if (p?.type === "refusal") refused = true;
    }
  }
  const reason = incompleteReason(body);
  if (text === "" && (refused || reason === "content_filter")) throw new LlmError("content_filter", status);
  if (!sawMessage && body.status === "completed") throw new LlmError("protocol", status); // e.g. only reasoning items
  return {
    text,
    finish: body.status === "incomplete" ? (reason === "max_output_tokens" ? "length" : reason === "content_filter" ? "content_filter" : "other") : "stop",
    usage: usage(body.usage),
  };
}

/** Terminal events: response.completed, response.incomplete, response.failed; `error` mid-stream (FM-LLM-09). */
async function readStream(
  res: Response,
  onDelta?: (d: { type: "text"; text: string }) => void,
  signal?: AbortSignal,
): Promise<NormalizedResult> {
  let streamed = "";
  for await (const ev of readSse(res, signal)) {
    const data = parseJsonObject(ev.data);
    if (!data) throw new LlmError("protocol", res.status);
    const type = typeof data.type === "string" ? data.type : ev.event;
    if (type === "response.output_text.delta" && typeof data.delta === "string" && data.delta.length > 0) {
      streamed += data.delta;
      onDelta?.({ type: "text", text: data.delta });
    } else if (type === "error") {
      throw new LlmError(errorClass(data), res.status);
    } else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
      const response = data.response && typeof data.response === "object" ? (data.response as Record<string, unknown>) : null;
      if (!response) throw new LlmError("protocol", res.status);
      const result = fromResponse(response, res.status);
      // The final object is authoritative; fall back to the streamed text if it omitted output.
      return result.text === "" && streamed !== "" ? { ...result, text: streamed } : result;
    }
  }
  throw new LlmError("protocol", res.status); // FM-LLM-08
}

function errorClass(error: unknown): LlmErrorClass {
  const e = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  if (e?.code === "rate_limit_exceeded") return "rate_limited";
  if (e?.code === "context_length_exceeded") return "context_length";
  return "unknown";
}

function incompleteReason(body: Record<string, unknown>): unknown {
  const d = body.incomplete_details && typeof body.incomplete_details === "object" ? (body.incomplete_details as Record<string, unknown>) : null;
  return d?.reason;
}

function headers(conn: { secret: string; extra_headers: Record<string, string> }): Record<string, string> {
  const h: Record<string, string> = { ...conn.extra_headers, accept: "application/json" };
  if (conn.secret) h.authorization = `Bearer ${conn.secret}`;
  return h;
}

function usage(raw: unknown): NormalizedResult["usage"] {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = nonNegativeInt(u.input_tokens);
  const output = nonNegativeInt(u.output_tokens);
  return input === undefined && output === undefined ? undefined : { input_tokens: input, output_tokens: output };
}
