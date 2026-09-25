import type { Context, Hono } from "hono";
import { invalid, requireOperator } from "../auth.ts";
import { flagOn, type Env } from "../env.ts";
import { errorBody } from "../errors.ts";
import { extraKeys, parseObject } from "../json.ts";
import { adapterFor } from "../providers/registry.ts";
import { resolveConnection, type ConnectionSecretRow } from "../providers/runtime.ts";
import { canStoreSecrets, sealSecret } from "../providers/secrets.ts";
import { LlmError, SUPPORTED_FORMATS, type ApiFormat, type LlmErrorClass, type ResolvedConnection } from "../providers/types.ts";
import {
  PRESETS,
  PRESET_ALT_FORMATS,
  TOKEN_PARAMS,
  checkHeaders,
  checkSecret,
  checkSecretEnv,
  normalizeBaseUrl,
  type Preset,
} from "../providers/validate.ts";

type AppEnv = { Bindings: Env };
type C = Context<AppEnv>;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/;
const TEST_TIMEOUT_MS = 15_000;
const CREATE_KEYS = ["name", "preset", "api_format", "base_url", "secret_source", "secret", "secret_env",
  "extra_headers", "default_quota_class", "token_param"] as const;
const PATCH_KEYS = ["name", "base_url", "secret_source", "secret", "secret_env", "extra_headers",
  "default_quota_class", "token_param", "disabled"] as const;

export type ConnectionRow = ConnectionSecretRow & {
  name: string;
  preset: string;
  secret_last4: string | null;
  secret_updated_at: string | null;
  default_quota_class: string;
  last_error_class: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  agent_count?: number;
};

const COLUMNS = `c.id, c.name, c.preset, c.api_format, c.base_url, c.secret_source, c.secret_ciphertext, c.secret_env,
  c.secret_last4, c.secret_updated_at, c.extra_headers_json, c.default_quota_class, c.token_param, c.last_error_class,
  c.last_checked_at, c.created_at, c.updated_at, c.disabled_at,
  (SELECT COUNT(*) FROM agent_runtimes r WHERE r.connection_id = c.id) AS agent_count`;

/** RT-09: never secret_ciphertext, never the secret. */
export function publicConnection(row: ConnectionRow) {
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(row.extra_headers_json) as Record<string, string>;
  } catch {
    headers = {};
  }
  return {
    id: row.id,
    name: row.name,
    preset: row.preset,
    api_format: row.api_format,
    base_url: row.base_url,
    secret_source: row.secret_source,
    secret_env: row.secret_env,
    secret_last4: row.secret_last4,
    secret_updated_at: row.secret_updated_at,
    extra_headers: headers,
    default_quota_class: row.default_quota_class,
    token_param: row.token_param,
    last_error_class: row.last_error_class,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
    agent_count: row.agent_count ?? 0,
  };
}

async function gate(c: C): Promise<Response | null> {
  const auth = await requireOperator(c);
  if (auth instanceof Response) return auth;
  if (!flagOn(c.env.ff_providers)) return c.json(errorBody("not_ready", "providers are not enabled"), 503);
  return null;
}

async function loadConnection(env: Env, id: string): Promise<ConnectionRow | null> {
  return env.DB.prepare(`SELECT ${COLUMNS} FROM provider_connections c WHERE c.id = ?`).bind(id).first<ConnectionRow>();
}

type Draft = {
  preset: Preset;
  api_format: ApiFormat;
  base_url: string;
  secret_source: "stored" | "env" | "none";
  secret?: string;
  secret_env?: string;
  extra_headers: Record<string, string>;
  token_param: "max_tokens" | "max_completion_tokens";
};

