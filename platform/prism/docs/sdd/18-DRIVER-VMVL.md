# 18 — 參考驅動：VictoriaMetrics + VictoriaLogs

位置：`drivers/vmvl`。這個驅動的存在價值是**證明架構**：它的能力分佈與 ClickHouse 幾乎相反，若中間層在兩者間切換無感，隔離層就是有效的。

兩者皆為 Apache-2.0，但驅動**只透過 HTTP 協議互動，不 import 其原始碼**（保持依賴輕量與版本無關）。

## 1. DSN 與 Options

```
vmvl://?metrics=http://127.0.0.1:8428&logs=http://127.0.0.1:9428&traces=
```

| Option | 預設 | 說明 |
|---|---|---|
| `metrics_url` | 必填 | VictoriaMetrics single-node 位址 |
| `logs_url` | 必填 | VictoriaLogs 位址 |
| `traces_url` | `""` | v1 留空；非空時委派給另一個驅動（Phase 6 的 `storage.split`） |
| `account_id` | `""` | VM/VL 的多租戶 accountID；非空時啟用原生多租戶路徑 |
| `timeout` | `55s` | HTTP 客戶端超時 |
| `max_conns_per_host` | `32` | |
| `retention_period` | `""` | 只讀；VM/VL 的保留期由其自身啟動參數控制，驅動只回報 |

## 2. 宣告的能力

```go
spi.Capabilities{
    Driver: "vmvl", Version: buildVersion,
    Signals: []spi.Signal{spi.SignalMetrics, spi.SignalLogs}, // 無 traces
    Metrics: spi.MetricCaps{
        NativePromQL: true,   // ★ 與 clickhouse 相反
        Exemplars:    false,
        Metadata:     false,  // VM 不保存 metadata
        DeleteSeries: true,   // /api/v1/admin/tsdb/delete_series
    },
    Logs: spi.LogCaps{
        NativeLogQuery: true,
        Pushdown: spi.LogPushdown{
            Substring: true, Regex: true,
            ParsedFieldJSON: true, ParsedFieldLogfmt: true, // ★ 兩者都支援
            Limit: true, Sort: true,
        },
        Aggregation: true, LiveTail: true, Stats: true,
    },
    Traces: spi.TraceCaps{},  // 全 false
    MultiTenant: accountID != "",
    OutOfOrderWindow: -1,     // 無限制，見 03-STORAGE-SPI.md §2
    Retention: spi.RetentionCaps{PerSignal: true, PerTenant: false, Enforced: true},
}
```

`Traces()` 回 `nil`。中間層對此的處理見 `03-STORAGE-SPI.md` §9 末段：Jaeger API 回空結果、`/-/ready` 標示降級、`/api/console/v1/status` 的 `signals.traces` 為 `"unsupported"`，**不得 panic**。

## 3. 指標

### 3.1 寫入

直接轉發為 Prometheus remote_write：

```
POST {metrics_url}/api/v1/write
Content-Encoding: snappy
Content-Type: application/x-protobuf
X-Prometheus-Remote-Write-Version: 0.1.0
```

多租戶時路徑為 `{metrics_url}/insert/{account_id}/prometheus/api/v1/write`。

**零成本路徑**：當上游本身就是 remote_write 進來的（`internal/compat/promapi/write.go`），驅動可以直接把原始的 snappy body 轉發，不做 decode/encode。此優化需在 ingest 層保留原始 body 的引用，僅在 `driver == "vmvl"` 且無正規化需求時啟用。**v1 不實作此優化**，先走統一路徑；記錄為 Phase 6 的優化點。

### 3.2 `NativeMetricQuerier`（下推路徑）

```
GET {metrics_url}/api/v1/query?query={expr}&time={ts}&timeout={t}
GET {metrics_url}/api/v1/query_range?query={expr}&start={s}&end={e}&step={step}&timeout={t}
```

VM 的回應格式**就是** Prometheus API v1 格式，因此驅動只需：

1. 轉發請求（加上 `extra_filters[]={__tenant__="X"}` 做租戶隔離，見 §3.4）
2. 解析回應為 `spi.PromResult`
3. 把 VM 的 `warnings` 原樣帶出

**這是整個 SPI 設計的最佳案例**：一個「原生支援方言」的後端，下推實作只有約 80 行。

### 3.3 Tier-1 原語（回退路徑，供 `force_fallback` 與差分測試使用）

即使宣告 `NativePromQL: true`，仍必須實作 `Select` / `LabelNames` / `LabelValues`——否則 `force_fallback` 無法運作，L3 差分測試就跑不了。

```
Select      → GET {metrics_url}/api/v1/query_range
              query={__name__="X", ...matchers}  &start&end&step
              （用一個裸的 selector 表達式，讓 VM 回 matrix）
LabelNames  → GET {metrics_url}/api/v1/labels?match[]=...&start=&end=
LabelValues → GET {metrics_url}/api/v1/label/{name}/values?match[]=...&start=&end=
```

