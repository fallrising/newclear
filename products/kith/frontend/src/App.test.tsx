import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubWide(matches: boolean) {
  const mq = {
    matches,
    media: "(min-width: 768px)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const fn = () => mq;
  vi.stubGlobal("matchMedia", fn);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: fn });
}

function stubFetch(operator: boolean) {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ id: "operator", handle: "owner", is_operator: operator ? 1 : 0 }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/rooms")) {
        return new Response(JSON.stringify({ rooms: [{ id: "room-1", name: "Lobby" }] }), { status: 200 });
      }
      if (url.includes("/members") || url.includes("/messages")) {
        return new Response(JSON.stringify({ members: [], messages: [] }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    },
  );
}

describe("App shell", () => {
  it("keeps the room list beside the timeline on a wide viewport", async () => {
    stubWide(true);
    stubFetch(true);
    render(<App />);
    expect(await screen.findByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.getByText("Select a room.")).toBeTruthy();
    expect(screen.getByText("A room is one conversation. People and agents are members of it the same way.")).toBeTruthy();
    expect(screen.getByText("Type @ to mention a room member. A mention is talking to one member. It is not a promise that they reply.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New room" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Lobby" }));
    expect(await screen.findByPlaceholderText("Message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to rooms" })).toBeNull();
    expect(screen.getByText("live")).toBeTruthy();
    expect(screen.getByText("your connection")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New room" })).toHaveLength(1);
  });

  it("opens a room over the list on a narrow viewport", async () => {
    stubWide(false);
    stubFetch(false);
    render(<App />);
    expect(await screen.findByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
    expect(screen.queryByText("Select a room.")).toBeNull();
    expect(screen.getByText("Tap a room to read it and write into it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lobby" }));
    expect(await screen.findByPlaceholderText("Message")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lobby" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to rooms" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to rooms" }));
    expect(await screen.findByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("switches rooms without dropping the list on a wide viewport", async () => {
    stubWide(true);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/me")) {
          return new Response(JSON.stringify({ id: "operator", handle: "owner", is_operator: 1 }), { status: 200 });
        }
        if (url.endsWith("/api/rooms")) {
          return new Response(
            JSON.stringify({
              rooms: [
                { id: "room-1", name: "Lobby" },
                { id: "room-2", name: "Design", slug: "design" },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/members") || url.includes("/messages")) {
          return new Response(JSON.stringify({ members: [], messages: [] }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Lobby" }));
    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lobby" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(await screen.findByRole("heading", { name: "Design" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Design" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Lobby" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to rooms" })).toBeNull();
    expect(screen.getByPlaceholderText("Message")).toBeTruthy();
  });

  it("signs in and then creates a room that stays selected in the list", async () => {
    stubWide(true);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    let authed = false;
    let rooms: Array<{ id: string; name: string; slug?: string }> = [{ id: "room-1", name: "Lobby" }];
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/me")) {
          if (!authed) {
            return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
          }
          return new Response(JSON.stringify({ id: "operator", handle: "owner", is_operator: 1 }), { status: 200 });
        }
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        if (url.endsWith("/api/auth/login") && method === "POST") {
          authed = true;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/rooms") && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { name: string; slug: string };
          posts.push(body);
          const created = { id: "room-2", name: body.name, slug: body.slug };
          rooms = [...rooms, created];
          return new Response(JSON.stringify(created), { status: 200 });
        }
        if (url.endsWith("/api/rooms")) {
          return new Response(JSON.stringify({ rooms }), { status: 200 });
        }
        if (url.includes("/members") || url.includes("/messages")) {
          return new Response(JSON.stringify({ members: [], messages: [] }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(<App />);
    expect(await screen.findByLabelText("Handle")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    fireEvent.click((await screen.findAllByRole("button", { name: "New room" }))[0]!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    expect(await screen.findByRole("heading", { name: "Design" })).toBeTruthy();
    await waitFor(() => expect(posts).toEqual([{ name: "Design", slug: "design" }]));
    const created = screen.getByRole("button", { name: "Design" });
    expect(created.getAttribute("aria-current")).toBe("true");
    expect(created.textContent).toBe("Design");
    expect(screen.getByRole("button", { name: "Lobby" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByPlaceholderText("Message")).toBeTruthy();
  });
});
