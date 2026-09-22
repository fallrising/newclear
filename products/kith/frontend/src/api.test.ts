import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCsrfToken, login, parseMembers, parseRooms } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "csrf=; max-age=0; path=/";
});

describe("parseRooms / parseMembers", () => {
  it("reads rooms and member badges", () => {
    expect(parseRooms({ rooms: [{ id: "room-1", name: "Lobby" }] })).toEqual([
      { id: "room-1", name: "Lobby", slug: undefined },
    ]);
    const members = parseMembers({
      members: [
        { id: "grok", handle: "grok", kind: "agent", quota_class: "api_key" },
        { member_id: "codex", handle: "codex", kind: "agent", quota_class: "operator_personal" },
      ],
    });
    expect(members[0]?.kind).toBe("agent");
    expect(members[1]?.id).toBe("codex");
    expect(members[1]?.quota_class).toBe("operator_personal");
  });
});

describe("login", () => {
  it("GETs CSRF then POSTs handle/password with matching header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "tok-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/auth/login")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    );
    await login("owner", "secret");
    expect(calls[0]?.url).toContain("/api/csrf");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[1]?.url).toContain("/api/auth/login");
    const headers = new Headers(calls[1]?.init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("tok-1");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ handle: "owner", password: "secret" });
  });

  it("prefers the csrf cookie over the JSON body", async () => {
    document.cookie = "csrf=cookie-token; path=/";
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "body-token" }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );
    const token = await fetchCsrfToken();
    expect(token).toBe("cookie-token");
  });
});