**`Select` 的 step 選擇**：`SelectHints.Step` 為 0（instant）時用 `LookbackDelta`；否則用 `Step`。但 PromQL 引擎期望的是**原始樣本**而非降採樣結果——用 `query_range` 會得到對齊到 step 的值，導致 `rate()` 計算與真實不符。

正確做法：用 VM 的 export 端點取原始樣本：

```
POST {metrics_url}/api/v1/export
     match[]={selector}&start={s}&end={e}&reduce_mem_usage=1
回應：JSON Lines，每行 {"metric":{...},"values":[...],"timestamps":[...]}
```

`/api/v1/export` 回傳原始樣本，正是 `storage.Querier.Select` 需要的語義。**必須用這個端點，不能用 `query_range`。** 這個坑會讓差分測試 `Q3` 失敗，且症狀是「結果差一點點」，極難查。

### 3.4 租戶隔離

- `account_id` 非空：用 VM 原生多租戶路徑，`MultiTenant: true`，中間層不注入標籤。
- `account_id` 為空：`MultiTenant: false`，`WithTenantGuard` 注入 `__tenant__` 標籤。下推時驅動必須把該 matcher 加進 PromQL 表達式——**不能只加在 URL 參數**，因為 PromQL 表達式中的子查詢也要受限。

實作：用 VM 支援的 `extra_label` 與 `extra_filters[]` 參數：

```
&extra_filters[]={__tenant__="acme"}
```

VM 會把該 filter 注入表達式的**每一個** selector，這正是我們要的語義。若目標 VM 版本不支援 `extra_filters[]`，驅動必須在啟動時偵測並拒絕啟動（`Ping` 時檢查 `/api/v1/status/buildinfo`），**不得降級為不安全的實作**。

## 4. 日誌

### 4.1 寫入

```
POST {logs_url}/insert/jsonline?_stream_fields={fields}&_time_field=_time&_msg_field=_msg
Content-Type: application/stream+json

{"_time":"2026-09-05T10:00:00.123456789Z","_msg":"log line",
 "service":"api","host":"h1","level":"error",
 "trace_id":"abc...","attr_foo":"bar"}
```

映射規則：

| UTM | VictoriaLogs 欄位 |
|---|---|
| `TS` | `_time`（RFC3339Nano） |
| `Body` | `_msg` |
| `Labels` | 頂層欄位，且列入 `_stream_fields` |
| `Attrs` | 頂層欄位，**不**列入 `_stream_fields` |
| `Severity` | `level` 欄位（字串），列入 `_stream_fields` |
| `TraceID` / `SpanID` | `trace_id` / `span_id` 頂層欄位 |
| `Resource.*` | `service`/`host`/`cluster`/`env` 頂層欄位，列入 `_stream_fields` |
| `Tenant` | `MultiTenant` 時走 `/insert/{account}/jsonline`；否則寫 `__tenant__` 欄位並列入 `_stream_fields` |

**`_stream_fields` 的選擇是效能關鍵**：VictoriaLogs 依此切分 stream，選太多會造成 stream 爆炸。只放 `Labels` + 固定的低基數欄位，`Attrs` 一律不放。

`Attrs` 的鍵名需加前綴避免與 VL 保留欄位（`_time`/`_msg`/`_stream`/`_stream_id`）衝突：鍵以 `_` 開頭時前綴 `attr`。

### 4.2 `NativeLogQuerier` — `LogQuery` IR → LogSQL

| IR 元素 | LogSQL |
|---|---|
| `Selectors` `k="v"` | `k:="v"` |
| `Selectors` `k!="v"` | `-k:="v"` |
| `Selectors` `k=~"re"` | `k:~"re"` |
| `Selectors` `k!~"re"` | `-k:~"re"` |
| `Start`/`End` | `_time:[{start}, {end})` |
| `LineContains "s"` | `_msg:"s"`（VL 的短語搜尋） |
| `LineNotContains "s"` | `-_msg:"s"` |
| `LineMatch "re"` | `_msg:~"re"` |
| `LineNotMatch "re"` | `-_msg:~"re"` |
| `ParseJSON` | `\| unpack_json` |
| `ParseLogfmt` | `\| unpack_logfmt` |
| `FieldFilter f = "v"` | `\| filter f:="v"` |
| `FieldFilter f > 5` | `\| filter f:>5` |
| `Direction Backward` | `\| sort by (_time) desc` |
| `Limit n` | `\| limit {n}` |
| `Agg count_over_time` | `\| stats by (_time:{step}, {group}) count() as value` |
| `Agg bytes_over_time` | `\| stats by (_time:{step}, {group}) sum(length(_msg)) as value` |

查詢端點：

```
POST {logs_url}/select/logsql/query
     query={logsql}&start={s}&end={e}&limit={n}
回應：JSON Lines，每行一筆日誌
```

