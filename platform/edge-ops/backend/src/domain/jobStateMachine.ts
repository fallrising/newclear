// Embedded copy of contracts/state-machines/job.v1.json; test/stateMachine.test.ts fails on drift.

export const JOB_STATES = [
  "draft",
  "awaiting_approval",
  "queued",
  "leased",
  "running",
  "reconciling",
  "expired",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "unknown",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_JOB_STATES: readonly JobState[] = ["expired", "succeeded", "failed", "timed_out", "cancelled", "unknown"];

export type TransitionActor = "operator" | "server" | "courier" | "cron";

export const JOB_TRANSITIONS: readonly { from: JobState; to: JobState; by: TransitionActor }[] = [
  { from: "draft", to: "awaiting_approval", by: "operator" },
  { from: "draft", to: "cancelled", by: "operator" },
  { from: "awaiting_approval", to: "queued", by: "server" },
  { from: "awaiting_approval", to: "expired", by: "cron" },
  { from: "awaiting_approval", to: "cancelled", by: "operator" },
  { from: "queued", to: "leased", by: "courier" },
  { from: "queued", to: "expired", by: "cron" },
  { from: "queued", to: "cancelled", by: "operator" },
  { from: "leased", to: "running", by: "courier" },
  { from: "leased", to: "cancelled", by: "courier" },
  { from: "leased", to: "reconciling", by: "cron" },
  { from: "running", to: "succeeded", by: "courier" },
  { from: "running", to: "failed", by: "courier" },
  { from: "running", to: "timed_out", by: "courier" },
  { from: "running", to: "cancelled", by: "courier" },
  { from: "running", to: "reconciling", by: "cron" },
  { from: "reconciling", to: "succeeded", by: "courier" },
  { from: "reconciling", to: "failed", by: "courier" },
  { from: "reconciling", to: "timed_out", by: "courier" },
  { from: "reconciling", to: "cancelled", by: "courier" },
  { from: "reconciling", to: "unknown", by: "operator" },
];

export function isAllowedTransition(from: JobState, to: JobState, by: TransitionActor): boolean {
  return JOB_TRANSITIONS.some((t) => t.from === from && t.to === to && t.by === by);
}
