import { describe, expect, it } from "vitest";
import { aiSetupProblem } from "./ai_settings";

const ready = { provider: "opencode", model: "test-model", key_present: true, key_env: "OPENCODE_API_KEY" };
describe("AI configuration feedback", () => {
  it("blocks unavailable status without claiming a missing key", () => {
    expect(aiSetupProblem(null)).toContain("unavailable");
  });
  it("blocks invalid configuration even when a key is present", () => {
    expect(aiSetupProblem({ ...ready, configuration_error: "Set LOOM_AI_PROTOCOL" })).toBe("Set LOOM_AI_PROTOCOL");
  });
  it("names the configured key variable and accepts valid legacy/new status", () => {
    expect(aiSetupProblem({ ...ready, key_present: false })).toContain("OPENCODE_API_KEY");
    expect(aiSetupProblem(ready)).toBeNull();
    expect(aiSetupProblem({ ...ready, configuration_error: null, protocol: "messages" })).toBeNull();
  });
});
