import { DurableObject } from "cloudflare:workers";
import {
  INTERNAL_HEADER,
  INTERNAL_ORIGIN,
  MEMBER_HEADER,
  ROOM_HEADER,
  flagOn,
  type Env,
} from "../env.ts";
import { paidCallsEnabled, reservePaidAttempt, releasePaidAttempt } from "../cost-controls.ts";
import {
  configuredModelAvailable,
  chatCompletion,
  createFakeFetch,
  listModelIds,
  type FakeLlm,
  type FetchLike,
} from "./llm.ts";
import { DEFAULT_MODEL_ID, buildMessages, isNoReply, systemPrompt, wrapTranscript } from "./prompt.ts";
import { BODY_MAX_BYTES } from "../../src/caps.ts";
import { utf8Bytes } from "../json.ts";
import { adapterFor } from "../providers/registry.ts";
import {
  hostedParams,
  loadAgentRuntime,
  resolveConnection,
  runtimeStatus,
  viewConnectionRow,
} from "../providers/runtime.ts";
import { LlmError, type LlmErrorClass, type NormalizedResult } from "../providers/types.ts";

export type BeginInput = {
  generation_id: string;
  agent_id: string;
  room_id: string;
  handle?: string;
  transcript?: string;
  trigger_seq?: number;
  runtime_epoch?: number;
};

export type BeginOk = { ok: true; generation_id: string };
export type BeginFail = { ok: false; code: string; message: string };
export type BeginResult = BeginOk | BeginFail;

type Job = {
  generation_id: string;
  agent_id: string;
  room_id: string;
  handle: string;
  transcript: string;
  trigger_seq: number;
  v2?: V2Job;
};

type Execution = {
  version: 1;
  generation_id: string;
  agent_id: string;
  room_id: string;
  phase: "initializing" | "pending" | "running" | "retry_wait" | "terminal";
  attempt: 0 | 1;
  deadline: number;
  not_before: number;
};
type ClaimedJob = { job: Job; execution: Execution; expired: boolean };

