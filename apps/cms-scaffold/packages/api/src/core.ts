import createClient, { type Middleware } from "openapi-fetch";
import { ApiError, errorFromBody } from "./errors";
import type { paths } from "./schema";

export type Transport = ReturnType<typeof createTransport>;

export interface TransportOptions {
  /** API origin, for example http://localhost:8080. A trailing slash is removed. */
  baseUrl: string;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

export function createTransport(options: TransportOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  let csrfToken: string | null = null;
  let pending: Promise<string> | null = null;

  // Resolve fetch at call time so MSW, which patches globalThis.fetch after this module loads, is honoured.
  const lazyFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

  const client = createClient<paths>({ baseUrl, credentials: "include", fetch: lazyFetch });

  async function fetchCsrf(): Promise<string> {
    pending ??= (async () => {
      const response = await lazyFetch(`${baseUrl}/api/v1/auth/csrf`, { credentials: "include" });
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw new ApiError(response.status, "INVALID_RESPONSE", "CSRF response is not JSON");
      }
      if (!response.ok) throw errorFromBody(response.status, body);
      const token = (body as { csrfToken?: unknown } | null)?.csrfToken;
      if (typeof token !== "string") throw new ApiError(response.status, "INVALID_RESPONSE", "CSRF token missing");
      csrfToken = token;
      return token;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  const csrfMiddleware: Middleware = {
    async onRequest({ request }) {
      if (!UNSAFE.has(request.method)) return undefined;
      const token = csrfToken ?? (await fetchCsrf());
      request.headers.set("X-CSRF-Token", token);
      return request;
    },
  };
  client.use(csrfMiddleware);

  async function once<T>(run: () => Promise<FetchResult<T>>): Promise<T> {
    let result: FetchResult<T>;
    try {
      result = await run();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof SyntaxError) throw new ApiError(200, "INVALID_RESPONSE", "Response body is not JSON");
      throw new ApiError(0, "NETWORK_ERROR", error instanceof Error ? error.message : "Network error");
    }
    if (result.response.ok) return result.data as T;
    throw errorFromBody(result.response.status, result.error);
  }

  /**
   * Runs one openapi-fetch call. Every failure becomes ApiError; AbortError is rethrown unchanged (C-16).
   * A 403 CSRF_FAILED clears the token, fetches a new one and retries exactly once (S-03).
   */
  async function call<T>(run: () => Promise<FetchResult<T>>): Promise<T> {
    try {
      return await once(run);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.code === "CSRF_FAILED") {
        csrfToken = null;
        await fetchCsrf();
        return once(run);
      }
      throw error;
    }
  }

  return {
    baseUrl,
    client,
    call,
    setCsrfToken(token: string | null) {
      csrfToken = token;
    },
    /** Absolute URL for a path returned by the API (media variant URLs are root-relative). */
    url(path: string) {
      return /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`;
    },
  };
}
