import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tokenizeMentions } from "../src/mention.ts";
import { canWake } from "../src/quota.ts";
import { buildSpawn, cut, parseOutput, type Trigger } from "./adapters.ts";
import { AuthError, type KithClient } from "./client.ts";
import type { RunnerConfig } from "./config.ts";
import { readEvents, type RoomEvent } from "./events.ts";
import type { SpawnFn } from "./process.ts";
import type { RunnerState } from "./state.ts";

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export type RunnerDeps = {
  cfg: RunnerConfig;
  client: KithClient;
  state: RunnerState;
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
  log: Log;
  signal: AbortSignal;
};

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const DISCOVER_EVERY_MS = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/**
 * One queue for all rooms: at most one CLI runs at a time on this host (BR-44 asks for ≤ 1 per room; one per
 * runner is stricter and keeps CLI home directories single-user).
 */
export class Runner {
  private queue: Promise<void> = Promise.resolve();
  private readonly loops = new Map<string, Promise<void>>();
  private self: { id: string; handle: string } | null = null;
  private fatal: Error | null = null;
  private readonly abort = new AbortController();

  private readonly d: RunnerDeps;

  constructor(d: RunnerDeps) {
    this.d = d;
    d.signal.addEventListener("abort", () => this.abort.abort(), { once: true });
  }

  /** Resolves when stopped; rejects with AuthError on 401 (exit code 3, FM-RUN-06). */
  async run(): Promise<void> {
    this.self = await this.d.client.me();
    this.d.log("start", { handle: this.self.handle, adapter: this.d.cfg.adapter.kind, quota_class: this.d.cfg.quota_class });
    while (!this.abort.signal.aborted) {
      const rooms = this.d.cfg.rooms ?? (await this.d.client.listRooms()).slice(0, this.d.cfg.max_rooms);
      for (const room of rooms) {
        if (!this.loops.has(room)) {
          const loop = this.roomLoop(room).catch((e: unknown) => this.stop(e));
          this.loops.set(room, loop);
        }
      }
      await sleep(DISCOVER_EVERY_MS, this.abort.signal);
    }
    await Promise.allSettled([...this.loops.values(), this.queue]);
    if (this.fatal) throw this.fatal;
  }

  private stop(e: unknown): void {
    if (e instanceof AuthError) {
      this.fatal = e;
      this.d.log("fatal", { reason: "token_rejected" });
      this.abort.abort();
      return;
    }
    this.d.log("room_loop_error", { message: e instanceof Error ? e.message : String(e) });
  }

  private async roomLoop(room: string): Promise<void> {
    const signal = this.abort.signal;
    let cursor = this.d.state.cursor(room) ?? (await this.d.client.maxSeq(room));
    this.d.log("room", { room, after_seq: cursor });
    let backoff = BACKOFF_MIN_MS;
    while (!signal.aborted) {
      let res: Response;
      try {
        res = await this.d.client.events(room, cursor, signal);
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (signal.aborted) return;
        this.d.log("events_retry", { room, wait_ms: backoff });
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS); // FM-RUN-01
        continue;
      }
      if (res.status === 403 || res.status === 404) {
        await res.body?.cancel();
        this.d.log("room_gone", { room, status: res.status });
        this.loops.delete(room);
        return;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        continue;
      }
      backoff = BACKOFF_MIN_MS;
      try {
        for await (const item of readEvents(res.body)) {
          if (item.type === "gap") {
            this.d.log("gap", { room, cursor }); // reconnect from the cursor; the missed rows come back as replay:true
            break;
          }
          const ev = item.event;
          if (!Number.isFinite(ev.seq) || ev.seq <= cursor) continue;
          if (this.shouldRun(room, ev)) await this.enqueue(room, ev);
          cursor = ev.seq;
          this.d.state.setCursor(room, cursor);
        }
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (signal.aborted) return;
      }
      await sleep(500, signal);
    }
  }

  /** replay:true never runs (INV-19). Server hint first (B-12); local mention + quota as the fallback and as INV-13. */
  private shouldRun(room: string, ev: RoomEvent): boolean {
    if (ev.replay || ev.kind !== "message" || !this.self || ev.sender_id === this.self.id) return false;
    if (this.d.state.isDone(room, ev.seq)) return false; // FM-RUN-05
    const mentioned = ev.wake ? ev.wake.mentioned : tokenizeMentions(ev.body, [this.self.handle]).includes(this.self.handle.toLowerCase());
    const allowed = ev.wake ? ev.wake.wake_allowed : mentioned;
    if (!allowed) {
      if (mentioned) this.d.log("wake_skip", { room, seq: ev.seq, reason: "wake_not_allowed" }); // FM-RUN-08 metric
      return false;
    }
    if (this.d.cfg.quota_class === "operator_personal") {
      const gate = canWake({ quota_class: "operator_personal", trigger_member_id: ev.sender_id, operator_member_id: this.d.cfg.operator_member_id ?? "" });
      if (!gate.ok) {
        this.d.log("wake_skip", { room, seq: ev.seq, reason: gate.code }); // FM-RUN-08: no status, no CLI
        return false;
      }
    }
    return true;
  }

  private enqueue(room: string, ev: RoomEvent): Promise<void> {
    this.queue = this.queue.then(() => this.job(room, ev)).catch((e: unknown) => this.stop(e));
    return this.queue;
  }

  private async job(room: string, ev: RoomEvent): Promise<void> {
    if (!this.self || this.abort.signal.aborted) return;
    const c = this.d.client;
    const trigger: Trigger = { room_id: room, id: ev.id, seq: ev.seq, sender_id: ev.sender_id, body: ev.body, thread_id: ev.thread_id };
    const threadRoot = ev.thread_id ?? ev.id; // traces go under the trigger; a trigger inside a thread keeps that thread
    const idBase = `kr${ev.seq}-${room}`.slice(0, 56);
    this.d.log("job_start", { room, seq: ev.seq });
    await c.postStatus(room, "accepted");
    await c.postStatus(room, "running");
    const tmp = mkdtempSync(path.join(this.d.cfg.state_dir, "job-"));
    let out;
    try {
      const spec = buildSpawn(this.d.cfg, this.self.handle, trigger, tmp, this.d.env);
      const run = await this.d.spawn(spec, this.d.cfg.adapter.timeout_s * 1000);
      out = parseOutput(this.d.cfg.adapter.kind, run);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    let n = 0;
    for (const t of out.traces) {
      await c.postTrace(room, { client_message_id: `${idBase}-t${++n}`, summary: t.summary, full: t.full, thread_id: threadRoot });
    }
    if (out.ok) {
      if (out.reply !== "" && out.reply !== "NO_REPLY") await c.sendMessage(room, out.reply, `${idBase}-r`, ev.thread_id);
      await c.postStatus(room, "idle");
      this.d.log("job_done", { room, seq: ev.seq, traces: n });
    } else {
      await c.postStatus(room, "blocked"); // empty body: the WS frame then carries the state name itself
      await c.sendMessage(room, `（@${this.self.handle} 沒有完成：${cut(out.reason, 200)}）`, `${idBase}-f`, ev.thread_id);
      this.d.log("job_failed", { room, seq: ev.seq, reason: out.reason });
    }
    this.d.state.markDone(room, ev.seq);
  }
}
