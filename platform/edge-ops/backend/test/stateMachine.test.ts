import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JOB_STATES, JOB_TRANSITIONS, TERMINAL_JOB_STATES } from "../src/domain/jobStateMachine.ts";

const contract = JSON.parse(readFileSync(new URL("../../contracts/state-machines/job.v1.json", import.meta.url), "utf8"));

test("embedded job state machine matches the contract", () => {
  assert.deepEqual([...JOB_STATES], contract.states);
  assert.deepEqual([...TERMINAL_JOB_STATES], contract.terminal);
  assert.deepEqual(
    JOB_TRANSITIONS.map((t) => ({ ...t })),
    contract.transitions.map((t: { from: string; to: string; by: string }) => ({ from: t.from, to: t.to, by: t.by })),
  );
});

test("state machine invariants", () => {
  const terminal = new Set<string>(TERMINAL_JOB_STATES);
  for (const t of JOB_TRANSITIONS) assert.ok(!terminal.has(t.from), `terminal state ${t.from} has an outgoing transition`);
  // Lease loss never leads straight back to queued or to a retry.
  assert.ok(!JOB_TRANSITIONS.some((t) => t.to === "queued" && t.from !== "awaiting_approval"));
  assert.ok(!JOB_TRANSITIONS.some((t) => t.from === "unknown"));
  // Only execution evidence (courier) or reconciliation can finish a started attempt.
  for (const t of JOB_TRANSITIONS.filter((x) => ["running", "reconciling"].includes(x.from) && x.to !== "reconciling")) {
    assert.ok(t.by === "courier" || (t.from === "reconciling" && t.to === "unknown" && t.by === "operator"), JSON.stringify(t));
  }
});
