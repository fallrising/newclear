// Field rules shared by the v1 wire objects. Go twin: agent/internal/contract/fields.go.

import type { JsonObject, JsonValue } from "./strictJson.ts";

export type ContractCode =
  | "invalid_document"
  | "unsupported_version"
  | "unknown_field"
  | "missing_field"
  | "invalid_field";

export class ContractError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: string, field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ContractError";
    this.code = code;
    this.field = field;
  }
}

export const HEX64 = /^[0-9a-f]{64}$/;
export const B64URL_NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const UTC_SECONDS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

export function idPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_[a-z0-9][a-z0-9_-]{0,62}$`);
}

/** Checks `schema_version`, then unknown keys, then missing keys — the order every twin uses. */
export function checkShape(
  doc: JsonValue,
  family: string,
  supportedMajor: number,
  fields: readonly string[],
): JsonObject {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new ContractError("invalid_document", "$", "document must be a JSON object");
  }
  const version = doc["schema_version"];
  if (version === undefined) throw new ContractError("missing_field", "schema_version", "required");
  const m = typeof version === "string" ? new RegExp(`^${family.replace(/\./g, "\\.")}\\.v([1-9][0-9]{0,3})$`).exec(version) : null;
  if (!m) throw new ContractError("invalid_field", "schema_version", `must be ${family}.v${supportedMajor}`);
  if (Number(m[1]) !== supportedMajor) {
    throw new ContractError("unsupported_version", "schema_version", `unsupported major ${m[1]}`);
  }
  const allowed = new Set(fields);
  for (const k of Object.keys(doc).sort()) {
    if (!allowed.has(k)) throw new ContractError("unknown_field", k, "field is not part of the contract");
  }
  for (const f of fields) {
    if (!(f in doc)) throw new ContractError("missing_field", f, "required");
  }
  return doc;
}

export function str(doc: JsonObject, field: string, re: RegExp): string {
  const v = doc[field];
  if (typeof v !== "string" || !re.test(v)) throw new ContractError("invalid_field", field, `must match ${re.source}`);
  return v;
}

export function int(doc: JsonObject, field: string, min: number, max: number): number {
  const v = doc[field];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new ContractError("invalid_field", field, `must be an integer in [${min}, ${max}]`);
  }
  return v;
}

export function oneOf<T extends string>(doc: JsonObject, field: string, values: readonly T[]): T {
  const v = doc[field];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw new ContractError("invalid_field", field, `must be one of ${values.join(", ")}`);
  }
  return v as T;
}

/** Parses `YYYY-MM-DDTHH:MM:SSZ` into Unix seconds; rejects impossible calendar values. */
export function parseUtcSeconds(v: string): number | null {
  const m = UTC_SECONDS.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return ms / 1000;
}

export function time(doc: JsonObject, field: string): number {
  const v = doc[field];
  const t = typeof v === "string" ? parseUtcSeconds(v) : null;
  if (t === null) throw new ContractError("invalid_field", field, "must be UTC RFC 3339 YYYY-MM-DDTHH:MM:SSZ");
  return t;
}

export function formatUtcSeconds(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}
