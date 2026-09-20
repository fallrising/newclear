import { describe, expect, it } from "vitest";
import { evaluateHeuristic } from "../src/heuristic.ts";

describe("ambient heuristic", () => {
  it("H1–H5: question/help/@all pass; H4 recent agent and H5 agent sender veto", () => {
    expect(
      evaluateHeuristic({ body: "are you there?", sender_kind: "human", recent_10_has_agent: false }),
    ).toBe(true);
    expect(
      evaluateHeuristic({ body: "can someone help", sender_kind: "human", recent_10_has_agent: false }),
    ).toBe(true);
    expect(
      evaluateHeuristic({ body: "ping @all now", sender_kind: "human", recent_10_has_agent: false }),
    ).toBe(true);
    expect(
      evaluateHeuristic({ body: "are you there?", sender_kind: "human", recent_10_has_agent: true }),
    ).toBe(false);
    expect(
      evaluateHeuristic({ body: "are you there?", sender_kind: "agent", recent_10_has_agent: false }),
    ).toBe(false);
    expect(
      evaluateHeuristic({ body: "hello", sender_kind: "human", recent_10_has_agent: false }),
    ).toBe(false);
  });
});
