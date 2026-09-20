import { tokenizeMentions } from "../src/mention.ts";
import { canWake } from "../src/quota.ts";
import { botTokenFromEnv, type SidecarConfig } from "./config.ts";
import {
  eventsUrl,
  mcpToolCall,
  postStatusAccepted,
  postTrace,
  sendMessage,
  type FetchFn,
  type HttpCall,
} from "./mcp.ts";
import { buildPrompt, summarizeCliOutput } from "./prompt.ts";
import {
  assertArgvOmitsRoomBody,
  buildCodexArgv,
  defaultSpawn,
  type SpawnFn,
  type SpawnResult,
} from "./spawn.ts";

export type SidecarEvent = {
  seq: number;
  kind: string;
  body?: string;
  sender_id?: string;
  replay: boolean;
  hint?: string;
};

export type SidecarMetrics = {
  wake_total: Record<string, number>;
};

export type ConsumeResult = {
  afterSeq: number;
  cursor: number;
  cliCount: number;
  metrics: SidecarMetrics;
  posts: HttpCall[];
  prompts: string[];
  traces: string[];
  sends: string[];
  logs: string[];
  argvList: string[][];
  stdinList: string[];
  spawnResults: SpawnResult[];
};

export type ConsumeOptions = {
  config: SidecarConfig;
  events: SidecarEvent[];
  fetch: FetchFn;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  /** Persisted last_live_seq. Absent ⇒ use maxSeq (never implicit 0). */
  cursor?: number | null;
  /** Injected MAX(seq) for tests / first start. */
  maxSeq?: number | null;
  newId?: () => string;
};

export function initialAfterSeq(input: { cursor?: number | null; maxSeq?: number | null }): number {
  if (input.cursor != null && Number.isFinite(input.cursor)) return input.cursor;
  if (input.maxSeq != null && Number.isFinite(input.maxSeq)) return input.maxSeq;
  throw new Error("sidecar refuses default after_seq=0; inject maxSeq or persist a cursor");
}

export function parseSseEvents(text: string): SidecarEvent[] {
  const events: SidecarEvent[] = [];
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const obj = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    events.push({
      seq: Number(obj.seq),
      kind: String(obj.kind ?? ""),
      body: typeof obj.body === "string" ? obj.body : "",
      sender_id: typeof obj.sender_id === "string" ? obj.sender_id : "",
      replay: obj.replay === true,
      hint: typeof obj.hint === "string" ? obj.hint : undefined,
    });
  }
  return events;
}

function recordPost(posts: HttpCall[], url: string, method: string, body: string): void {
  posts.push({ url, method, body });
}

function wrapFetch(fetchImpl: FetchFn, posts: HttpCall[]): FetchFn {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = init?.body == null ? "" : String(init.body);
    if (method !== "GET") recordPost(posts, url, method, body);
    return fetchImpl(input, init);
  };
}

function bumpMetric(metrics: SidecarMetrics, result: string): void {
  metrics.wake_total[result] = (metrics.wake_total[result] ?? 0) + 1;
}

export async function consumeEvents(opts: ConsumeOptions): Promise<ConsumeResult> {
  const afterSeq = initialAfterSeq({ cursor: opts.cursor, maxSeq: opts.maxSeq });
  const env = opts.env ?? process.env;
  const token = botTokenFromEnv(env);
  const posts: HttpCall[] = [];
  const fetchImpl = wrapFetch(opts.fetch, posts);
  const spawnImpl = opts.spawn ?? defaultSpawn;
  const logs: string[] = [];
  const prompts: string[] = [];
  const traces: string[] = [];
  const sends: string[] = [];
  const argvList: string[][] = [];
  const stdinList: string[] = [];
  const spawnResults: SpawnResult[] = [];
  const metrics: SidecarMetrics = { wake_total: {} };
  let cursor = afterSeq;
  let cliCount = 0;
  const handle = opts.config.agent_handle.toLowerCase();

  for (const ev of opts.events) {
    if (!Number.isFinite(ev.seq) || ev.seq <= afterSeq) continue;
    cursor = ev.seq;
    // replay:true is catch-up only — never exec, never post_status(accepted).
    if (ev.replay === true) {
      logs.push(`replay_skip seq=${ev.seq}`);
      continue;
    }
    if (ev.kind !== "message") {
      logs.push(`kind_skip seq=${ev.seq} kind=${ev.kind}`);
      continue;
    }
    const body = ev.body ?? "";
    const mentions = tokenizeMentions(body, [handle]);
    if (!mentions.includes(handle)) continue;

    const gate = canWake({
      quota_class: opts.config.quota_class,
      trigger_member_id: ev.sender_id ?? "",
      operator_member_id: opts.config.operator_member_id,
    });
    if (!gate.ok) {
      bumpMetric(metrics, gate.code);
      logs.push(`wake_total result=${gate.code} seq=${ev.seq}`);
      continue;
    }

    const generationId = opts.newId ? opts.newId() : crypto.randomUUID();
    await postStatusAccepted(fetchImpl, opts.config, token, generationId);

    const prompt = buildPrompt(opts.config.agent_handle, body);
    prompts.push(prompt);
    const argv = buildCodexArgv();
    assertArgvOmitsRoomBody(argv, body);

    const spawned = await spawnImpl({
      executable: opts.config.executable,
      argv,
      stdin: prompt,
      cwd: opts.config.workspace,
      env: {
        ...env,
        CODEX_HOME: opts.config.codex_home,
      },
    });
    cliCount += 1;
    argvList.push(spawned.argv);
    stdinList.push(spawned.stdin);
    spawnResults.push(spawned);

    const summary = summarizeCliOutput(spawned.stdout, generationId);
    traces.push(summary);
    await postTrace(fetchImpl, opts.config, token, summary, generationId);
    sends.push(summary);
    await sendMessage(fetchImpl, opts.config, token, summary, generationId);
    bumpMetric(metrics, "accepted");
    logs.push(`wake_total result=accepted seq=${ev.seq} generation_id=${generationId}`);
  }

  return {
    afterSeq,
    cursor,
    cliCount,
    metrics,
    posts,
    prompts,
    traces,
    sends,
    logs,
    argvList,
    stdinList,
    spawnResults,
  };
}

