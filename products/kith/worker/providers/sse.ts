import { MAX_RESPONSE_BYTES } from "./http.ts";
import { LlmError } from "./types.ts";

export type SseEvent = { event: string | null; data: string };

/**
 * text/event-stream reader (FM-LLM-07): lines end in \r\n, \n or \r (mixed allowed); a blank line ends an event;
 * ":" lines are comments; several data: lines join with "\n"; field values drop one leading space.
 * A chunk boundary may fall anywhere, including inside a UTF-8 sequence or between \r and \n.
 * More than 1 MiB in total → protocol (FM-LLM-11). A read that fails (connection dropped) → protocol (FM-LLM-08),
 * or timeout when `signal` was aborted (FM-LLM-10). The caller decides whether the stream ended properly.
 */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let event: string | null = null;
  let data: string[] = [];
  let pendingCr = false;
  const flush = function* (): Generator<SseEvent> {
    if (data.length > 0) yield { event, data: data.join("\n") };
    event = null;
    data = [];
  };
  const line = function* (text: string): Generator<SseEvent> {
    if (text === "") {
      yield* flush();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new LlmError(signal?.aborted ? "timeout" : "protocol", res.status);
      }
      const { done, value } = chunk;
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LlmError("protocol", res.status);
      }
      buffer += decoder.decode(value, { stream: true });
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch === "\n" && pendingCr) {
          pendingCr = false;
          start = i + 1;
          continue;
        }
        pendingCr = false;
        if (ch === "\n" || ch === "\r") {
          yield* line(buffer.slice(start, i));
          if (ch === "\r") pendingCr = true;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield* line(buffer);
    // No trailing blank line: the last event is incomplete and is dropped (the adapter then sees no terminal event).
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** JSON object or null; never throws. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
