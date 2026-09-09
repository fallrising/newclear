# 17 — 參考驅動：ClickHouse

位置：`drivers/clickhouse`。Schema DDL 見 `04-DATA-MODEL.md` §6，本文件補完**每個 SPI 方法的查詢實作**。

## 1. DSN 與 Options

```
clickhouse://user:password@host:9000/database?secure=false&dial_timeout=5s
```

| Option | 預設 | 說明 |
|---|---|---|
| `cluster` | `""` | 非空時 DDL 加 `ON CLUSTER`，引擎改用 `Replicated*` |
| `max_execution_time` | `55` | 秒。必須 < `query.timeout`，讓 CH 先超時並回明確錯誤 |
| `max_memory_usage` | `1000000000` | 單查詢記憶體上限（1 GB） |
| `max_result_rows` | `5000000` | 超出回 `ErrTooLarge` |
| `async_insert` | `1` | 見 `04` §6.6 |
| `max_open_conns` | `10` | |
| `retention_metrics_days` / `_logs_days` / `_traces_days` / `_red_days` | 30/14/7/90 | 寫入 DDL 的 TTL |

## 2. 宣告的能力

```go
spi.Capabilities{
    Driver: "clickhouse", Version: buildVersion,
    Signals: []spi.Signal{spi.SignalMetrics, spi.SignalLogs, spi.SignalTraces},
    Metrics: spi.MetricCaps{
        NativePromQL: false,  // CH 不懂 PromQL，走回退引擎
        Exemplars:    false,  // Phase 6
        Metadata:     true,
        DeleteSeries: true,
    },
    Logs: spi.LogCaps{
        NativeLogQuery: true,
        Pushdown: spi.LogPushdown{
            Substring: true, Regex: true,
            ParsedFieldJSON: true, ParsedFieldLogfmt: false,
            Limit: false, Sort: true,  // Limit=false：logfmt 未下推，見 §6.3
        },
        Aggregation: true, LiveTail: false, Stats: true,
    },
    Traces: spi.TraceCaps{
        TagFilter: true, DurationFilter: true, SpanKindFilter: true,
        Dependencies: true, RED: true,
    },
    MultiTenant: false,           // 用 tenant 欄位隔離，靠 WithTenantGuard
    OutOfOrderWindow: -1,         // 無限制：MergeTree 天然接受亂序
    Retention: spi.RetentionCaps{PerSignal: true, PerTenant: false, Enforced: true},
}
```

上方應為 `OutOfOrderWindow: -1`（無限制），MergeTree 完全接受亂序寫入。語義定義見 `03-STORAGE-SPI.md` §2。

## 3. 寫入

### 3.1 通用

所有寫入用 `clickhouse-go` 的 batch API：

```go
batch, err := conn.PrepareBatch(ctx, "INSERT INTO logs")
for _, r := range records { batch.Append(...) }
err = batch.Send()
```

連線層 settings：

```go
clickhouse.Settings{
    "async_insert":                 1,
    "wait_for_async_insert":        0,
    "async_insert_max_data_size":   10485760,
    "async_insert_busy_timeout_ms": 1000,
    "insert_deduplicate":           0,   // 我們自己處理去重語義
}
```

### 3.2 指標寫入

兩張表，同一批次內都要寫：

1. `metric_series`：僅寫該批次中**首次出現**的 fingerprint（驅動內維護一個 LRU，容量 `100_000`，避免每次都寫）。
2. `metric_samples`：全部樣本。

fingerprint 由中間層計算（`utm.Fingerprint`），驅動不重算——保證跨驅動一致。

### 3.3 日誌寫入

`labels` 與 `attrs` 分別寫入兩個 `Map`。`severity` 寫 Enum 字串。

**空值處理**：`trace_id`/`span_id` 為空時寫空字串（非 NULL），讓 bloom filter 索引正常運作。

### 3.4 Span 寫入

`events` 與 `links` 用 `Nested`，clickhouse-go 需以平行陣列傳入：

```go
batch.Append(..., eventTS []time.Time, eventName []string, eventAttrs []map[string]string, ...)
```

同一批次額外觸發 §8 的依賴邊本地 join。

## 4. `MetricStore.Select`

