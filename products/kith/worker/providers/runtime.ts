import { flagOn, type Env } from "../env.ts";
import { adapterFor } from "./registry.ts";
import { envSecret, openSecret } from "./secrets.ts";
import type { ApiFormat, ResolvedConnection } from "./types.ts";

export type RuntimeKind = "hosted" | "runner" | "external";
export type RuntimeStatus = "ok" | "unconfigured" | "connection_error" | "runner_offline" | "disabled";
export const RUNNER_ONLINE_MS = 5 * 60_000;

export type AgentRuntimeView = {
  agent_id: string;
  handle: string;
  quota_class: string;
  disabled_at: string | null;
  runtime: RuntimeKind | null; // null = no agent_runtimes row yet (v1 settings, 03 §7)
  runtime_epoch: number;
  connection_id: string | null;
  model: string | null;
  params_json: string;
  system_prompt_addendum: string;
  adapter_kind: string | null;
  runner_last_seen_at: string | null;
  runtime_error_class: string | null;
  conn_name: string | null;
  conn_format: ApiFormat | null;
  conn_base_url: string | null;
  conn_secret_source: "stored" | "env" | "none" | null;
  conn_secret_ciphertext: string | null;
  conn_secret_env: string | null;
  conn_extra_headers_json: string | null;
  conn_token_param: "max_tokens" | "max_completion_tokens" | null;
  conn_error_class: string | null;
  conn_disabled_at: string | null;
};

const VIEW_SQL = `SELECT m.id AS agent_id, m.handle, m.quota_class, m.disabled_at,
       r.runtime, COALESCE(r.runtime_epoch, 0) AS runtime_epoch, r.connection_id, r.model,
       COALESCE(r.params_json, '{}') AS params_json, COALESCE(r.system_prompt_addendum, '') AS system_prompt_addendum,
       r.adapter_kind, r.runner_last_seen_at, r.last_error_class AS runtime_error_class,
       c.name AS conn_name, c.api_format AS conn_format, c.base_url AS conn_base_url,
       c.secret_source AS conn_secret_source, c.secret_ciphertext AS conn_secret_ciphertext,
       c.secret_env AS conn_secret_env, c.extra_headers_json AS conn_extra_headers_json,
       c.token_param AS conn_token_param, c.last_error_class AS conn_error_class, c.disabled_at AS conn_disabled_at
FROM members m
LEFT JOIN agent_runtimes r ON r.agent_id = m.id
LEFT JOIN provider_connections c ON c.id = r.connection_id
WHERE m.kind = 'agent'`;

export async function loadAgentRuntime(env: Env, agentId: string): Promise<AgentRuntimeView | null> {
  return env.DB.prepare(`${VIEW_SQL} AND m.id = ?`).bind(agentId).first<AgentRuntimeView>();
}

export async function loadAllAgentRuntimes(env: Env): Promise<AgentRuntimeView[]> {
  const res = await env.DB.prepare(`${VIEW_SQL} ORDER BY m.created_at ASC`).all<AgentRuntimeView>();
  return res.results ?? [];
}

/** B-03 runtime_status. `ok` is the only status that may wake (V2-INV-05). */
export function runtimeStatus(env: Env, v: AgentRuntimeView, now = Date.now()): RuntimeStatus {
  if (v.disabled_at) return "disabled";
  if (v.runtime === null) {
    // v1 settings, before the migration script (03 §7): same answer v1 reply_limit would give.
    if (v.quota_class === "operator_personal") return flagOn(env.ff_sidecar) ? "ok" : "runner_offline";
    return env.XAI_API_KEY || env.FAKE_LLM_TEXT ? "ok" : "unconfigured";
  }
  if (v.runtime === "external") return "ok";
  if (v.runtime === "runner") {
    const seen = v.runner_last_seen_at ? Date.parse(v.runner_last_seen_at) : Number.NaN;
    return Number.isFinite(seen) && now - seen < RUNNER_ONLINE_MS ? "ok" : "runner_offline";
  }
  if (!v.connection_id || v.conn_format === null || v.conn_disabled_at || !v.model) return "unconfigured";
  if (!adapterFor(v.conn_format)) return "unconfigured";
  if (v.conn_secret_source === "env" && !(v.conn_secret_env && envSecret(env, v.conn_secret_env))) return "unconfigured";
  if (v.conn_secret_source === "stored" && !env.KITH_SECRETS_KEY) return "unconfigured";
  if (v.conn_error_class === "auth" || v.runtime_error_class === "not_found") return "connection_error";
  return "ok";
}

export type ConnectionSecretRow = {
  id: string;
  api_format: ApiFormat;
  base_url: string;
  secret_source: "stored" | "env" | "none";
  secret_ciphertext: string | null;
  secret_env: string | null;
  extra_headers_json: string;
  token_param: "max_tokens" | "max_completion_tokens";
};

/** Decrypts in memory only. null → treat as unconfigured. */
export async function resolveConnection(env: Env, row: ConnectionSecretRow): Promise<ResolvedConnection | null> {
  let secret = "";
  if (row.secret_source === "stored") {
    secret = row.secret_ciphertext ? ((await openSecret(env, row.secret_ciphertext)) ?? "") : "";
    if (!secret) return null;
  } else if (row.secret_source === "env") {
    secret = row.secret_env ? (envSecret(env, row.secret_env) ?? "") : "";
    if (!secret) return null;
  }
  let extra: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.extra_headers_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Record<string, string>;
  } catch {
    extra = {};
  }
  return {
    id: row.id,
    api_format: row.api_format,
    base_url: row.base_url,
    secret,
    extra_headers: extra,
    token_param: row.token_param,
  };
}

export function viewConnectionRow(v: AgentRuntimeView): ConnectionSecretRow | null {
  if (!v.connection_id || !v.conn_format || !v.conn_base_url || !v.conn_secret_source || !v.conn_token_param) return null;
  return {
    id: v.connection_id,
    api_format: v.conn_format,
    base_url: v.conn_base_url,
    secret_source: v.conn_secret_source,
    secret_ciphertext: v.conn_secret_ciphertext,
    secret_env: v.conn_secret_env,
    extra_headers_json: v.conn_extra_headers_json ?? "{}",
    token_param: v.conn_token_param,
  };
}

export type HostedParams = { max_output_tokens: number; temperature?: number; stream: boolean };
export const MAX_OUTPUT_DEFAULT = 1024;
export const MAX_OUTPUT_CAP = 8192;

export function hostedParams(paramsJson: string): HostedParams {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(paramsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const max = typeof raw.max_output_tokens === "number" && Number.isInteger(raw.max_output_tokens)
    ? Math.min(MAX_OUTPUT_CAP, Math.max(1, raw.max_output_tokens))
    : MAX_OUTPUT_DEFAULT;
  const out: HostedParams = { max_output_tokens: max, stream: raw.stream === true };
  if (typeof raw.temperature === "number" && raw.temperature >= 0 && raw.temperature <= 2) out.temperature = raw.temperature;
  return out;
}
