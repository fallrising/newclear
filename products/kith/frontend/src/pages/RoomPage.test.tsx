import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