```sql
WITH matched AS (
    SELECT fingerprint, labels
    FROM metric_series
    WHERE tenant = {tenant:String}
      AND metric = {metric:String}          -- 從 __name__ matcher 提取；無則省略此行
      {label_conditions}
      AND last_seen  >= {start:DateTime}
      AND first_seen <= {end:DateTime}
)
SELECT m.fingerprint, any(mt.labels) AS labels,
       groupArray(m.ts) AS tss, groupArray(m.value) AS vals
FROM metric_samples AS m
INNER JOIN matched AS mt ON m.fingerprint = mt.fingerprint
WHERE m.tenant = {tenant:String}
  AND m.metric = {metric:String}
  AND m.ts >= {start:DateTime64(3)} AND m.ts <= {end:DateTime64(3)}
GROUP BY m.fingerprint
ORDER BY labels
SETTINGS max_execution_time = {max_exec:UInt32}, max_result_rows = {max_rows:UInt64}
```

### 4.1 `{label_conditions}` 生成

| Matcher | SQL |
|---|---|
| `k = "v"`（v 非空） | `labels[{k:String}] = {v:String}` |
| `k = ""` | `(NOT mapContains(labels, {k:String}) OR labels[{k:String}] = '')` |
| `k != "v"` | `labels[{k:String}] != {v:String}` |
| `k =~ "re"` | `match(labels[{k:String}], {re:String})` |
| `k !~ "re"` | `NOT match(labels[{k:String}], {re:String})` |

**`k = ""` 的處理是正確性關鍵**：Prometheus 語義中「標籤不存在」與「標籤為空字串」等價，漏掉會讓 `{foo=""}` 這類查詢結果錯誤（`C-MET-05` 測項專測此點）。

正則必須先由驅動轉為 RE2 相容形式並錨定：`^(?:re)$`。ClickHouse 的 `match` 是部分匹配，不錨定會多回結果。

### 4.2 排序與串流

`ORDER BY labels` 在 ClickHouse 中對 `Map` 的排序規則與 Go 的 `labels.Compare` **不一致**。因此：

- SQL 不做 `ORDER BY labels`，改為 `ORDER BY fingerprint`（穩定但非字典序）
- 驅動在 Go 端用小根堆做 k-way merge 排序後輸出

**或者**（推薦，實作更簡單）：把 labels 序列化為 Prometheus 的規範字串形式存為額外欄位 `labels_str`，`ORDER BY labels_str` 即與 Go 端一致：

```sql
ALTER TABLE metric_series ADD COLUMN labels_str String MATERIALIZED
    arrayStringConcat(arraySort(arrayMap((k, v) -> concat(k, '\x00', v),
        mapKeys(labels), mapValues(labels))), '\x01');
```

採用後者。此欄位為 `MATERIALIZED`，不佔額外寫入成本。

### 4.3 大結果集的分批

`groupArray` 對長序列會爆記憶體。當預估點數 > `1_000_000` 時，改用不聚合的形式串流：

```sql
SELECT fingerprint, ts, value FROM metric_samples
WHERE ... ORDER BY fingerprint, ts
```

驅動在 Go 端依 `fingerprint` 變化切分 Series。這條路徑必須是預設，`groupArray` 只作為小結果集的優化（用 `EXPLAIN ESTIMATE` 或 `metric_series` 的計數判斷）。

## 5. `MetricStore.LabelNames` / `LabelValues`

```sql
-- LabelNames
SELECT DISTINCT arrayJoin(mapKeys(labels)) AS name
FROM metric_series
WHERE tenant = {tenant:String} {label_conditions}
  AND last_seen >= {start:DateTime} AND first_seen <= {end:DateTime}
ORDER BY name LIMIT {limit:UInt64}

-- LabelValues
SELECT DISTINCT labels[{name:String}] AS value
FROM metric_series
WHERE tenant = {tenant:String} AND mapContains(labels, {name:String}) {label_conditions}
  AND last_seen >= {start:DateTime} AND first_seen <= {end:DateTime}
ORDER BY value LIMIT {limit:UInt64}
```

`__name__` 是特例：`LabelValues("__name__")` 改查 `SELECT DISTINCT metric FROM metric_series`。

## 6. `LogStore.Search` 與 `NativeLogQuerier.SearchNative`

### 6.1 `LogQuery` → SQL 的翻譯規則

