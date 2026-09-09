# 03 — Storage SPI（存儲驅動介面）

這是 Prism 的隔離層本體。設計原型是 Go 的 `database/sql/driver`：**核心介面極小且必選，能力擴充用可選介面 + 型別斷言。**

套件位置：`pkg/spi`（公開，語意化版本）。任何第三方都能在自己的 repo 實作驅動。

## 1. 註冊與開啟

```go
package spi

// Register 由驅動套件在 init() 呼叫。重複名稱 panic。
func Register(name string, d Driver)

// Drivers 回傳已註冊驅動名稱（排序後）。
func Drivers() []string

// Open 依名稱建立 Backend。
func Open(ctx context.Context, name string, cfg Config) (Backend, error)

type Config struct {
    DSN        string            // 驅動自解析，如 clickhouse://user:pw@host:9000/prism
    Options    map[string]string // 驅動特定選項，來自設定檔 storage.options
    Logger     *slog.Logger
    Registerer prometheus.Registerer // 驅動自身指標註冊處；可為 nil
    Clock      Clock             // 測試用可注入；預設 SystemClock
}

type Driver interface {
    Name() string
    Open(ctx context.Context, cfg Config) (Backend, error)
}

type Backend interface {
    Capabilities() Capabilities

    // 不支援的 signal 回 nil。呼叫端必須檢查。
    Metrics() MetricStore
    Logs() LogStore
    Traces() TraceStore

    // Migrate 建立或升級 schema，必須冪等，可重複呼叫。
    Migrate(ctx context.Context) error
    Ping(ctx context.Context) error
    Close() error
}
```

`cmd/prismd/main.go` 以 blank import 引入驅動：

```go
import (
    _ "github.com/OWNER/prism/drivers/clickhouse"
    _ "github.com/OWNER/prism/drivers/memory"
    _ "github.com/OWNER/prism/drivers/vmvl"
)
```

不同的建構標籤可裁剪二進位大小（`-tags noclickhouse`），但預設全部編入。

## 2. 能力宣告

```go
type Signal string
const (
    SignalMetrics Signal = "metrics"
    SignalLogs    Signal = "logs"
    SignalTraces  Signal = "traces"
)

type Capabilities struct {
    Driver  string
    Version string
    Signals []Signal

    Metrics MetricCaps
    Logs    LogCaps
    Traces  TraceCaps

    MultiTenant      bool          // 後端原生租戶隔離；false 時中間層以 tenant 標籤隔離
    // OutOfOrderWindow 可接受的亂序寫入窗口。
    //   0   = 完全不接受亂序（後端要求嚴格遞增）
    //   > 0 = 接受該窗口內的亂序
    //   < 0 = 無限制（如 ClickHouse 的 MergeTree）
    OutOfOrderWindow time.Duration
    MaxLookback      time.Duration // 0 = 無限制
    Retention        RetentionCaps
}

type MetricCaps struct {
    NativePromQL     bool // 是否實作 NativeMetricQuerier
    Exemplars        bool
    NativeHistograms bool
    Downsampling     bool
    DeleteSeries     bool
}

type LogCaps struct {
    NativeLogQuery bool // 是否實作 NativeLogQuerier（完整 IR 下推）
    Pushdown       LogPushdown
    Aggregation    bool // 能否下推 count_over_time / rate 類聚合
    LiveTail       bool
}

type LogPushdown struct {
    Substring         bool // |= != 可下推
    Regex             bool // |~ !~ 可下推
    ParsedFieldJSON   bool // | json 後的欄位過濾可下推
    ParsedFieldLogfmt bool // | logfmt 後的欄位過濾可下推
    Limit             bool // 僅在上述全部為 true 時才可宣告
    Sort              bool
}

type TraceCaps struct {
    TagFilter      bool
    DurationFilter bool
    SpanKindFilter bool
    Dependencies   bool // 是否實作 DependencyQuerier
    RED            bool // 是否實作 SpanAggregator（預聚合 RED）
}

type RetentionCaps struct {
    PerSignal bool // 能否對不同 signal 設不同保留期
    PerTenant bool
    Enforced  bool // 後端自行執行清理（如 ClickHouse TTL）；false 時由 Prism 定期刪除
}
```

**誠實原則**：宣告 `true` 的能力必須真的可用。一致性測試會針對每個宣告為 `true` 的位元執行對應測試；宣告為 `false` 的可選介面若被實作，也視為失敗（避免半吊子）。

## 3. 指標存儲

