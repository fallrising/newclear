# 04 — 統一遙測模型（UTM）與參考 Schema

套件位置：`pkg/utm`。這是 L2 抽象層的另一半，與 `pkg/spi` 同樣是穩定契約。

## 1. 設計基準

UTM 直接對齊 OpenTelemetry 資料模型，不發明新概念。原因：OTel 是唯一同時覆蓋三種訊號、且被所有主流後端接受的模型；任何自創模型都會在轉換邊界上流失資訊。

**唯一的偏離**：UTM 為了效能與相容性做了「扁平化」——`Resource` 的關鍵欄位提升為一級欄位（`Tenant`/`Host`/`Service`），其餘留在 map 中。

## 2. 時間單位（唯一權威定義）

`pkg/utm/time.go` 是全專案時間轉換的唯一入口。**任何模組不得自行寫 `/1000` 或 `*1e6`。**

| 場景 | 單位 | 型別 |
|---|---|---|
| UTM 指標樣本 `MetricPoint.TS` | Unix **毫秒** | `int64` |
| UTM 日誌 `LogRecord.TS` | Unix **奈秒** | `int64` |
| UTM Span `Start`/`End` | Unix **奈秒** | `int64` |
| Prometheus API 輸入/輸出 | Unix **秒**（float） | — |
| Loki API 輸入/輸出 | Unix **奈秒**（字串） | — |
| Jaeger API 輸入/輸出 | Unix **微秒** | — |
| ClickHouse `DateTime64(9)` | 奈秒 | — |
| ClickHouse `DateTime64(3)` | 毫秒 | — |

指標用毫秒是因為 Prometheus 生態全部是毫秒；日誌與追蹤用奈秒是因為 OTel 與 Loki 都是奈秒。刻意不統一，避免在最熱的路徑上做無謂轉換與精度損失。

```go
package utm

func MilliToSecFloat(ms int64) float64
func SecFloatToMilli(s float64) int64
func NanoToMicro(ns int64) int64
func MicroToNano(us int64) int64
func NanoToMilli(ns int64) int64
func ParsePromTime(s string) (time.Time, error)   // RFC3339 或 unix 秒
func ParseLokiTime(s string) (int64 /*ns*/, error) // ns 字串 / RFC3339Nano / 相對值
func ParseJaegerTime(s string) (int64 /*ns*/, error)
```

## 3. 核心型別

```go
package utm

// Labels 是排序後的鍵值對，語意與 prometheus/model/labels.Labels 相同。
// 直接 type alias 到上游，避免轉換成本。
type Labels = labels.Labels

type Resource struct {
    Tenant          string // 必填，Ingest 層注入
    Service         string // service.name
    ServiceInstance string // service.instance.id
    ServiceVersion  string // service.version
    Namespace       string // service.namespace
    Host            string // host.name
    Cluster         string // k8s.cluster.name 或自訂
    Env             string // deployment.environment
    Attrs           map[string]string // 其餘 resource attributes（已展平）
    // SchemaURL 保留，v1 不使用
}

type MetricType uint8
const (
    TypeUnknown MetricType = iota
    TypeGauge
    TypeCounter
    TypeHistogram
    TypeSummary
)

type MetricPoint struct {
    Name      string
    Labels    Labels  // 已含 resource 映射進來的標籤（見 §4.2）
    TS        int64   // Unix 毫秒
    Value     float64
    Type      MetricType
    Histogram *Histogram // Type==TypeHistogram 且非展開形式時使用
    Exemplar  *Exemplar
}

type Histogram struct {
    Count  uint64
    Sum    float64
    Bounds []float64 // 上界，遞增
    Counts []uint64  // len == len(Bounds)+1
}

type Exemplar struct {
    Labels  Labels // 通常含 trace_id / span_id
    Value   float64
    TS      int64  // 毫秒
}

type MetricMetadata struct {
    Metric, Type, Help, Unit string
}

type Severity uint8 // 對齊 OTel SeverityNumber/4 的粗粒度
const (
    SevUnknown Severity = iota
    SevTrace; SevDebug; SevInfo; SevWarn; SevError; SevFatal
)

type LogRecord struct {
    Resource   *Resource
    TS         int64 // Unix 奈秒，事件時間
    ObservedTS int64 // Unix 奈秒，採集時間；用於偵測時鐘漂移
    Severity   Severity
    SeverityText string
    Body       string
    TraceID    string // 32 hex chars，無則空
    SpanID     string // 16 hex chars
    Labels     Labels            // 低基數，可用於索引與 stream 選擇
    Attrs      map[string]string // 高基數，只存不索引
}

type SpanKind uint8
const (
    KindUnspecified SpanKind = iota
    KindInternal; KindServer; KindClient; KindProducer; KindConsumer
)

type StatusCode uint8
const (
    StatusUnset StatusCode = iota
    StatusOK; StatusError
)

type Span struct {
    Resource     *Resource
    TraceID      string // 32 hex
    SpanID       string // 16 hex
    ParentSpanID string // 16 hex，root 為空
    TraceState   string
    Name         string
    Kind         SpanKind
    StartNano    int64
    EndNano      int64
    StatusCode   StatusCode
    StatusMsg    string
    Attrs        map[string]string
    Events       []SpanEvent
    Links        []SpanLink
}

type SpanEvent struct {
    TS    int64 // 奈秒
    Name  string
    Attrs map[string]string
}
type SpanLink struct {
    TraceID, SpanID string
    Attrs           map[string]string
}
```

