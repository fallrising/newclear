import { describe, expect, it } from "vitest";
import {
  BODY_MAX_BYTES,
  FANOUT_CHUNK,
  INBOX_LIVE_BUFFER,
  MEMBERS_PER_ROOM,
  STATUS_MAX_BYTES,
  WAKE_PER_MINUTE,
} from "../src/caps.ts";

describe("caps", () => {
  it("CAP-CONST-01: body 8 KiB, status 512, fanout 6, members/room 32, wake 6/min, inbox buffer 128", () => {
    expect(BODY_MAX_BYTES).toBe(8192);
    expect(STATUS_MAX_BYTES).toBe(512);
    expect(FANOUT_CHUNK).toBe(6);
    expect(MEMBERS_PER_ROOM).toBe(32);
    expect(WAKE_PER_MINUTE).toBe(6);
    expect(INBOX_LIVE_BUFFER).toBe(128);
  });
});
