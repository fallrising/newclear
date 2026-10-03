import { loadKeywords, matchKeywords } from "./keyword.ts";
import { canWake, type QuotaClass } from "./quota.ts";

export type WakeHintInput = {
  self: string;
  mode: "silent" | "mention" | "keyword" | "ambient";
  keywords: string[];
  quota_class: QuotaClass;
  operator_member_id: string;
  sender_id: string;
  sender_kind: "human" | "agent";
  mentions: string[];
  body: string;
};

export type WakeHint = { mentioned: boolean; wake_allowed: boolean };

/**
 * B-12: the attention + quota + self/agent part of Inbox `notify` (src/notify.ts), without cooldown, wake budget,
 * debounce or the ambient heuristic — those belong to whoever dispatches (hosted Inbox, kith-runner, or the
 * external client). Ambient is treated like mention here: only an explicit @ is a hint to wake.
 */
export function wakeHint(input: WakeHintInput): WakeHint {
  const mentioned = input.mentions.includes(input.self);
  if (input.sender_id === input.self) return { mentioned, wake_allowed: false };
  let byAttention: boolean;
  if (input.sender_kind === "agent") {
    byAttention = mentioned && input.mode !== "silent"; // INV-04
  } else if (input.mode === "mention" || input.mode === "ambient") {
    byAttention = mentioned;
  } else if (input.mode === "keyword") {
    byAttention = matchKeywords(input.body, loadKeywords(input.keywords));
  } else {
    byAttention = false;
  }
  if (!byAttention) return { mentioned, wake_allowed: false };
  const quota = canWake({
    quota_class: input.quota_class,
    trigger_member_id: input.sender_id,
    operator_member_id: input.operator_member_id,
  });
  return { mentioned, wake_allowed: quota.ok };
}
