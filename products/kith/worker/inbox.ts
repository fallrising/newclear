import { DurableObject } from "cloudflare:workers";
import { INBOX_LIVE_BUFFER } from "../src/caps.ts";
import { evaluateHeuristic } from "../src/heuristic.ts";
import {
  createNotifyState,
  notify,
  type AttentionMode,
  type NotifyEnvelope,
  type NotifyPolicy,
  type PendingAmbient,
} from "../src/notify.ts";
import { canWake } from "../src/quota.ts";
import { flagOn, type Env } from "./env.ts";
import type { BeginInput, BeginResult } from "./hosted/generation.ts";
import { loadAgentRuntime, runtimeStatus } from "./providers/runtime.ts";
import { inc } from "./metrics.ts";
import type { AcquireAmbientResult, ConsumeWakeBudgetResult, RoomActivity } from "./room.ts";

/** Minimal live-tail item. M3 notify is a buffer; attention/LLM come later. */
export type InboxNotifyPayload = {
  seq: number;
  kind: string;
  room_id: string;
  id: string;
  body: string;
  sender_id: string;
  origin: string;
  /** Inbox owner (self). Room sets this per agent on fanout. */
  member_id?: string;
  /** Member ids mentioned in the event body. */
  mentions?: string[];
  sender_kind?: "human" | "agent";
  thread_id?: string | null;
  created_at?: string;
};

type Waiter = {
  cursor: number;
  resolve: (items: InboxNotifyPayload[]) => void;
  settled: boolean;
};

type HostedBeginStub = DurableObjectStub & {
  begin(input: BeginInput): Promise<BeginResult>;
};

type RoomAmbientStub = DurableObjectStub & {
  activity(roomId: string): Promise<RoomActivity>;
  tryAcquireAmbient(roomId: string, agentId: string, generationId: string): Promise<AcquireAmbientResult>;
  consumeWakeBudget(): Promise<ConsumeWakeBudgetResult>;
  releaseAmbient(generationId: string): Promise<void>;
};

type PolicyRow = {
  attention_mode: string;
  keywords_json: string;
  cooldown_ms: number;
  debounce_ms: number;
  classifier: string;
  policy_epoch: number;
  quota_class: string;
  handle: string;
};

const ATTENTION_MODES = new Set<AttentionMode>(["silent", "mention", "keyword", "ambient"]);

export class Inbox extends DurableObject<Env> {
  private waiters: Waiter[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  /** Append message|trace to the ring buffer. Status is dropped. No sleep/LLM. */
  async notify(payload: InboxNotifyPayload): Promise<{ accepted: boolean }> {
    const started = Date.now();
    const kind = typeof payload?.kind === "string" ? payload.kind : "";
    if (kind === "status" || (kind !== "message" && kind !== "trace")) {
      await this.ctx.storage.put("last_notify_elapsed_ms", Date.now() - started);
      return { accepted: false };
    }
    const items = (await this.ctx.storage.get<InboxNotifyPayload[]>("buffer")) ?? [];
    items.push(payload);
    if (items.length > INBOX_LIVE_BUFFER) {
      items.splice(0, items.length - INBOX_LIVE_BUFFER);
    }
    const notifyCount = ((await this.ctx.storage.get<number>("notify_count")) ?? 0) + 1;
    const identity: Record<string, unknown> = { buffer: items, notify_count: notifyCount };
    if (typeof payload.room_id === "string" && payload.room_id) identity.room_id = payload.room_id;
    if (typeof payload.member_id === "string" && payload.member_id) identity.member_id = payload.member_id;
    await this.ctx.storage.put(identity);
    this.wakeWaiters(items);
    await this.maybeDispatchMention(payload);
    await this.ctx.storage.put("last_notify_elapsed_ms", Date.now() - started);
    return { accepted: true };
  }

  async liveAfter(cursorSeq: number): Promise<InboxNotifyPayload[]> {
    const items = (await this.ctx.storage.get<InboxNotifyPayload[]>("buffer")) ?? [];
    return items.filter((item) => item.seq > cursorSeq).sort((a, b) => a.seq - b.seq);
  }

  /** Wait until the ring has seq > cursor. notify() must not sleep; this may poll. */
  async waitAfter(cursorSeq: number): Promise<InboxNotifyPayload[]> {
    const existing = await this.liveAfter(cursorSeq);
    if (existing.length > 0) return existing;
    return new Promise<InboxNotifyPayload[]>((resolve) => {
      const waiter: Waiter = { cursor: cursorSeq, resolve, settled: false };
      this.waiters.push(waiter);
      const tick = (): void => {
        if (waiter.settled) return;
        void this.liveAfter(cursorSeq).then((items) => {
          if (waiter.settled) return;
          if (items.length > 0) {
            waiter.settled = true;
            this.waiters = this.waiters.filter((w) => w !== waiter);
            resolve(items);
            return;
          }
          setTimeout(tick, 25);
        });
      };
      setTimeout(tick, 25);
    });
  }

  async notifyCount(): Promise<number> {
    return (await this.ctx.storage.get<number>("notify_count")) ?? 0;
  }

  /** Test RPC: last persistable/notify drop reason (INV-13). */
  async lastRejectCode(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("last_reject_code")) ?? null;
  }