/** Shared by POST /api/providers and POST /api/providers/test. Returns a 400 message or the draft. */
async function parseDraft(env: Env, obj: Record<string, unknown>): Promise<Draft | string> {
  const preset = obj.preset;
  if (typeof preset !== "string" || !(preset in PRESETS)) return "invalid preset";
  const p = PRESETS[preset as Preset];
  const format = (obj.api_format ?? p.api_format) as unknown;
  if (typeof format !== "string" || !SUPPORTED_FORMATS.includes(format as ApiFormat)) return "unsupported api_format";
  if (p.api_format !== null && format !== p.api_format && !(PRESET_ALT_FORMATS[preset as Preset] ?? []).includes(format as ApiFormat)) {
    return "api_format does not match preset";
  }
  const rawBase = obj.base_url ?? p.base_url;
  if (typeof rawBase !== "string") return "base_url required";
  const base = normalizeBaseUrl(rawBase, format as ApiFormat, flagOn(env.KITH_DEV_ALLOW_HTTP_PROVIDERS));
  if (!base.ok) return base.message;
  const headers = checkHeaders(obj.extra_headers);
  if (!headers.ok) return headers.message;
  const tokenParam = obj.token_param ?? p.token_param;
  if (typeof tokenParam !== "string" || !(TOKEN_PARAMS as readonly string[]).includes(tokenParam)) return "invalid token_param";
  const source = obj.secret_source;
  const draft: Draft = {
    preset: preset as Preset,
    api_format: format as ApiFormat,
    base_url: base.value,
    secret_source: "none",
    extra_headers: headers.value,
    token_param: tokenParam as Draft["token_param"],
  };
  if (source === "stored") {
    const secret = checkSecret(obj.secret);
    if (!secret.ok) return secret.message;
    if (obj.secret_env !== undefined) return "secret_env not allowed with stored";
    draft.secret_source = "stored";
    draft.secret = secret.value;
  } else if (source === "env") {
    const name = checkSecretEnv(obj.secret_env);
    if (!name.ok) return name.message;
    if (obj.secret !== undefined) return "secret not allowed with env";
    draft.secret_source = "env";
    draft.secret_env = name.value;
  } else if (source === "none") {
    if (obj.secret !== undefined || obj.secret_env !== undefined) return "secret not allowed with none";
  } else {
    return "invalid secret_source";
  }
  return draft;
}

type TestResult = { ok: true; models: string[] | null } | { ok: false; error_class: LlmErrorClass };

/** 15 s. List models; a 404 on the list endpoint → models:null, still ok (03 §2.2 "可關閉"). */
async function runTest(conn: ResolvedConnection): Promise<TestResult> {
  const adapter = adapterFor(conn.api_format);
  if (!adapter) return { ok: false, error_class: "bad_request" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const models = await adapter.listModels(conn, fetch, controller.signal);
    return { ok: true, models: models.slice(0, 500) };
  } catch (err) {
    const cls: LlmErrorClass = err instanceof LlmError ? err.errorClass : "unknown";
    if (cls === "not_found") return { ok: true, models: null };
    return { ok: false, error_class: cls };
  } finally {
    clearTimeout(timer);
  }
}

