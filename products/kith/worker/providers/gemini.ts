import { failFromResponse, isEventStream, joinUrl, nonNegativeInt, readJsonObject, send } from "./http.ts";
import { parseJsonObject, readSse } from "./sse.ts";
import { LlmError, type LlmAdapter, type LlmErrorClass, type NormalizedResult } from "./types.ts";

const MODEL_PAGES = 5;
const FILTER_REASONS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "LANGUAGE"]);

/** Google AI Studio generateContent / streamGenerateContent?alt=sse (base …/v1beta, header x-goog-api-key). */
export const gemini: LlmAdapter = {
  format: "gemini",

  async listModels(conn, fetchImpl, signal) {
    const ids: string[] = [];
    let token: string | null = null;
    for (let page = 0; page < MODEL_PAGES; page++) {
      const url = joinUrl(conn.base_url, `models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
      const res = await send(fetchImpl, url, { method: "GET", headers: headers(conn) }, signal);
      if (!res.ok) return failFromResponse(res, refine);
      const body = await readJsonObject(res);
      if (!body || !Array.isArray(body.models)) throw new LlmError("protocol", res.status);
      for (const row of body.models) {
        const name = row && typeof row === "object" ? (row as Record<string, unknown>).name : undefined;
        if (typeof name === "string") ids.push(name.replace(/^models\//, ""));
      }
      if (typeof body.nextPageToken !== "string" || body.nextPageToken === "") break;
      token = body.nextPageToken;
    }
    return ids;
  },

  async complete(conn, req, fetchImpl, signal, onDelta) {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.max_output_tokens };
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.stop && req.stop.length > 0) generationConfig.stopSequences = req.stop;
    const payload = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.transcript }] }],
      generationConfig,
    };
    const model = encodeURIComponent(req.model.replace(/^models\//, ""));
    const path = req.stream ? `models/${model}:streamGenerateContent?alt=sse` : `models/${model}:generateContent`;
    const res = await send(
      fetchImpl,
      joinUrl(conn.base_url, path),
      {
        method: "POST",
        headers: { ...headers(conn), "content-type": "application/json", accept: req.stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );
    if (!res.ok) return failFromResponse(res, refine);
    if (req.stream && isEventStream(res)) return readStream(res, onDelta, signal);
    const body = await readJsonObject(res);
    if (!body) throw new LlmError("protocol", res.status);
    const chunk = parseChunk(body, res.status);
    if (chunk.finishReason === null && chunk.text === "") throw new LlmError("protocol", res.status);
    return result(chunk.text, chunk.finishReason, chunk.usage, res.status);
  },
};

type Chunk = { text: string; finishReason: string | null; usage: NormalizedResult["usage"] };

/** One GenerateContentResponse (a whole reply, or one SSE chunk holding only the new text). */
function parseChunk(body: Record<string, unknown>, status: number): Chunk {
  if (body.error && typeof body.error === "object") {
    const e = body.error as Record<string, unknown>;
    throw new LlmError(refine(typeof e.code === "number" ? e.code : status, body) ?? "unknown", status);
  }
  const feedback = body.promptFeedback && typeof body.promptFeedback === "object" ? (body.promptFeedback as Record<string, unknown>) : null;
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (candidates.length === 0 && typeof feedback?.blockReason === "string") throw new LlmError("content_filter", status);
  const candidate = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>) : null;
  const content = candidate?.content && typeof candidate.content === "object" ? (candidate.content as Record<string, unknown>) : null;
  let text = "";
  if (Array.isArray(content?.parts)) {
    for (const part of content.parts) {
      const p = part && typeof part === "object" ? (part as Record<string, unknown>) : null;
      if (p && p.thought !== true && typeof p.text === "string") text += p.text; // thought summaries are not the reply
    }
  }
  const um = body.usageMetadata && typeof body.usageMetadata === "object" ? (body.usageMetadata as Record<string, unknown>) : null;
  const input = nonNegativeInt(um?.promptTokenCount);
  const output = nonNegativeInt(um?.candidatesTokenCount);
  return {
    text,
    finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
    usage: input === undefined && output === undefined ? undefined : { input_tokens: input, output_tokens: output },
  };
}

/** No explicit end event: a chunk carrying finishReason ends the stream properly (FM-LLM-08). */
async function readStream(
  res: Response,
  onDelta?: (d: { type: "text"; text: string }) => void,
  signal?: AbortSignal,
): Promise<NormalizedResult> {
  let text = "";
  let finishReason: string | null = null;
  let usage: NormalizedResult["usage"];
  for await (const ev of readSse(res, signal)) {
    const data = parseJsonObject(ev.data);
    if (!data) throw new LlmError("protocol", res.status);
    const chunk = parseChunk(data, res.status);
    if (chunk.text) {
      text += chunk.text;
      onDelta?.({ type: "text", text: chunk.text });
    }
    if (chunk.usage) usage = chunk.usage;
    if (chunk.finishReason && chunk.finishReason !== "FINISH_REASON_UNSPECIFIED") finishReason = chunk.finishReason;
  }
  if (finishReason === null) throw new LlmError("protocol", res.status);
  return result(text, finishReason, usage, res.status);
}

function result(text: string, finishReason: string | null, usage: NormalizedResult["usage"], status: number): NormalizedResult {
  if (finishReason !== null && FILTER_REASONS.has(finishReason) && text.trim() === "") throw new LlmError("content_filter", status);
  const finish: NormalizedResult["finish"] =
    finishReason === "STOP" ? "stop"
    : finishReason === "MAX_TOKENS" ? "length"
    : finishReason !== null && FILTER_REASONS.has(finishReason) ? "content_filter"
    : "other";
  return { text, finish, usage };
}

/**
 * google.rpc.Status in {error:{code,message,status,details}}. status names win over the HTTP code. An invalid
 * API key arrives as 400 INVALID_ARGUMENT with details[].reason "API_KEY_INVALID" → auth (inference, §4.5.4).
 */
function refine(_status: number, body: Record<string, unknown> | null): LlmErrorClass | undefined {
  const e = body && typeof body.error === "object" && body.error ? (body.error as Record<string, unknown>) : null;
  if (!e) return undefined;
  const details = Array.isArray(e.details) ? e.details : [];
  if (details.some((d) => d && typeof d === "object" && (d as Record<string, unknown>).reason === "API_KEY_INVALID")) return "auth";
  switch (e.status) {
    case "UNAUTHENTICATED":
    case "PERMISSION_DENIED":
      return "auth";
    case "NOT_FOUND":
      return "not_found";
    case "INVALID_ARGUMENT":
    case "FAILED_PRECONDITION":
    case "OUT_OF_RANGE":
      return "bad_request";
    case "RESOURCE_EXHAUSTED":
      return "rate_limited";
    case "UNAVAILABLE":
      return "overloaded";
    case "DEADLINE_EXCEEDED":
      return "timeout";
    case "INTERNAL":
    case "UNKNOWN":
      return "unknown";
    default:
      return undefined;
  }
}

function headers(conn: { secret: string; extra_headers: Record<string, string> }): Record<string, string> {
  const h: Record<string, string> = { ...conn.extra_headers, accept: "application/json" };
  if (conn.secret) h["x-goog-api-key"] = conn.secret;
  return h;
}