type RoomReleaseStub = DurableObjectStub & {
  admitHosted(generationId: string): Promise<{ ok: boolean; code?: string }>;
  releaseHosted(generationId: string): Promise<void>;
  releaseAmbient(generationId: string): Promise<void>;
  postStatus(
    roomId: string,
    memberId: string,
    state: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
  postReplyFailed(
    roomId: string,
    memberId: string,
    errorClass: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
  postDraft(
    roomId: string,
    memberId: string,
    generationId: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
};

export class HostedGeneration extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  /** Test RPC: inject fake GET /v1/models + POST /v1/chat/completions. Never a real key. */
  async setFakeLlm(fake: FakeLlm): Promise<void> {
    await this.ctx.storage.put("fake_llm", { text: fake.text, models: fake.models });
  }

  /**
   * Insert generations (dispatched) and schedule DO-local work. Does not await the model.
   * GET /v1/models is a start gate: missing grok-4.5 refuses without INSERT.
   */
  async begin(input: BeginInput): Promise<BeginResult> {
    if (!paidCallsEnabled(this.env)) {
      return { ok: false, code: "not_ready", message: "hosted execution requires explicit paid opt-in and limits" };
    }
    const generationId = typeof input.generation_id === "string" ? input.generation_id : "";
    const agentId = typeof input.agent_id === "string" ? input.agent_id : "";
    const roomId = typeof input.room_id === "string" ? input.room_id : "";
    if (!generationId || !agentId || !roomId) {
      return { ok: false, code: "invalid_request", message: "generation_id, agent_id, room_id required" };
    }

    const job: Job = {
      generation_id: generationId,
      agent_id: agentId,
      room_id: roomId,
      handle: "",
      transcript: typeof input.transcript === "string" ? input.transcript : "",
      trigger_seq: typeof input.trigger_seq === "number" ? input.trigger_seq : 0,
    };
    if (utf8Bytes(job.transcript) > CONTEXT_MAX_BYTES || !Number.isInteger(job.trigger_seq) || job.trigger_seq < 0) {
      return { ok: false, code: "invalid_request", message: "invalid hosted input" };
    }
    const now = Date.now();
    const execution: Execution = {
      version: 1, generation_id: generationId, agent_id: agentId, room_id: roomId,
      phase: "initializing", attempt: 0, deadline: now + GENERATION_TIMEOUT_MS, not_before: now,
    };
    // Identity and terminal tombstones survive restarts; a repeated begin cannot reset attempts or bindings.
    const created = await this.ctx.storage.transaction(async (txn) => {
      if (await txn.get("execution") || await txn.get("job")) return false;
      await txn.put({ execution, job });
      return true;
    });
    if (!created) return { ok: false, code: "generation_dropped", message: "generation already started" };

    try {
      // A bounded watchdog also cleans initialization interrupted before the work alarm was installed.
      await this.ctx.storage.setAlarm(execution.deadline);
      const handle = await this.resolveHandle(agentId, input.handle);
      if (!handle) return await this.rejectBegin(job, "not_found", "agent not found");
      job.handle = handle;
      const room = this.room(job);
      const admitted = await room.admitHosted(generationId);
      if (!admitted.ok) return await this.rejectBegin(job, admitted.code ?? "not_ready", "room hosted admission refused");
      const view = flagOn(this.env.ff_providers) ? await loadAgentRuntime(this.env, agentId) : null;
      if (view && view.runtime !== null) {
        if (view.runtime !== "hosted" || runtimeStatus(this.env, view) !== "ok") {
          return await this.rejectBegin(job, "runtime_unconfigured", "hosted runtime is not ready");
        }
        if (typeof input.runtime_epoch === "number" && input.runtime_epoch !== view.runtime_epoch) {
          return await this.rejectBegin(job, "generation_dropped", "runtime changed");
        }
        job.v2 = { runtime_epoch: view.runtime_epoch, attempt: 0 };
        await this.ctx.storage.put("job", job);
        await this.env.DB.prepare(
          `INSERT INTO generations (id, room_id, agent_id, trigger_seq, state, created_at, completed_at, connection_id, model, runtime_epoch)
           VALUES (?, ?, ?, ?, 'dispatched', ?, NULL, ?, ?, ?)`,
        ).bind(generationId, roomId, agentId, job.trigger_seq, new Date().toISOString(), view.connection_id, view.model, view.runtime_epoch).run();
      } else {
        await this.ctx.storage.put("job", job);
        if (!(await this.reserve(job, execution)) || !paidCallsEnabled(this.env)) {
          return await this.rejectBegin(job, "not_ready", "paid attempt admission refused");
        }
        const fetchImpl = await this.fetchImpl();
        if (!paidCallsEnabled(this.env)) return await this.rejectBegin(job, "not_ready", "hosted execution stopped");
        const ids = await listModelIds(fetchImpl, this.apiKey(), { timeoutMs: Math.min(MODEL_LIST_TIMEOUT_MS, this.remaining(execution)) });
        if (!configuredModelAvailable(ids, DEFAULT_MODEL_ID)) {
          return await this.rejectBegin(job, "not_ready", `configured model ${DEFAULT_MODEL_ID} is not in GET /v1/models`);
        }
        await this.env.DB.prepare(
          `INSERT INTO generations (id, room_id, agent_id, trigger_seq, state, created_at, completed_at)
           VALUES (?, ?, ?, ?, 'dispatched', ?, NULL)`,
        ).bind(generationId, roomId, agentId, job.trigger_seq, new Date().toISOString()).run();
      }
      if (!paidCallsEnabled(this.env) || this.remaining(execution) <= 0) {
        return await this.rejectBegin(job, "not_ready", "hosted execution stopped");
      }
      await this.ctx.storage.put("execution", { ...execution, phase: "pending" });
      await this.broadcastReply(roomId, agentId, "is replying");
      await this.ctx.storage.setAlarm(Date.now());
      return { ok: true, generation_id: generationId };
    } catch {
      return this.rejectBegin(job, "not_ready", "hosted initialization failed");
    }
  }

  /** Test RPC: run the scheduled job without calling reserved `alarm` over RPC. */
  async runScheduled(): Promise<void> {
    await this.runJob();
  }

  /** Runs fake/real chat completions, then Room internal send. Not invoked from Worker waitUntil. */
  async alarm(): Promise<void> {
    await this.runJob();
  }

  private async runJob(): Promise<void> {
    const claimed = await this.claimExecution();
    if (!claimed) return;
    const { job, execution } = claimed;
    if (claimed.expired || !paidCallsEnabled(this.env)) {
      try { await this.markGeneration(job.generation_id, "failed"); }
      finally {
        await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
        await this.finish(job);
      }
      return;
    }
    if (job.v2) return this.runJobV2({ ...job, v2: job.v2 }, execution);

    let failedClass: HostedErrorClass | null = null;
    try {
      if (!(await this.generationCanRun(job, execution))) return;
      const transitioned = await this.env.DB.prepare(
        `UPDATE generations SET state = 'streaming' WHERE id = ? AND state = 'dispatched'`,
      )
        .bind(job.generation_id)
        .run();
      if (transitioned.meta.changes !== 1) return;
      await this.ctx.storage.setAlarm(execution.deadline);
      if (!(await this.reserve(job, execution)) || !paidCallsEnabled(this.env)) {
        await this.markGeneration(job.generation_id, "failed");
        return;
      }
      const text = await this.runModel(job, execution);
      if (isNoReply(text)) {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }
      if (!text) {
        await this.markGeneration(job.generation_id, "failed");
        failedClass = "protocol";
        return;
      }
      const res = await beforeHostedDeadline(() => this.sendToRoom(job, truncateBody(text)), execution.deadline);
      if (!res.ok) {
        if (res.status === 409) {
          await this.markGeneration(job.generation_id, "dropped");
        } else {
          await this.markGeneration(job.generation_id, "failed");
          failedClass = "unknown";
        }
      }
    } catch (err) {
      await this.markGeneration(job.generation_id, "failed");
      failedClass = classifyHostedError(err);
    } finally {
      if (failedClass !== null) {
        await this.broadcastReplyFailed(job.room_id, job.agent_id, failedClass);
      }
      await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
      // Mention generations never acquired the lock; Room no-ops on generation_id mismatch.
      await this.finish(job);
    }
  }

  private async runJobV2(job: Job & { v2: V2Job }, execution: Execution): Promise<void> {
    let failedClass: LlmErrorClass | null = null;
    let rescheduled = false;
    let drafts: DraftThrottle | null = null;
    try {
      if (!(await this.generationCanRun(job, execution))) return;
      const transitioned = await this.env.DB.prepare(
        `UPDATE generations SET state = 'streaming' WHERE id = ? AND state = 'dispatched'`,
      )
        .bind(job.generation_id)
        .run();
      if (execution.attempt === 0 && transitioned.meta.changes !== 1) return;
      await this.ctx.storage.setAlarm(execution.deadline);

      const view = await loadAgentRuntime(this.env, job.agent_id);
      // RT-01.2: runtime changed (or connection vanished) since dispatch → drop, never persist.
      if (!view || view.runtime !== "hosted" || view.runtime_epoch !== job.v2.runtime_epoch) {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }
      const row = viewConnectionRow(view);
      const conn = row && runtimeStatus(this.env, view) === "ok" ? await resolveConnection(this.env, row) : null;
      const adapter = conn ? adapterFor(conn.api_format) : null;
      if (!conn || !adapter || !view.model) {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }

      const params = hostedParams(view.params_json);
      if (!(await this.reserve(job, execution)) || !paidCallsEnabled(this.env) || this.remaining(execution) <= 0) {
        await this.markGeneration(job.generation_id, "failed");
        return;
      }
      // B-10: stream only while ff_drafts=on; otherwise the runtime's stream setting is ignored.
      const streaming = params.stream && flagOn(this.env.ff_drafts);
      drafts = streaming ? new DraftThrottle((text) => this.broadcastDraft(job, text, execution)) : null;
      const addendum = view.system_prompt_addendum.trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.remaining(execution));
      let result: NormalizedResult;
      try {
        result = await beforeHostedDeadline(() => adapter.complete(
          conn,
          {
            model: view.model,
            system: addendum ? `${systemPrompt(job.handle)}\n\n${addendum}` : systemPrompt(job.handle),
            transcript: wrapTranscript(job.transcript),
            max_output_tokens: params.max_output_tokens,
            temperature: params.temperature,
            stream: streaming,
          },
          fetch,
          controller.signal,
          drafts ? (d) => drafts?.push(d.text) : undefined,
        ), execution.deadline);
      } finally {
        clearTimeout(timer);
        if (drafts) await beforeHostedDeadline(() => drafts!.settle(), execution.deadline);
      }

      // V2-INV-06: re-read the epoch after the model returns; a change during the call drops the reply.
      const after = await loadAgentRuntime(this.env, job.agent_id);
      if (!after || after.runtime_epoch !== job.v2.runtime_epoch) {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }
      await this.env.DB.prepare(`UPDATE generations SET input_tokens = ?, output_tokens = ? WHERE id = ?`)
        .bind(result.usage?.input_tokens ?? null, result.usage?.output_tokens ?? null, job.generation_id)
        .run();
      if (isNoReply(result.text) || result.text.trim() === "") {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }
      const res = await beforeHostedDeadline(() => this.sendToRoom(job, truncateBody(result.text)), execution.deadline);
      if (!res.ok) {
        if (res.status === 409) {
          await this.markGeneration(job.generation_id, "dropped");
        } else {
          await this.markFailed(job, "unknown");
          failedClass = "unknown";
        }
      }
    } catch (err) {
      const cls: LlmErrorClass = err instanceof LlmError ? err.errorClass
        : err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "unknown";
      if (drafts) {
        try { await beforeHostedDeadline(() => drafts!.settle(), execution.deadline); }
        catch { /* expired or lost drafts never start more work */ }
      }
      // No retry once a draft was shown: a second attempt would restart the visible text (03 §2.6 + B-10).
      if (err instanceof LlmError && RETRYABLE.has(cls) && RETRYABLE_HTTP.has(err.status ?? 0)
        && execution.attempt === 0 && !drafts?.sentAny && paidCallsEnabled(this.env)) {
        // A transport error/timeout has an unknown upstream outcome. Only an explicit HTTP refusal may retry.
        const wait = Math.min(RETRY_MAX_MS, Math.max(RETRY_DEFAULT_MS, err.retryAfterMs ?? RETRY_DEFAULT_MS));
        const when = Date.now() + wait;
        if (when < execution.deadline) {
          await this.ctx.storage.transaction(async (txn) => {
            await txn.put({
              job: { ...job, v2: { ...job.v2, attempt: 1 } },
              execution: { ...execution, phase: "retry_wait", attempt: 1, not_before: when },
            });
          });
          await this.ctx.storage.setAlarm(when);
          rescheduled = true;
          return;
        }
      }
      await this.markFailed(job, cls);
      failedClass = cls;
    } finally {
      if (!rescheduled) {
        if (failedClass !== null) {
          await this.broadcastReplyFailed(job.room_id, job.agent_id, failedClass);
        }
        await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
        await this.finish(job);
      }
    }
  }

  private remaining(execution: Execution): number {
    return execution.deadline - Date.now();
  }

  private room(job: Pick<Job, "room_id">): RoomReleaseStub {
    return this.env.ROOM.get(this.env.ROOM.idFromName(`room:${job.room_id}`)) as RoomReleaseStub;
  }

  private reserve(job: Job, execution: Execution): Promise<boolean> {
    if (this.remaining(execution) <= 0) return Promise.resolve(false);
    return reservePaidAttempt(this.env, {
      generationId: job.generation_id, agentId: job.agent_id, roomId: job.room_id, attempt: execution.attempt,
    });
  }

  private async generationCanRun(job: Job, execution: Execution): Promise<boolean> {
    const row = await this.env.DB.prepare(`SELECT room_id, agent_id, state FROM generations WHERE id = ?`)
      .bind(job.generation_id).first<{ room_id: string; agent_id: string; state: string }>();
    return row?.room_id === job.room_id && row.agent_id === job.agent_id
      && row.state === (execution.attempt === 0 ? "dispatched" : "streaming");
  }

  /** The claim is durable before fetch; interrupted running attempts never repeat an unknown paid result. */
  private async claimExecution(): Promise<ClaimedJob | null> {
    const now = Date.now();
    return this.ctx.storage.transaction<ClaimedJob | null>(async (txn) => {
      const job = await txn.get<Job>("job");
      if (!job) return null;
      const execution = await txn.get<Execution>("execution");
      // Legacy pending jobs have no attempt claim. Fail closed rather than guessing whether a call already ran.
      if (!execution) {
        return { job, execution: {
          version: 1, generation_id: job.generation_id, agent_id: job.agent_id, room_id: job.room_id,
          phase: "terminal", attempt: 0, deadline: now, not_before: now,
        }, expired: true };
      }
      if (execution.phase === "terminal") return null;
      const invalid = execution.version !== 1 || execution.generation_id !== job.generation_id
        || execution.agent_id !== job.agent_id || execution.room_id !== job.room_id
        || ![0, 1].includes(execution.attempt) || !Number.isFinite(execution.deadline)
        || execution.deadline > now + GENERATION_TIMEOUT_MS || !Number.isFinite(execution.not_before)
        || execution.not_before > execution.deadline || (execution.attempt === 1 && !job.v2)
        || (execution.phase === "pending" && execution.attempt !== 0)
        || (execution.phase === "retry_wait" && execution.attempt !== 1)
        || (job.v2 && job.v2.attempt !== execution.attempt);
      const expired = invalid || now >= execution.deadline;
      if (!expired && (execution.phase === "running" || execution.phase === "initializing" || now < execution.not_before)) return null;
      if (!expired && execution.phase !== "pending" && execution.phase !== "retry_wait") return null;
      await txn.put("execution", { ...execution, phase: "running" });
      return { job, execution, expired };
    });
  }

  private async rejectBegin(job: Job, code: string, message: string): Promise<BeginFail> {
    try { await this.markGeneration(job.generation_id, "failed"); }
    finally {
      await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
      await this.finish(job);
    }
    return { ok: false, code, message };
  }

  private async finish(job: Job): Promise<void> {
    try {
      await this.ctx.storage.transaction(async (txn) => {
        const prior = await txn.get<Execution>("execution");
        const now = Date.now();
        const terminal: Execution = {
          version: 1, generation_id: job.generation_id, agent_id: job.agent_id, room_id: job.room_id,
          phase: "terminal", attempt: prior?.attempt === 1 ? 1 : 0, deadline: prior?.deadline ?? now, not_before: now,
        };
        await txn.put("execution", terminal);
        await txn.delete(["job", "fake_llm"]);
      });
      await this.ctx.storage.deleteAlarm();
    } finally {
      // Releases do not refund spent daily reservations. Leases also have a bounded expiry if RPC is unavailable.
      try { await releasePaidAttempt(this.env, job.generation_id); } catch { /* bounded global lease */ }
      try { await this.room(job).releaseHosted(job.generation_id); } catch { /* bounded room lease */ }
      await this.releaseAmbientLock(job);
    }
  }

  /** B-10 frame through the Room; a lost draft never fails the generation. */
  private async broadcastDraft(job: Job, text: string, execution: Execution): Promise<void> {
    if (this.remaining(execution) <= 0 || !paidCallsEnabled(this.env)) return;
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${job.room_id}`)) as RoomReleaseStub;
      await beforeHostedDeadline(() => stub.postDraft(job.room_id, job.agent_id, job.generation_id, text), execution.deadline);
    } catch {
      /* drafts are best effort */
    }
  }

  /** generations.error_class + the side effects of 03 §2.6 (auth marks the connection, not_found the runtime). */
  private async markFailed(job: Job, cls: LlmErrorClass): Promise<void> {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE generations SET state = 'failed', error_class = ?, completed_at = ? WHERE id = ? AND state IN ('dispatched', 'streaming')`,
    )
      .bind(cls, now, job.generation_id)
      .run();
    if (cls === "auth") {
      await this.env.DB.prepare(
        `UPDATE provider_connections SET last_error_class = 'auth', last_checked_at = ?
         WHERE id = (SELECT connection_id FROM agent_runtimes WHERE agent_id = ?)`,
      )
        .bind(now, job.agent_id)
        .run();
    } else if (cls === "not_found") {
      await this.env.DB.prepare(`UPDATE agent_runtimes SET last_error_class = 'not_found' WHERE agent_id = ? AND runtime_epoch = ?`)
        .bind(job.agent_id, job.v2?.runtime_epoch ?? -1)
        .run();
    }
  }

  private async broadcastReplyFailed(roomId: string, memberId: string, errorClass: HostedErrorClass | LlmErrorClass): Promise<void> {
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${roomId}`)) as RoomReleaseStub;
      await stub.postReplyFailed(roomId, memberId, errorClass);
    } catch {
      /* a missed status line must not fail the generation */
    }
  }

  private async broadcastReply(roomId: string, memberId: string, body: "is replying" | "reply ended"): Promise<void> {
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${roomId}`)) as RoomReleaseStub;
      await stub.postStatus(roomId, memberId, "reply", body);
    } catch {
      /* a missed status line must not fail the generation */
    }
  }

  private async releaseAmbientLock(job: Job): Promise<void> {
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${job.room_id}`)) as RoomReleaseStub;
      await stub.releaseAmbient(job.generation_id);
    } catch {
      /* mention never acquired; Room no-ops on generation_id mismatch */
    }
  }

  private async runModel(job: Job, execution: Execution): Promise<string> {
    const messages = buildMessages(job.handle, job.transcript);
    const fetchImpl = await this.fetchImpl();
    if (!paidCallsEnabled(this.env) || this.remaining(execution) <= 0) throw new Error("hosted execution stopped");
    return chatCompletion(fetchImpl, this.apiKey(), messages, DEFAULT_MODEL_ID, { timeoutMs: this.remaining(execution) });
  }

  private async sendToRoom(job: Job, body: string): Promise<Response> {
    const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${job.room_id}`));
    const clientMessageId = `genreply-${job.generation_id}`.slice(0, 64);
    return stub.fetch(
      new Request(`${INTERNAL_ORIGIN}/rooms/${job.room_id}/send?room_id=${encodeURIComponent(job.room_id)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [INTERNAL_HEADER]: "1",
          [MEMBER_HEADER]: job.agent_id,
          [ROOM_HEADER]: job.room_id,
        },
        body: JSON.stringify({
          body,
          client_message_id: clientMessageId,
          thread_id: null,
          generation_id: job.generation_id,
        }),
      }),
    );
  }

  private async markGeneration(id: string, state: "dropped" | "failed"): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE generations SET state = ?, completed_at = ? WHERE id = ? AND state IN ('dispatched', 'streaming')`,
    )
      .bind(state, new Date().toISOString(), id)
      .run();
  }

  private async fetchImpl(): Promise<FetchLike> {
    const fake = await this.ctx.storage.get<FakeLlm>("fake_llm");
    if (fake && typeof fake.text === "string") return createFakeFetch(fake);
    const key = this.apiKey();
    if (key.length > 0) return fetch;
    const envFake = envFakeLlm(this.env);
    if (envFake) return createFakeFetch(envFake);
    return fetch;
  }

  private apiKey(): string {
    return this.env.XAI_API_KEY ?? "";
  }

  private async resolveHandle(agentId: string, provided?: string): Promise<string | null> {
    if (typeof provided === "string" && provided.length > 0) return provided;
    const row = await this.env.DB.prepare(`SELECT handle FROM members WHERE id = ? AND kind = 'agent'`)
      .bind(agentId)
      .first<{ handle: string }>();
    return row?.handle ?? null;
  }
}