**所有 `Attrs` 一律 `map[string]string`**：OTel 的 AnyValue 在寫入時就序列化（數字用 `strconv`，布林用 `true/false`，複合型別用 JSON）。理由：三種後端沒有一個能有效索引異質型別；型別資訊對查詢價值極低，對複雜度成本極高。原始型別若真的需要，記在 `MetricMetadata` 或另存 `_type` 後綴屬性。

## 4. 正規化規則（`internal/ingest/normalize`）

### 4.1 Resource 抽取

依 OTel 語義約定，按下列優先序填入 `Resource` 的一級欄位。找不到時留空，**不得填假值**。

| 欄位 | 來源 attribute（依序） |
|---|---|
| `Service` | `service.name` |
| `ServiceInstance` | `service.instance.id` → `host.id` |
| `ServiceVersion` | `service.version` |
| `Host` | `host.name` → `k8s.node.name` → `net.host.name` |
| `Cluster` | `k8s.cluster.name` → `prism.cluster` |
| `Env` | `deployment.environment.name` → `deployment.environment` |

### 4.2 Resource → 標籤映射

指標與日誌的 `Labels` 中，下列標籤由 Resource 自動注入（若已存在同名標籤，**不覆寫使用者的值**，改加前綴 `resource_`）：

`job`（= `Service`）、`instance`（= `ServiceInstance`，空則 `Host`）、`host`、`cluster`、`env`、`service`

`job` / `instance` 用 Prometheus 慣例命名，讓現成的 Prometheus 儀表板與規則能直接運作。

### 4.3 名稱正規化

- 指標名稱：非 `[a-zA-Z0-9_:]` 的字元替換為 `_`；開頭為數字時前置 `_`。
- 標籤名稱：非 `[a-zA-Z0-9_]` 替換為 `_`；`.` → `_`（OTel 用點，Prometheus 用底線）。
- 保留 `__` 前綴的標籤為系統專用，使用者傳入時剝除並記錄警告。

### 4.4 OTel 指標展開

| OTel 型別 | UTM 處理 |
|---|---|
| Gauge | 1 個 `TypeGauge` 點 |
| Sum(monotonic, cumulative) | 1 個 `TypeCounter` 點；名稱補 `_total`（若未有） |
| Sum(non-monotonic) | `TypeGauge` |
| Sum(delta) | 轉為 cumulative（狀態存於 ingest 記憶體，key = 序列 hash，TTL 5 分鐘）；轉換失敗則丟棄並警告 |
| Histogram(cumulative) | 展開成 `_bucket{le=}`、`_sum`、`_count` 三組經典序列（v1）；同時保留 `Histogram` 結構供支援原生直方圖的驅動使用 |
| ExponentialHistogram | v1 轉為固定桶近似（記錄 warning）；Phase 6 支援原生 |
| Summary | 展開成 `{quantile=}`、`_sum`、`_count` |

