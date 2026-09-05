# 06 — 查詢層

套件：`internal/query`。目標：**同一份查詢語義在任何驅動上都得到相同結果**，能下推就下推，不能就本地算。

## 1. 路由決策

```go
package query

type Router struct {
    backend spi.Backend
    caps    spi.Capabilities
    engine  *promql.Engine       // Apache-2.0 上游引擎
    limits  Limits
}
```

決策表：

| 請求 | 條件 | 路徑 |
|---|---|---|
| PromQL instant/range | `caps.Metrics.NativePromQL == true` 且後端實作 `NativeMetricQuerier` | **下推**：整條 PromQL 字串交給後端 |
| PromQL instant/range | 否則 | **回退**：`promql.Engine` + `promqladapter` 讀 `Select` |
| `/series`、`/labels`、`/label/*/values` | 一律 | 直接呼叫 Tier-1 原語 |
| LogQL | `caps.Logs.NativeLogQuery == true` | **下推**：`LogQuery` IR 交給 `NativeLogQuerier` |
| LogQL | 否則 | **混合**：可下推部分給 `Search`，其餘中間層串流補算 |
| Jaeger 查詢 | 一律 | `TraceQuery` IR → `FindTraceIDs` + `GetTrace` |
| RED 面板 | `caps.Traces.RED == true` | `SpanAggregator.ServiceRED` |
| RED 面板 | 否則 | 回退：掃描 span 現算，且強制縮小時間窗（見 §5.3） |

每次查詢必須遞增 `prism_storage_query_duration_seconds{driver,signal,path="pushdown"|"fallback"}`。使用者能從指標看出自己的後端走了哪條路。

**強制開關**：設定 `query.force_fallback: true` 時，即使後端支援下推也走回退路徑。這是 differential test 的基礎（見 `10-CONFORMANCE-TESTING.md` §4），必須實作。

## 2. PromQL 回退引擎

不自己寫 PromQL。使用 `github.com/prometheus/prometheus/promql`（Apache-2.0），只需提供 `storage.Queryable`。

```go
package promqladapter

// Queryable 把 spi.MetricStore 包成 prometheus 的 storage.Queryable。
func New(ms spi.MetricStore, tenant string, limits Limits) storage.Queryable

// 內部：
//   storage.Querier.Select(sortSeries bool, hints *storage.SelectHints, matchers ...*labels.Matcher)
//     → spi.SeriesQuery{Matchers: conv(matchers), Hints: conv(hints)}
//     → spi.SeriesSet
//     → storage.SeriesSet（薄包裝，零拷貝）
```

要點：

- `spi.SelectHints` 的欄位刻意與 `storage.SelectHints` 一一對應，轉換是純欄位搬移。
- `sortSeries=true` 時已由 SPI 排序契約保證，不需額外排序。
- `Querier.LabelNames` / `LabelValues` 直接映射。
- `Close()` 必須關閉底層迭代器。
- 引擎設定：`MaxSamples`（預設 50_000_000）、`Timeout`（預設 2 分鐘）、`LookbackDelta`（預設 5 分鐘，與 Prometheus 一致）、`EnableAtModifier: true`、`EnableNegativeOffset: true`。

這一步做完，**任何驅動立刻獲得完整正確的 PromQL**。這是整個架構最大的槓桿點：用約 300 行適配器換來一個經過十年驗證的查詢引擎。

## 3. LogQL 子集引擎（clean-room 自研）

### 3.1 為什麼不能像 PromQL 一樣複用上游

Loki 是 AGPL-3.0，不可 import（見 `00-SDD-OVERVIEW.md` §4）。因此必須自研。所幸 LogQL 的 v1 子集（`02-COMPATIBILITY-CONTRACT.md` §3.3）遠比 PromQL 簡單。

### 3.2 實作

```
internal/query/logql/
├── lexer.go      # 手寫 scanner
├── parser.go     # 遞迴下降，產出 spi.LogQuery
├── ast.go
├── compile.go    # 正則預編譯、LiteralHint 抽取
├── exec.go       # 中間層補算：串流套用 Filters/Stages/Fields
├── agg.go        # count_over_time / rate / sum by 等
└── errors.go     # Loki 格式的錯誤訊息
```

**不建 AST 樹再走訪**：LogQL v1 子集是線性管線，直接解析成 `spi.LogQuery` 的扁平結構。這讓下推變成單純的欄位檢查，而不是 AST pattern matching。

### 3.3 `LiteralHint` 抽取（下推優化）

`|~ "error.*timeout"` 這類正則，抽出必然出現的字面子串（此例為 `error`），填入 `LineFilter.LiteralHint`。驅動可用它做粗篩（如 ClickHouse 的 tokenbf 索引 / `hasToken`），中間層再用完整正則精篩。