| IR 元素 | SQL 片段 |
|---|---|
| `Selectors` | 同 §4.1，但作用於 `labels` 欄位；一級欄位（`service`/`host`/`env`/`cluster`/`severity`）優先用原生欄位比較（走 `ORDER BY` 前綴） |
| `Start`/`End` | `ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}` |
| `LineContains` | `position(body, {v:String}) > 0` |
| `LineNotContains` | `position(body, {v:String}) = 0` |
| `LineMatch` + `LiteralHint` | `hasToken(body, {hint:String}) AND match(body, {re:String})` |
| `LineMatch` 無 hint | `match(body, {re:String})` |
| `LineNotMatch` | `NOT match(body, {re:String})`（不可用 hint 加速） |
| `ParseJSON` + `FieldFilter` | `JSONExtractString(body, {field:String}) = {v:String}` 等 |
| `ParseLogfmt` + `FieldFilter` | `extractGroups(body, ...)`，或退化為中間層補算（見 §6.3） |
| `Direction` | `ORDER BY ts DESC`（Backward）/ `ASC`（Forward）；次序鍵加 `, _part_offset` 保證穩定 |
| `Limit` | `LIMIT {n:UInt64}`，僅在全部條件下推時使用 |

`hasToken(body, hint)` 能命中 `idx_body_tokens` 的 tokenbf 索引，是日誌查詢效能的關鍵。**前提是 hint 必須是完整 token**（被非字母數字分隔）——若 hint 含分隔符，改用 `position()`（無索引加速但正確）。

### 6.2 完整查詢模板

```sql
SELECT ts, observed_ts, tenant, cluster, host, service, env,
       severity, severity_text, body, trace_id, span_id, labels, attrs
FROM logs
WHERE tenant = {tenant:String}
  {selector_conditions}
  AND ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}
  {line_filter_conditions}
  {field_filter_conditions}
ORDER BY ts {dir}, _part_offset {dir}
LIMIT {limit:UInt64}
SETTINGS max_execution_time = {max_exec:UInt32},
         max_result_rows = {max_rows:UInt64},
         max_bytes_to_read = {max_bytes:UInt64}
```

### 6.3 logfmt 的處理

ClickHouse 沒有原生 logfmt 解析。方案：

- 宣告 `ParsedFieldJSON: true`、`ParsedFieldLogfmt: false`（能力宣告區分兩種解析器，定義見 `03-STORAGE-SPI.md` §2）。
- logfmt 的欄位過濾由中間層補算。
- 連帶地 `Pushdown.Limit` 必須為 **false**（依 `Capabilities.Validate` 的規則：未完成全部過濾就截斷會漏資料）。`NativeLogQuery` 也因此只能在查詢不含 `| logfmt` 時走下推——驅動的 `SearchNative` 遇到 logfmt 階段時必須回 `spi.ErrUnsupported`，讓中間層改走 `Search` + 補算。

替代方案（Phase 6）：用 `extractAllGroupsHorizontal(body, '(\\w+)=("[^"]*"|\\S*)')` 在 SQL 中解析，但正則成本高且邊界情況多，v1 不採用。

### 6.4 聚合下推

```sql
SELECT toStartOfInterval(ts, INTERVAL {step:UInt32} SECOND) AS t,
       {group_keys},
       count() AS v                          -- count_over_time
       -- sum(length(body)) AS v             -- bytes_over_time
FROM logs
WHERE {同 §6.2 的條件}
GROUP BY t, {group_keys}
ORDER BY t
```

`rate` = `count / window_seconds`，在 Go 端除。**滑動窗口的處理**：LogQL 的 `[5m]` 是滑動窗口，而 `toStartOfInterval` 是固定桶。當 `window != step` 時，SQL 只能算固定桶，必須改為：

- 若 `window == step`：直接用上述 SQL（最常見情形，Grafana 預設如此）
- 若 `window != step`：拉出每個 step 桶的計數後在 Go 端做滑動累加。此時 SQL 用 `step` 的最大公因數作為桶大小。

**若 `window` 不是 `step` 的整數倍**：回退為中間層完全補算（`Aggregation` 下推對此查詢視為不可用）。這種情形罕見，正確性優先。

## 7. 追蹤查詢

### 7.1 `GetTrace`

```sql
SELECT * FROM spans
WHERE tenant = {tenant:String} AND trace_id = {tid:String}
  {AND ts >= {start} AND ts < {end}}          -- 有時間範圍時加上
ORDER BY ts
LIMIT {max_spans_per_trace:UInt64}
```

