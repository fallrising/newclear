import { describe, expect, it } from "vitest";
import { createNotifyState, notify, type NotifyEnvelope } from "../src/notify.ts";
import { canWake } from "../src/quota.ts";

function mentionEnvelope(input: {
  trigger_member_id: string;
  quota_class: "api_key" | "operator_personal";
}): NotifyEnvelope {
  return {
    room_id: "r1",
    event: {
      id: "m1",
      seq: 1,
      kind: "message",
      sender_id: input.trigger_member_id,
      sender_kind: "human",
      body: "hello @grok",
      mentions: ["agent-1"],
      thread_id: null,
      origin: "local",
    },
    policy: {
      mode: "mention",
      keywords: [],
      cooldown_ms: 15000,
      debounce_ms: 2000,
      quota_class: input.quota_class,
      policy_epoch: 1,
    },
    operator_member_id: "op",
    trigger_member_id: input.trigger_member_id,
    last_human_seq: 1,
    last_human_at: "2026-09-20T12:00:00.000Z",
    humans_typing: false,
    wake_budget_remaining: 4,
  };
}

describe("quota gate", () => {
  it("INV-13: operator_personal wakes only the operator; mention remains persistable", () => {
    expect(
      canWake({
        quota_class: "api_key",
        trigger_member_id: "human-1",
        operator_member_id: "op",
      }),
    ).toEqual({ ok: true, persistable: true });

    expect(
      canWake({
        quota_class: "operator_personal",
        trigger_member_id: "op",
        operator_member_id: "op",
      }),
    ).toEqual({ ok: true, persistable: true });

    const rejected = canWake({
      quota_class: "operator_personal",
      trigger_member_id: "human-1",
      operator_member_id: "op",
    });
    expect(rejected).toEqual({ ok: false, code: "subscription_operator_only", persistable: true });
    expect(rejected.persistable).toBe(true);
  });

  it("INV-13: notify drops hosted dispatch on quota fail without throwing; persistable", () => {
    const state = createNotifyState();
    const alarms: number[] = [];
    const envelope = mentionEnvelope({ trigger_member_id: "human-1", quota_class: "operator_personal" });
    const result = notify(envelope, "agent-1", 1_000_000, {
      setAlarm: (ms) => {
        alarms.push(ms);
      },
      state,
    });
    expect(result).toMatchObject({ action: "drop", reason: "subscription_operator_only", persistable: true });
    expect(state.hosted_stubs).toHaveLength(0);
    expect(alarms).toHaveLength(0);
  });
});
