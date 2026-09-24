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
import { DEFAULT_MODEL_ID, buildMessages, isNoReply } from "./prompt.ts";

export type BeginInput = {
  generation_id: string;
  agent_id: string;
  room_id: string;
  handle?: string;
  transcript?: string;
  trigger_seq?: number;
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

  private async broadcastReplyFailed(roomId: string, memberId: string, errorClass: HostedErrorClass): Promise<void> {
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
