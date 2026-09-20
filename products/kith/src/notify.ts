import { loadKeywords, matchKeywords } from "./keyword.ts";
import { canWake } from "./quota.ts";

export type AttentionMode = "silent" | "mention" | "keyword" | "ambient";

export type NotifyEvent = {
  id: string;
  seq: number;
  kind: string;
  sender_id: string;
  sender_kind: "human" | "agent";
  body: string;
  mentions: string[];
  thread_id: string | null;
  origin: string;
};

export type NotifyPolicy = {
  mode: AttentionMode;
  keywords: string[];
  cooldown_ms: number;
  debounce_ms: number;
  quota_class: "api_key" | "operator_personal";
  policy_epoch: number;
  classifier?: "heuristic" | "llm";
};

export type NotifyEnvelope = {
  room_id: string;
  event: NotifyEvent;
  policy: NotifyPolicy;
  operator_member_id: string;
  trigger_member_id: string;
  last_human_seq: number;
  last_human_at: string;
  humans_typing: boolean;
  wake_budget_remaining: number;
};

export type PendingAmbient = {
  policy_epoch: number;
  envelope: NotifyEnvelope;
};

export type NotifyState = {
  last_dispatch: number | null;
  pending: PendingAmbient | null;
  current_policy_epoch?: number;
  hosted_stubs: Array<{ envelope: NotifyEnvelope }>;
};

export type NotifyDeps = {
  setAlarm: (delayMs: number) => void;
  runHeuristic?: (input: unknown) => unknown;
  state: NotifyState;
};

export type NotifyResult =
  | { action: "drop"; reason: string; persistable?: true }
  | { action: "dispatch_mention" }
  | { action: "set_alarm"; delayMs: number };

export function createNotifyState(): NotifyState {
  return { last_dispatch: null, pending: null, hosted_stubs: [] };
}

function cooldownElapsed(now: number, lastDispatch: number | null, cooldownMs: number): boolean {
  if (lastDispatch === null) return true;
  return now - lastDispatch >= cooldownMs;
}

function dispatchMention(envelope: NotifyEnvelope, now: number, deps: NotifyDeps): NotifyResult {
  const quota = canWake({
    quota_class: envelope.policy.quota_class,
    trigger_member_id: envelope.trigger_member_id,
    operator_member_id: envelope.operator_member_id,
  });
  if (!quota.ok) {
    return { action: "drop", reason: quota.code, persistable: true };
  }
  deps.state.hosted_stubs.push({ envelope });
  deps.state.last_dispatch = now;
  return { action: "dispatch_mention" };
}

/** Synchronous Inbox.notify. Ambient only records pending + setAlarm. Does not run heuristic. */
export function notify(envelope: NotifyEnvelope, self: string, now: number, deps: NotifyDeps): NotifyResult {
  const event = envelope.event;
  if (event.kind !== "message" || event.origin !== "local") {
    return { action: "drop", reason: "kind_or_origin" };
  }
  if (event.sender_id === self) {
    return { action: "drop", reason: "self" };
  }

  // INV-04: agent→agent wake only on explicit mention; @self uses mention path
  // even when mode is keyword or ambient. Silent stays silent.
  if (event.sender_kind === "agent") {
    if (!event.mentions.includes(self)) {
      return { action: "drop", reason: "agent_non_mention" };
    }
    if (envelope.policy.mode === "silent") {
      return { action: "drop", reason: "silent" };
    }
    if (!cooldownElapsed(now, deps.state.last_dispatch, envelope.policy.cooldown_ms)) {
      return { action: "drop", reason: "cooldown" };
    }
    return dispatchMention(envelope, now, deps);
  }

  switch (envelope.policy.mode) {
    case "silent":
      return { action: "drop", reason: "silent" };
    case "mention": {
      if (!event.mentions.includes(self)) {
        return { action: "drop", reason: "not_mentioned" };
      }
      if (!cooldownElapsed(now, deps.state.last_dispatch, envelope.policy.cooldown_ms)) {
        return { action: "drop", reason: "cooldown" };
      }
      return dispatchMention(envelope, now, deps);
    }
    case "keyword": {
      const loaded = loadKeywords(envelope.policy.keywords);
      if (!matchKeywords(event.body, loaded)) {
        return { action: "drop", reason: "keyword_miss" };
      }
      if (!cooldownElapsed(now, deps.state.last_dispatch, envelope.policy.cooldown_ms)) {
        return { action: "drop", reason: "cooldown" };
      }
      return dispatchMention(envelope, now, deps);
    }
    case "ambient": {
      deps.state.pending = { policy_epoch: envelope.policy.policy_epoch, envelope };
      if (
        deps.state.current_policy_epoch !== undefined &&
        envelope.policy.policy_epoch < deps.state.current_policy_epoch
      ) {
        deps.state.pending = null;
        return { action: "drop", reason: "stale_policy_epoch" };
      }
      const lastHumanAt = Date.parse(envelope.last_human_at);
      const remaining = envelope.policy.debounce_ms - (now - lastHumanAt);
      const delayMs = remaining > 0 ? remaining : 0;
      deps.setAlarm(delayMs);
      return { action: "set_alarm", delayMs };
    }
    default:
      return { action: "drop", reason: "unknown_mode" };
  }
}
