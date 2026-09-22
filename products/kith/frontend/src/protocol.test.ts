import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_MESSAGE_ID_MAX,
  CLIENT_MESSAGE_ID_MIN,
  hasSeqGap,
  lastContinuousSeq,
  newClientMessageId,
  parseWsPacket,
  roomWebSocketUrl,
  sendPacket,
} from "./protocol";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newClientMessageId", () => {
  it("returns 8–64 chars when randomUUID exists", () => {
    const id = newClientMessageId();
    expect(id.length).toBeGreaterThanOrEqual(CLIENT_MESSAGE_ID_MIN);
    expect(id.length).toBeLessThanOrEqual(CLIENT_MESSAGE_ID_MAX);
  });

  it("works on insecure HTTP where randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = (i * 17 + 3) % 256;
        }
        return bytes;
      },
    });
    const id = newClientMessageId();
    expect(typeof crypto.randomUUID).toBe("undefined");
    expect(id.length).toBe(32);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("works when crypto is missing entirely", () => {
    vi.stubGlobal("crypto", undefined);
    const id = newClientMessageId();
    expect(id.length).toBeGreaterThanOrEqual(CLIENT_MESSAGE_ID_MIN);
    expect(id.length).toBeLessThanOrEqual(CLIENT_MESSAGE_ID_MAX);
  });

  it("does not collide across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(newClientMessageId());
    }
    expect(seen.size).toBe(200);
  });
});

describe("sendPacket / parseWsPacket", () => {
  it("builds a v1 send packet with the client_message_id", () => {
    const packet = sendPacket("hello", "client01");
    expect(packet).toEqual({
      v: 1,
      type: "send",
      client_message_id: "client01",
      body: "hello",
    });
  });

  it("parses event, status, and error packets", () => {
    const event = parseWsPacket(
      JSON.stringify({ v: 1, type: "event", event: { seq: 3, body: "hi", kind: "message" } }),
    );
    expect(event).toEqual({
      type: "event",
      event: expect.objectContaining({ seq: 3, body: "hi", kind: "message" }),
    });
    expect(parseWsPacket(JSON.stringify({ v: 1, type: "status", member_id: "m1", body: "typing" }))).toEqual({
      type: "status",
      member_id: "m1",
      body: "typing",
    });
    expect(parseWsPacket(JSON.stringify({ v: 1, type: "error", code: "payload_too_large" }))?.type).toBe(
      "error",
    );
    expect(parseWsPacket("not-json")).toBeNull();
  });
});

describe("seq helpers", () => {
  it("detects a hole after a continuous prefix", () => {
    expect(lastContinuousSeq([0, 1, 2, 4])).toBe(2);
    expect(hasSeqGap([0, 1, 2, 4])).toBe(true);
    expect(hasSeqGap([0, 1, 2])).toBe(false);
    expect(hasSeqGap([])).toBe(false);
  });
});

describe("roomWebSocketUrl", () => {
  it("uses ws on http hosts including Tailscale IPs", () => {
    vi.stubGlobal("window", { location: { protocol: "http:", host: "100.111.95.79:5173" } });
    expect(roomWebSocketUrl("room-1")).toBe("ws://100.111.95.79:5173/api/rooms/room-1/ws");
  });
});
