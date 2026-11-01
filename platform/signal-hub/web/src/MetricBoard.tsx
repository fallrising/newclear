import { useEffect, useMemo, useState } from "react";
import { errorText } from "./model";
import type { Page } from "./model";
import {
  groupLabel,
  loadPages,
  metricPath,
  metricSeries,
  versionBoundaries,
} from "./metrics";
import type { MetricPage, Rollup, Rule } from "./metrics";

function useAllPages<P extends Page<unknown>>(
  path: string,
  token: string,
  revision: number,
  denied: (error: unknown) => void,
) {
  const [state, setState] = useState<{
    path: string;
    revision: number;
    page: P | null;
    loading: boolean;
    count: number;
    error: unknown;
  }>({ path, revision, page: null, loading: true, count: 0, error: null });
  useEffect(() => {
    const request = new AbortController();
    setState({
      path,
      revision,
      page: null,
      loading: true,
      count: 0,
      error: null,
    });
    loadPages<P>(path, token, request.signal, (count) => {
      if (!request.signal.aborted)
        setState((previous) => ({ ...previous, count }));
    })
      .then((page) => {
        if (!request.signal.aborted)
          setState({
            path,
            revision,
            page,
            loading: false,
            count: page.items.length,
            error: null,
          });
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return;
        denied(error);
        setState({
          path,
          revision,
          page: null,
          loading: false,
          count: 0,
          error,
        });
      });
    return () => request.abort();
  }, [path, token, revision, denied]);
  // A newly selected time range must never briefly display the preceding query.
  return state.path === path && state.revision === revision
    ? state
    : { ...state, page: null, error: null, loading: true, count: 0 };
}
function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="notice error" role="alert">
      <span>{errorText(error)}</span>
      <button onClick={retry}>重試</button>
    </div>
  );
}
function Loading({ count }: { count: number }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在載入全部分頁… 已取得 {count} 筆
    </div>
  );
}
function metricTime(value: string | null): string {
  if (!value) return "尚無";
  return value.replace("T", " ").replace("Z", " UTC");
}
function numberLabel(value: number) {
  if (Math.abs(value) >= 1_000_000 || (value !== 0 && Math.abs(value) < 0.001))
    return value.toExponential(2);
  return new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 5 }).format(
    value,
  );
}
const colors = [
  "#147f78",
  "#9b6840",
  "#7567a8",
  "#496ca4",
  "#ae5573",
  "#687e35",
];
export function MetricChart({ rule, items }: { rule: Rule; items: Rollup[] }) {
  const series = useMemo(
    () => metricSeries(items, rule.bucket),
    [items, rule.bucket],
  );
  const points = series.flatMap((item) => item.points);
  const times = items.map((item) => Date.parse(item.bucket_start));
  const first = times.reduce((a, b) => Math.min(a, b), Infinity);
  const last = times.reduce((a, b) => Math.max(a, b), -Infinity);
  const values = points.map((point) => point.value);
  if (rule.threshold) values.push(rule.threshold.value);
  const minimum = values.reduce((a, b) => Math.min(a, b), 0),
    maximum = values.reduce((a, b) => Math.max(a, b), 1);
  const x = (time: string) =>
    first === last
      ? 340
      : 60 + ((Date.parse(time) - first) / (last - first)) * 590;
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  const y = (value: number) =>
    210 -
    ((value / magnitude - minimum / magnitude) /
      (maximum / magnitude - minimum / magnitude)) *
      175;
  const boundaries = versionBoundaries(items);
  return (
    <>
      <svg
        className="metric-chart"
        viewBox="0 0 680 255"
        role="img"
        aria-labelledby={`chart-title-${rule.id} chart-description-${rule.id}`}
      >
        <title id={`chart-title-${rule.id}`}>{rule.title} 趨勢</title>
        <desc id={`chart-description-${rule.id}`}>
          時間由左至右，單位為 {rule.aggregation.fn}
          。虛線為未結束的桶，空值與缺少的桶保留斷點，垂直線標示版本變更。下方資料表提供每筆數值。
        </desc>
        {[0, 0.5, 1].map((fraction) => {
          const value = minimum * (1 - fraction) + maximum * fraction;
          return (
            <g key={fraction}>
              <line
                className="metric-grid-line"
                x1="60"
                x2="650"
                y1={y(value)}
                y2={y(value)}
              />
              <text
                className="metric-axis"
                x="50"
                y={y(value) + 4}
                textAnchor="end"
              >
                {numberLabel(value)}
              </text>
            </g>
          );
        })}
        {rule.threshold && (
          <line
            className="metric-threshold"
            data-threshold={rule.threshold.value}
            x1="60"
            x2="650"
            y1={y(rule.threshold.value)}
            y2={y(rule.threshold.value)}
          >
            <title>
              目前版本門檻 {rule.threshold.op} {rule.threshold.value}
            </title>
          </line>
        )}
        {boundaries.map((row) => (
          <g
            key={`${row.bucket_start}/${row.rule_version}`}
            className="metric-boundary"
            data-version={row.rule_version}
          >
            <line
              x1={x(row.bucket_start)}
              x2={x(row.bucket_start)}
              y1="25"
              y2="215"
            />
            <text x={x(row.bucket_start)} y="17" textAnchor="middle">
              v{row.rule_version}
            </text>
            <title>
              版本變更：{row.bucket_start}，v{row.rule_version}
            </title>
          </g>
        ))}
        {series.map((line, index) => (
          <g key={line.group} stroke={colors[index % colors.length]}>
            {line.segments.map((segment, i) => (
              <line
                key={i}
                x1={x(segment.from.bucket_start)}
                x2={x(segment.to.bucket_start)}
                y1={y(segment.from.value)}
                y2={y(segment.to.value)}
                strokeWidth="2"
                strokeDasharray={segment.partial ? "5 4" : undefined}
                data-partial={segment.partial}
              />
            ))}
            {line.points.map((point) => (
              <circle
                key={`${point.bucket_start}/${point.rule_version}`}
                cx={x(point.bucket_start)}
                cy={y(point.value)}
                r={point.partial ? "4" : "2.5"}
                fill={point.partial ? "white" : colors[index % colors.length]}
                strokeWidth="1.5"
                strokeDasharray={point.partial ? "3 2" : undefined}
                data-partial={point.partial}
              >
                <title>
                  {groupLabel(line.group)} · {point.bucket_start} · v
                  {point.rule_version} · {point.value}
                  {point.partial ? "（未結束）" : ""}
                </title>
              </circle>
            ))}
          </g>
        ))}
        {times.length > 0 && (
          <>
            <text className="metric-axis" x="60" y="240">
              {new Date(first).toISOString().slice(0, 16).replace("T", " ")} UTC
            </text>
            <text className="metric-axis" x="650" y="240" textAnchor="end">
              {new Date(last).toISOString().slice(0, 16).replace("T", " ")} UTC
            </text>
          </>
        )}
      </svg>
      {!points.length && (
        <p className="metric-note">此範圍沒有可繪製的數值；空值不代表零。</p>
      )}
      <div
        className="metric-legend"
        aria-label="圖例"
        tabIndex={0}
        role="region"
      >
        {series.map((item, index) => (
          <span key={item.group}>
            <i className={`metric-color-${index % colors.length}`} />
            {groupLabel(item.group)}
          </span>
        ))}
      </div>
    </>
  );
}
export function MetricTable({ rule, items }: { rule: Rule; items: Rollup[] }) {
  return (
    <details className="metric-table-details">
      <summary>查看資料表（{items.length} 筆）</summary>
      <div
        className="table-scroll metric-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${rule.title} 指標資料`}
      >
        <table className="metric-table">
          <caption>
            {rule.title}：桶起點由早至晚，時間為 UTC；空值不代表零。
          </caption>
          <thead>
            <tr>
              {[
                "桶起點",
                "分組",
                "規則版本",
                "數值",
                "樣本數",
                "狀態",
                "計算時間",
              ].map((title) => (
                <th key={title} scope="col">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={`${row.bucket_start}/${row.rule_version}/${row.group_key}`}
              >
                <th scope="row">{metricTime(row.bucket_start)}</th>
                <td>{groupLabel(row.group_key)}</td>
                <td>
                  v{row.rule_version}
                  {row.rule_version !== rule.version && "（舊版本規則）"}
                </td>
                <td>{row.value === null ? "—（空值）" : String(row.value)}</td>
                <td>{row.sample_count}</td>
                <td>{row.partial ? "未結束（partial）" : "已結束"}</td>
                <td>{metricTime(row.computed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
function MetricCard({
  rule,
  params,
  token,
  revision,
  denied,
}: {
  rule: Rule;
  params: URLSearchParams;
  token: string;
  revision: number;
  denied: (error: unknown) => void;
}) {
  const [group, setGroup] = useState("");
  const [retry, setRetry] = useState(0);
  const path = metricPath(rule.id, params);
  const state = useAllPages<MetricPage>(path, token, revision + retry, denied);
  const groups = useMemo(
    () =>
      [...new Set(state.page?.items.map((row) => row.group_key) ?? [])].sort(),
    [state.page],
  );
  const selected = groups.includes(group) ? group : "";
  const items = useMemo(
    () =>
      state.page?.items.filter(
        (row) => !selected || row.group_key === selected,
      ) ?? [],
    [state.page, selected],
  );
  return (
    <section
      className="panel metric-card"
      aria-labelledby={`metric-heading-${rule.id}`}
    >
      <div className="panel-heading">
        <div>
          <h2 id={`metric-heading-${rule.id}`}>{rule.title}</h2>
          <p className="metric-rule-meta">
            {rule.id} · v{rule.version} · {rule.aggregation.fn}
            {rule.aggregation.field ? `(${rule.aggregation.field})` : ""} ·{" "}
            {rule.bucket} UTC
          </p>
        </div>
        <span>唯讀規則</span>
      </div>
      {state.loading ? (
        <Loading count={state.count} />
      ) : state.error ? (
        <Failure
          error={state.error}
          retry={() => setRetry((value) => value + 1)}
        />
      ) : (
        state.page && (
          <div className="metric-content">
            <div className="metric-controls">
              <label>
                分組
                {rule.group_by?.length ? `（${rule.group_by.join("、")}）` : ""}
                <select
                  value={selected}
                  onChange={(event) => setGroup(event.target.value)}
                >
                  <option value="">全部分組（{groups.length}）</option>
                  {groups.map((key) => (
                    <option key={key} value={key}>
                      {groupLabel(key)}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                已載入全部 {state.page.items.length} 筆 · 顯示 {items.length} 筆
              </span>
            </div>
            {items.length ? (
              <>
                <MetricChart rule={rule} items={items} />
                <p className="metric-note">
                  虛線／空心點：未結束的桶 · 垂直線：版本變更 · 空值保留斷點。
                  {items.some((row) => row.rule_version !== rule.version) &&
                    " 此段包含舊版本規則，版本間不連線。"}
                </p>
                <MetricTable rule={rule} items={items} />
              </>
            ) : (
              <div className="empty">
                <h3>此範圍沒有指標</h3>
                <p>
                  請調整時間範圍，或確認規則已有成功計算。沒有資料不代表一切正常。
                </p>
              </div>
            )}
            {rule.threshold && (
              <p className="metric-threshold-note">
                目前版本門檻：{rule.threshold.op} {rule.threshold.value} · 連續{" "}
                {rule.threshold.for_buckets} 個已結束的桶 ·{" "}
                {rule.threshold.severity}
              </p>
            )}
            <dl className="metric-metadata">
              <div>
                <dt>最早可重算事件</dt>
                <dd>{metricTime(state.page.recomputable_from)}</dd>
              </div>
              <div>
                <dt>最後計算時間</dt>
                <dd>{metricTime(state.page.last_computed_at)}</dd>
              </div>
            </dl>
          </div>
        )
      )}
    </section>
  );
}
export function Metrics({
  params,
  token,
  denied,
}: {
  params: URLSearchParams;
  token: string;
  denied: (error: unknown) => void;
}) {
  const [revision, setRevision] = useState(0);
  const state = useAllPages<Page<Rule>>(
    "/v1/rules?limit=200",
    token,
    revision,
    denied,
  );
  return (
    <div className="metrics-board">
      <div className="metrics-heading">
        <span>
          {state.page ? `${state.page.items.length} 條生效規則` : "生效規則"}
        </span>
        <button
          className="outline-button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={state.loading}
        >
          重新查詢指標
        </button>
      </div>
      {state.loading ? (
        <Loading count={state.count} />
      ) : state.error ? (
        <Failure
          error={state.error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : state.page?.items.length ? (
        state.page.items.map((rule) => (
          <MetricCard
            key={`${rule.id}/${rule.version}`}
            rule={rule}
            params={params}
            token={token}
            revision={revision}
            denied={denied}
          />
        ))
      ) : (
        <section className="panel">
          <div className="empty">
            <h3>尚無生效規則</h3>
            <p>指標規則由設定檔管理；載入規則並完成計算後，趨勢將顯示於此。</p>
          </div>
        </section>
      )}
    </div>
  );
}
