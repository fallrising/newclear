import { VERSION } from './types.ts';
import type { Metrics, Telemetry } from './types.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new HttpError(422, 'invalid_payload', message);
}
export function object(value: unknown, fields: string[]): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  const obj = value as Record<string, unknown>;
  requireThat(Object.keys(obj).length === fields.length && fields.every(k => Object.hasOwn(obj, k)), 'Missing or unknown fields');
  return obj;
}
export function nodeId(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && /^node_demo(?:0[1-9]|10)$/.test(value), 'Only synthetic node_demo01..10 are allowed');
}
export function timestamp(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'Use UTC ISO timestamps including milliseconds');
  requireThat(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Invalid UTC timestamp');
}
export function strictJson(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json', 'Malformed JSON'); }
  // JSON.parse validates grammar; this token pass rejects duplicate decoded keys and excessive depth.
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  const stack: {kind: string; keys: Set<string>; expectKey: boolean}[] = [];
  for (const t of tokens) {
    if (t === '{' || t === '[') {
      stack.push({kind: t, keys: new Set(), expectKey: t === '{'});
      requireThat(stack.length <= 12, 'JSON nesting limit exceeded');
    } else if (t === '}' || t === ']') stack.pop();
    else {
      const top = stack.at(-1);
      if (t === ',' && top?.kind === '{') top.expectKey = true;
      else if (t.startsWith('"') && top?.kind === '{' && top.expectKey) {
        const key = JSON.parse(t) as string;
        requireThat(!top.keys.has(key), 'Duplicate JSON key');
        top.keys.add(key); top.expectKey = false;
      }
    }
  }
  return value;
}
export function telemetry(value: unknown, now: number): Telemetry {
  const x = object(value, ['schema_version','node_id','enrollment_generation','boot_id','seq','sent_at','observed_at','window_seconds','sample_count','metrics']);
  requireThat(x.schema_version === VERSION, 'Unsupported schema version'); nodeId(x.node_id);
  requireThat(x.enrollment_generation === 1, 'Unknown enrollment generation');
  requireThat(typeof x.boot_id === 'string' && /^boot_[a-z0-9_-]{1,64}$/.test(x.boot_id), 'Invalid boot_id');
  requireThat(Number.isSafeInteger(x.seq) && (x.seq as number) >= 0, 'seq must be a safe nonnegative integer');
  timestamp(x.sent_at); timestamp(x.observed_at);
  requireThat(Math.abs(Date.parse(x.sent_at) - now) <= 120_000, 'Envelope clock skew exceeds 120s');
  requireThat(Date.parse(x.observed_at) <= now + 5_000 && Date.parse(x.observed_at) >= now - 7*86400_000, 'Sample outside retention window');
  requireThat(x.window_seconds === 60 && Number.isInteger(x.sample_count) && (x.sample_count as number) >= 1 && (x.sample_count as number) <= 60, 'Invalid aggregation window');
  const m = object(x.metrics, ['cpu_avg_percent','cpu_max_percent','memory_used_bytes','memory_total_bytes','disk_used_percent','network_rx_bytes','network_tx_bytes']);
  for (const k of ['cpu_avg_percent','cpu_max_percent','disk_used_percent']) {
    const v = m[k]; requireThat(v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100), `${k} must be null or 0..100`);
  }
  for (const k of ['memory_used_bytes','memory_total_bytes','network_rx_bytes','network_tx_bytes']) {
    const v = m[k]; requireThat(v === null || (typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n), `${k} must be null or uint64 decimal string`);
  }
  requireThat((m.cpu_avg_percent === null) === (m.cpu_max_percent === null), 'CPU pair must both be null or present');
  requireThat(m.cpu_avg_percent === null || (m.cpu_avg_percent as number) <= (m.cpu_max_percent as number), 'CPU average exceeds maximum');
  requireThat((m.memory_used_bytes === null) === (m.memory_total_bytes === null), 'Memory pair must both be null or present');
  if (m.memory_total_bytes !== null) requireThat(BigInt(m.memory_total_bytes as string) > 0n && BigInt(m.memory_used_bytes as string) <= BigInt(m.memory_total_bytes as string), 'Invalid memory accounting');
  return {...x, metrics: m as unknown as Metrics} as unknown as Telemetry;
}
/** Hash logical sample only: a retry may carry a newly signed sent_at envelope. */
export async function sampleDigest(t: Telemetry): Promise<string> {
  const {sent_at: _sent, ...sample} = t;
  const canonical = JSON.stringify(sample, [...new Set([...Object.keys(sample), ...Object.keys(sample.metrics)])].sort());
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
