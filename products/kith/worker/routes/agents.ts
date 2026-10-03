import type { Context, Hono } from "hono";
import { invalid, requireOperator } from "../auth.ts";
import { flagOn, type Env } from "../env.ts";
import { errorBody } from "../errors.ts";
import { extraKeys, parseObject, utf8Bytes } from "../json.ts";
import { adapterFor } from "../providers/registry.ts";
import {
  MAX_OUTPUT_CAP,
  hostedParams,
  loadAgentRuntime,
  loadAllAgentRuntimes,
  runtimeStatus,
  type AgentRuntimeView,
} from "../providers/runtime.ts";
import type { ApiFormat } from "../providers/types.ts";

type AppEnv = { Bindings: Env };
type C = Context<AppEnv>;

const MODEL_RE = /^[\x21-\x7e]{1,128}$/;
const ADDENDUM_MAX_BYTES = 4096; // RT-12
const ADAPTER_KINDS = new Set(["codex", "claude_code", "gemini_cli", "command"]);
const RUNTIME_KEYS: Record<string, readonly string[]> = {
  hosted: ["connection_id", "model", "system_prompt_addendum", "max_output_tokens", "temperature", "stream"],
  runner: ["adapter_kind"],
  external: [],
};

const GENERATIONS_DEFAULT = 50; // 06 §6.1
const GENERATIONS_MAX = 100;
type GenerationRow = {
  id: string;
  room_id: string;
  room_name: string | null;
  trigger_seq: number;
  state: string;
  error_class: string | null;
  created_at: string;
  completed_at: string | null;
  connection_id: string | null;
  model: string | null;
  runtime_epoch: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

type AgentExtraRow = { id: string; display_name: string; created_at: string; rooms_json: string; token_count: number };

/** Summary shared by GET /api/agents, GET /api/agents/:id and the room member list (no secrets by construction). */
export function runtimeSummary(env: Env, v: AgentRuntimeView) {
  return {
    runtime: v.runtime,
    runtime_status: runtimeStatus(env, v),
    runtime_epoch: v.runtime_epoch,
    connection_id: v.connection_id,
    connection_name: v.conn_name,
    api_format: v.conn_format,
    model: v.model,
    adapter_kind: v.adapter_kind,
    runner_last_seen_at: v.runner_last_seen_at,
  };
}

async function gate(c: C): Promise<Response | null> {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  if (!flagOn(c.env.ff_providers)) return c.json(errorBody("not_ready", "providers are not enabled"), 503);
  return null;
}

async function extras(env: Env, agentId?: string): Promise<Map<string, AgentExtraRow>> {
  const res = await env.DB.prepare(
    `SELECT m.id, m.display_name, m.created_at,
            (SELECT json_group_array(rm.room_id) FROM room_members rm WHERE rm.member_id = m.id) AS rooms_json,
            (SELECT COUNT(*) FROM bot_tokens t WHERE t.member_id = m.id AND t.revoked_at IS NULL
               AND (t.expires_at IS NULL OR t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) AS token_count
     FROM members m WHERE m.kind = 'agent'${agentId ? " AND m.id = ?" : ""}`,
  )
    .bind(...(agentId ? [agentId] : []))
    .all<AgentExtraRow>();
  return new Map((res.results ?? []).map((row) => [row.id, row]));
}

function agentJson(env: Env, v: AgentRuntimeView, extra: AgentExtraRow | undefined) {
  let rooms: string[] = [];
  try {
    rooms = JSON.parse(extra?.rooms_json ?? "[]") as string[];
  } catch {
    rooms = [];
  }
  return {
    id: v.agent_id,
    handle: v.handle,
    display_name: extra?.display_name ?? v.handle,
    quota_class: v.quota_class,
    created_at: extra?.created_at ?? null,
    disabled_at: v.disabled_at,
    rooms,
    token_count: extra?.token_count ?? 0,
    ...runtimeSummary(env, v),
  };
}

async function agentDetail(env: Env, agentId: string) {
  const v = await loadAgentRuntime(env, agentId);
  if (!v) return null;
  const extra = (await extras(env, agentId)).get(agentId);
  const changes = await env.DB.prepare(
    `SELECT x.id, x.from_runtime, x.to_runtime, x.from_epoch, x.to_epoch, x.created_at, x.changed_by,
            m.display_name AS changed_by_name
     FROM agent_runtime_changes x JOIN members m ON m.id = x.changed_by
     WHERE x.agent_id = ? ORDER BY x.created_at DESC, x.to_epoch DESC LIMIT 20`,
  )
    .bind(agentId)
    .all();
  const params = hostedParams(v.params_json);
  return {
    ...agentJson(env, v, extra),
    max_output_tokens: params.max_output_tokens,
    temperature: params.temperature ?? null,
    stream: params.stream,
    system_prompt_addendum: v.system_prompt_addendum,
    runtime_changes: changes.results ?? [],
  };
}

export function mountAgentRoutes(app: Hono<AppEnv>): void {
  app.get("/api/agents", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const views = await loadAllAgentRuntimes(c.env);
    const ex = await extras(c.env);
    return c.json({ agents: views.map((v) => agentJson(c.env, v, ex.get(v.agent_id))) });
  });

  app.get("/api/agents/:id", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const agent = await agentDetail(c.env, c.req.param("id"));
    if (!agent) return c.json(errorBody("not_found", "agent not found"), 404);
    return c.json({ agent });
  });

  app.patch("/api/agents/:id", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const id = c.req.param("id");
    if (!(await loadAgentRuntime(c.env, id))) return c.json(errorBody("not_found", "agent not found"), 404);
    const obj = parseObject(await c.req.text());
    if (!obj) return invalid(c, "invalid json");
    if (extraKeys(obj, ["display_name", "disabled"]).length > 0 || Object.keys(obj).length === 0) return invalid(c, "unknown field");
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (obj.display_name !== undefined) {
      if (typeof obj.display_name !== "string" || obj.display_name.trim().length < 1 || [...obj.display_name].length > 64) {
        return invalid(c, "invalid display_name");
      }
      sets.push("display_name = ?"); binds.push(obj.display_name.trim());
    }
    if (obj.disabled !== undefined) {
      if (typeof obj.disabled !== "boolean") return invalid(c, "invalid disabled");
      sets.push("disabled_at = CASE WHEN ? THEN COALESCE(disabled_at, ?) ELSE NULL END");
      binds.push(obj.disabled ? 1 : 0, new Date().toISOString());
    }
    await c.env.DB.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ? AND kind = 'agent'`).bind(...binds, id).run();
    return c.json({ agent: await agentDetail(c.env, id) });
  });

  /** B-09 generations list (W5): newest first, operator only, no prompt or reply text. */
  app.get("/api/agents/:id/generations", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const id = c.req.param("id");
    if (!(await loadAgentRuntime(c.env, id))) return c.json(errorBody("not_found", "agent not found"), 404);
    const rawLimit = c.req.query("limit");
    const limit = rawLimit === undefined ? GENERATIONS_DEFAULT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > GENERATIONS_MAX) return invalid(c, "invalid limit");
    const res = await c.env.DB.prepare(
      `SELECT g.id, g.room_id, r.name AS room_name, g.trigger_seq, g.state, g.error_class, g.created_at, g.completed_at,
              g.connection_id, g.model, g.runtime_epoch, g.input_tokens, g.output_tokens
       FROM generations g LEFT JOIN rooms r ON r.id = g.room_id
       WHERE g.agent_id = ? ORDER BY g.created_at DESC LIMIT ?`,
    )
      .bind(id, limit)
      .all<GenerationRow>();
    return c.json({
      generations: (res.results ?? []).map((g) => ({
        ...g,
        duration_ms: g.completed_at ? Math.max(0, Date.parse(g.completed_at) - Date.parse(g.created_at)) : null,
      })),
    });
  });

  /** B-09 / RT-01: one PUT = one epoch. Every field of the chosen runtime is replaced (no partial setups). */
  app.put("/api/agents/:id/runtime", async (c) => {
    const auth = await requireOperator(c);
    if (auth instanceof Response) return auth;
    if (!flagOn(c.env.ff_providers)) return c.json(errorBody("not_ready", "providers are not enabled"), 503);
    const id = c.req.param("id");
    const before = await loadAgentRuntime(c.env, id);
    if (!before) return c.json(errorBody("not_found", "agent not found"), 404);
    const obj = parseObject(await c.req.text());
    if (!obj) return invalid(c, "invalid json");
    const runtime = obj.runtime;
    if (typeof runtime !== "string" || !(runtime in RUNTIME_KEYS)) return invalid(c, "invalid runtime");
    if (extraKeys(obj, ["runtime", "quota_class", "revoke_tokens", ...RUNTIME_KEYS[runtime]!]).length > 0) {
      return invalid(c, "unknown field");
    }
    if (obj.quota_class !== "api_key" && obj.quota_class !== "operator_personal") return invalid(c, "quota_class required"); // RT-01.3
    if (obj.revoke_tokens !== undefined && typeof obj.revoke_tokens !== "boolean") return invalid(c, "invalid revoke_tokens");

    let connectionId: string | null = null;
    let model: string | null = null;
    let addendum = "";
    let adapterKind: string | null = null;
    const params: Record<string, unknown> = {};
    if (runtime === "hosted") {
      if (typeof obj.connection_id !== "string") return invalid(c, "connection_id required"); // RT-01.6
      if (typeof obj.model !== "string" || !MODEL_RE.test(obj.model)) return invalid(c, "model required");
      const conn = await c.env.DB.prepare(`SELECT id, api_format, disabled_at FROM provider_connections WHERE id = ?`)
        .bind(obj.connection_id)
        .first<{ id: string; api_format: ApiFormat; disabled_at: string | null }>();
      if (!conn) return c.json(errorBody("not_found", "provider not found"), 404);
      if (conn.disabled_at) return c.json(errorBody("provider_disabled", "provider is disabled"), 409);
      if (!adapterFor(conn.api_format)) return invalid(c, "unsupported api_format");
      connectionId = conn.id;
      model = obj.model;
      if (obj.system_prompt_addendum !== undefined) {
        if (typeof obj.system_prompt_addendum !== "string" || utf8Bytes(obj.system_prompt_addendum) > ADDENDUM_MAX_BYTES) {
          return invalid(c, "invalid system_prompt_addendum");
        }
        addendum = obj.system_prompt_addendum;
      }
      if (obj.max_output_tokens !== undefined) {
        const n = obj.max_output_tokens;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_OUTPUT_CAP) return invalid(c, "invalid max_output_tokens");
        params.max_output_tokens = n;
      }
      if (obj.temperature !== undefined && obj.temperature !== null) {
        const t = obj.temperature;
        if (typeof t !== "number" || !(t >= 0 && t <= 2)) return invalid(c, "invalid temperature");
        params.temperature = t;
      }
      if (obj.stream !== undefined) {
        if (typeof obj.stream !== "boolean") return invalid(c, "invalid stream");
        params.stream = obj.stream; // honoured only while ff_drafts=on (W5 §4.3)
      }
    } else if (runtime === "runner") {
      if (typeof obj.adapter_kind !== "string" || !ADAPTER_KINDS.has(obj.adapter_kind)) return invalid(c, "invalid adapter_kind");
      adapterKind = obj.adapter_kind;
    }

    const now = new Date().toISOString();
    const fromEpoch = before.runtime === null ? null : before.runtime_epoch;
    const toEpoch = (fromEpoch ?? 0) + 1;
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO agent_runtimes (agent_id, runtime, connection_id, model, params_json, system_prompt_addendum,
           adapter_kind, runtime_epoch, runner_last_seen_at, last_error_class, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(agent_id) DO UPDATE SET runtime = excluded.runtime, connection_id = excluded.connection_id,
           model = excluded.model, params_json = excluded.params_json,
           system_prompt_addendum = excluded.system_prompt_addendum, adapter_kind = excluded.adapter_kind,
           runtime_epoch = agent_runtimes.runtime_epoch + 1,
           runner_last_seen_at = CASE WHEN agent_runtimes.runtime = excluded.runtime THEN agent_runtimes.runner_last_seen_at ELSE NULL END,
           last_error_class = NULL, updated_at = excluded.updated_at`,
      ).bind(id, runtime, connectionId, model, JSON.stringify(params), addendum, adapterKind, toEpoch, now),
      c.env.DB.prepare(`UPDATE members SET quota_class = ? WHERE id = ?`).bind(obj.quota_class, id),
      c.env.DB.prepare(
        `INSERT INTO agent_runtime_changes (id, agent_id, changed_by, from_runtime, to_runtime, from_epoch, to_epoch, created_at)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT runtime_epoch FROM agent_runtimes WHERE agent_id = ?), ?)`,
      ).bind(crypto.randomUUID(), id, auth.member.id, before.runtime, runtime, fromEpoch, id, now),
    ];
    if (obj.revoke_tokens === true) {
      statements.push(
        c.env.DB.prepare(`UPDATE bot_tokens SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL`).bind(now, id),
      );
    }
    await c.env.DB.batch(statements);
    const agent = await agentDetail(c.env, id);
    return c.json({ agent, runtime_epoch: agent?.runtime_epoch ?? toEpoch });
  });
}