export async function queryMaxSeq(
  fetchImpl: FetchFn,
  config: SidecarConfig,
  token: string,
): Promise<number> {
  const root = config.mcp_base_url.replace(/\/$/, "");
  let after = -1;
  let max = -1;
  for (;;) {
    const url = `${root}/api/rooms/${encodeURIComponent(config.room_id)}/messages?after_seq=${after}&limit=50`;
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`queryMaxSeq HTTP ${res.status}`);
    }
    const json = (await res.json()) as { messages?: Array<{ seq?: number }> };
    const rows = json.messages ?? [];
    if (rows.length === 0) return max;
    for (const row of rows) {
      if (typeof row.seq === "number" && row.seq > max) max = row.seq;
    }
    after = max;
    if (rows.length < 50) return max;
  }
}

async function* sseBlocks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replaceAll("\r\n", "\n");
    let idx = buf.indexOf("\n\n");
    while (idx >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf("\n\n");
    }
  }
  if (buf.trim()) yield buf;
}

/** Live GET /mcp/events tail. First cursor is MAX(seq), never implicit 0. */
export async function runLiveSidecar(opts: {
  config: SidecarConfig;
  fetch: FetchFn;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  maxSeq?: number | null;
  signal?: AbortSignal;
  log?: (line: string) => void;
}): Promise<ConsumeResult> {
  const env = opts.env ?? process.env;
  const token = botTokenFromEnv(env);
  if (!token) throw new Error("KITH_BOT_TOKEN is required");
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  let cursor =
    opts.maxSeq != null && Number.isFinite(opts.maxSeq)
      ? opts.maxSeq
      : await queryMaxSeq(opts.fetch, opts.config, token);
  log(`sidecar after_seq=${cursor} (MAX, not 0)`);
  const acc = await consumeEvents({
    config: opts.config,
    events: [],
    fetch: opts.fetch,
    spawn: opts.spawn,
    env,
    cursor,
    maxSeq: cursor,
  });

  while (!opts.signal?.aborted) {
    const url = eventsUrl(opts.config.mcp_base_url, opts.config.room_id, cursor);
    const res = await opts.fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "text/event-stream",
      },
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      log(`events HTTP ${res.status}; retry`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    let gapped = false;
    for await (const block of sseBlocks(res.body)) {
      if (opts.signal?.aborted) break;
      if (block.split("\n").some((l) => l.startsWith(": gap") || l === ": gap")) {
        log("gap; reconnect");
        gapped = true;
        break;
      }
      const events = parseSseEvents(`${block}\n\n`);
      if (events.length === 0) continue;
      const part = await consumeEvents({
        config: opts.config,
        events,
        fetch: opts.fetch,
        spawn: opts.spawn,
        env,
        cursor,
        maxSeq: cursor,
      });
      cursor = part.cursor;
      acc.cursor = cursor;
      acc.cliCount += part.cliCount;
      acc.posts.push(...part.posts);
      acc.prompts.push(...part.prompts);
      acc.traces.push(...part.traces);
      acc.sends.push(...part.sends);
      acc.logs.push(...part.logs);
      acc.argvList.push(...part.argvList);
      acc.stdinList.push(...part.stdinList);
      acc.spawnResults.push(...part.spawnResults);
      for (const [k, v] of Object.entries(part.metrics.wake_total)) {
        acc.metrics.wake_total[k] = (acc.metrics.wake_total[k] ?? 0) + v;
      }
      for (const line of part.logs) log(line);
    }
    if (!gapped && !opts.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return acc;
}

export async function runSidecar(opts: {
  config: SidecarConfig;
  fetch: FetchFn;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  cursor?: number | null;
  maxSeq?: number | null;
  events?: SidecarEvent[];
  newId?: () => string;
  live?: boolean;
  signal?: AbortSignal;
}): Promise<ConsumeResult> {
  if (opts.events) {
    return consumeEvents({
      config: opts.config,
      events: opts.events,
      fetch: opts.fetch,
      spawn: opts.spawn,
      env: opts.env,
      cursor: opts.cursor,
      maxSeq: opts.maxSeq,
      newId: opts.newId,
    });
  }

  if (opts.live) {
    return runLiveSidecar({
      config: opts.config,
      fetch: opts.fetch,
      spawn: opts.spawn,
      env: opts.env,
      maxSeq: opts.maxSeq,
      signal: opts.signal,
    });
  }

  const afterSeq = initialAfterSeq({ cursor: opts.cursor, maxSeq: opts.maxSeq });
  const env = opts.env ?? process.env;
  const token = botTokenFromEnv(env);
  const url = eventsUrl(opts.config.mcp_base_url, opts.config.room_id, afterSeq);
  const res = await opts.fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "text/event-stream",
    },
  });
  const text = await res.text();
  const events = parseSseEvents(text);
  return consumeEvents({
    config: opts.config,
    events,
    fetch: opts.fetch,
    spawn: opts.spawn,
    env,
    cursor: afterSeq,
    maxSeq: opts.maxSeq,
    newId: opts.newId,
  });
}

export { mcpToolCall };
