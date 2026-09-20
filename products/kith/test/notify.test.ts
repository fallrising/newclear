import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createNotifyState,
  notify,
  type NotifyDeps,
  type NotifyEnvelope,
  type NotifyPolicy,
} from "../src/notify.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkTs(path));
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function baseEnvelope(over: {
  kind?: string;
  origin?: string;
  sender_id?: string;
  sender_kind?: "human" | "agent";
  mentions?: string[];
  body?: string;
  mode?: NotifyPolicy["mode"];
  keywords?: string[];
  last_human_at?: string;
  quota_class?: NotifyPolicy["quota_class"];
  trigger_member_id?: string;
}): NotifyEnvelope {
  return {
    room_id: "r1",
    event: {
      id: "m1",
      seq: 1,
      kind: over.kind ?? "message",
      sender_id: over.sender_id ?? "human-1",
      sender_kind: over.sender_kind ?? "human",
      body: over.body ?? "hello room",
      mentions: over.mentions ?? [],
      thread_id: null,
      origin: over.origin ?? "local",
    },
    policy: {
      mode: over.mode ?? "ambient",
      keywords: over.keywords ?? [],
      cooldown_ms: 15000,
      debounce_ms: 2000,
      quota_class: over.quota_class ?? "api_key",
      policy_epoch: 1,
    },
    operator_member_id: "op",
    trigger_member_id: over.trigger_member_id ?? over.sender_id ?? "human-1",
    last_human_seq: 1,
    last_human_at: over.last_human_at ?? "2026-09-20T12:00:00.000Z",
    humans_typing: false,
    wake_budget_remaining: 4,
  };
}

function depsWith(heuristic = vi.fn()): { deps: NotifyDeps; alarms: number[]; heuristic: ReturnType<typeof vi.fn> } {
  const alarms: number[] = [];
  const state = createNotifyState();
  return {
    alarms,
    heuristic,
    deps: {
      setAlarm: (ms) => {
        alarms.push(ms);
      },
      runHeuristic: heuristic,
      state,
    },
  };
}