### 4.5 時鐘漂移處理

- `TS` 超出 `[now - max_past, now + max_future]`（預設 `max_past=1h`、`max_future=5m`）→ 依 `ingest.clock_skew_policy` 處理：
  - `clamp`（預設）：夾到邊界，並在 `Attrs["prism.clock_adjusted"]="true"` 標記
  - `drop`：丟棄並遞增 `prism_ingest_rejected_total{reason="clock_skew"}`
- 日誌另存 `ObservedTS`，Console 可對照發現有問題的主機。

## 5. 基數治理（`internal/ingest/limits`）

高基數是自建監控系統最常見的死法。以下限制**必須**在 v1 實作，且全部可依租戶覆寫。

| 限制 | 預設 | 超出行為 |
|---|---|---|
| `max_label_name_length` | 128 | 截斷 |
| `max_label_value_length` | 2048 | 截斷 |
| `max_labels_per_series` | 40 | 拒絕該點 |
| `max_active_series_per_tenant` | 500_000 | 拒絕新序列（既有序列繼續） |
| `max_series_per_metric_name` | 50_000 | 拒絕新序列 + 告警 |
| `max_log_line_bytes` | 256 KiB | 截斷並加 `prism.truncated=true` |
| `max_attrs_per_record` | 128 | 丟棄多餘（保留字典序前 N 個，行為可預測） |
| `max_spans_per_trace` | 20_000 | 丟棄多餘 span 並在 trace 上標記 |
| `ingest_rate_bytes_per_sec` | 依租戶 | 429 |

活躍序列計數用固定容量的 HyperLogLog + 精確 LRU 混合實作：LRU 保存最近 N 個序列 hash（用於 `max_series_per_metric_name` 的精確判斷），HLL 估算全租戶總量（低記憶體）。每小時滑窗重置。

**標籤降級規則**：以下 attribute 永遠不得成為指標標籤或日誌 `Labels`，只能進 `Attrs`（正則可設定）：

```
^(trace_id|span_id|request_id|session_id|user_id|uuid|.*_uuid|.*\.id|url\.full|http\.url|http\.target)$
```

指標寫入時若偵測到某標籤在 5 分鐘內出現超過 `cardinality_alarm_threshold`（預設 10_000）個不同值，自動：
1. 遞增 `prism_ingest_high_cardinality_total{tenant,metric,label}`
2. 觸發內建告警 `PrismHighCardinalityLabel`
3. 若 `limits.auto_drop_high_cardinality: true`（預設 false），把該標籤從此序列剝除

## 6. ClickHouse 參考 Schema

驅動 `drivers/clickhouse`。所有 DDL 放在 `drivers/clickhouse/migrations/NNN_*.sql`，由 `Migrate()` 依序執行並記錄於 `prism_schema_migrations` 表。

### 6.1 日誌