```go
type MetricStore interface {
    Write(ctx context.Context, batch []utm.MetricPoint) error

    // Tier-1 原語：所有驅動必須實作。
    Select(ctx context.Context, q SeriesQuery) (SeriesSet, error)
    LabelNames(ctx context.Context, q LabelQuery) ([]string, error)
    LabelValues(ctx context.Context, name string, q LabelQuery) ([]string, error)
}

// Tier-2 可選：型別斷言取得。
type NativeMetricQuerier interface {
    QueryInstant(ctx context.Context, tenant, expr string, ts time.Time, timeout time.Duration) (*PromResult, error)
    QueryRange(ctx context.Context, tenant, expr string, start, end time.Time, step time.Duration, timeout time.Duration) (*PromResult, error)
}
type SeriesDeleter interface {
    DeleteSeries(ctx context.Context, tenant string, matchers []Matcher, tr TimeRange) error
}
type ExemplarQuerier interface {
    QueryExemplars(ctx context.Context, tenant string, matchers [][]Matcher, tr TimeRange) ([]ExemplarSet, error)
}
type MetadataStore interface {
    UpsertMetadata(ctx context.Context, tenant string, md []utm.MetricMetadata) error
    Metadata(ctx context.Context, tenant, metric string, limit int) ([]utm.MetricMetadata, error)
}
```

### 3.1 `SeriesQuery` 與 hints

```go
type SeriesQuery struct {
    Tenant   string
    Matchers []Matcher // 必須至少有一個 非空值的 = 或 =~ 匹配（防全表掃描）
    Start    int64     // Unix 毫秒，含
    End      int64     // Unix 毫秒，含
    Hints    SelectHints
}

// SelectHints 欄位與 prometheus/storage.SelectHints 一一對應，
// 讓 promqladapter 可以零損耗轉發，供驅動做下推優化。忽略 hints 永遠是合法實作。
type SelectHints struct {
    Start, End int64
    Step       int64    // 毫秒，0 = instant
    Func       string   // "rate"、"increase"、"sum"…
    Grouping   []string
    By         bool
    Range      int64    // 毫秒
    Limit      int
}

type Matcher struct {
    Type  MatchType // MatchEqual / MatchNotEqual / MatchRegexp / MatchNotRegexp
    Name  string
    Value string
}

type LabelQuery struct {
    Tenant   string
    Matchers []Matcher
    Start, End int64 // Unix 毫秒
    Limit    int
}
```

### 3.2 迭代器

一律串流，禁止在驅動內把整個結果集載入記憶體後回傳 slice。

```go
type SeriesSet interface {
    Next() bool
    At() Series
    Err() error
    Warnings() []string
    Close() error   // 呼叫端必須 defer Close()
}

type Series interface {
    Labels() utm.Labels
    Samples() SampleIterator
}

type SampleIterator interface {
    Next() bool
    At() (ts int64, v float64) // ts = Unix 毫秒
    Err() error
}
```

**排序契約**：`SeriesSet` 必須依 labels 字典序遞增；每個 Series 的樣本必須依時間遞增且不重複。PromQL 引擎依賴此契約，違反會產生錯誤結果而非錯誤訊息。

## 4. 日誌存儲

```go
type LogStore interface {
    Write(ctx context.Context, batch []utm.LogRecord) error

    // Tier-1 原語：拉取原始日誌，過濾能力由 LogQuery 中驅動宣告可下推的部分決定。
    Search(ctx context.Context, q LogQuery) (LogIterator, error)
    LabelNames(ctx context.Context, q LabelQuery) ([]string, error)
    LabelValues(ctx context.Context, name string, q LabelQuery) ([]string, error)
}

type NativeLogQuerier interface {
    // 完整 IR（含 pipeline 與聚合）下推。
    SearchNative(ctx context.Context, q LogQuery) (LogResult, error)
}
type LogTailer interface {
    Tail(ctx context.Context, q LogQuery) (LogStream, error) // Phase 4
}
type LogStatser interface {
    Stats(ctx context.Context, q LogQuery) (LogStats, error) // /loki/api/v1/index/stats
}
```

### 4.1 `LogQuery` — 日誌查詢 IR

這是 LogQL 與未來任何日誌語法的共同中間表示。**中間層負責解析語法，驅動只看 IR。**

