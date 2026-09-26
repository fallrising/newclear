import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createCmsClient } from "./index";
import { createFrontClient } from "./public-entry";

type Call = { url: string; method: string; headers: Headers; body: string | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(responder: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const call: Call = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? null : await request.clone().text(),
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const entry = {
  id: "00000000-0000-4000-8000-000000000001",
  contentType: "album",
  slug: "a",
  publicationState: "draft",
  version: 1,
  title: "A",
  payload: {},
  dirty: false,
  publishedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

describe("@cms/api transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("S-03 fetches the CSRF token once and reuses it for later writes", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/api/v1/auth/csrf") ? json(200, { csrfToken: "t1" }) : json(200, entry),
    );
    const api = createCmsClient({ baseUrl: "http://api.test/" });
    await api.work.publish(entry.id);
    await api.work.unpublish(entry.id);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /api/v1/auth/csrf",
      `POST /api/v1/entries/${entry.id}/publish`,
      `POST /api/v1/entries/${entry.id}/unpublish`,
    ]);
    expect(calls[1].headers.get("X-CSRF-Token")).toBe("t1");
    expect(calls[2].headers.get("X-CSRF-Token")).toBe("t1");
  });

  it("S-03 login stores the returned token so the next write needs no CSRF fetch", async () => {
    const me = {
      principal: { id: entry.id, username: "u", displayName: "U", status: "active" },
      roles: [],
      surfaces: { front: true, back: true, admin: false },
    };
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/auth/csrf")) return json(200, { csrfToken: "t0" });
      if (call.url.endsWith("/auth/login")) return json(200, { ...me, csrfToken: "t-login" });
      return json(200, entry);
    });
    const api = createCmsClient({ baseUrl: "http://api.test" });
    await api.auth.login("u", "p");
    await api.work.archive(entry.id);
    expect(calls.at(-1)?.headers.get("X-CSRF-Token")).toBe("t-login");
  });

  it("S-03 retries exactly once after 403 CSRF_FAILED with a fresh token", async () => {
    let tokens = 0;
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/auth/csrf")) return json(200, { csrfToken: `t${++tokens}` });
      if (call.headers.get("X-CSRF-Token") === "t1") {
        return json(403, { error: { code: "CSRF_FAILED", message: "bad" }, requestId: "r1" });
      }
      return json(200, entry);
    });
    const api = createCmsClient({ baseUrl: "http://api.test" });
    await expect(api.work.publish(entry.id)).resolves.toMatchObject({ id: entry.id });
    expect(calls.map((c) => c.headers.get("X-CSRF-Token"))).toEqual([null, "t1", null, "t2"]);
  });

  it("W0-FM05 S-03 a second CSRF_FAILED is thrown, not retried again", async () => {
    stubFetch((call) =>
      call.url.endsWith("/auth/csrf")
        ? json(200, { csrfToken: "t" })
        : json(403, { error: { code: "CSRF_FAILED", message: "bad" }, requestId: "r" }),
    );
    const api = createCmsClient({ baseUrl: "http://api.test" });
    await expect(api.work.publish(entry.id)).rejects.toMatchObject({ status: 403, code: "CSRF_FAILED" });
  });

  it("W0-FM08 maps an ErrorEnvelope to ApiError with status, code and requestId", async () => {
    stubFetch(() => json(404, { error: { code: "ENTRY_NOT_FOUND", message: "Entry not found" }, requestId: "req-9" }));
    const api = createFrontClient({ baseUrl: "http://api.test" });
    const error = await api.public.bySlug("album", "nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "ENTRY_NOT_FOUND", requestId: "req-9" });
  });

  it("C-18 an HTML 502 from a proxy becomes INVALID_RESPONSE, not a SyntaxError", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
    const api = createFrontClient({ baseUrl: "http://api.test" });
    await expect(api.public.entries("album")).rejects.toMatchObject({ status: 502, code: "INVALID_RESPONSE" });
  });

  it("C-18 a 200 whose body is not JSON becomes INVALID_RESPONSE", async () => {
    stubFetch(() => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const api = createFrontClient({ baseUrl: "http://api.test" });
    await expect(api.public.entries("album")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("W0-FM10 C-18 a network failure becomes NETWORK_ERROR with status 0", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const api = createFrontClient({ baseUrl: "http://api.test" });
    await expect(api.public.entries("album")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("W0-FM11 C-16 an aborted request rejects with AbortError so TanStack Query can cancel it", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const api = createFrontClient({ baseUrl: "http://api.test" });
    const controller = new AbortController();
    controller.abort();
    await expect(api.public.entries("album", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("E-02 serializes ref filters as ref.<field> and drops empty values", async () => {
    const calls = stubFetch(() => json(200, { items: [], total: 0, offset: 0, limit: 0 }));
    const api = createCmsClient({ baseUrl: "http://api.test" });
    await api.work.entries("issue", { ref: { project: "p-1" }, state: "", q: "kan" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/content-types/issue/entries");
    expect([...url.searchParams.entries()]).toEqual([
      ["q", "kan"],
      ["ref.project", "p-1"],
    ]);
  });

  it("AC-08 the Front client only reaches /api/v1/public and /api/v1/auth", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/auth/csrf") ? json(200, { csrfToken: "t" }) : json(200, { items: [], total: 0, offset: 0, limit: 0 }),
    );
    const api = createFrontClient({ baseUrl: "http://api.test" });
    await api.public.entries("album");
    await api.public.entries("photo", { ref: { album: "a-1" } });
    await api.auth.logout().catch(() => undefined);
    expect(Object.keys(api).sort()).toEqual(["auth", "public", "url"]);
    for (const call of calls) {
      expect(new URL(call.url).pathname).toMatch(/^\/api\/v1\/(public|auth)\//);
    }
  });

  it("E-02 url() prefixes root-relative media URLs with the API origin", () => {
    const api = createFrontClient({ baseUrl: "http://api.test/" });
    expect(api.url("/api/v1/public/media/m/file/web")).toBe("http://api.test/api/v1/public/media/m/file/web");
    expect(api.url("https://cdn.test/x.jpg")).toBe("https://cdn.test/x.jpg");
  });
});
