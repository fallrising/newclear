import { DurableObject } from "cloudflare:workers";
import {
  INTERNAL_HEADER,
  INTERNAL_ORIGIN,
  MEMBER_HEADER,
  ROOM_HEADER,
  flagOn,
  type Env,
} from "../env.ts";
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
  type AgentRuntimeView,
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

type RoomReleaseStub = DurableObjectStub & {
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
    if (!flagOn(this.env.ff_hosted_agent)) {
      return { ok: false, code: "not_ready", message: "hosted agent is not enabled" };
    }
    const generationId = typeof input.generation_id === "string" ? input.generation_id : "";
    const agentId = typeof input.agent_id === "string" ? input.agent_id : "";
    const roomId = typeof input.room_id === "string" ? input.room_id : "";
    if (!generationId || !agentId || !roomId) {
      return { ok: false, code: "invalid_request", message: "generation_id, agent_id, room_id required" };
    }

    const handle = await this.resolveHandle(agentId, input.handle);
    if (!handle) {
      return { ok: false, code: "not_found", message: "agent not found" };
    }

    const job: Job = {
      generation_id: generationId,
      agent_id: agentId,
      room_id: roomId,
      handle,
      transcript: typeof input.transcript === "string" ? input.transcript : "",
      trigger_seq: typeof input.trigger_seq === "number" ? input.trigger_seq : 0,
    };
    if (flagOn(this.env.ff_providers)) {
      const view = await loadAgentRuntime(this.env, agentId);
      if (view && view.runtime !== null) return this.beginV2(input, job, view);
    }
    await this.ctx.storage.put("job", job);

    try {
      const ids = await listModelIds(await this.fetchImpl(), this.apiKey());
      if (!configuredModelAvailable(ids, DEFAULT_MODEL_ID)) {
        await this.ctx.storage.delete("job");
        return {
          ok: false,
          code: "not_ready",
          message: `configured model ${DEFAULT_MODEL_ID} is not in GET /v1/models`,
        };
      }
    } catch (err) {
      await this.ctx.storage.delete("job");
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "not_ready", message };
    }

    const now = new Date().toISOString();
    try {
      await this.env.DB.prepare(
        `INSERT INTO generations (id, room_id, agent_id, trigger_seq, state, created_at, completed_at)
         VALUES (?, ?, ?, ?, 'dispatched', ?, NULL)`,
      )
        .bind(generationId, roomId, agentId, job.trigger_seq, now)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "not_ready", message };
    }

    await this.broadcastReply(roomId, agentId, "is replying");
    try {
      // Next tick (delay 0). Absolute epoch 0 is rejected by the runtime.
      await this.ctx.storage.setAlarm(Date.now());
    } catch (err) {
      await this.broadcastReply(roomId, agentId, "reply ended");
      throw err;
    }
    return { ok: true, generation_id: generationId };
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
    const job = await this.ctx.storage.get<Job>("job");
    if (!job) return;
    if (job.v2) return this.runJobV2({ ...job, v2: job.v2 });

    let failedClass: HostedErrorClass | null = null;
    try {
      await this.env.DB.prepare(
        `UPDATE generations SET state = 'streaming' WHERE id = ? AND state = 'dispatched'`,
      )
        .bind(job.generation_id)
        .run();

      const text = await this.runModel(job);
      if (isNoReply(text)) {
        await this.markGeneration(job.generation_id, "dropped");
        return;
      }
      if (!text) {
        await this.markGeneration(job.generation_id, "failed");
        failedClass = "protocol";
        return;
      }
      const res = await this.sendToRoom(job, text);
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
      await this.releaseAmbientLock(job);
    }
  }

  /**
   * v2 path (ff_providers=on and the agent has an agent_runtimes row). No GET /models start gate:
   * V2-INV-05 is decided by runtime_status before any INSERT.
   */
  private async beginV2(input: BeginInput, job: Job, view: AgentRuntimeView): Promise<BeginResult> {
    if (view.runtime !== "hosted") {
      return { ok: false, code: "not_ready", message: "agent runtime is not hosted" };
    }
    if (runtimeStatus(this.env, view) !== "ok") {
      return { ok: false, code: "runtime_unconfigured", message: "hosted runtime is not ready" };
    }
    if (typeof input.runtime_epoch === "number" && input.runtime_epoch !== view.runtime_epoch) {
      return { ok: false, code: "generation_dropped", message: "runtime changed" };
    }
    const v2Job: Job = { ...job, v2: { runtime_epoch: view.runtime_epoch, attempt: 0 } };
    await this.ctx.storage.put("job", v2Job);
    try {
      await this.env.DB.prepare(
        `INSERT INTO generations (id, room_id, agent_id, trigger_seq, state, created_at, completed_at, connection_id, model, runtime_epoch)
         VALUES (?, ?, ?, ?, 'dispatched', ?, NULL, ?, ?, ?)`,
      )
        .bind(job.generation_id, job.room_id, job.agent_id, job.trigger_seq, new Date().toISOString(),
          view.connection_id, view.model, view.runtime_epoch)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "not_ready", message };
    }
    await this.broadcastReply(job.room_id, job.agent_id, "is replying");
    try {
      await this.ctx.storage.setAlarm(Date.now());
    } catch (err) {
      await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
      throw err;
    }
    return { ok: true, generation_id: job.generation_id };
  }

  private async runJobV2(job: Job & { v2: V2Job }): Promise<void> {
    let failedClass: LlmErrorClass | null = null;
    let rescheduled = false;
    let drafts: DraftThrottle | null = null;
    try {
      await this.env.DB.prepare(
        `UPDATE generations SET state = 'streaming' WHERE id = ? AND state = 'dispatched'`,
      )
        .bind(job.generation_id)
        .run();

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
      // B-10: stream only while ff_drafts=on; otherwise the runtime's stream setting is ignored.
      const streaming = params.stream && flagOn(this.env.ff_drafts);
      drafts = streaming ? new DraftThrottle((text) => this.broadcastDraft(job, text)) : null;
      const addendum = view.system_prompt_addendum.trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
      let result: NormalizedResult;
      try {
        result = await adapter.complete(
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
        );
      } finally {
        clearTimeout(timer);
        await drafts?.settle(); // every draft is delivered before the final event or the failure (FM-SYNC-14)
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
      const res = await this.sendToRoom(job, truncateBody(result.text));
      if (!res.ok) {
        if (res.status === 409) {
          await this.markGeneration(job.generation_id, "dropped");
        } else {
          await this.markFailed(job, "unknown");
          failedClass = "unknown";
        }
      }
    } catch (err) {
      const cls: LlmErrorClass = err instanceof LlmError ? err.errorClass : "unknown";
      await drafts?.settle();
      // No retry once a draft was shown: a second attempt would restart the visible text (03 §2.6 + B-10).
      if (RETRYABLE.has(cls) && job.v2.attempt === 0 && !drafts?.sentAny) {
        // 03 §2.6: one retry, scheduled with a DO alarm (never sleep).
        const wait = err instanceof LlmError && err.retryAfterMs !== undefined ? err.retryAfterMs : RETRY_DEFAULT_MS;
        await this.ctx.storage.put("job", { ...job, v2: { ...job.v2, attempt: 1 } });
        await this.ctx.storage.setAlarm(Date.now() + wait);
        rescheduled = true;
        return;
      }
      await this.markFailed(job, cls);
      failedClass = cls;
    } finally {
      if (!rescheduled) {
        if (failedClass !== null) {
          await this.broadcastReplyFailed(job.room_id, job.agent_id, failedClass);
        }
        await this.broadcastReply(job.room_id, job.agent_id, "reply ended");
        await this.releaseAmbientLock(job);
      }
    }
  }

  /** B-10 frame through the Room; a lost draft never fails the generation. */
  private async broadcastDraft(job: Job, text: string): Promise<void> {
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(`room:${job.room_id}`)) as RoomReleaseStub;
      await stub.postDraft(job.room_id, job.agent_id, job.generation_id, text);
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

  private async runModel(job: Job): Promise<string> {
    const messages = buildMessages(job.handle, job.transcript);
    return chatCompletion(await this.fetchImpl(), this.apiKey(), messages, DEFAULT_MODEL_ID);
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
  | "network"
  | "protocol"
  | "unknown";

/** Map the v1 client's thrown errors to 03 §2.3 LlmErrorClass names (subset available before W4). */
export function classifyHostedError(err: unknown): HostedErrorClass {
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
const RETRY_DEFAULT_MS = 1_000;
const RETRYABLE: ReadonlySet<LlmErrorClass> = new Set(["rate_limited", "overloaded", "timeout", "network"]);
const TRUNCATED_SUFFIX = "（已截斷）";

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