```go
type LogQuery struct {
    Tenant     string
    Selectors  []Matcher     // {job="api", level=~"error|warn"}
    Start, End int64         // Unix 奈秒，[Start, End)
    Filters    []LineFilter  // 順序即求值順序
    Stages     []ParseStage  // | json | logfmt
    Fields     []FieldFilter // 解析後欄位過濾
    Direction  Direction     // Backward（新→舊，預設）/ Forward
    Limit      int           // 0 = 用設定檔預設
    Agg        *LogAggregation // nil = 回原始日誌行
}

type LineFilter struct {
    Op    LineFilterOp // Contains / NotContains / Match / NotMatch
    Value string       // 原始字串（Match 時為正則來源）
    // 驅動不得自行編譯正則；中間層在 Compile() 時填入下列欄位
    Compiled *regexp.Regexp
    // 對 Match 類型，若正則可退化為子串，中間層填入以利下推
    LiteralHint string
}

type ParseStage struct { Kind ParseKind } // ParseJSON / ParseLogfmt

type FieldFilter struct {
    Field string
    Op    CompareOp // Eq/Ne/Re/NotRe/Gt/Gte/Lt/Lte
    Value string
    Num   *float64  // 數值比較時已解析
}

type LogAggregation struct {
    RangeFunc string        // count_over_time / rate / bytes_over_time / bytes_rate
    Window    time.Duration
    Step      time.Duration
    VectorOp  string        // sum/avg/min/max/count/topk/bottomk；空字串 = 不做向量聚合
    By        []string
    Without   []string
    K         int           // topk/bottomk
}
```

### 4.2 部分下推規則（Tier-1 驅動）

驅動只需保證：**回傳的結果是 `Selectors` + 時間範圍的超集，且不多不少地滿足自己宣告可下推的那些過濾。** 中間層負責補齊剩下的過濾。

| 驅動宣告 | 驅動須處理 | 中間層補算 |
|---|---|---|
| `Substring=false, Regex=false` | 只做 Selectors + 時間 | 全部 Filters / Stages / Fields / Agg |
| `Substring=true, Regex=false` | Selectors + 時間 + `Contains`/`NotContains` | Regex Filters、Stages、Fields、Agg |
| `ParsedFieldJSON=true` | 上述 + `\| json` 後的 Fields | logfmt 的 Fields、Agg（若 `Aggregation=false`） |
| `ParsedFieldLogfmt=true` | 上述 + `\| logfmt` 後的 Fields | Agg（若 `Aggregation=false`） |
| `NativeLogQuery=true` | 全部 | 無 |

**`Limit` 的陷阱**：只有在驅動已套用**全部**過濾條件時才能下推 `Limit`。否則驅動必須忽略 `Limit`，改由中間層在補算後截斷；驅動應改用設定檔的 `max_scan_rows` 做保護並在超出時回 `ErrTooLarge`。這一條寫錯會導致「日誌少了」這種最難查的 bug。

### 4.3 迭代器

```go
type LogIterator interface {
    Next() bool
    At() utm.LogRecord
    Err() error
    Close() error
}

type LogResult struct {
    Streams []LogStream  // 原始日誌結果
    Matrix  []SeriesData // 聚合結果
}
```

## 5. 追蹤存儲

```go
type TraceStore interface {
    Write(ctx context.Context, batch []utm.Span) error
    GetTrace(ctx context.Context, tenant, traceID string) (SpanIterator, error)
    FindTraceIDs(ctx context.Context, q TraceQuery) ([]TraceIDWithTime, error)
    Services(ctx context.Context, tenant string, tr TimeRange) ([]string, error)
    Operations(ctx context.Context, tenant, service, spanKind string, tr TimeRange) ([]Operation, error)
}

type DependencyQuerier interface {
    Dependencies(ctx context.Context, tenant string, tr TimeRange) ([]Dependency, error)
}
type SpanAggregator interface {
    // 供 APM RED 面板；未實作時中間層以 FindTraceIDs + 掃描回退（慢，僅供小量）
    ServiceRED(ctx context.Context, q REDQuery) ([]REDPoint, error)
}

type TraceQuery struct {
    Tenant      string
    Service     string            // 必填
    Operation   string
    SpanKind    string
    Tags        map[string]string
    MinDuration time.Duration
    MaxDuration time.Duration
    Start, End  int64 // Unix 奈秒
    Limit       int   // trace 數量，非 span 數量
}

type REDQuery struct {
    Tenant     string
    Services   []string // 空 = 全部
    Operation  string
    Start, End int64    // Unix 奈秒
    Step       time.Duration
    Quantiles  []float64 // 如 [0.5,0.95,0.99]
}
type REDPoint struct {
    Service, Operation string
    TS                 int64 // Unix 毫秒
    Requests, Errors   uint64
    Latency            map[float64]float64 // quantile -> 奈秒
}
```

**`FindTraceIDs` 兩階段查詢**：先找出符合條件的 trace ID（小結果），再用 `GetTrace` 逐一取完整 trace。禁止一次查詢直接回傳全部 span——這在真實資料量下會 OOM。

## 6. 中間層對驅動的包裝

`internal/storage` 提供 decorator 鏈，驅動作者不需要關心這些：

