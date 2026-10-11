import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../worker/env.ts";
import { Room, WS_FRAME_MAX_BYTES, WS_MEMBER_FRAMES_PER_MINUTE, WS_ROOM_FRAMES_PER_MINUTE } from "../../worker/room.ts";

type FrameAdmission = { admitWebSocketFrame(memberId: string): Promise<boolean> };
type FrameLedger = { minute: number; total: number; members: Record<string, number> };

function socket(member = "member") {
  const sent: Record<string, unknown>[] = [];
  const deserializeAttachment = vi.fn(() => ({ member_id: member, room_id: "room" }));
  const ws = { deserializeAttachment, send: (raw: string) => { sent.push(JSON.parse(raw)); } } as unknown as WebSocket;
  return { ws, sent, deserializeAttachment };
}

async function fixture() {
  const stub = env.ROOM.get(env.ROOM.idFromName(`ws-cost:${crypto.randomUUID()}`));
  const prepare = vi.fn(() => { throw new Error("downstream D1 must not run"); });
  await runInDurableObject(stub, (instance: Room) => {
    (instance as unknown as { env: Env }).env = {
      ...env, DB: { prepare } as unknown as D1Database,
    } as Env;
  });
  return { stub, prepare };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("WebSocket frame cost admission", () => {
  it("concurrent frames share the member and room limits atomically", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const admission = instance as unknown as FrameAdmission;
      const member = await Promise.all(Array.from({ length: 150 }, () => admission.admitWebSocketFrame("member")));
      expect(member.filter(Boolean)).toHaveLength(WS_MEMBER_FRAMES_PER_MINUTE);
      // A valid existing minute with 980 accepted frames, then race across the room boundary.
      const members = { "member:member": 120, "member:partial": 20,
        ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`member:existing-${i}`, 120])) };
      await state.storage.put("ws_frames", { minute: Math.floor(Date.now() / 60_000), total: 980, members });
      const room = await Promise.all(Array.from({ length: 50 }, (_, i) => admission.admitWebSocketFrame(`other-${i % 5}`)));
      expect(room.filter(Boolean)).toHaveLength(20);
      const ledger = await state.storage.get<FrameLedger>("ws_frames");
      expect(ledger?.total).toBe(WS_ROOM_FRAMES_PER_MINUTE);
      expect(Object.values(ledger!.members).every((count) => count <= WS_MEMBER_FRAMES_PER_MINUTE)).toBe(true);
    });
  });

  it("member keys are prototype safe and the minute map holds at most 32 identities", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const admission = instance as unknown as FrameAdmission;
      for (const id of ["__proto__", "toString", ...Array.from({ length: 30 }, (_, i) => `member-${i}`)]) {
        expect(await admission.admitWebSocketFrame(id)).toBe(true);
      }
      expect(await admission.admitWebSocketFrame("extra-member")).toBe(false);
      expect(await admission.admitWebSocketFrame("__proto__")).toBe(true);
      const ledger = await state.storage.get<FrameLedger>("ws_frames");
      expect(Object.keys(ledger!.members)).toHaveLength(32);
      expect(ledger?.members["member:__proto__"]).toBe(2);
      expect(await admission.admitWebSocketFrame("")).toBe(false);
      expect(await admission.admitWebSocketFrame("x".repeat(129))).toBe(false);
    });
  });

  it("quota reset replaces the bounded member map at the next UTC minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(120_000);
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const admission = instance as unknown as FrameAdmission;
      for (let i = 0; i < WS_MEMBER_FRAMES_PER_MINUTE; i++) expect(await admission.admitWebSocketFrame("member")).toBe(true);
      expect(await admission.admitWebSocketFrame("member")).toBe(false);
      vi.setSystemTime(180_000);
      expect(await admission.admitWebSocketFrame("next-member")).toBe(true);
      expect(await state.storage.get<FrameLedger>("ws_frames")).toEqual({ minute: 3, total: 1, members: { "member:next-member": 1 } });
    });
  });

  it("oversized text and binary frames are refused before identity, JSON or storage work", async () => {
    const { stub, prepare } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const f = socket();
      await instance.webSocketMessage(f.ws, "x".repeat(WS_FRAME_MAX_BYTES + 1));
      await instance.webSocketMessage(f.ws, new ArrayBuffer(WS_FRAME_MAX_BYTES + 1));
      await instance.webSocketMessage(f.ws, "界".repeat(Math.ceil(WS_FRAME_MAX_BYTES / 3)));
      expect(f.sent.map((item) => item.code)).toEqual(["payload_too_large", "payload_too_large", "payload_too_large"]);
      expect(f.deserializeAttachment).not.toHaveBeenCalled();
      expect(await state.storage.get("ws_frames")).toBeUndefined();
      expect(prepare).not.toHaveBeenCalled();
    });
  });

  it("send and status over quota cannot reach D1, typing storage or persistence", async () => {
    const { stub, prepare } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const admission = instance as unknown as FrameAdmission;
      for (let i = 0; i < WS_MEMBER_FRAMES_PER_MINUTE; i++) await admission.admitWebSocketFrame("member");
      const f = socket();
      await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "send", body: "hello", client_message_id: "client-001" }));
      await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "status", body: "typing" }));
      expect(f.sent.map((item) => item.code)).toEqual(["rate_limited", "rate_limited"]);
      expect(prepare).not.toHaveBeenCalled();
      expect(await state.storage.get("typing")).toBeUndefined();
      expect(await state.storage.get("next_seq")).toBeUndefined();
    });
  });

  it("an admission storage failure refuses downstream work", async () => {
    const { stub, prepare } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      vi.spyOn(state.storage, "transaction").mockRejectedValueOnce(new Error("injected admission failure"));
      const f = socket();
      await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "status", body: "typing" }));
      expect(f.sent.map((item) => item.code)).toEqual(["rate_limited"]);
      expect(prepare).not.toHaveBeenCalled();
      expect(await state.storage.get("typing")).toBeUndefined();
    });
  });

  it("ACK and invalid frame types do no D1, quota or typing work", async () => {
    const { stub, prepare } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const f = socket();
      for (let i = 0; i < 100; i++) await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "ack", seq: i }));
      await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "bogus" }));
      expect(f.sent.map((item) => item.code)).toEqual(["invalid_request"]);
      expect(prepare).not.toHaveBeenCalled();
      expect(await state.storage.get("ws_frames")).toBeUndefined();
      expect(await state.storage.get("typing")).toBeUndefined();
    });
  });

  it("normal status frames keep hibernation support without timers or admission RPC", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Room, state) => {
      const room = instance as unknown as { env: Env };
      const crossObject = vi.fn(() => { throw new Error("no admission RPC"); });
      room.env = {
        ...room.env,
        DB: { prepare: () => ({ bind() { return this; }, first: async () => ({ ok: 1 }) }) } as unknown as D1Database,
        ROOM: { get: crossObject } as unknown as Env["ROOM"],
      };
      const timer = vi.spyOn(globalThis, "setTimeout");
      const f = socket();
      await instance.webSocketMessage(f.ws, JSON.stringify({ v: 1, type: "status", body: "typing" }));
      expect(f.sent).toEqual([]);
      expect(await state.storage.get("typing")).toEqual({ member: expect.any(Number) });
      expect(timer).not.toHaveBeenCalled();
      expect(crossObject).not.toHaveBeenCalled();
    });
  });
});
