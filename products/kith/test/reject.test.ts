import { describe, expect, it } from "vitest";
import { BODY_MAX_BYTES, FANOUT_CHUNK, MEMBERS_PER_ROOM, STATUS_MAX_BYTES, WAKE_PER_MINUTE } from "../src/caps.ts";
import { chunks } from "../src/fanout.ts";
import { consumeWake, rejectBody, rejectMemberCount, rejectStatus } from "../src/reject.ts";

describe("cap rejects", () => {
  it("body > 8 KiB is payload_too_large, never silent drop", () => {
    expect(rejectBody(BODY_MAX_BYTES)).toEqual({ ok: true });
    expect(rejectBody(BODY_MAX_BYTES + 1)).toEqual({ ok: false, code: "payload_too_large" });
  });

  it("status > 512 is payload_too_large, never silent drop", () => {
    expect(rejectStatus(STATUS_MAX_BYTES)).toEqual({ ok: true });
    expect(rejectStatus(STATUS_MAX_BYTES + 1)).toEqual({ ok: false, code: "payload_too_large" });
  });

  it("member 33 is room_full, never silent drop", () => {
    expect(rejectMemberCount(MEMBERS_PER_ROOM)).toEqual({ ok: true });
    expect(rejectMemberCount(MEMBERS_PER_ROOM + 1)).toEqual({ ok: false, code: "room_full" });
  });

  it("7th wake in a 6-budget window is wake_budget_exhausted, never silent drop", () => {
    let consumed = 0;
    for (let i = 0; i < WAKE_PER_MINUTE; i++) {
      const result = consumeWake(consumed);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected consume");
      consumed = result.consumed;
    }
    expect(consumed).toBe(6);
    expect(consumeWake(consumed)).toEqual({ ok: false, code: "wake_budget_exhausted" });
  });

  it("32 agents fan out in 6 batches of <=6 with no silent drop", () => {
    const ids = Array.from({ length: 32 }, (_, i) => `agent-${i}`);
    const batches = chunks(ids, FANOUT_CHUNK);
    expect(batches).toHaveLength(6);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(FANOUT_CHUNK);
    expect(batches.flat()).toEqual(ids);
  });
});
