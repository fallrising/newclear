// Telemetry report v1 (SDD 03 §2, 05 §3). Go twin: agent/internal/contract/telemetry.go.
// Units live in field names; there are no floats on the wire. `null` means unsupported or
// unavailable and must never be rendered as 0.

import { ContractError, checkShape, idPattern, int, str, time } from "./fields.ts";
import { parseStrictJson, type JsonObject, type JsonValue } from "./strictJson.ts";

export const TELEMETRY_MAX_BYTES = 256 * 1024;
export const MAX_SERIES_ENTRIES = 32;

const REPORT_FIELDS = [
  "schema_version",
  "node_id",
  "enrollment_generation",
  "boot_id",
  "seq",
  "window_start",
  "window_end",
  "sample_count",
  "agent_version",
  "spool_dropped_reports",
  "metrics",
] as const;

const METRIC_FIELDS = [
  "cpu_busy_bp",
  "load1_milli",
  "load5_milli",
  "load15_milli",
  "mem_total_bytes",
  "mem_available_bytes",
  "swap_total_bytes",
  "swap_free_bytes",
  "uptime_seconds",
  "mounts",
  "disk_io",
  "net",
] as const;

const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,32})?$/;
// uint64 as a canonical decimal string (no leading zeros, max 2^64-1).
const U64 = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 18446744073709551615n;
const LABEL = /^[A-Za-z0-9_./:@-]{1,128}$/;

export interface Window {
  avg: number;
  max: number;
  last: number;
}

export interface TelemetryReport {
  node_id: string;
  enrollment_generation: number;
  boot_id: string;
  seq: number;
  window_start: number;
  window_end: number;
  sample_count: number;
  agent_version: string;
  spool_dropped_reports: number;
  metrics: {
    cpu_busy_bp: Window | null;
    load1_milli: number | null;
    load5_milli: number | null;
    load15_milli: number | null;
    mem_total_bytes: string | null;
    mem_available_bytes: string | null;
    swap_total_bytes: string | null;
    swap_free_bytes: string | null;
    uptime_seconds: number | null;
    mounts: { mount: string; total_bytes: string; avail_bytes: string }[] | null;
    disk_io: { device: string; read_bytes_total: string; write_bytes_total: string }[] | null;
    net: { iface: string; rx_bytes_total: string; tx_bytes_total: string }[] | null;
  };
}

export function parseTelemetryReport(bytes: Uint8Array): TelemetryReport {
  const doc = checkShape(parseStrictJson(bytes, TELEMETRY_MAX_BYTES), "edgeops.telemetry", 1, REPORT_FIELDS);
  const r = {
    node_id: str(doc, "node_id", idPattern("node")),
    enrollment_generation: int(doc, "enrollment_generation", 1, 2147483647),
    boot_id: str(doc, "boot_id", BOOT_ID),
    seq: int(doc, "seq", 0, Number.MAX_SAFE_INTEGER),
    window_start: time(doc, "window_start"),
    window_end: time(doc, "window_end"),
    sample_count: int(doc, "sample_count", 0, 3600),
    agent_version: str(doc, "agent_version", AGENT_VERSION),
    spool_dropped_reports: int(doc, "spool_dropped_reports", 0, Number.MAX_SAFE_INTEGER),
    metrics: metrics(doc["metrics"]),
  };
  if (r.window_end < r.window_start || r.window_end - r.window_start > 3600) {
    throw new ContractError("invalid_field", "window_end", "window must be 0..3600 seconds");
  }
  return r;
}

