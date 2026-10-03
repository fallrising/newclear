export const filterKeys = [
  "from",
  "to",
  "source",
  "type",
  "severity_min",
  "subject_prefix",
  "correlationid",
  "q",
] as const;
export type FilterKey = (typeof filterKeys)[number];
export type Filters = Record<FilterKey, string>;
export const severities = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
] as const;
export interface CloudEvent {
  specversion: string;
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  summary?: string;
  severity?: string;
  originurl?: string;
  correlationid?: string;
  causationid?: string;
  [key: string]: unknown;
}
export interface StoredEvent {
  seq: number;
  received_at: string;
  clock_skew: boolean;
  event: CloudEvent;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
export interface EventDetail {
  item: StoredEvent;
  related: StoredEvent[];
}
export interface Source {
  name: string;
  source_prefix: string;
  expected_interval: string | null;
  last_received_at: string | null;
  last_event_time: string | null;
  status: "fresh" | "late" | "silent" | "never";
}
export function readFilters(params: URLSearchParams): Filters {
  return Object.fromEntries(
    filterKeys.map((key) => [key, params.get(key) ?? ""]),
  ) as Filters;
}
export function presetRange(
  hours: number,
  now = new Date(),
): Pick<Filters, "from" | "to"> {
  return {
    from: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    to: now.toISOString(),
  };
}
export function initialParams(
  search: string,
  now = new Date(),
): URLSearchParams {
  const original = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of [...filterKeys, "range", "view", "event"]) {
    if (original.has(key)) params.set(key, original.get(key)!);
  }
  if (
    !params.has("from") &&
    !params.has("to") &&
    params.get("range") !== "all"
  ) {
    const range = presetRange(24, now);
    params.set("from", range.from);
    params.set("to", range.to);
    params.set("range", "24h");
  }
  return params;
}
export function applyFilters(
  params: URLSearchParams,
  filters: Filters,
  range: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of filterKeys) {
    if (filters[key]) next.set(key, filters[key]);
    else next.delete(key);
  }
  next.set("range", range);
  next.delete("event");
  next.delete("cursor");
  return next;
}
export function eventsPath(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of filterKeys)
    if (params.has(key)) query.set(key, params.get(key)!);
  query.set("limit", "100");
  return "/v1/events?" + query.toString();
}
export function safeOriginURL(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function localInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 19);
}
export function customUTC(value: string, original: string): string {
  if (value === localInput(original)) return original;
  return value ? new Date(value).toISOString() : "";
}
export function sourceLabel(source: Source): string {
  if (source.status === "never") return "尚未收到事件";
  if (source.expected_interval === null) return "未啟用新鮮度檢查";
  return { fresh: "新鮮", late: "延遲", silent: "沉默" }[source.status];
}
export function sortedRelated(items: StoredEvent[]): StoredEvent[] {
  // The API preserves arbitrary fractional-second precision; compare the exact
  // fraction when JavaScript's millisecond Date would otherwise tie.
  return [...items].sort(
    (a, b) => compareEventTime(a.event.time, b.event.time) || a.seq - b.seq,
  );
}
function compareEventTime(a: string, b: string): number {
  const delta = Date.parse(a) - Date.parse(b);
  if (delta) return delta;
  const fraction = (value: string) =>
    value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] ?? "";
  const fa = fraction(a),
    fb = fraction(b),
    length = Math.max(fa.length, fb.length);
  return fa.padEnd(length, "0").localeCompare(fb.padEnd(length, "0"));
}
export class APIError extends Error {
  constructor(public status: number) {
    super("API request failed");
  }
}
export function errorText(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 401)
      return "認證失敗（401）：token 無效或已失效，請重新輸入。";
    if (error.status === 403)
      return "權限不足（403）：請使用 owner 或唯讀 token。";
    if (error.status === 400)
      return "查詢無效（400）：請檢查時間、類型與篩選條件。";
    if (error.status === 404)
      return "找不到資料（404）：事件可能已封存，或此功能尚未提供。";
    if (error.status === 503) return "服務暫時無法查詢（503），請稍後重試。";
    return `查詢失敗（HTTP ${error.status}），請重試。`;
  }
  return "無法連線：請檢查網路與 Signal Hub 服務，再重試。";
}
export async function api<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) throw new APIError(response.status);
  return response.json() as Promise<T>;
}
