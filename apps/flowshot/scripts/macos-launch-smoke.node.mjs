import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptanceBudgetMs,
  assessLaunchSignals,
  observationWindowMs,
} from "./macos-launch-smoke.mjs";

describe("macOS launch smoke diagnostics", () => {
  it("keeps the 1.5 second acceptance budget while observing for 15 seconds", () => {
    assert.equal(acceptanceBudgetMs, 1_500);
    assert.equal(observationWindowMs({}), 15_000);
    assert.equal(
      observationWindowMs({ MACOS_LAUNCH_OBSERVATION_MS: "20000" }),
      20_000,
    );
  });

  it("rejects an invalid observation window", () => {
    assert.throws(
      () => observationWindowMs({ MACOS_LAUNCH_OBSERVATION_MS: "1500" }),
      /greater than the 1500 ms acceptance budget/u,
    );
    assert.throws(
      () => observationWindowMs({ MACOS_LAUNCH_OBSERVATION_MS: "later" }),
      /positive integer/u,
    );
  });

  it("passes only when both signals arrive before the acceptance budget", () => {
    assert.deepEqual(
      assessLaunchSignals({
        command: { observedAtMs: 1_120 },
        window: { observedAtMs: 980 },
      }),
      [],
    );
  });

  it("reports a late signal separately from a missing signal", () => {
    assert.deepEqual(
      assessLaunchSignals({
        command: { observedAtMs: 2_340 },
        window: {
          missingReason: "no on-screen layer-zero window is owned by pid 42",
        },
      }),
      [
        "command signal arrived at 2340 ms; budget is under 1500 ms",
        "window signal was not observed: no on-screen layer-zero window is owned by pid 42",
      ],
    );
  });

  it("treats a signal at exactly 1.5 seconds as over budget", () => {
    assert.deepEqual(
      assessLaunchSignals({
        command: { observedAtMs: 1_499 },
        window: { observedAtMs: 1_500 },
      }),
      ["window signal arrived at 1500 ms; budget is under 1500 ms"],
    );
  });
});