function envFakeLlm(env: Env): FakeLlm | null {
  const text = env.FAKE_LLM_TEXT;
  if (typeof text !== "string" || text.length === 0) return null;
  return { text, models: parseEnvModels(env.FAKE_LLM_MODELS) };
}

function parseEnvModels(raw: string | undefined): string[] | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      return parsed;
    }
  } catch {
    /* comma-separated */
  }
  const models = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return models.length > 0 ? models : undefined;
}

export type HostedErrorClass =
  | "auth"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "network"
  | "protocol"
  | "unknown";

/** Map the v1 client's thrown errors to 03 §2.3 LlmErrorClass names (subset available before W4). */
export function classifyHostedError(err: unknown): HostedErrorClass {
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return "timeout";
  if (err instanceof LlmError && err.errorClass === "protocol") return "protocol";
  const message = err instanceof Error ? err.message : String(err);
  const status = /failed: (\d{3})$/.exec(message);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return "auth";
    if (code === 404) return "not_found";
    if (code === 400 || code === 422) return "bad_request";
    if (code === 429) return "rate_limited";
    if (code === 503 || code === 529) return "overloaded";
    return "unknown";
  }
  if (err instanceof TypeError) return "network";
  return "unknown";
}

type V2Job = { runtime_epoch: number; attempt: number };

