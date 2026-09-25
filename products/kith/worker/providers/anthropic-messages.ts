import { failFromResponse, joinUrl, nonNegativeInt, readJsonObject, send } from "./http.ts";
import { LlmError, type LlmAdapter, type LlmErrorClass, type NormalizedResult } from "./types.ts";

/** Current and only published value (Anthropic TS SDK 0.128.0 client.ts default header). */
export const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_PAGES = 5;

export const anthropicMessages: LlmAdapter = {
  format: "anthropic_messages",

  async listModels(conn, fetchImpl, signal) {
    const ids: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < MODEL_PAGES; page++) {
      const url = joinUrl(conn.base_url, `v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`);
      const res = await send(fetchImpl, url, { method: "GET", headers: headers(conn) }, signal);
      if (!res.ok) return failFromResponse(res, refine);
      const body = await readJsonObject(res);
      if (!body || !Array.isArray(body.data)) throw new LlmError("protocol", res.status);
      for (const row of body.data) {
        const id = row && typeof row === "object" ? (row as Record<string, unknown>).id : undefined;
        if (typeof id === "string") ids.push(id);
      }
      if (body.has_more !== true || typeof body.last_id !== "string") break;
      after = body.last_id;
    }
    return ids;
  },

  async complete(conn, req, fetchImpl, signal) {
    const payload: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.max_output_tokens,
      system: req.system,
      messages: [{ role: "user", content: req.transcript }],
      stream: false,
    };
    // Newer Claude models reject any temperature except 1.0 (SDK 0.128.0 marks it deprecated); send only when set.
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.stop && req.stop.length > 0) payload.stop_sequences = req.stop;
    const res = await send(
      fetchImpl,
      joinUrl(conn.base_url, "v1/messages"),
      { method: "POST", headers: { ...headers(conn), "content-type": "application/json" }, body: JSON.stringify(payload) },
      signal,
    );
    if (!res.ok) return failFromResponse(res, refine);
    const body = await readJsonObject(res);
    if (!body || !Array.isArray(body.content)) throw new LlmError("protocol", res.status);
    const blocks = body.content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
    const texts = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string);
    if (body.stop_reason === "refusal" && texts.join("").trim() === "") throw new LlmError("content_filter", res.status);
    if (texts.length === 0 && blocks.length > 0) throw new LlmError("protocol", res.status); // only tool_use / thinking
    return { text: texts.join(""), finish: finish(body.stop_reason), usage: usage(body.usage) };
  },
};

function headers(conn: { secret: string; extra_headers: Record<string, string> }): Record<string, string> {
  const h: Record<string, string> = { ...conn.extra_headers, accept: "application/json", "anthropic-version": ANTHROPIC_VERSION };
  if (conn.secret) h["x-api-key"] = conn.secret;
  return h;
}

/** error.type (Anthropic ErrorType) wins over the status code. */
function refine(_status: number, body: Record<string, unknown> | null): LlmErrorClass | undefined {
  const error = body && typeof body.error === "object" && body.error ? (body.error as Record<string, unknown>) : null;
  switch (error?.type) {
    case "authentication_error":
    case "permission_error":
    case "billing_error":
      return "auth";
    case "not_found_error":
      return "not_found";
    case "invalid_request_error":
      return "bad_request";
    case "rate_limit_error":
      return "rate_limited";
    case "overloaded_error":
      return "overloaded";
    case "timeout_error":
      return "timeout";
    case "api_error":
      return "unknown";
    default:
      return undefined;
  }
}

function finish(reason: unknown): NormalizedResult["finish"] {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "length";
  if (reason === "refusal") return "content_filter";
  return "other";
}

function usage(raw: unknown): NormalizedResult["usage"] {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = nonNegativeInt(u.input_tokens);
  const output = nonNegativeInt(u.output_tokens);
  return input === undefined && output === undefined ? undefined : { input_tokens: input, output_tokens: output };
}