```go
backend = spi.Open(...)
backend = wrap.WithMetrics(backend)     // 記錄 prism_storage_* 指標
backend = wrap.WithTracing(backend)     // 自身 span
backend = wrap.WithRetry(backend, cfg)  // 依 ErrClass 決定重試
backend = wrap.WithTimeout(backend, cfg)
backend = wrap.WithTenantGuard(backend) // Capabilities.MultiTenant=false 時強制注入 tenant 標籤
```

`WithTenantGuard` 是安全關鍵：對不支援原生多租戶的後端，它在寫入時強制加上 `__tenant__` 標籤，在查詢時強制加上對應的 `Matcher`，且**檢查使用者傳入的 matcher 沒有試圖覆寫 `__tenant__`**。

## 7. 錯誤模型

```go
type ErrClass string
const (
    ErrBadRequest  ErrClass = "bad_request"  // 呼叫端錯誤，不重試 → HTTP 400
    ErrUnsupported ErrClass = "unsupported"  // 驅動不支援，不重試 → HTTP 400 + 明確訊息
    ErrNotFound    ErrClass = "not_found"    // → HTTP 404
    ErrTooLarge    ErrClass = "too_large"    // 超出掃描/結果限制，不重試 → HTTP 413/422
    ErrThrottled   ErrClass = "throttled"    // 可重試 → HTTP 429
    ErrUnavailable ErrClass = "unavailable"  // 可重試 → HTTP 503
    ErrTimeout     ErrClass = "timeout"      // 可重試（查詢不重試，寫入重試）→ HTTP 503
    ErrInternal    ErrClass = "internal"     // 不重試 → HTTP 500
)

type Error struct {
    Class  ErrClass
    Driver string
    Op     string // "metrics.Write"、"logs.Search"…
    Err    error
}
func (e *Error) Error() string
func (e *Error) Unwrap() error
func Classify(err error) ErrClass // 非 *Error 一律回 ErrInternal
```

驅動**必須**把後端原生錯誤映射成上述分類。例如 ClickHouse 的 `TOO_MANY_ROWS`→`ErrTooLarge`，連線失敗→`ErrUnavailable`，`MEMORY_LIMIT_EXCEEDED`→`ErrTooLarge`。

寫入重試策略（`WithRetry`）：`ErrThrottled`/`ErrUnavailable`/`ErrTimeout` 以指數退避重試至多 3 次（100ms 起，×2，加 ±20% jitter）。其他一律立即失敗並丟棄該批次，遞增 `prism_ingest_dropped_total{reason="write_failed"}`。

## 8. 驅動作者檢查清單

新增一個驅動時必須完成：

1. 實作 `Driver` + `Backend` + 至少一個 `*Store`，在 `init()` 呼叫 `spi.Register`。
2. 誠實填寫 `Capabilities`。
3. `Migrate` 冪等；提供版本化的 schema 遷移。
4. 所有原生錯誤映射成 `spi.ErrClass`。
5. 迭代器保證排序契約與 `Close` 釋放資源。
6. 通過 `spi/conformance.Run(t, factory)` 全部測項。
7. 提供 `drivers/<name>/README.md`：DSN 格式、必要的後端版本、options 清單、已知限制。
8. 在 `10-CONFORMANCE-TESTING.md` 的 CI 矩陣加入該驅動。

## 9. 參考驅動能力對照

| 能力 | memory | clickhouse | vmvl |
|---|---|---|---|
| Signals | m/l/t | m/l/t | m/l/t（traces 走 ClickHouse 或不支援，見下） |
| `NativePromQL` | false | false | **true**（VictoriaMetrics 原生 PromQL/MetricsQL） |
| `NativeLogQuery` | false | true（翻成 SQL） | true（翻成 LogSQL） |
| `Logs.Pushdown.Regex` | false | true | true |
| `Logs.Pushdown.ParsedFieldJSON` | false | true | true |
| `Logs.Pushdown.ParsedFieldLogfmt` | false | **false** | true |
| `Traces.RED` | false | **true**（物化視圖預聚合） | false |
| `Traces.Dependencies` | false | true | false |
| `MultiTenant` | false | false（用 tenant 欄位） | true（VM/VL 原生多租戶路徑） |
| `Retention.Enforced` | false | true（TTL） | true |

`vmvl` 驅動若使用者未配置追蹤後端，`Traces()` 回 `nil`，`Capabilities.Signals` 不含 `traces`。中間層此時讓 Jaeger API 回空結果並在 `/-/ready` 標示降級，**不得 panic**。

這張表本身就是設計驗證：三個驅動的能力分佈明顯不同，若中間層寫得對，切換它們對使用者完全不可見（只有效能差異）。
