import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricChart, MetricTable } from "./MetricBoard";
import type { Rollup, Rule } from "./metrics";

const rule: Rule = {
  id: "metric",
  title: "Synthetic trend",
  version: 2,
  aggregation: { fn: "avg", field: "data.duration" },
  bucket: "1h",
  filter: { types: ["test.event"] },
  threshold: { op: ">=", value: 2, for_buckets: 2, severity: "warning" },
};
const row = (
  hour: number,
  value: number | null,
  extra: Partial<Rollup> = {},
): Rollup => ({
  rule_version: 2,
  bucket_start: `2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`,
  group_key: "[]",
  value,
  sample_count: value === null ? 0 : 1,
  partial: false,
  computed_at: "2026-10-03T12:00:00Z",
  ...extra,
});

describe("metric chart and accessible table", () => {
  it("renders dashed partial points, threshold and version boundaries even when groups change", () => {
    const markup = renderToStaticMarkup(
      <MetricChart
        rule={rule}
        items={[
          row(1, 1, { rule_version: 1, group_key: '["old"]' }),
          row(2, 2),
          row(3, 3, { partial: true }),
        ]}
      />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('data-version="2"');
    expect(markup).toContain('data-threshold="2"');
    expect(markup).toContain('stroke-dasharray="5 4" data-partial="true"');
    expect(markup).not.toContain("style=");
  });
  it("renders null gaps and exact accessible values without scripts or false zeros", () => {
    const items = [
      row(1, 0, { rule_version: 1 }),
      row(2, null),
      row(3, 2.123456789, { group_key: '["<script>"]', partial: true }),
    ];
    const table = renderToStaticMarkup(
      <MetricTable rule={rule} items={items} />,
    );
    expect(table).toContain('tabindex="0"');
    expect(table).toContain('scope="col"');
    expect(table).toContain('scope="row"');
    expect(table).toContain("—（空值）");
    expect(table).toContain("2.123456789");
    expect(table).toContain("舊版本規則");
    expect(table).toContain("未結束（partial）");
    expect(table).toContain("&lt;script&gt;");
    expect(table).not.toContain("<script>");
  });
  it("keeps SVG coordinates finite for extreme finite aggregates", () => {
    const markup = renderToStaticMarkup(
      <MetricChart rule={rule} items={[row(1, -1e308), row(2, 1e308)]} />,
    );
    expect(markup).not.toMatch(
      /(?:x|y|cx|cy)[12]?="(?:NaN|Infinity|-Infinity)"/,
    );
  });
});