  /** Test RPC: wall time of the last notify() body, excluding RPC overhead. */
  async lastNotifyElapsedMs(): Promise<number | null> {
    const value = await this.ctx.storage.get<number>("last_notify_elapsed_ms");
    return value === undefined ? null : value;
  }

  /** Test RPC: true only after alarm() calls evaluateHeuristic. */
  async lastHeuristicRan(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>("last_heuristic_ran")) === true;
  }

  /** Test RPC: delay passed to setAlarm from notify() or a debounce re-arm. */
  async lastAlarmDelayMs(): Promise<number | null> {
    const value = await this.ctx.storage.get<number>("last_alarm_delay_ms");
    return value === undefined ? null : value;
  }

  /** Test RPC: pending ambient envelope, if any. */
  async pendingAmbient(): Promise<PendingAmbient | null> {
    return (await this.ctx.storage.get<PendingAmbient>("pending")) ?? null;
  }

  /** Test RPC: scheduled alarm timestamp (live getAlarm, else last setAlarm target). */
  async alarmAt(): Promise<number | null> {
    const live = await this.ctx.storage.getAlarm();
    if (typeof live === "number") return live;
    const stored = await this.ctx.storage.get<number>("last_alarm_at");
    return stored === undefined ? null : stored;
  }

  /** Test RPC: run the ambient alarm without calling reserved `alarm` over RPC. */
  async runScheduled(): Promise<void> {
    await this.runAmbientAlarm();
  }

  async alarm(): Promise<void> {
    await this.runAmbientAlarm();
  }

  private async maybeDispatchMention(payload: InboxNotifyPayload): Promise<void> {
    if (!flagOn(this.env.ff_hosted_agent) && !flagOn(this.env.ff_ambient)) return;
    if (payload.kind !== "message") return;
    const origin = typeof payload.origin === "string" ? payload.origin : "";
    if (origin !== "local") return;

    const roomId =
      typeof payload.room_id === "string" && payload.room_id
        ? payload.room_id
        : ((await this.ctx.storage.get<string>("room_id")) ?? "");
    const self =
      typeof payload.member_id === "string" && payload.member_id
        ? payload.member_id
        : ((await this.ctx.storage.get<string>("member_id")) ?? "");
    if (!roomId || !self) return;

    const policyRow = await this.loadPolicy(roomId, self);
    if (!policyRow) return;

    const mode = ATTENTION_MODES.has(policyRow.attention_mode as AttentionMode)
      ? (policyRow.attention_mode as AttentionMode)
      : "silent";

    const operator = await this.env.DB.prepare(
      `SELECT id FROM members WHERE is_operator = 1 AND disabled_at IS NULL LIMIT 1`,
    ).first<{ id: string }>();
    const operatorMemberId = operator?.id ?? "";

    const cooldownMs = Number(policyRow.cooldown_ms);
    const debounceMs = Number(policyRow.debounce_ms);
    const policy: NotifyPolicy = {
      mode,
      keywords: parseKeywords(policyRow.keywords_json),
      cooldown_ms: Number.isFinite(cooldownMs) ? cooldownMs : 15_000,
      debounce_ms: Number.isFinite(debounceMs) ? debounceMs : 2_000,
      quota_class: policyRow.quota_class === "operator_personal" ? "operator_personal" : "api_key",
      policy_epoch: Number(policyRow.policy_epoch) || 1,
      classifier: policyRow.classifier === "llm" ? "llm" : "heuristic",
    };

    const senderKind = payload.sender_kind === "agent" ? "agent" : "human";
    const mentions = Array.isArray(payload.mentions)
      ? payload.mentions.filter((id) => typeof id === "string")
      : [];
    const createdAt =
      typeof payload.created_at === "string" && payload.created_at ? payload.created_at : new Date().toISOString();
    const lastDispatch = (await this.ctx.storage.get<number>("last_dispatch")) ?? null;
    const state = createNotifyState();
    state.last_dispatch = lastDispatch;
    state.current_policy_epoch = policy.policy_epoch;

    const envelope: NotifyEnvelope = {
      room_id: roomId,
      event: {
        id: payload.id,
        seq: payload.seq,
        kind: payload.kind,
        sender_id: payload.sender_id,
        sender_kind: senderKind,
        body: payload.body,
        mentions,
        thread_id: payload.thread_id ?? null,
        origin,
      },
      policy,
      operator_member_id: operatorMemberId,
      trigger_member_id: payload.sender_id,
      last_human_seq: senderKind === "human" ? payload.seq : 0,
      last_human_at: senderKind === "human" ? createdAt : "1970-01-01T00:00:00.000Z",
      humans_typing: false,
      wake_budget_remaining: 4,
    };

    const result = notify(envelope, self, Date.now(), {
      setAlarm: () => {
        /* actual ctx.storage.setAlarm runs after notify returns */
      },
      state,
    });

    if (result.action === "drop") {
      await this.noteWakeReject(result.reason);
      return;
    }

    if (result.action === "set_alarm") {
      if (!flagOn(this.env.ff_ambient)) return;
      await this.ctx.storage.delete("last_reject_code");
      const when = Date.now() + result.delayMs;
      await this.ctx.storage.put({
        pending: state.pending,
        last_alarm_delay_ms: result.delayMs,
        last_alarm_at: when,
        last_heuristic_ran: false,
      });
      // delay 0 → Date.now() next tick; epoch 0 is rejected by the runtime.
      await this.ctx.storage.setAlarm(when);
      return;
    }

    if (result.action !== "dispatch_mention") return;
    // Keyword hosted is not this path. Ambient human uses set_alarm; agent @self uses mention.
    if (mode !== "mention" && senderKind !== "agent") return;
    if (!flagOn(this.env.ff_hosted_agent)) return;
    const gate = await this.hostedGate(self, policy.quota_class);
    if (!gate.go) {
      if (gate.code) await this.noteWakeReject(gate.code);
      return;
    }

    const generationId = crypto.randomUUID();
    await this.ctx.storage.delete("last_reject_code");
    await this.ctx.storage.put({
      last_dispatch: state.last_dispatch ?? Date.now(),
      last_generation_id: generationId,
    });
    void this.dispatchHosted({
      generationId,
      agentId: self,
      roomId,
      handle: policyRow.handle,
      transcript: payload.body,
      triggerSeq: payload.seq,
      runtimeEpoch: gate.runtime_epoch,
      waitUntil: true,
    });
  }

  private async runAmbientAlarm(): Promise<void> {
    const pending = (await this.ctx.storage.get<PendingAmbient>("pending")) ?? null;
    if (!pending) return;
    if (!flagOn(this.env.ff_ambient)) {
      await this.ctx.storage.delete("pending");
      return;
    }

    const roomId = pending.envelope.room_id;
    const self = (await this.ctx.storage.get<string>("member_id")) ?? "";
    if (!roomId || !self) {
      await this.ctx.storage.delete("pending");
      return;
    }

    const policyRow = await this.loadPolicy(roomId, self);
    if (!policyRow || pending.policy_epoch < (Number(policyRow.policy_epoch) || 1)) {
      await this.ctx.storage.delete("pending");
      return;
    }

    const room = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${roomId}`)) as RoomAmbientStub;
    const act = await room.activity(roomId);
    const now = Date.now();
    const debounceMs = pending.envelope.policy.debounce_ms;
    const lastHumanMs = act.last_human_at ? Date.parse(act.last_human_at) : Number.NaN;
    const withinDebounce = Number.isFinite(lastHumanMs) && now - lastHumanMs < debounceMs;
    if (act.humans_typing || withinDebounce) {
      const when = now + debounceMs;
      await this.ctx.storage.put({ last_alarm_delay_ms: debounceMs, last_alarm_at: when });
      await this.ctx.storage.setAlarm(when);
      return;
    }

    await this.ctx.storage.put("last_heuristic_ran", true);
    const event = pending.envelope.event;
    if (
      !evaluateHeuristic({
        body: event.body,
        sender_kind: event.sender_kind,
        recent_10_has_agent: act.recent_10_has_agent,
      })
    ) {
      await this.ctx.storage.delete("pending");
      return;
    }

    let acquired = false;
    let dispatched = false;
    const generationId = crypto.randomUUID();
    try {
      const cas = await room.tryAcquireAmbient(roomId, self, generationId);
      if (!cas.ok) return;
      acquired = true;
      const budget = await room.consumeWakeBudget();
      if (!budget.ok) {
        await this.noteWakeReject(budget.code);
        return;
      }
      const quota = canWake({
        quota_class: pending.envelope.policy.quota_class,
        trigger_member_id: pending.envelope.trigger_member_id,
        operator_member_id: pending.envelope.operator_member_id,
      });
      if (!quota.ok) {
        await this.noteWakeReject(quota.code);
        return;
      }
      if (!flagOn(this.env.ff_hosted_agent)) return;
      const gate = await this.hostedGate(self, pending.envelope.policy.quota_class);
      if (!gate.go) {
        if (gate.code) await this.noteWakeReject(gate.code);
        return;
      }
      const started = await this.dispatchHosted({
        generationId,
        agentId: self,
        roomId,
        handle: policyRow.handle,
        transcript: event.body,
        triggerSeq: event.seq,
        runtimeEpoch: gate.runtime_epoch,
        waitUntil: false,
      });
      if (!started.ok) {
        await this.noteWakeReject(started.code);
        return;
      }
      dispatched = true;
      await this.ctx.storage.delete("pending");
      await this.ctx.storage.delete("last_reject_code");
      await this.ctx.storage.put({
        last_dispatch: now,
        last_generation_id: generationId,
      });
    } finally {
      if (acquired && !dispatched) {
        await room.releaseAmbient(generationId);
      }
    }
  }

  private async noteWakeReject(code: string): Promise<void> {
    await this.ctx.storage.put("last_reject_code", code);
    inc("wake_total", { result: code });
  }

  private async loadPolicy(roomId: string, self: string): Promise<PolicyRow | null> {
    return this.env.DB.prepare(
      `SELECT rm.attention_mode, rm.keywords_json, rm.cooldown_ms, rm.debounce_ms,
              rm.classifier, rm.policy_epoch, m.quota_class, m.handle
       FROM room_members rm
       JOIN members m ON m.id = rm.member_id
       WHERE rm.room_id = ? AND rm.member_id = ? AND m.disabled_at IS NULL`,
    )
      .bind(roomId, self)
      .first<PolicyRow>();
  }

  /**
   * v2 (ff_providers=on, agent has a runtime row): only `hosted` dispatches here; runner / external read
   * /mcp/events. runtime_status other than ok → no generation (V2-INV-05). Otherwise the v1 rule.
   */
  private async hostedGate(
    agentId: string,
    quotaClass: string,
  ): Promise<{ go: false; code?: string } | { go: true; runtime_epoch?: number }> {
    if (flagOn(this.env.ff_providers)) {
      const view = await loadAgentRuntime(this.env, agentId);
      if (view && view.runtime !== null) {
        if (view.runtime !== "hosted") return { go: false };
        if (runtimeStatus(this.env, view) !== "ok") return { go: false, code: "runtime_unconfigured" };
        return { go: true, runtime_epoch: view.runtime_epoch };
      }
    }
    // v1: operator_personal is the sidecar path (INV-13 local). Do not also run HostedGeneration.
    return quotaClass === "operator_personal" ? { go: false } : { go: true };
  }

  private dispatchHosted(input: {
    generationId: string;
    agentId: string;
    roomId: string;
    handle: string;
    transcript: string;
    triggerSeq: number;
    runtimeEpoch?: number;
    waitUntil: boolean;
  }): Promise<BeginResult> {
    const stub = this.env.HOSTED.get(this.env.HOSTED.idFromName(input.generationId)) as HostedBeginStub;
    const run = stub
      .begin({
        generation_id: input.generationId,
        agent_id: input.agentId,
        room_id: input.roomId,
        handle: input.handle,
        transcript: input.transcript,
        trigger_seq: input.triggerSeq,
        runtime_epoch: input.runtimeEpoch,
      })
      .catch((): BeginResult => ({ ok: false, code: "not_ready", message: "hosted begin failed" }));
    // begin() inserts + setAlarm; do not await the model. waitUntil keeps the notify RPC alive.
    if (input.waitUntil && typeof this.ctx.waitUntil === "function") {
      this.ctx.waitUntil(run.then(() => undefined));
    }
    return run;
  }

  private wakeWaiters(items: InboxNotifyPayload[]): void {
    if (this.waiters.length === 0) return;
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.settled) continue;
      const hit = items.filter((item) => item.seq > waiter.cursor).sort((a, b) => a.seq - b.seq);
      if (hit.length > 0) {
        waiter.settled = true;
        waiter.resolve(hit);
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }
}

function parseKeywords(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