function metrics(v: JsonValue | undefined): TelemetryReport["metrics"] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ContractError("invalid_field", "metrics", "must be an object");
  }
  for (const k of Object.keys(v).sort()) {
    if (!(METRIC_FIELDS as readonly string[]).includes(k)) throw new ContractError("unknown_field", `metrics.${k}`, "unknown metric");
  }
  for (const k of METRIC_FIELDS) {
    if (!(k in v)) throw new ContractError("missing_field", `metrics.${k}`, "required; use null when unsupported");
  }
  return {
    cpu_busy_bp: nullable(v, "cpu_busy_bp", (x, f) => window(x, f)),
    load1_milli: nullable(v, "load1_milli", (x, f) => intValue(x, f, 0, 100_000_000)),
    load5_milli: nullable(v, "load5_milli", (x, f) => intValue(x, f, 0, 100_000_000)),
    load15_milli: nullable(v, "load15_milli", (x, f) => intValue(x, f, 0, 100_000_000)),
    mem_total_bytes: nullable(v, "mem_total_bytes", u64),
    mem_available_bytes: nullable(v, "mem_available_bytes", u64),
    swap_total_bytes: nullable(v, "swap_total_bytes", u64),
    swap_free_bytes: nullable(v, "swap_free_bytes", u64),
    uptime_seconds: nullable(v, "uptime_seconds", (x, f) => intValue(x, f, 0, Number.MAX_SAFE_INTEGER)),
    mounts: nullable(v, "mounts", (x, f) =>
      series(x, f, (e, ef) => {
        const o = entry(e, ef, ["mount", "total_bytes", "avail_bytes"]);
        return { mount: label(o, ef, "mount"), total_bytes: u64(o["total_bytes"], `${ef}.total_bytes`), avail_bytes: u64(o["avail_bytes"], `${ef}.avail_bytes`) };
      }),
    ),
    disk_io: nullable(v, "disk_io", (x, f) =>
      series(x, f, (e, ef) => {
        const o = entry(e, ef, ["device", "read_bytes_total", "write_bytes_total"]);
        return {
          device: label(o, ef, "device"),
          read_bytes_total: u64(o["read_bytes_total"], `${ef}.read_bytes_total`),
          write_bytes_total: u64(o["write_bytes_total"], `${ef}.write_bytes_total`),
        };
      }),
    ),
    net: nullable(v, "net", (x, f) =>
      series(x, f, (e, ef) => {
        const o = entry(e, ef, ["iface", "rx_bytes_total", "tx_bytes_total"]);
        return {
          iface: label(o, ef, "iface"),
          rx_bytes_total: u64(o["rx_bytes_total"], `${ef}.rx_bytes_total`),
          tx_bytes_total: u64(o["tx_bytes_total"], `${ef}.tx_bytes_total`),
        };
      }),
    ),
  };
}

function nullable<T>(o: JsonObject, k: string, parse: (v: JsonValue, field: string) => T): T | null {
  const v = o[k]!;
  return v === null ? null : parse(v, `metrics.${k}`);
}

function intValue(v: JsonValue, field: string, min: number, max: number): number {
  if (typeof v !== "number" || v < min || v > max) throw new ContractError("invalid_field", field, `must be an integer in [${min}, ${max}]`);
  return v;
}

function u64(v: JsonValue | undefined, field: string): string {
  if (typeof v !== "string" || !U64.test(v) || BigInt(v) > U64_MAX) {
    throw new ContractError("invalid_field", field, "must be a uint64 decimal string");
  }
  return v;
}

function window(v: JsonValue, field: string): Window {
  const o = entry(v, field, ["avg", "max", "last"]);
  const w = {
    avg: intValue(o["avg"]!, `${field}.avg`, 0, 10000),
    max: intValue(o["max"]!, `${field}.max`, 0, 10000),
    last: intValue(o["last"]!, `${field}.last`, 0, 10000),
  };
  if (w.avg > w.max || w.last > w.max) throw new ContractError("invalid_field", `${field}.max`, "max must bound avg and last");
  return w;
}

function entry(v: JsonValue | undefined, field: string, keys: readonly string[]): JsonObject {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ContractError("invalid_field", field, "must be an object");
  for (const k of Object.keys(v).sort()) {
    if (!keys.includes(k)) throw new ContractError("unknown_field", `${field}.${k}`, "unknown field");
  }
  for (const k of keys) {
    if (!(k in v)) throw new ContractError("missing_field", `${field}.${k}`, "required");
  }
  return v;
}

function label(o: JsonObject, field: string, k: string): string {
  const v = o[k];
  if (typeof v !== "string" || !LABEL.test(v)) throw new ContractError("invalid_field", `${field}.${k}`, "invalid label");
  return v;
}

function series<T extends Record<string, string>>(v: JsonValue, field: string, parse: (e: JsonValue, f: string) => T): T[] {
  if (!Array.isArray(v) || v.length > MAX_SERIES_ENTRIES) {
    throw new ContractError("invalid_field", field, `must be an array of at most ${MAX_SERIES_ENTRIES}`);
  }
  const seen = new Set<string>();
  return v.map((e, i) => {
    const parsed = parse(e, `${field}[${i}]`);
    const id = Object.values(parsed)[0]!;
    if (seen.has(id)) throw new ContractError("invalid_field", `${field}[${i}]`, "duplicate series label");
    seen.add(id);
    return parsed;
  });
}
