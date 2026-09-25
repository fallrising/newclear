import { LlmError, type LlmErrorClass } from "./types.ts";

export const MAX_RESPONSE_BYTES = 1024 * 1024; // FM-LLM-11
export const RETRY_AFTER_CAP_MS = 10_000; // FM-LLM-05

/** base + path without producing "//" (FM-LLM-15). `base` is already normalized (no trailing slash). */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Retry-After: delta-seconds or HTTP-date; also retry-after-ms. Result clamped to [0, 10000]. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms !== null && ms.trim() !== "" && Number.isFinite(Number(ms))) return clampRetry(Number(ms));
  const raw = headers.get("retry-after");
  if (raw === null || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return clampRetry(seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return clampRetry(at - now);
}

function clampRetry(ms: number): number {
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, Math.round(ms)));
}

/** HTTP status → class. Body-level refinements (context_length, content_filter) are the adapter's job. */
export function classifyStatus(status: number): LlmErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422 || status === 413) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status === 503 || status === 529) return "overloaded";
  return "unknown";
}

/** Read at most 1 MiB; more → protocol (FM-LLM-11). */
export async function readTextCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw new LlmError("protocol", res.status);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new LlmError("protocol", res.status);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Parsed JSON object or null (FM-LLM-01: HTML page, empty body, array, scalar). */
export async function readJsonObject(res: Response): Promise<Record<string, unknown> | null> {
  const text = await readTextCapped(res);
  if (text.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** fetch with network errors mapped; the caller's AbortSignal (timeout) → timeout. */
export async function send(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal, redirect: "manual" });
  } catch (err) {
    if (signal?.aborted) throw new LlmError("timeout");
    if (err instanceof LlmError) throw err;
    throw new LlmError("network");
  }
}

/** Non-2xx → LlmError. 3xx (redirect: manual) counts as protocol: a provider must not redirect. */
export async function failFromResponse(
  res: Response,
  refine?: (status: number, body: Record<string, unknown> | null) => LlmErrorClass | undefined,
): Promise<never> {
  let body: Record<string, unknown> | null = null;
  try {
    body = await readJsonObject(res);
  } catch {
    body = null;
  }
  if (res.status >= 300 && res.status < 400) throw new LlmError("protocol", res.status);
  const cls = refine?.(res.status, body) ?? classifyStatus(res.status);
  const retry = cls === "rate_limited" || cls === "overloaded" ? parseRetryAfter(res.headers) : undefined;
  throw new LlmError(cls, res.status, retry);
}

export function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