無時間範圍時先查 `trace_index` 取得 `start_ts`/`end_ts`，再帶範圍查 `spans`：

```sql
SELECT min(start_ts) AS s, max(end_ts) AS e FROM trace_index
WHERE tenant = {tenant:String} AND trace_id = {tid:String}
```

**兩段式查詢是必須的**：`spans` 的 `ORDER BY` 前綴是 `(tenant, service, name, ts)`，不帶時間範圍會掃全表。

### 7.2 `FindTraceIDs`

```sql
SELECT trace_id, min(ts) AS start_ts, max(ts) AS end_ts
FROM spans
WHERE tenant = {tenant:String}
  AND service = {service:String}
  {AND name = {operation:String}}
  {AND kind = {kind:String}}
  AND ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}
  {AND duration_ns >= {min_dur:UInt64}}
  {AND duration_ns <= {max_dur:UInt64}}
  {AND attrs[{tk:String}] = {tv:String}}       -- 每個 tag 一條
GROUP BY trace_id
ORDER BY start_ts DESC
LIMIT {limit:UInt64}
```

**duration 過濾的語義**：Jaeger 的 `minDuration` 指的是 **trace 的總時長**（root span 的 duration），而非任一 span。上述 SQL 過濾的是單一 span。正確做法：

```sql
SELECT trace_id, min(ts) AS start_ts, max(ts) AS end_ts,
       maxIf(duration_ns, parent_id = '') AS root_dur
FROM spans WHERE ... GROUP BY trace_id
HAVING root_dur >= {min_dur:UInt64} AND root_dur <= {max_dur:UInt64}
ORDER BY start_ts DESC LIMIT {limit:UInt64}
```

若 trace 無 root span（採樣或截斷），`root_dur` 為 0，用 `max(duration_ns)` 作為回退。此語義差異必須寫進 driver README。

### 7.3 `Services` / `Operations`

```sql
SELECT DISTINCT service FROM spans
WHERE tenant = {tenant:String} AND ts >= {start} AND ts < {end}
ORDER BY service

SELECT DISTINCT name, toString(kind) AS span_kind FROM spans
WHERE tenant = {tenant:String} AND service = {service:String}
  {AND kind = {kind:String}}
  AND ts >= {start} AND ts < {end}
ORDER BY name
```

這兩個查詢在資料量大時很慢（`DISTINCT` 掃分區）。**優化（Phase 3 必做）**：建 `service_ops` 的 `AggregatingMergeTree` MV，直接查該表。

```sql
CREATE TABLE service_ops (
    day DateTime, tenant LowCardinality(String),
    service LowCardinality(String), name LowCardinality(String),
    kind LowCardinality(String), cnt SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(day)
ORDER BY (tenant, service, name, kind, day) TTL day + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW mv_service_ops TO service_ops AS
SELECT toDate(ts) AS day, tenant, service, name, toString(kind) AS kind, count() AS cnt
FROM spans GROUP BY day, tenant, service, name, kind;
```

### 7.4 `SpanAggregator.ServiceRED`

```sql
SELECT service, name,
       toStartOfInterval(minute, INTERVAL {step:UInt32} SECOND) AS t,
       sum(requests) AS reqs, sum(errors) AS errs, sum(lat_sum) AS lsum,
       quantilesMerge(0.5, 0.9, 0.95, 0.99)(lat) AS q
FROM service_red_1m
WHERE tenant = {tenant:String}
  {AND service IN {services:Array(String)}}
  {AND name = {operation:String}}
  AND minute >= {start:DateTime} AND minute < {end:DateTime}
GROUP BY service, name, t
ORDER BY t
```

`step` 必須 ≥ 60 秒（MV 粒度）。小於 60 秒時向上取整並回 warning。

## 8. `DependencyQuerier`

見 `13-ADR.md` ADR-008 的近似策略。實作：

### 8.1 寫入時的本地 join

```go
// 在同一批次內建立 spanID → service 的索引
idx := map[string]string{}
for _, s := range batch { idx[s.SpanID] = s.Resource.Service }
for _, s := range batch {
    if s.ParentSpanID == "" { continue }
    if parentSvc, ok := idx[s.ParentSpanID]; ok {
        if parentSvc != s.Resource.Service {
            edges = append(edges, edge{parentSvc, s.Resource.Service, isError(s)})
        }
    } else {
        pending = append(pending, pendingLink{s.TraceID, s.ParentSpanID, s.Resource.Service, isError(s), s.StartNano})
    }
}
```