describe("notify", () => {
  it("ATT-03: ambient debounce elapsed returns in <20ms and src has no setTimeout/sleep/Atomics.wait", () => {
    const now = 1_700_000_000_000;
    const { deps, alarms, heuristic } = depsWith();
    const envelope = baseEnvelope({
      mode: "ambient",
      last_human_at: new Date(now - 10_000).toISOString(),
    });
    const t0 = Date.now();
    const result = notify(envelope, "agent-1", now, deps);
    const t1 = Date.now();
    expect(t1 - t0).toBeLessThan(20);
    expect(result).toEqual({ action: "set_alarm", delayMs: 0 });
    expect(alarms).toEqual([0]);
    expect(heuristic).not.toHaveBeenCalled();

    for (const file of walkTs(srcDir)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/setTimeout/);
      expect(text, file).not.toMatch(/\bsleep\b/);
      expect(text, file).not.toMatch(/Atomics\.wait/);
    }
  });

  it("ATT-04: ambient debounce elapsed records only setAlarm(0); heuristic spy is not called", () => {
    const now = 1_700_000_000_000;
    const { deps, alarms, heuristic } = depsWith();
    const result = notify(
      baseEnvelope({ mode: "ambient", last_human_at: new Date(now - 5_000).toISOString() }),
      "agent-1",
      now,
      deps,
    );
    expect(result).toEqual({ action: "set_alarm", delayMs: 0 });
    expect(alarms).toEqual([0]);
    expect(heuristic).not.toHaveBeenCalled();
    expect(deps.state.hosted_stubs).toHaveLength(0);
    expect(deps.state.pending).not.toBeNull();
  });

  it("ATT-05: sender_id == self drops and does not setAlarm", () => {
    const { deps, alarms, heuristic } = depsWith();
    const result = notify(
      baseEnvelope({ mode: "ambient", sender_id: "agent-1", sender_kind: "agent", mentions: ["agent-1"] }),
      "agent-1",
      1_700_000_000_000,
      deps,
    );
    expect(result).toEqual({ action: "drop", reason: "self" });
    expect(alarms).toHaveLength(0);
    expect(heuristic).not.toHaveBeenCalled();
    expect(deps.state.pending).toBeNull();
  });

  it("ATT-06: agent-to-agent non-mention drops; @self takes mention path for mention/keyword/ambient", () => {
    const now = 1_700_000_000_000;
    const ambient = depsWith();
    const ambientDrop = notify(
      baseEnvelope({
        mode: "ambient",
        sender_id: "agent-a",
        sender_kind: "agent",
        mentions: [],
      }),
      "agent-b",
      now,
      ambient.deps,
    );
    expect(ambientDrop).toEqual({ action: "drop", reason: "agent_non_mention" });
    expect(ambient.alarms).toHaveLength(0);
    expect(ambient.heuristic).not.toHaveBeenCalled();
    expect(ambient.deps.state.hosted_stubs).toHaveLength(0);

    const keywordHit = depsWith();
    const keywordHitDrop = notify(
      baseEnvelope({
        mode: "keyword",
        keywords: ["deploy"],
        body: "please Deploy now",
        sender_id: "agent-a",
        sender_kind: "agent",
        mentions: [],
      }),
      "agent-b",
      now,
      keywordHit.deps,
    );
    expect(keywordHitDrop).toEqual({ action: "drop", reason: "agent_non_mention" });
    expect(keywordHit.deps.state.hosted_stubs).toHaveLength(0);

    const mentionedAmbient = depsWith();
    const mentionedAmbientResult = notify(
      baseEnvelope({
        mode: "ambient",
        sender_id: "agent-a",
        sender_kind: "agent",
        mentions: ["agent-b"],
      }),
      "agent-b",
      now,
      mentionedAmbient.deps,
    );
    expect(mentionedAmbientResult).toEqual({ action: "dispatch_mention" });
    expect(mentionedAmbient.alarms).toHaveLength(0);
    expect(mentionedAmbient.deps.state.hosted_stubs).toHaveLength(1);

    const keywordMention = depsWith();
    const keywordMentionResult = notify(
      baseEnvelope({
        mode: "keyword",
        keywords: ["deploy"],
        body: "no keyword here",
        sender_id: "agent-a",
        sender_kind: "agent",
        mentions: ["agent-b"],
      }),
      "agent-b",
      now,
      keywordMention.deps,
    );
    expect(keywordMentionResult).toEqual({ action: "dispatch_mention" });
    expect(keywordMention.deps.state.hosted_stubs).toHaveLength(1);

    const mention = depsWith();
    const mentionResult = notify(
      baseEnvelope({
        mode: "mention",
        sender_id: "agent-a",
        sender_kind: "agent",
        mentions: ["agent-b"],
        trigger_member_id: "agent-a",
      }),
      "agent-b",
      now,
      mention.deps,
    );
    expect(mentionResult).toEqual({ action: "dispatch_mention" });
    expect(mention.deps.state.hosted_stubs).toHaveLength(1);
  });

  it("ATT-07: kind status or trace drops immediately", () => {
    const status = depsWith();
    expect(
      notify(baseEnvelope({ kind: "status", mode: "mention", mentions: ["agent-1"] }), "agent-1", 0, status.deps),
    ).toEqual({ action: "drop", reason: "kind_or_origin" });
    expect(status.alarms).toHaveLength(0);
    expect(status.deps.state.hosted_stubs).toHaveLength(0);

    const trace = depsWith();
    expect(
      notify(baseEnvelope({ kind: "trace", mode: "ambient" }), "agent-1", 0, trace.deps),
    ).toEqual({ action: "drop", reason: "kind_or_origin" });
    expect(trace.alarms).toHaveLength(0);
  });
});
