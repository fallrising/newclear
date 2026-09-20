/** Isolate-local counters. No handle labels. Do not log body, token, API key, or prompt. */

export type MetricLabels = Record<string, string>;

export type MetricsSnapshot = {
  messages_total: { message: number; trace: number };
  generation_dropped_total: number;
  ambient_budget_exhausted: number;
  wake_total: Record<string, number>;
};

type Entry = { name: string; labels: MetricLabels };

const values = new Map<string, number>();
const meta = new Map<string, Entry>();

function keyOf(name: string, labels: MetricLabels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return name;
  return `${name}\t${keys.map((k) => `${k}=${labels[k]}`).join(",")}`;
}

export function inc(name: string, labels?: MetricLabels, n = 1): void {
  const labelsSafe = labels ?? {};
  const key = keyOf(name, labelsSafe);
  values.set(key, (values.get(key) ?? 0) + n);
  if (!meta.has(key)) meta.set(key, { name, labels: labelsSafe });
}

export function snapshot(): MetricsSnapshot {
  const out: MetricsSnapshot = {
    messages_total: { message: 0, trace: 0 },
    generation_dropped_total: 0,
    ambient_budget_exhausted: 0,
    wake_total: {},
  };
  for (const [key, value] of values) {
    const entry = meta.get(key);
    if (!entry) continue;
    if (entry.name === "messages_total") {
      const kind = entry.labels.kind;
      if (kind === "message" || kind === "trace") out.messages_total[kind] = value;
    } else if (entry.name === "generation_dropped_total") {
      out.generation_dropped_total = value;
    } else if (entry.name === "ambient_budget_exhausted") {
      out.ambient_budget_exhausted = value;
    } else if (entry.name === "wake_total") {
      const result = entry.labels.result;
      if (typeof result === "string") out.wake_total[result] = value;
    }
  }
  return out;
}

/** Test helper: isolate counters persist across it() when isolate is off. */
export function reset(): void {
  values.clear();
  meta.clear();
}
