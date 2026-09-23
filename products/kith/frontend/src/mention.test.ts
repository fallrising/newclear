import { describe, expect, it } from "vitest";
import { applyMention, filterMentionHandles, mentionQuery } from "./mention";

describe("mentionQuery", () => {
  it("reads the prefix at the caret and ignores an @ inside a word", () => {
    expect(mentionQuery("@gr", 3)).toEqual({ start: 0, query: "gr" });
    expect(mentionQuery("hi @", 4)).toEqual({ start: 3, query: "" });
    expect(mentionQuery("a@b", 3)).toBeNull();
    expect(mentionQuery("@grok there", 6)).toBeNull();
  });

  it("replaces only the active prefix", () => {
    expect(applyMention("hi @gr!", 3, 6, "grok")).toEqual({ value: "hi @grok !", caret: 9 });
  });

  it("filters handles, not display names", () => {
    const members = [
      { handle: "Grok", display_name: "Owner" },
      { handle: "guest" },
      { handle: "codex" },
    ];
    expect(filterMentionHandles(members, "").map((member) => member.handle)).toEqual(["codex", "Grok", "guest"]);
    expect(filterMentionHandles(members, "g").map((member) => member.handle)).toEqual(["Grok", "guest"]);
  });
});
