import { api } from "./model";
import type { Page } from "./model";

export interface Rule {
  id: string;
  version: number;
  title: string;
  filter: {
    types: string[];
    sources?: string[];
    severity_min?: string;
    subject_prefix?: string;
    data?: Record<string, string | number | boolean | null>;
  };
  aggregation: {
    fn: "count" | "count_distinct" | "sum" | "min" | "max" | "avg";
    field?: string;
  };
  bucket: "5m" | "1h" | "1d";
  group_by?: string[];
  threshold?: {
    op: ">" | ">=" | "<" | "<=" | "==" | "!=";
    value: number;
    for_buckets: number;
    severity: string;
  };
}
export interface Rollup {
  rule_version: number;
  bucket_start: string;
  group_key: string;
  value: number | null;
  sample_count: number;
  partial: boolean;
  computed_at: string;
}
export interface MetricPage extends Page<Rollup> {
  rule_id: string;
  recomputable_from: string | null;
  last_computed_at: string | null;
}
export function metricPath(
  id: string,
  params: URLSearchParams,
  group = "",
): string {
  const query = new URLSearchParams();
  for (const key of ["from", "to"]) {
    if (params.get(key)) query.set(key, params.get(key)!);
  }
  if (group) query.set("group", group);
  query.set("limit", "200");
  return `/v1/metrics/${encodeURIComponent(id)}?${query}`;
}

// Never publish a successful chart assembled from only part of a result. Both
// rules and rollups use opaque cursors; a failed page rejects the entire load.
export async function loadPages<P extends Page<unknown>>(
  path: string,
  token: string,
  signal: AbortSignal,
  progress: (count: number) => void = () => {},
): Promise<P> {
  const items: P["items"] = [];
  const seen = new Set<string>();
  let next = path;
  for (;;) {
    signal.throwIfAborted();
    const page = await api<P>(next, token, signal);
    signal.throwIfAborted();
    items.push(...page.items);
    progress(items.length);
    if (page.next_cursor === null) return { ...page, items };
    if (seen.has(page.next_cursor))
      throw new Error("Repeated pagination cursor");
    seen.add(page.next_cursor);
    const query = new URL(path, "http://localhost");
    query.searchParams.set("cursor", page.next_cursor);
    next = query.pathname + query.search;
  }
}
export function groupLabel(key: string): string {
  if (key === "[]") return "未分組";
  if (key === "__other__") return "其他分組（合併）";
  return key;
}
export const bucketMilliseconds = {
  "5m": 300_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};
export interface MetricSeries {
  group: string;
  points: (Rollup & { value: number })[];
  segments: {
    from: Rollup & { value: number };
    to: Rollup & { value: number };
    partial: boolean;
  }[];
}
export function metricSeries(
  items: Rollup[],
  bucket: Rule["bucket"],
): MetricSeries[] {
  const groups = new Map<string, Rollup[]>();
  for (const item of items) {
    const rows = groups.get(item.group_key) ?? [];
    rows.push(item);
    groups.set(item.group_key, rows);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, rows]) => {
      rows.sort(
        (a, b) =>
          Date.parse(a.bucket_start) - Date.parse(b.bucket_start) ||
          a.rule_version - b.rule_version,
      );
      const series: MetricSeries = {
        group,
        points: [],
        segments: [],
      };
      let previous: Rollup | undefined;
      for (const row of rows) {
        if (row.value !== null) {
          const point = row as Rollup & { value: number };
          series.points.push(point);
          if (
            previous?.value !== null &&
            previous !== undefined &&
            previous.rule_version === row.rule_version &&
            Date.parse(row.bucket_start) - Date.parse(previous.bucket_start) ===
              bucketMilliseconds[bucket]
          ) {
            series.segments.push({
              from: previous as Rollup & { value: number },
              to: point,
              partial: previous.partial || row.partial,
            });
          }
        }
        previous = row;
      }
      return series;
    });
}

// A version may introduce completely different groups. Detect boundaries
// across the whole result rather than relying on a group surviving a reload.
export function versionBoundaries(items: Rollup[]): Rollup[] {
  const buckets = new Map<string, Map<number, Rollup>>();
  for (const row of items) {
    const versions = buckets.get(row.bucket_start) ?? new Map<number, Rollup>();
    versions.set(row.rule_version, row);
    buckets.set(row.bucket_start, versions);
  }
  const boundaries: Rollup[] = [];
  let previous: Map<number, Rollup> | undefined;
  for (const [, versions] of [...buckets].sort(
    ([a], [b]) => Date.parse(a) - Date.parse(b),
  )) {
    if (previous)
      for (const [version, row] of versions)
        if (!previous.has(version)) boundaries.push(row);
    previous = versions;
  }
  return boundaries;
}