### 8.2 補算任務

```sql
CREATE TABLE pending_links (
    ts DateTime64(9), tenant LowCardinality(String),
    trace_id String, parent_span_id String,
    child_service LowCardinality(String), is_error UInt8
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, ts)
TTL toDateTime(ts) + INTERVAL 1 DAY;
```

每 5 分鐘執行：

```sql
INSERT INTO service_deps_1h
SELECT toStartOfHour(p.ts) AS hour, p.tenant, s.service AS parent,
       p.child_service AS child, count() AS calls, sum(p.is_error) AS errors
FROM pending_links AS p
INNER JOIN spans AS s
    ON s.trace_id = p.trace_id AND s.span_id = p.parent_span_id AND s.tenant = p.tenant
WHERE p.ts >= now() - INTERVAL 10 MINUTE AND p.ts < now() - INTERVAL 1 MINUTE
  AND s.ts >= now() - INTERVAL 15 MINUTE
  AND s.service != p.child_service
GROUP BY hour, p.tenant, parent, child;
```

處理後刪除已消化的 `pending_links`（用分區刪除或依賴 TTL）。

**必須記錄命中率指標** `prism_dep_local_join_ratio`，Phase 3 驗收時實測並寫入 ADR-008。

## 9. 錯誤映射

| ClickHouse 錯誤碼 | `spi.ErrClass` |
|---|---|
| 網路錯誤、`NETWORK_ERROR`(210)、`SOCKET_TIMEOUT`(209) | `ErrUnavailable` |
| `TIMEOUT_EXCEEDED`(159) | `ErrTimeout` |
| `MEMORY_LIMIT_EXCEEDED`(241) | `ErrTooLarge` |
| `TOO_MANY_ROWS`(158)、`TOO_MANY_BYTES`(307) | `ErrTooLarge` |
| `TOO_MANY_SIMULTANEOUS_QUERIES`(202) | `ErrThrottled` |
| `UNKNOWN_TABLE`(60)、`UNKNOWN_DATABASE`(81) | `ErrUnavailable`（尚未 Migrate） |
| `SYNTAX_ERROR`(62)、`ILLEGAL_TYPE_OF_ARGUMENT`(43) | `ErrInternal`（我們生成的 SQL 有 bug） |
| `AUTHENTICATION_FAILED`(516) | `ErrUnavailable` |
| 其他 | `ErrInternal` |

`SYNTAX_ERROR` 映射為 `ErrInternal` 而非 `ErrBadRequest` 是刻意的：SQL 由驅動生成，語法錯是我們的 bug，不是使用者的。

## 10. 遷移

`drivers/clickhouse/migrations/`：

```
001_init_logs.sql
002_init_spans.sql
003_init_metrics.sql
004_trace_index.sql
005_service_red.sql
006_service_deps.sql
007_service_ops.sql
008_labels_str.sql
```

執行機制：

```sql
CREATE TABLE IF NOT EXISTS prism_schema_migrations (
    version UInt32, name String, applied_at DateTime DEFAULT now(),
    checksum String
) ENGINE = MergeTree ORDER BY version;
```

- 依 version 遞增執行未套用者。
- 每個檔案的 sha256 存為 `checksum`；已套用的檔案內容變更時**啟動失敗**並提示（防止靜默的 schema 漂移）。
- TTL 天數以 Go template 注入，因此 checksum 對「渲染前」的模板計算。
- 保留期變更不新增遷移檔，改為啟動時執行 `ALTER TABLE ... MODIFY TTL`（冪等）。

## 11. driver README 必載明的已知限制

1. ClickHouse 不是時序資料庫，指標壓縮與查詢效能明顯不如專用 TSDB（見 `04` §6.5）。
2. `PromQL` 全部走中間層回退引擎，大範圍高基數查詢會慢。
3. logfmt 解析不下推。
4. 服務依賴圖為近似值（ADR-008）。
5. Jaeger `minDuration`/`maxDuration` 作用於 root span；無 root span 的 trace 用 max span duration 回退。
6. 不支援 exemplar 與原生直方圖（Phase 6）。
7. TTL 精度為天（`ttl_only_drop_parts = 1`）。
