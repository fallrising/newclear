import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomPage } from "./RoomPage";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("RoomPage send", () => {
  it("sends a v1 packet even when randomUUID is missing", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/members")) {
          return jsonOk({ members: [{ id: "operator", handle: "owner", kind: "human" }] });
        }
        if (url.includes("/messages")) {
          return jsonOk({ messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );

    render(
      <RoomPage
        room={{ id: "room-1", name: "Lobby" }}
        onBack={() => undefined}
        onLoggedOut={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    const box = screen.getByPlaceholderText("Message");
    fireEvent.change(box, { target: { value: "hello from owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeTruthy();
    expect(ws!.sent).toHaveLength(1);
    const packet = JSON.parse(ws!.sent[0]!) as {
      v: number;
      type: string;
      body: string;
      client_message_id: string;
    };
    expect(packet).toMatchObject({ v: 1, type: "send", body: "hello from owner" });
    expect(packet.client_message_id.length).toBeGreaterThanOrEqual(8);
    expect(packet.client_message_id.length).toBeLessThanOrEqual(64);
  });

  it("does not send while IME is composing", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/members") || url.includes("/messages")) {
          return jsonOk({ members: [], messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomPage
        room={{ id: "room-1", name: "Lobby" }}
        onBack={() => undefined}
        onLoggedOut={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    const box = screen.getByPlaceholderText("Message");
    fireEvent.change(box, { target: { value: "你好" } });
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, "isComposing", { get: () => true });
    box.dispatchEvent(composing);
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
  });

  it("invites a human by handle when the viewer is the operator", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return jsonOk({ csrf: "t" });
        }
        if (url.includes("/members") && init?.method === "POST") {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return jsonOk({ ok: true, member_id: "guest", role: "member" });
        }
        if (url.includes("/members")) {
          const members =
            posts.length > 0
              ? [
                  { id: "operator", handle: "owner", kind: "human" },
                  { id: "guest", handle: "guest", kind: "human" },
                ]
              : [{ id: "operator", handle: "owner", kind: "human" }];
          return jsonOk({ members });
        }
        if (url.includes("/messages")) {
          return jsonOk({ messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomPage
        operator
        room={{ id: "room-1", name: "Lobby" }}
        onBack={() => undefined}
        onLoggedOut={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    expect(await screen.findByRole("list", { name: "Members" })).toBeTruthy();
    expect(screen.getByText("@owner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Handle"), { target: { value: "guest" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Invite" }).closest("form")!);
    await waitFor(() => expect(posts).toEqual([{ url: "/api/rooms/room-1/members", body: { handle: "guest" } }]));
    expect(await screen.findByText("They will see this room after they refresh.")).toBeTruthy();
  });

  it("sends on Enter, keeps Shift+Enter, and ignores IME keyCode 229", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/members") || url.includes("/messages")) {
          return jsonOk({ members: [], messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomPage room={{ id: "room-1", name: "Lobby" }} onBack={() => undefined} onLoggedOut={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    const box = screen.getByPlaceholderText("Message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "   " } });
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
    expect(box.value).toBe("   ");

    fireEvent.change(box, { target: { value: "hello" } });
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
    expect(box.value).toBe("hello");

    const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(composing, "keyCode", { get: () => 229 });
    box.dispatchEvent(composing);
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
    expect(box.value).toBe("hello");

    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1);
    expect(JSON.parse(FakeWebSocket.instances[0]!.sent[0]!).body).toBe("hello");
    expect(box.value).toBe("");
  });

  it("keeps the draft when the connection drops", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/members") || url.includes("/messages")) {
          return jsonOk({ members: [], messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomPage room={{ id: "room-1", name: "Lobby" }} onBack={() => undefined} onLoggedOut={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    const box = screen.getByPlaceholderText("Message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "still here" } });
    const ws = FakeWebSocket.instances[0]!;
    ws.readyState = 3;
    ws.onclose?.(new CloseEvent("close"));
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(screen.getByText("Offline. Reconnecting…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("still here");
    expect(ws.sent).toEqual([]);
  });

  it("shows operator required when an invite is forbidden", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return jsonOk({ csrf: "t" });
        }
        if (url.includes("/members") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: { code: "forbidden", message: "operator required" } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/members") || url.includes("/messages")) {
          return jsonOk({ members: [], messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomPage operator room={{ id: "room-1", name: "Lobby" }} onBack={() => undefined} onLoggedOut={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByText("live")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Handle"), { target: { value: "guest" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Invite" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("operator required");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("sizes the composer from scrollHeight up to the resolved 40dvh cap", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/members") || url.includes("/messages")) {
          return jsonOk({ members: [], messages: [] });
        }
        return new Response("no", { status: 404 });
      },
    );
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = original(element);
      if (element instanceof HTMLTextAreaElement) {
        return new Proxy(style, {
          get(target, prop, receiver) {
            if (prop === "maxHeight") {
              return "80px";
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
      return style;
    });
    render(
      <RoomPage room={{ id: "room-1", name: "Lobby" }} onBack={() => undefined} onLoggedOut={() => undefined} />,
    );
    const box = (await screen.findByPlaceholderText("Message")) as HTMLTextAreaElement;
    let scroll = 30;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => scroll });
    fireEvent.change(box, { target: { value: "hi" } });
    await waitFor(() => expect(box.style.height).toBe("30px"));
    expect(box.style.overflowY).toBe("hidden");
    scroll = 400;
    fireEvent.change(box, { target: { value: "hi\nmore" } });
    await waitFor(() => expect(box.style.height).toBe("80px"));
    expect(box.style.overflowY).toBe("auto");
  });
});