```sql
CREATE TABLE IF NOT EXISTS logs
(
    ts            DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    observed_ts   DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    tenant        LowCardinality(String),
    cluster       LowCardinality(String),
    host          LowCardinality(String),
    service       LowCardinality(String),
    env           LowCardinality(String),
    severity      Enum8('unknown'=0,'trace'=1,'debug'=2,'info'=3,'warn'=4,'error'=5,'fatal'=6),
    severity_text LowCardinality(String),
    body          String                              CODEC(ZSTD(3)),
    trace_id      String                              CODEC(ZSTD(1)),
    span_id       String                              CODEC(ZSTD(1)),
    labels        Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    attrs         Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    INDEX idx_body_tokens  body     TYPE tokenbf_v1(30720, 3, 0) GRANULARITY 1,
    INDEX idx_trace        trace_id TYPE bloom_filter(0.01)      GRANULARITY 1,
    INDEX idx_label_keys   mapKeys(labels)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_label_vals   mapValues(labels) TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant, service, severity, host, ts)
TTL toDateTime(ts) + INTERVAL {{ .LogRetentionDays }} DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

`ttl_only_drop_parts = 1` 讓 TTL 直接丟整個 part，避免昂貴的重寫；代價是保留期精度為一天，可接受。

### 6.2 Span

```sql
CREATE TABLE IF NOT EXISTS spans
(
    ts            DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    tenant        LowCardinality(String),
    trace_id      String        CODEC(ZSTD(1)),
    span_id       String        CODEC(ZSTD(1)),
    parent_id     String        CODEC(ZSTD(1)),
    service       LowCardinality(String),
    name          LowCardinality(String),
    kind          Enum8('unspecified'=0,'internal'=1,'server'=2,'client'=3,'producer'=4,'consumer'=5),
    duration_ns   UInt64        CODEC(T64, ZSTD(1)),
    status_code   Enum8('unset'=0,'ok'=1,'error'=2),
    status_msg    String        CODEC(ZSTD(1)),
    host          LowCardinality(String),
    env           LowCardinality(String),
    attrs         Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    res_attrs     Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    events        Nested(ts DateTime64(9), name String, attrs Map(String,String)),
    links         Nested(trace_id String, span_id String),

    INDEX idx_trace     trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration  duration_ns TYPE minmax GRANULARITY 1,
    INDEX idx_attr_keys mapKeys(attrs) TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant, service, name, ts)
TTL toDateTime(ts) + INTERVAL {{ .TraceRetentionDays }} DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

**`GetTrace` 的效能關鍵**：`ORDER BY` 前綴沒有 `trace_id`，靠 bloom filter 索引。因此 `GetTrace` 必須帶時間範圍（Jaeger UI 會帶）。若無時間範圍，先查 `trace_index` 表：

```sql
CREATE TABLE IF NOT EXISTS trace_index
(
    trace_id   String,
    tenant     LowCardinality(String),
    start_ts   SimpleAggregateFunction(min, DateTime64(9)),
    end_ts     SimpleAggregateFunction(max, DateTime64(9)),
    services   SimpleAggregateFunction(groupUniqArrayArray, Array(LowCardinality(String))),
    span_count SimpleAggregateFunction(sum, UInt64),
    error_count SimpleAggregateFunction(sum, UInt64),
    duration_ns SimpleAggregateFunction(max, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(start_ts)
ORDER BY (tenant, trace_id)
TTL toDateTime(start_ts) + INTERVAL {{ .TraceRetentionDays }} DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trace_index TO trace_index AS
SELECT trace_id, tenant, min(ts) AS start_ts, max(ts) AS end_ts,
       groupUniqArray(service) AS services, count() AS span_count,
       countIf(status_code = 'error') AS error_count, max(duration_ns) AS duration_ns
FROM spans GROUP BY tenant, trace_id;
```

### 6.3 RED 預聚合（APM 核心）

```sql
CREATE TABLE IF NOT EXISTS service_red_1m
(
    minute    DateTime,
    tenant    LowCardinality(String),
    service   LowCardinality(String),
    name      LowCardinality(String),
    kind      LowCardinality(String),
    requests  SimpleAggregateFunction(sum, UInt64),
    errors    SimpleAggregateFunction(sum, UInt64),
    lat       AggregateFunction(quantiles(0.5, 0.9, 0.95, 0.99), UInt64),
    lat_sum   SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (tenant, service, name, kind, minute)
TTL minute + INTERVAL {{ .REDRetentionDays }} DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_service_red_1m TO service_red_1m AS
SELECT toStartOfMinute(ts) AS minute, tenant, service, name, toString(kind) AS kind,
       count() AS requests,
       countIf(status_code = 'error') AS errors,
       quantilesState(0.5, 0.9, 0.95, 0.99)(duration_ns) AS lat,
       sum(duration_ns) AS lat_sum
FROM spans
WHERE kind IN ('server', 'consumer')
GROUP BY minute, tenant, service, name, kind;
```

RED 保留期應長於 span 保留期（預設 span 7 天、RED 90 天）：明細可以丟，趨勢不能丟。

### 6.4 服務依賴