export function mountProviderRoutes(app: Hono<AppEnv>): void {
  app.get("/api/providers", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const res = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM provider_connections c ORDER BY c.created_at ASC`).all<ConnectionRow>();
    return c.json({ providers: (res.results ?? []).map(publicConnection), can_store_secrets: await canStoreSecrets(c.env) });
  });

  app.get("/api/providers/:id", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const row = await loadConnection(c.env, c.req.param("id"));
    if (!row) return c.json(errorBody("not_found", "provider not found"), 404);
    return c.json({ provider: publicConnection(row) });
  });

  app.post("/api/providers/test", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const obj = parseObject(await c.req.text());
    if (!obj) return invalid(c, "invalid json");
    if (extraKeys(obj, CREATE_KEYS.filter((k) => k !== "name" && k !== "default_quota_class")).length > 0) {
      return invalid(c, "unknown field");
    }
    const draft = await parseDraft(c.env, obj);
    if (typeof draft === "string") return invalid(c, draft);
    const conn: ResolvedConnection = {
      id: "draft",
      api_format: draft.api_format,
      base_url: draft.base_url,
      secret: draft.secret ?? "",
      extra_headers: draft.extra_headers,
      token_param: draft.token_param,
    };
    if (draft.secret_source === "env") {
      const resolved = await resolveConnection(c.env, { ...conn, secret_source: "env", secret_ciphertext: null,
        secret_env: draft.secret_env ?? null, extra_headers_json: JSON.stringify(draft.extra_headers) });
      if (!resolved) return c.json(errorBody("secret_unavailable", "worker secret is not set"), 400);
      conn.secret = resolved.secret;
    }
    return c.json(await runTest(conn));
  });

  app.post("/api/providers", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const obj = parseObject(await c.req.text());
    if (!obj) return invalid(c, "invalid json");
    if (extraKeys(obj, CREATE_KEYS).length > 0) return invalid(c, "unknown field");
    if (typeof obj.name !== "string" || !NAME_RE.test(obj.name)) return invalid(c, "invalid name");
    const quota = obj.default_quota_class;
    if (quota !== "api_key" && quota !== "operator_personal") return invalid(c, "default_quota_class required"); // BR-54: asked explicitly
    const draft = await parseDraft(c.env, obj);
    if (typeof draft === "string") return invalid(c, draft);
    let sealed: string | null = null;
    if (draft.secret_source === "stored") {
      sealed = await sealSecret(c.env, draft.secret ?? "");
      if (!sealed) return c.json(errorBody("secrets_key_missing", "KITH_SECRETS_KEY is not set; use secret_source=env"), 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        `INSERT INTO provider_connections (id, name, preset, api_format, base_url, secret_source, secret_ciphertext, secret_env,
           secret_last4, secret_updated_at, extra_headers_json, default_quota_class, token_param, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, obj.name, draft.preset, draft.api_format, draft.base_url, draft.secret_source, sealed,
          draft.secret_env ?? null, draft.secret ? draft.secret.slice(-4) : null, draft.secret ? now : null,
          JSON.stringify(draft.extra_headers), quota, draft.token_param, now, now)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE/i.test(message)) return c.json(errorBody("name_taken", "name taken"), 409);
      return c.json(errorBody("not_ready", "failed to create provider"), 503);
    }
    const row = await loadConnection(c.env, id);
    return c.json({ provider: row ? publicConnection(row) : null }, 201);
  });

  app.patch("/api/providers/:id", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const row = await loadConnection(c.env, c.req.param("id"));
    if (!row) return c.json(errorBody("not_found", "provider not found"), 404);
    const obj = parseObject(await c.req.text());
    if (!obj) return invalid(c, "invalid json");
    if (extraKeys(obj, PATCH_KEYS).length > 0 || Object.keys(obj).length === 0) return invalid(c, "unknown field");
    const sets: string[] = [];
    const binds: unknown[] = [];
    let clearsError = false;
    if (obj.name !== undefined) {
      if (typeof obj.name !== "string" || !NAME_RE.test(obj.name)) return invalid(c, "invalid name");
      sets.push("name = ?"); binds.push(obj.name);
    }
    if (obj.base_url !== undefined) {
      if (typeof obj.base_url !== "string") return invalid(c, "invalid base_url");
      const base = normalizeBaseUrl(obj.base_url, row.api_format, flagOn(c.env.KITH_DEV_ALLOW_HTTP_PROVIDERS));
      if (!base.ok) return invalid(c, base.message);
      sets.push("base_url = ?"); binds.push(base.value); clearsError = true;
    }
    if (obj.secret_source !== undefined || obj.secret !== undefined || obj.secret_env !== undefined) {
      const source = obj.secret_source ?? row.secret_source;
      const now = new Date().toISOString();
      if (source === "stored") {
        const secret = checkSecret(obj.secret);
        if (!secret.ok) return invalid(c, secret.message); // overwrite only; never read back (BR-51)
        const sealed = await sealSecret(c.env, secret.value);
        if (!sealed) return c.json(errorBody("secrets_key_missing", "KITH_SECRETS_KEY is not set; use secret_source=env"), 400);
        sets.push("secret_source = 'stored'", "secret_ciphertext = ?", "secret_env = NULL", "secret_last4 = ?", "secret_updated_at = ?");
        binds.push(sealed, secret.value.slice(-4), now);
      } else if (source === "env") {
        const name = checkSecretEnv(obj.secret_env);
        if (!name.ok || obj.secret !== undefined) return invalid(c, name.ok ? "secret not allowed with env" : name.message);
        sets.push("secret_source = 'env'", "secret_ciphertext = NULL", "secret_env = ?", "secret_last4 = NULL", "secret_updated_at = ?");
        binds.push(name.value, now);
      } else if (source === "none") {
        if (obj.secret !== undefined || obj.secret_env !== undefined) return invalid(c, "secret not allowed with none");
        sets.push("secret_source = 'none'", "secret_ciphertext = NULL", "secret_env = NULL", "secret_last4 = NULL", "secret_updated_at = ?");
        binds.push(now);
      } else {
        return invalid(c, "invalid secret_source");
      }
      clearsError = true;
    }
    if (obj.extra_headers !== undefined) {
      const headers = checkHeaders(obj.extra_headers);
      if (!headers.ok) return invalid(c, headers.message);
      sets.push("extra_headers_json = ?"); binds.push(JSON.stringify(headers.value)); clearsError = true;
    }
    if (obj.default_quota_class !== undefined) {
      if (obj.default_quota_class !== "api_key" && obj.default_quota_class !== "operator_personal") return invalid(c, "invalid default_quota_class");
      sets.push("default_quota_class = ?"); binds.push(obj.default_quota_class);
    }
    if (obj.token_param !== undefined) {
      if (typeof obj.token_param !== "string" || !(TOKEN_PARAMS as readonly string[]).includes(obj.token_param)) return invalid(c, "invalid token_param");
      sets.push("token_param = ?"); binds.push(obj.token_param);
    }
    if (obj.disabled !== undefined) {
      if (typeof obj.disabled !== "boolean") return invalid(c, "invalid disabled");
      sets.push("disabled_at = ?"); binds.push(obj.disabled ? (row.disabled_at ?? new Date().toISOString()) : null);
    }
    if (clearsError) sets.push("last_error_class = NULL");
    sets.push("updated_at = ?"); binds.push(new Date().toISOString());
    try {
      await c.env.DB.prepare(`UPDATE provider_connections SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, row.id).run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE/i.test(message)) return c.json(errorBody("name_taken", "name taken"), 409);
      return c.json(errorBody("not_ready", "failed to update provider"), 503);
    }
    const updated = await loadConnection(c.env, row.id);
    return c.json({ provider: updated ? publicConnection(updated) : null });
  });

  app.delete("/api/providers/:id", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const row = await loadConnection(c.env, c.req.param("id"));
    if (!row) return c.json(errorBody("not_found", "provider not found"), 404);
    const force = c.req.query("force") === "1";
    if ((row.agent_count ?? 0) > 0 && !force) return c.json(errorBody("in_use", "provider is used by agents"), 409);
    // BR-53: referencing agents keep their row with connection_id = NULL → runtime_status unconfigured.
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE agent_runtimes SET connection_id = NULL, updated_at = ? WHERE connection_id = ?`).bind(new Date().toISOString(), row.id),
      c.env.DB.prepare(`DELETE FROM provider_connections WHERE id = ?`).bind(row.id),
    ]);
    return c.json({ ok: true });
  });

  app.post("/api/providers/:id/test", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const row = await loadConnection(c.env, c.req.param("id"));
    if (!row) return c.json(errorBody("not_found", "provider not found"), 404);
    const conn = await resolveConnection(c.env, row);
    if (!conn) return c.json(errorBody("secret_unavailable", "provider secret is not available"), 400);
    const result = await runTest(conn);
    await c.env.DB.prepare(`UPDATE provider_connections SET last_error_class = ?, last_checked_at = ? WHERE id = ?`)
      .bind(result.ok ? null : result.error_class, new Date().toISOString(), row.id)
      .run();
    return c.json(result);
  });
}
