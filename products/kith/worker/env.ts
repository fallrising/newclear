export type Env = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ROOM: DurableObjectNamespace;
  INBOX: DurableObjectNamespace;
  HOSTED: DurableObjectNamespace;
  ff_mcp: string;
  ff_hosted_agent: string;
  ff_sidecar: string;
  ff_ambient: string;
  XAI_API_KEY?: string;
  FAKE_LLM_TEXT?: string;
  FAKE_LLM_MODELS?: string;
  TEST_MIGRATIONS?: unknown;
};

export const SESSION_COOKIE = "kith_session";
export const CSRF_COOKIE = "csrf";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const INTERNAL_HEADER = "X-Kith-Internal";
export const MEMBER_HEADER = "X-Kith-Member-Id";
export const ROOM_HEADER = "X-Kith-Room-Id";
export const INTERNAL_ORIGIN = "https://kith.internal";

export function flagOn(value: string | undefined): boolean {
  return value === "on";
}