**轉義規則**：LogSQL 的字串用雙引號，內部的 `"` 與 `\` 需逃逸。正則直接內嵌（VL 用 RE2，與 Go 相容，無需轉換）。

**滑動窗口的差異**：VL 的 `stats by (_time:5m)` 是固定桶，與 LogQL 的滑動窗口語義不同。處理方式與 `17-DRIVER-CLICKHOUSE.md` §6.4 相同：`window == step` 時下推，否則回退。

### 4.3 `LogTailer`

```
GET {logs_url}/select/logsql/tail?query={logsql}
```

回應為 chunked JSON Lines 串流。驅動包裝為 `spi.LogStream`，`Close()` 時取消 HTTP 請求。

### 4.4 `LabelNames` / `LabelValues`

```
POST {logs_url}/select/logsql/field_names   query={selector}&start&end
POST {logs_url}/select/logsql/field_values  query={selector}&field={name}&start&end&limit
```

**過濾保留欄位**：`_time`、`_msg`、`_stream`、`_stream_id` 不得出現在 `LabelNames` 結果中（它們是 VL 內部欄位，Loki API 的使用者不該看到）。

### 4.5 `Stats`

```
POST {logs_url}/select/logsql/stats_query   query={selector}&time={t}
```

映射為 `spi.LogStats`。VL 不提供 `TotalLinesProcessed` 的精確值時填估算值，Loki API 的 `stats` 欄位允許近似。

## 5. 錯誤映射

| 情形 | `spi.ErrClass` |
|---|---|
| 連線被拒、DNS 失敗、`ECONNRESET` | `ErrUnavailable` |
| HTTP 503 / 502 / 504 | `ErrUnavailable` |
| HTTP 429 | `ErrThrottled` |
| `context.DeadlineExceeded`、HTTP 408 | `ErrTimeout` |
| HTTP 400 且 body 含 `cannot parse` / `unsupported` | `ErrBadRequest` |
| HTTP 422 | `ErrTooLarge` |
| HTTP 401 / 403 | `ErrUnavailable`（設定問題，不是使用者錯誤） |
| body 含 `too many` / `exceeds` | `ErrTooLarge` |
| 其他 4xx | `ErrBadRequest` |
| 其他 5xx | `ErrInternal` |

**VM/VL 的錯誤回應是純文字，不是結構化 JSON**。驅動必須讀取 body 前 4 KB 做關鍵字匹配，並把原文放進 `spi.Error.Err`，讓使用者能看到後端的原始訊息。

## 6. `Migrate` 與 `Ping`

`Migrate` 是 no-op（VM/VL 無 schema），但必須：

1. 檢查兩個服務可達（`GET /health` 或 `/-/healthy`）
2. 檢查版本支援 `extra_filters[]`（見 §3.4）
3. 檢查 `logs_url` 的 `/select/logsql/query` 可用

任一失敗回 `ErrUnavailable` 並附明確訊息。

`Ping` 檢查兩個服務的健康端點，任一失敗即失敗。

## 7. driver README 必載明的已知限制

1. **不支援追蹤**。需要 APM 的使用者必須改用 `clickhouse` 驅動，或等 Phase 6 的 `storage.split`。
2. 不支援 metric metadata，`/prom/api/v1/metadata` 回空物件。
3. 不支援 exemplar。
4. 保留期由 VM/VL 自身的啟動參數控制，Prism 的 `storage.retention` 設定對此驅動無效（會在啟動時警告）。
5. `account_id` 為空時，租戶隔離依賴 `extra_filters[]`；VM 版本過舊會導致啟動失敗（刻意，不降級）。
6. 滑動窗口聚合在 `window != step` 時回退到中間層計算。

## 8. 對照表：兩個驅動的能力差異

這張表是 `E2E-07` 的設計依據——切換這兩個驅動時，使用者應該只感受到效能與 trace 可用性的差異，其餘行為完全一致。

| 面向 | clickhouse | vmvl | 中間層如何抹平 |
|---|---|---|---|
| PromQL | 回退引擎 | 原生下推 | `promqladapter` + `promql.Engine`；差分測試保證等價 |
| LogQL 聚合 | SQL 下推 | LogSQL 下推 | 兩者都翻譯自同一 IR |
| logfmt 解析 | 不下推 | 下推 | `PushdownPlan` 決定補算範圍 |
| 追蹤 | 完整支援 | 不支援 | Jaeger API 回空 + `/status` 標示降級 |
| RED 預聚合 | MV | 無 | 無 `SpanAggregator` 時中間層掃描回退（但 vmvl 連 span 都沒有，直接回空） |
| 多租戶 | 標籤注入 | 原生路徑或 `extra_filters[]` | `WithTenantGuard` 依 `MultiTenant` 決定 |
| metadata | 支援 | 不支援 | `/metadata` 回空物件（Prometheus 允許） |
| 保留期 | Prism 控制 TTL | 後端自控 | `RetentionCaps.Enforced` 都是 true，但來源不同 |