抽取規則（保守，寧可不抽也不抽錯）：
- 只處理 `^`、`$`、字面字元、`.`、`.*`、`.+`、字元類的簡單組合。
- 遇到 `|`（交替）、`?`（可選）、`{0,n}` 一律放棄抽取。
- 抽取結果為最長的字面片段，長度需 ≥ 3 才使用。

單元測試必須覆蓋「抽取錯誤導致漏資料」的情境：對隨機正則做 property test，驗證 `LiteralHint` 是所有匹配字串的必要子串。

### 3.4 補算執行器

```go
func Execute(ctx context.Context, it spi.LogIterator, q spi.LogQuery, done spi.LogPushdown) (spi.LogResult, error)
```

`done` 標明驅動已經處理過哪些條件；執行器只補做剩下的。**必須串流**：邊讀迭代器邊過濾邊計數，達到 `Limit` 立即 `Close()` 並返回，不得先收集全部再處理。

聚合（`count_over_time` 等）用固定桶的滑窗累加，記憶體上限 `query.max_agg_series`（預設 10_000 個輸出序列），超出回 `ErrTooLarge` 並提示使用者加 `by` 或縮小範圍。

## 4. Jaeger 查詢

```
internal/query/tracequery/
├── find.go     # TraceQuery → FindTraceIDs → 併發 GetTrace（上限 query.trace_concurrency，預設 8）
├── assemble.go # []utm.Span → Jaeger Trace JSON（單位轉換、processes 去重）
└── deps.go     # DependencyQuerier 或回退計算
```

- `FindTraceIDs` 回傳超過 `Limit` 時截斷並在回應 `warnings` 中說明。
- 組裝 `processes` 時，相同 `(serviceName, resource attrs hash)` 共用一個 `pN` key。
- `GetTrace` 找不到 → Jaeger 信封 `{"data":[],"errors":[{"code":404,"msg":"trace not found"}]}`。

## 5. 資源保護

任何查詢路徑都必須有這三道閘：

### 5.1 時間範圍

- `query.max_lookback`（預設 30 天）：起點早於此則夾到邊界並回 warning。
- `query.max_range`（預設 7 天）+ `step` 檢查：`(end-start)/step > query.max_points`（預設 11_000，與 Grafana 面板寬度同量級）時回 `400` 並提示加大 step。**這一條能擋掉九成的意外全表掃描。**

### 5.2 併發與超時

- 全域查詢併發上限 `query.max_concurrent`（預設 = `4 × GOMAXPROCS`），滿時回 `503` + `Retry-After: 1`。
- 每租戶併發上限 `query.max_concurrent_per_tenant`（預設 8）。
- 每查詢超時 `query.timeout`（預設 60s），透過 `context` 一路傳到驅動。**驅動必須尊重 context 取消**，這是 conformance 測項。

### 5.3 回退路徑的額外限制

當走回退路徑（`path="fallback"`）時，額外套用更嚴格的限制：

| 限制 | 下推 | 回退 |
|---|---|---|
| `max_range` | 7 天 | 24 小時 |
| `max_points` | 11_000 | 11_000 |
| 掃描列數上限 | 驅動自控 | `query.fallback_max_rows`（預設 5_000_000） |

超出時回 `ErrTooLarge`，訊息必須明確指出「目前後端不支援此查詢的下推，請縮小範圍或更換後端」。**讓使用者知道效能差異來自後端選擇，而不是平台壞了。**

## 6. 快取（Phase 4，非 v1）

留擴充點但 v1 不實作：

- `query.cache.enabled`（預設 false）
- range query 結果依 `(tenant, expr, start, end, step)` 快取，切齊到 step 邊界
- 只快取「已完全落在過去」的區間，最近 `query.cache.max_freshness`（預設 5 分鐘）不快取

介面預先定義在 `internal/query/cache.go`，v1 提供 no-op 實作。

## 7. 驗收標準

- Q1：`promqltest` 官方 testdata 在 `memory` 驅動上全綠。
- Q2：同一份 testdata 在 `clickhouse`、`vmvl` 驅動上全綠。
- Q3：`query.force_fallback: true` 與 `false` 在 `vmvl` 上對 200 條真實查詢產生逐點相同的結果（浮點誤差 < 1e-9）。
- Q4：LogQL 子集的 parser 對 `02` §3.3 的每條語法有正向測試，對每條不支援語法有「明確錯誤訊息」的負向測試。
- Q5：`LiteralHint` 的 property test 通過 10_000 個隨機正則。
- Q6：單一查詢 `sum(rate(x[5m]))` 跨 7 天在 2C4G 機器上不 OOM。
- Q7：查詢執行中取消 HTTP 請求，驅動的 goroutine 在 1 秒內全部退出（用 `goleak` 驗證）。