```sql
CREATE TABLE IF NOT EXISTS service_deps_1h
(
    hour       DateTime,
    tenant     LowCardinality(String),
    parent     LowCardinality(String),
    child      LowCardinality(String),
    calls      SimpleAggregateFunction(sum, UInt64),
    errors     SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour) ORDER BY (tenant, hour, parent, child)
TTL hour + INTERVAL 90 DAY;
```

依賴關係需要 join parent span 與 child span，MV 無法直接做。實作方式：ingest 層在同一批次內做 span→parent 的本地 join（同一 trace 的 span 通常同批到達），join 不到的 parent 記入 `pending_links` 表，由背景任務每 5 分鐘補算一次。**這是刻意的近似**，必須在文件與 UI 標示「依賴圖為近似值」。

### 6.5 指標

ClickHouse 存指標的 schema 用寬表 + 序列表分離：

```sql
CREATE TABLE IF NOT EXISTS metric_series
(
    fingerprint UInt64,
    tenant      LowCardinality(String),
    metric      LowCardinality(String),
    labels      Map(LowCardinality(String), String),
    first_seen  SimpleAggregateFunction(min, DateTime),
    last_seen   SimpleAggregateFunction(max, DateTime)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(first_seen) ORDER BY (tenant, metric, fingerprint);

CREATE TABLE IF NOT EXISTS metric_samples
(
    ts          DateTime64(3) CODEC(DoubleDelta, ZSTD(1)),
    fingerprint UInt64        CODEC(ZSTD(1)),
    tenant      LowCardinality(String),
    metric      LowCardinality(String),
    value       Float64       CODEC(Gorilla, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toDate(ts) ORDER BY (tenant, metric, fingerprint, ts)
TTL toDateTime(ts) + INTERVAL {{ .MetricRetentionDays }} DAY
SETTINGS ttl_only_drop_parts = 1;
```

`fingerprint` = `labels` 的 xxhash64（含 metric 名稱），由中間層計算並保證與 Prometheus 的 label 排序規則一致。

**誠實提醒（必須寫進 driver README）**：ClickHouse 不是時序資料庫。這套 schema 對指標的效能明顯不如 VictoriaMetrics/Prometheus（壓縮率約差 3–5 倍，高基數查詢差更多）。之所以提供，是為了「一個後端搞定三種訊號」的部署簡單性。**生產環境若指標量大，應改用 `vmvl` 驅動——這正是可換底層設計要解決的問題。**

### 6.6 寫入設定（必須）

所有 `INSERT` 使用：

```
SETTINGS async_insert = 1, wait_for_async_insert = 0,
         async_insert_max_data_size = 10485760,
         async_insert_busy_timeout_ms = 1000
```

且中間層 batcher 已先聚批（預設 5000 筆或 1 秒）。雙層批次是刻意的：中間層批次降低網路往返，`async_insert` 防止多個 `prismd` 副本或客戶端造成 part 爆炸。

## 7. vmvl 驅動的映射

| UTM | VictoriaMetrics / VictoriaLogs |
|---|---|
| `MetricPoint` 寫入 | `/api/v1/import/prometheus` 或 remote_write（推薦後者，可直接轉發） |
| `MetricStore.Select` | `/api/v1/query_range` + `/api/v1/series`（Tier-1 回退用） |
| `NativeMetricQuerier` | 直接轉發 PromQL 到 `/api/v1/query{,_range}`，**幾乎零成本** |
| `LogRecord` 寫入 | `/insert/jsonline`，`_time`/`_msg`/`_stream_fields` 依 VL 規範 |
| `NativeLogQuerier` | `LogQuery` IR → LogSQL 字串 → `/select/logsql/query` |
| `Span` | v1 不支援：`Traces()` 回 nil。使用者需另配 ClickHouse 或接受無 APM |
| 多租戶 | VM/VL 的 `/insert/<accountID>/` 與 `/select/<accountID>/` 路徑前綴 |

`vmvl` 驅動的價值在於證明架構：它的能力分佈與 ClickHouse 幾乎相反（指標原生下推、追蹤完全不支援），若中間層在兩者間切換無感，隔離層就是有效的。
