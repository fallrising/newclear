import type { ApiErrorBody, CsrfResponse } from "./types";

export class ApiError extends Error {
  /** 0 = network error. */
  readonly status: number;
  /** Server error.code; "network_error" for network failures; "http_<status>" when the body is not an error envelope. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function errorFrom(status: number, text: string): ApiError {
  try {
    const body: unknown = JSON.parse(text);
    if (isErrorBody(body)) return new ApiError(status, body.error.code, body.error.message);
  } catch {
    // Not JSON: fall through to the generic error.
  }
  return new ApiError(status, "http_" + status, "HTTP " + status);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

async function getCsrf(signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store", signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError(0, "network_error", "network error");
  }
  if (!res.ok) throw errorFrom(res.status, await res.text());
  return ((await res.json()) as CsrfResponse).csrf;
}

/**
 * JSON request to the Kith API. Every unsafe method fetches a fresh CSRF token first (FE-22):
 * v1 answers both CSRF mismatch and a missing session with 401 unauthorized, so a cached token
 * could not be told apart from a lost session.
 */
export async function apiFetch<T>(
  path: string,
  init: { method?: HttpMethod; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (method !== "GET") headers.set("X-CSRF-Token", await getCsrf(init.signal));
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: init.signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError(0, "network_error", "network error");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw errorFrom(res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}