const GENERATION_TIMEOUT_MS = 300_000; // FM-LLM-10, v1 limit
const MODEL_LIST_TIMEOUT_MS = 60_000;
const CONTEXT_MAX_BYTES = 16 * 1024;
const RETRY_DEFAULT_MS = 1_000;
const RETRY_MAX_MS = 10_000;
const RETRYABLE: ReadonlySet<LlmErrorClass> = new Set(["rate_limited", "overloaded"]);
const RETRYABLE_HTTP = new Set([429, 503, 529]);
const TRUNCATED_SUFFIX = "（已截斷）";

/** Bound local waiting and refuse new work at the deadline. Already-started platform RPC may remain pending. */
export async function beforeHostedDeadline<T>(run: () => Promise<T>, deadline: number, now: () => number = Date.now): Promise<T> {
  const remaining = deadline - now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > GENERATION_TIMEOUT_MS) {
    throw new DOMException("hosted execution deadline reached", "TimeoutError");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DOMException("hosted execution deadline reached", "TimeoutError")), remaining);
  });
  try { return await Promise.race([run(), expired]); }
  finally { clearTimeout(timer); }
}

/** 03 §2.5: over 8 KiB → cut on a code point boundary and append the suffix. */
export function truncateBody(text: string): string {
  if (utf8Bytes(text) <= BODY_MAX_BYTES) return text;
  const budget = BODY_MAX_BYTES - utf8Bytes(TRUNCATED_SUFFIX);
  let out = "";
  let used = 0;
  for (const ch of text) {
    const size = utf8Bytes(ch);
    if (used + size > budget) break;
    out += ch;
    used += size;
  }
  return out + TRUNCATED_SUFFIX;
}

export const DRAFT_MIN_INTERVAL_MS = 250; // 03 §2.4
export const DRAFT_MIN_CHARS = 64;

/**
 * Throttles cumulative-text drafts: send when ≥ 250 ms or ≥ 64 new characters since the last send.
 * Sends are chained so they arrive in order; above 8 KiB drafting stops and the final message is awaited (B-10).
 */
export class DraftThrottle {
  private text = "";
  private lastSentLength = 0;
  private lastSentAt = 0;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  sentAny = false;

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  push(delta: string): void {
    if (this.stopped) return;
    this.text += delta;
    if (utf8Bytes(this.text) > BODY_MAX_BYTES) {
      this.stopped = true;
      return;
    }
    const t = this.now();
    if (t - this.lastSentAt < DRAFT_MIN_INTERVAL_MS && this.text.length - this.lastSentLength < DRAFT_MIN_CHARS) return;
    this.lastSentAt = t;
    this.lastSentLength = this.text.length;
    this.sentAny = true;
    const snapshot = this.text;
    this.chain = this.chain.then(() => this.send(snapshot));
  }

  async settle(): Promise<void> {
    this.stopped = true;
    await this.chain;
  }
}
