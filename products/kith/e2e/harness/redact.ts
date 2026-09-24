import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { knownSecrets } from "../fixtures/accounts.ts";

// Redaction rules (docs/v2/milestones/W0.md §5.1.5).

export const RULE_IDS = [
  "R01-cookie-header",
  "R02-authorization-header",
  "R03-csrf-header",
  "R04-json-secret-keys",
  "R05-bot-token",
  "R06-known-secrets",
  "R07-observed-session",
] as const;

export type ScanRule = "R05-bot-token" | "R06-known-secrets" | "R07-observed-session";

const REDACTED = "[REDACTED]";
const KEPT_HEADERS = new Set(["content-type", "cookie", "set-cookie", "authorization", "x-csrf-token"]);
const SECRET_KEYS = new Set(["password", "old_password", "new_password", "csrf", "token", "secret", "api_key", "bot_token"]);
const BOT_TOKEN = /kith_bot_[0-9a-f]{64}/g;

function recordCookieValues(value: string): void {
  for (const m of value.matchAll(/(?:^|[;,\s])(?:kith_session|csrf)=([^;,\s]+)/g)) {
    if (m[1]) recordObservedSecret(m[1]);
  }
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (!KEPT_HEADERS.has(key)) continue;
    if (key === "cookie" || key === "set-cookie") {
      recordCookieValues(value);
      out[key] = REDACTED;
    } else if (key === "authorization") {
      out[key] = /^Bearer\s/i.test(value) ? "Bearer " + REDACTED : REDACTED;
    } else if (key === "x-csrf-token") {
      out[key] = REDACTED;
    } else {
      out[key] = redactText(value);
    }
  }
  return out;
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) && typeof v === "string" ? REDACTED : redactJson(v);
    }
    return out;
  }
  return value;
}

export function redactText(text: string): string {
  let out = text.replace(BOT_TOKEN, "kith_bot_" + REDACTED);
  for (const s of knownSecrets()) out = out.replaceAll(s, REDACTED);
  for (const s of readObservedSecrets()) out = out.replaceAll(s, REDACTED);
  return out;
}

export function recordObservedSecret(value: string): void {
  if (value.length < 16) return;
  const file = process.env.KITH_E2E_SECRET_FILE;
  if (!file) throw new Error("KITH_E2E_SECRET_FILE is not set");
  appendFileSync(file, value + "\n", { mode: 0o600 });
}

export function readObservedSecrets(): string[] {
  const file = process.env.KITH_E2E_SECRET_FILE;
  if (!file || !existsSync(file)) return [];
  return [...new Set(readFileSync(file, "utf8").split("\n").filter((l) => l !== ""))];
}

export function scanText(text: string, observed: string[]): ScanRule[] {
  const hits: ScanRule[] = [];
  if (new RegExp(BOT_TOKEN.source).test(text)) hits.push("R05-bot-token");
  if (knownSecrets().some((s) => text.includes(s))) hits.push("R06-known-secrets");
  if (observed.some((s) => text.includes(s))) hits.push("R07-observed-session");
  return hits;
}
