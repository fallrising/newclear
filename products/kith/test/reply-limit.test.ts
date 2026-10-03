import { describe, expect, it } from "vitest";
import { replyLimit, unicodeScalarLength } from "../worker/reply-limit.ts";

describe("replyLimit", () => {
  it("counts unicode scalars and hides an overlong fixed reply", () => {
    expect(unicodeScalarLength("hello from grok")).toBe(15);
    expect(unicodeScalarLength("🙂")).toBe(1);
    expect(
      replyLimit({
        kind: "agent",
        quotaClass: "api_key",
        sidecarOn: false,
        hasApiKey: false,
        fakeText: "x".repeat(121),
      }),
    ).toBeNull();
  });

  it("returns fixed text only for a hosted agent without an API key", () => {
    expect(
      replyLimit({
        kind: "agent",
        quotaClass: "api_key",
        sidecarOn: false,
        hasApiKey: false,
        fakeText: "hello from grok",
      }),
    ).toEqual({ code: "fixed", fixed_text: "hello from grok" });
    expect(
      replyLimit({
        kind: "agent",
        quotaClass: "api_key",
        sidecarOn: false,
        hasApiKey: true,
        fakeText: "hello from grok",
      }),
    ).toBeNull();
    expect(
      replyLimit({
        kind: "human",
        quotaClass: "api_key",
        sidecarOn: false,
        hasApiKey: false,
        fakeText: "hello from grok",
      }),
    ).toBeNull();
  });

  it("marks a personal agent sidecar_off only when the flag is off", () => {
    expect(
      replyLimit({
        kind: "agent",
        quotaClass: "operator_personal",
        sidecarOn: false,
        hasApiKey: false,
        fakeText: "hello from grok",
      }),
    ).toEqual({ code: "sidecar_off" });
    expect(
      replyLimit({
        kind: "agent",
        quotaClass: "operator_personal",
        sidecarOn: true,
        hasApiKey: false,
        fakeText: "hello from grok",
      }),
    ).toBeNull();
  });
});
