import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoom, fetchCsrfToken, inviteHuman, login, parseMe, parseMembers, parseRooms } from "./api";

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

describe("rooms mutations", () => {
  it("parseMe reads is_operator and handle", () => {
    expect(parseMe({ is_operator: 1, handle: "owner" })).toEqual({ isOperator: true, handle: "owner" });
    expect(parseMe({ is_operator: 0 }).isOperator).toBe(false);
    expect(parseMe({ is_operator: 0 }).handle).toBe("");
  });

  it("createRoom and inviteHuman post CSRF JSON", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "tok-1" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms")) {
          return new Response(JSON.stringify({ id: "room-2", name: "Design", slug: "design" }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, member_id: "guest", role: "member" }), { status: 200 });
      },
    );
    await expect(createRoom("Design", "design")).resolves.toEqual({
      id: "room-2",
      name: "Design",
      slug: "design",
    });
    await inviteHuman("room 2", "guest");
    const create = calls.find((call) => call.url.endsWith("/api/rooms") && call.init?.method === "POST");
    const invite = calls.find((call) => call.url.includes("/members"));
    expect(JSON.parse(String(create?.init?.body))).toEqual({ name: "Design", slug: "design" });
    expect(new Headers(create?.init?.headers).get("X-CSRF-Token")).toBe("tok-1");
    expect(invite?.url).toContain("/api/rooms/room%202/members");
    expect(JSON.parse(String(invite?.init?.body))).toEqual({ handle: "guest" });
  });
});
