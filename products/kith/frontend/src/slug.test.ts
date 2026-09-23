import { describe, expect, it, vi } from "vitest";
import { slugFromName } from "./slug";

describe("slugFromName", () => {
  it("normalizes a display name", () => {
    expect(slugFromName("  Design  Room ")).toBe("design-room");
    expect(slugFromName("A--B")).toBe("a-b");
    expect(slugFromName("x".repeat(60)).length).toBe(48);
  });

  it("fills room- plus 8 hex when the name has no slug characters", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0xab);
        return bytes;
      },
    });
    expect(slugFromName("設計")).toBe("room-abababab");
    expect(slugFromName("---")).toBe("room-abababab");
    vi.unstubAllGlobals();
  });
});
