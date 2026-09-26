import type { ApiFormat } from "./types.ts";

/** 03 §2.2. Values checked 2026-09-24 against SDK defaults (W4 §4.5.3, W5 §4.4). */
export const PRESETS = {
  openai: { api_format: "openai_chat", base_url: "https://api.openai.com/v1", token_param: "max_completion_tokens" },
  google: { api_format: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta", token_param: "max_tokens" },
  anthropic: { api_format: "anthropic_messages", base_url: "https://api.anthropic.com", token_param: "max_tokens" },
  xai: { api_format: "openai_chat", base_url: "https://api.x.ai/v1", token_param: "max_tokens" },
  deepseek: { api_format: "openai_chat", base_url: "https://api.deepseek.com", token_param: "max_tokens" },
  openrouter: { api_format: "openai_chat", base_url: "https://openrouter.ai/api/v1", token_param: "max_tokens" },
  mistral: { api_format: "openai_chat", base_url: "https://api.mistral.ai/v1", token_param: "max_tokens" },
  groq: { api_format: "openai_chat", base_url: "https://api.groq.com/openai/v1", token_param: "max_tokens" },
  custom: { api_format: null, base_url: null, token_param: "max_tokens" },
} as const satisfies Record<string, { api_format: ApiFormat | null; base_url: string | null; token_param: string }>;
export type Preset = keyof typeof PRESETS;
/** Formats a preset may switch to (03 §2.2 "可改"). Others must equal the preset's own format. */
export const PRESET_ALT_FORMATS: Partial<Record<Preset, readonly ApiFormat[]>> = { openai: ["openai_responses"] };
export const TOKEN_PARAMS = ["max_tokens", "max_completion_tokens"] as const;

const FORBIDDEN_HEADERS = new Set([
  "authorization", "x-api-key", "x-goog-api-key", "cookie", "host", "content-type", "content-length", "anthropic-version",
]);
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const HEADER_VALUE_RE = /^[\x20-\x7e]{0,512}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

export type Check<T> = { ok: true; value: T } | { ok: false; message: string };

/** RT-10 + FM-LLM-15. Returns the normalized base URL (no trailing slash; Anthropic without a trailing /v1). */
export function normalizeBaseUrl(raw: string, format: ApiFormat, allowDevHttp: boolean): Check<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "base_url is not a URL" };
  }
  if (url.protocol !== "https:" && !(allowDevHttp && url.protocol === "http:")) {
    return { ok: false, message: "base_url must use https" };
  }
  if (url.username || url.password) return { ok: false, message: "base_url must not contain credentials" };
  if (url.search || url.hash) return { ok: false, message: "base_url must not contain a query or fragment" };
  if (!allowDevHttp && isPrivateHost(url.hostname)) return { ok: false, message: "base_url host is not public" };
  let path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (format === "anthropic_messages") path = path.replace(/\/v1$/, "");
  return { ok: true, value: `${url.protocol}//${url.host}${path}` };
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) {
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

export function checkHeaders(raw: unknown): Check<Record<string, string>> {
  if (raw === undefined) return { ok: true, value: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "extra_headers must be an object" };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 8) return { ok: false, message: "at most 8 extra_headers" };
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name)) return { ok: false, message: "invalid header name" };
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) return { ok: false, message: "header not allowed" };
    if (typeof value !== "string" || !HEADER_VALUE_RE.test(value)) return { ok: false, message: "invalid header value" };
    out[name] = value;
  }
  return { ok: true, value: out };
}

/** FM-LLM-16: reject at write time, never at call time. */
export function checkSecret(raw: unknown): Check<string> {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 512) return { ok: false, message: "secret must be 1-512 characters" };
  if (raw !== raw.trim()) return { ok: false, message: "secret has leading or trailing whitespace" };
  if (/[\x00-\x20\x7f]/.test(raw)) return { ok: false, message: "secret contains whitespace or control characters" };
  return { ok: true, value: raw };
}

export function checkSecretEnv(raw: unknown): Check<string> {
  if (typeof raw !== "string" || !ENV_NAME_RE.test(raw) || raw === "KITH_SECRETS_KEY") {
    return { ok: false, message: "secret_env must be an upper-case Worker secret name" };
  }
  return { ok: true, value: raw };
}
