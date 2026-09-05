# 14 — `pkg/utm` 與 `pkg/spi` 完整 Go 契約

本文件是 L2 抽象層的**逐字規格**。實作者應直接以此為準建立檔案，不得增刪公開識別字。任何變更需先提 ADR。

檔案對應關係見 `01-ARCHITECTURE.md` §5。

---

## 1. `pkg/utm/time.go`

```go
// Package utm 定義統一遙測模型（Unified Telemetry Model）。
// 本套件不得 import 專案內任何其他套件。
package utm

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// 時間單位常數。全專案唯一權威，見 04-DATA-MODEL.md §2。
const (
	// MetricTimeUnit 指標樣本時間戳單位：Unix 毫秒。
	MetricTimeUnit = time.Millisecond
	// EventTimeUnit 日誌與 Span 時間戳單位：Unix 奈秒。
	EventTimeUnit = time.Nanosecond
)

// MilliToSecFloat 毫秒 → Prometheus API 的秒（float）。
func MilliToSecFloat(ms int64) float64 { return float64(ms) / 1e3 }

// SecFloatToMilli Prometheus API 的秒（float）→ 毫秒。四捨五入。
func SecFloatToMilli(s float64) int64 { return int64(s*1e3 + 0.5) }

func NanoToMicro(ns int64) int64 { return ns / 1e3 }
func MicroToNano(us int64) int64 { return us * 1e3 }
func NanoToMilli(ns int64) int64 { return ns / 1e6 }
func MilliToNano(ms int64) int64 { return ms * 1e6 }

func TimeToMilli(t time.Time) int64 { return t.UnixMilli() }
func TimeToNano(t time.Time) int64  { return t.UnixNano() }
func MilliToTime(ms int64) time.Time { return time.UnixMilli(ms).UTC() }
func NanoToTime(ns int64) time.Time  { return time.Unix(0, ns).UTC() }

// ParsePromTime 解析 Prometheus API 的時間參數。
// 接受：RFC3339 / RFC3339Nano / Unix 秒（可含小數）。
func ParsePromTime(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return MilliToTime(SecFloatToMilli(f)), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("cannot parse %q to a valid timestamp", s)
}

// ParseLokiTime 解析 Loki API 的時間參數，回傳 Unix 奈秒。
// 接受：Unix 奈秒字串 / RFC3339Nano / 相對時間（如 "5m"、"1h"，相對於 now）。
func ParseLokiTime(s string, now time.Time) (int64, error) {
	if s == "" {
		return 0, fmt.Errorf("empty timestamp")
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		// Loki 慣例：純數字一律視為奈秒。
		return n, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UnixNano(), nil
	}
	if d, err := time.ParseDuration(s); err == nil {
		return now.Add(-d).UnixNano(), nil
	}
	return 0, fmt.Errorf("cannot parse %q to a valid timestamp", s)
}

// ParseJaegerTime 解析 Jaeger API 的時間參數（Unix 微秒），回傳 Unix 奈秒。
func ParseJaegerTime(s string) (int64, error) {
	us, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("cannot parse %q as microseconds: %w", s, err)
	}
	return MicroToNano(us), nil
}

// ParseJaegerDuration 解析 Jaeger 的 duration 參數，如 "100ms"、"1.5s"。
func ParseJaegerDuration(s string) (time.Duration, error) {
	if s == "" {
		return 0, nil
	}
	return time.ParseDuration(strings.TrimSpace(s))
}

// FormatPromValue 依 Prometheus API 規範把 float 序列化為字串。
// 特殊值必須輸出 "NaN" / "+Inf" / "-Inf"。
func FormatPromValue(v float64) string {
	switch {
	case v != v:
		return "NaN"
	case v > maxFloat:
		return "+Inf"
	case v < -maxFloat:
		return "-Inf"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}
```

**測試要求**：`ParsePromTime` / `ParseLokiTime` / `ParseJaegerTime` 各需 table-driven 測試，覆蓋合法值、邊界值（0、負數、極大值）、非法值。`FormatPromValue` 需覆蓋 `NaN`、`±Inf`、`0`、`-0`、極小值、極大值、整數值（必須輸出 `1` 而非 `1.0`）。

---

## 2. `pkg/utm/labels.go`

```go
package utm

import "github.com/prometheus/prometheus/model/labels"

// Labels 直接 alias 上游型別，避免轉換成本。
// 語意：已排序、去重的鍵值對。
type Labels = labels.Labels

// Builder alias，供中間層構造 Labels。
type LabelsBuilder = labels.Builder

// 系統保留標籤。使用者輸入中出現這些標籤時必須剝除並記錄警告。
const (
	LabelTenant   = "__tenant__"
	LabelName     = "__name__"
	LabelSeverity = "__severity__"
)

// ReservedPrefix 保留前綴。
const ReservedPrefix = "__"

// Fingerprint 回傳 labels 的穩定 hash，作為序列身分。
// 必須與 Prometheus 的排序規則一致：先依 Name 字典序，再依 Value。
func Fingerprint(ls Labels) uint64 { return ls.Hash() }

// SanitizeMetricName 依 04-DATA-MODEL.md §4.3 正規化指標名稱。
// 非 [a-zA-Z0-9_:] 替換為 '_'；開頭為數字時前置 '_'。
func SanitizeMetricName(s string) string

// SanitizeLabelName 依 §4.3 正規化標籤名稱。
// 非 [a-zA-Z0-9_] 替換為 '_'（含 '.' → '_'）；開頭為數字時前置 '_'。
func SanitizeLabelName(s string) string

// IsReserved 判斷是否為系統保留標籤。
func IsReserved(name string) bool
```

---

## 3. `pkg/utm/resource.go` / `metric.go` / `log.go` / `span.go`

型別定義見 `04-DATA-MODEL.md` §3，此處補完該處省略的部分：

```go
package utm

// ---------- resource.go ----------

type Resource struct {
	Tenant          string
	Service         string
	ServiceInstance string
	ServiceVersion  string
	Namespace       string
	Host            string
	Cluster         string
	Env             string
	Attrs           map[string]string
}

// Clone 深拷貝。Ingest 流水線在跨批次共用 Resource 前必須呼叫。
func (r *Resource) Clone() *Resource

// ToLabels 依 04-DATA-MODEL.md §4.2 把 Resource 映射為標籤。
// existing 中已存在的同名標籤不覆寫，改以 "resource_" 前綴加入。
func (r *Resource) ToLabels(existing Labels) Labels

// ---------- metric.go ----------

type MetricType uint8

const (
	TypeUnknown MetricType = iota
	TypeGauge
	TypeCounter
	TypeHistogram
	TypeSummary
)

func (t MetricType) String() string // "unknown"|"gauge"|"counter"|"histogram"|"summary"

type MetricPoint struct {
	Name      string
	Labels    Labels
	TS        int64 // Unix 毫秒
	Value     float64
	Type      MetricType
	Histogram *Histogram
	Exemplar  *Exemplar
}

type Histogram struct {
	Count  uint64
	Sum    float64
	Bounds []float64 // 上界，嚴格遞增，不含 +Inf
	Counts []uint64  // len == len(Bounds)+1，最後一個為 +Inf 桶
}

// Validate 檢查 Bounds 遞增且 len(Counts)==len(Bounds)+1。
func (h *Histogram) Validate() error

// Expand 展開為經典的 _bucket/_sum/_count 序列。
// name 為基礎指標名（不含後綴）。
func (h *Histogram) Expand(name string, ls Labels, ts int64) []MetricPoint

type Exemplar struct {
	Labels Labels // 通常含 trace_id / span_id
	Value  float64
	TS     int64 // Unix 毫秒
}

type MetricMetadata struct {
	Metric string
	Type   MetricType
	Help   string
	Unit   string
}

// ---------- log.go ----------

type Severity uint8

const (
	SevUnknown Severity = iota
	SevTrace
	SevDebug
	SevInfo
	SevWarn
	SevError
	SevFatal
)

func (s Severity) String() string
// ParseSeverity 從文字（"ERROR"、"warn"、"E"…）推斷等級，無法判斷回 SevUnknown。
func ParseSeverity(text string) Severity
// SeverityFromOTel 從 OTel SeverityNumber(1..24) 映射。
func SeverityFromOTel(n int32) Severity

type LogRecord struct {
	Resource     *Resource
	TS           int64 // Unix 奈秒，事件時間
	ObservedTS   int64 // Unix 奈秒，採集時間
	Severity     Severity
	SeverityText string
	Body         string
	TraceID      string // 32 hex，空字串表示無
	SpanID       string // 16 hex
	Labels       Labels
	Attrs        map[string]string
}

// SizeBytes 估算記憶體佔用，供批次大小限制使用。
func (r *LogRecord) SizeBytes() int

// ---------- span.go ----------

type SpanKind uint8

const (
	KindUnspecified SpanKind = iota
	KindInternal
	KindServer
	KindClient
	KindProducer
	KindConsumer
)

func (k SpanKind) String() string // "unspecified"|"internal"|"server"|"client"|"producer"|"consumer"
func ParseSpanKind(s string) SpanKind

type StatusCode uint8

const (
	StatusUnset StatusCode = iota
	StatusOK
	StatusError
)

func (c StatusCode) String() string // "unset"|"ok"|"error"

type Span struct {
	Resource     *Resource
	TraceID      string
	SpanID       string
	ParentSpanID string
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

func (s *Span) DurationNano() int64 { return s.EndNano - s.StartNano }
func (s *Span) IsRoot() bool        { return s.ParentSpanID == "" }
func (s *Span) SizeBytes() int

type SpanEvent struct {
	TS    int64
	Name  string
	Attrs map[string]string
}

type SpanLink struct {
	TraceID string
	SpanID  string
	Attrs   map[string]string
}

// ---------- id.go ----------

// ValidTraceID 檢查是否為 32 個小寫 hex 字元且非全零。
func ValidTraceID(s string) bool
// ValidSpanID 檢查是否為 16 個小寫 hex 字元且非全零。
func ValidSpanID(s string) bool
// NormalizeID 把大寫 hex 轉小寫，去除 "0x" 前綴與連字號。
func NormalizeID(s string) string
```

**驗證規則**：`ValidTraceID` / `ValidSpanID` 失敗時，Ingest 層**清空該欄位並繼續**，不丟棄整筆記錄。全零 ID 在 W3C Trace Context 中代表無效，必須視為空。

---

## 4. `pkg/spi/driver.go`

```go
// Package spi 定義 Prism 的存儲驅動介面。
// 本套件只 import stdlib、prometheus/model/labels、prometheus/client_golang 與 pkg/utm。
package spi

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

type Driver interface {
	Name() string
	Open(ctx context.Context, cfg Config) (Backend, error)
}

type Config struct {
	DSN        string
	Options    map[string]string
	Logger     *slog.Logger
	Registerer prometheus.Registerer
	Clock      Clock
}

// Option 讀取輔助。缺值時回 def，型別錯誤時回錯誤。
func (c Config) String(key, def string) string
func (c Config) Int(key string, def int) (int, error)
func (c Config) Bool(key string, def bool) (bool, error)
func (c Config) Duration(key string, def time.Duration) (time.Duration, error)

type Clock interface {
	Now() time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

// SystemClock 預設時鐘。
var SystemClock Clock = systemClock{}

type Backend interface {
	Capabilities() Capabilities

	// 不支援的 signal 回 nil。呼叫端必須檢查。
	Metrics() MetricStore
	Logs() LogStore
	Traces() TraceStore

	// Migrate 建立或升級 schema，必須冪等。
	Migrate(ctx context.Context) error
	Ping(ctx context.Context) error
	Close() error
}

var (
	driversMu sync.RWMutex
	drivers   = map[string]Driver{}
)

// Register 由驅動套件在 init() 呼叫。重複名稱或 nil 驅動 panic。
func Register(name string, d Driver) {
	driversMu.Lock()
	defer driversMu.Unlock()
	if d == nil {
		panic("spi: Register driver is nil")
	}
	if _, dup := drivers[name]; dup {
		panic("spi: Register called twice for driver " + name)
	}
	drivers[name] = d
}

// Drivers 回傳已註冊驅動名稱，已排序。
func Drivers() []string {
	driversMu.RLock()
	defer driversMu.RUnlock()
	out := make([]string, 0, len(drivers))
	for n := range drivers {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Open 依名稱建立 Backend。
func Open(ctx context.Context, name string, cfg Config) (Backend, error) {
	driversMu.RLock()
	d, ok := drivers[name]
	driversMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("spi: unknown driver %q (available: %v)", name, Drivers())
	}
	if cfg.Clock == nil {
		cfg.Clock = SystemClock
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return d.Open(ctx, cfg)
}
```

---

## 5. `pkg/spi/capabilities.go`

完整定義見 `03-STORAGE-SPI.md` §2，此處補上驗證方法：

```go
package spi

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

	MultiTenant      bool
	OutOfOrderWindow time.Duration // 0=不接受亂序；>0=窗口；<0=無限制
	MaxLookback      time.Duration
	Retention        RetentionCaps
}

type MetricCaps struct {
	NativePromQL     bool
	Exemplars        bool
	NativeHistograms bool
	Downsampling     bool
	DeleteSeries     bool
	Metadata         bool
}

type LogCaps struct {
	NativeLogQuery bool
	Pushdown       LogPushdown
	Aggregation    bool
	LiveTail       bool
	Stats          bool
}

type LogPushdown struct {
	Substring         bool
	Regex             bool
	ParsedFieldJSON   bool
	ParsedFieldLogfmt bool
	Limit             bool
	Sort              bool
}

type TraceCaps struct {
	TagFilter      bool
	DurationFilter bool
	SpanKindFilter bool
	Dependencies   bool
	RED            bool
}

type RetentionCaps struct {
	PerSignal bool
	PerTenant bool
	Enforced  bool
}

func (c Capabilities) Has(s Signal) bool

// Validate 檢查宣告自洽性。由 conformance 套件與 prismd 啟動時呼叫。
// 規則：
//   - Signals 不得為空
//   - Metrics.* 為 true 時 Signals 必須含 metrics（Logs/Traces 同理）
//   - Logs.NativeLogQuery=true 時 Pushdown 全部欄位必須為 true
//   - Logs.Pushdown.Limit=true 時 Substring、Regex、ParsedFieldJSON、
//     ParsedFieldLogfmt 必須全部為 true
//     （理由：未完成全部過濾就截斷會漏資料，見 03-STORAGE-SPI.md §4.2）
//   - Traces.RED=true 時 Signals 必須含 traces
func (c Capabilities) Validate() error
```

`Validate` 的第四條規則把 `03` §4.2 的「`Limit` 陷阱」變成編譯期之外的靜態檢查，`prismd` 啟動時若驅動宣告不自洽必須拒絕啟動。

---

## 6. `pkg/spi/query_ir.go`

```go
package spi

import (
	"regexp"
	"time"

	"github.com/OWNER/prism/pkg/utm"
)

// ---------- 通用 ----------

type TimeRange struct {
	Start int64 // 含
	End   int64 // 含
	// 單位由使用情境決定：指標為毫秒，日誌與追蹤為奈秒。
	// 各 Store 的方法註解必須明確標示。
}

type MatchType uint8

const (
	MatchEqual MatchType = iota
	MatchNotEqual
	MatchRegexp
	MatchNotRegexp
)

func (t MatchType) String() string // "="|"!="|"=~"|"!~"

type Matcher struct {
	Type  MatchType
	Name  string
	Value string
	// re 由中間層在建構時預編譯（錨定為完全匹配：^(?:value)$）。
	// 驅動若要在本地求值必須使用此欄位，不得自行編譯。
	Compiled *regexp.Regexp
}

func (m Matcher) Matches(v string) bool

// NewMatcher 建構並預編譯。正則語法錯誤回 ErrBadRequest。
func NewMatcher(t MatchType, name, value string) (Matcher, error)

// ---------- 指標 ----------

type SeriesQuery struct {
	Tenant   string
	Matchers []Matcher
	Start    int64 // Unix 毫秒，含
	End      int64 // Unix 毫秒，含
	Hints    SelectHints
}

type SelectHints struct {
	Start, End int64
	Step       int64
	Func       string
	Grouping   []string
	By         bool
	Range      int64
	Limit      int
}

type LabelQuery struct {
	Tenant     string
	Matchers   []Matcher
	Start, End int64 // 指標為毫秒；日誌為奈秒
	Limit      int
}

type PromResult struct {
	ResultType string // "vector"|"matrix"|"scalar"|"string"
	Vector     []VectorSample
	Matrix     []SeriesData
	Scalar     *VectorSample
	Warnings   []string
}

type VectorSample struct {
	Labels utm.Labels
	TS     int64 // 毫秒
	Value  float64
}

type SeriesData struct {
	Labels  utm.Labels
	Samples []Sample
}

type Sample struct {
	TS    int64 // 毫秒
	Value float64
}

type ExemplarSet struct {
	SeriesLabels utm.Labels
	Exemplars    []utm.Exemplar
}

// ---------- 日誌 ----------

type Direction uint8

const (
	Backward Direction = iota // 新 → 舊（預設）
	Forward                   // 舊 → 新
)

type LineFilterOp uint8

const (
	LineContains LineFilterOp = iota
	LineNotContains
	LineMatch
	LineNotMatch
)

type LineFilter struct {
	Op       LineFilterOp
	Value    string
	Compiled *regexp.Regexp // 僅 LineMatch/LineNotMatch
	// LiteralHint 是所有匹配字串必含的字面子串（長度 >= 3），
	// 供驅動做粗篩下推。空字串表示無法抽取。見 06-QUERY-ENGINE.md §3.3。
	LiteralHint string
}

func (f LineFilter) Matches(line string) bool

type ParseKind uint8

const (
	ParseJSON ParseKind = iota
	ParseLogfmt
)

type ParseStage struct {
	Kind ParseKind
}

type CompareOp uint8

const (
	CmpEq CompareOp = iota
	CmpNe
	CmpRe
	CmpNotRe
	CmpGt
	CmpGte
	CmpLt
	CmpLte
)

type FieldFilter struct {
	Field    string
	Op       CompareOp
	Value    string
	Num      *float64       // 數值比較時已解析
	Compiled *regexp.Regexp // CmpRe/CmpNotRe
}

type LogAggregation struct {
	RangeFunc string // "count_over_time"|"rate"|"bytes_over_time"|"bytes_rate"
	Window    time.Duration
	Step      time.Duration
	VectorOp  string // ""|"sum"|"avg"|"min"|"max"|"count"|"topk"|"bottomk"
	By        []string
	Without   []string
	K         int
}

type LogQuery struct {
	Tenant     string
	Selectors  []Matcher
	Start, End int64 // Unix 奈秒，[Start, End)
	Filters    []LineFilter
	Stages     []ParseStage
	Fields     []FieldFilter
	Direction  Direction
	Limit      int
	Agg        *LogAggregation
}

// PushdownPlan 回報在給定能力下，哪些條件可以交給驅動。
// 中間層用它決定要補算什麼；conformance 用它驗證 C-LOG-04。
func (q LogQuery) PushdownPlan(caps LogPushdown, agg bool) PushdownPlan

type PushdownPlan struct {
	Selectors bool // 永遠 true
	TimeRange bool // 永遠 true
	Filters   []bool // 與 q.Filters 等長
	Stages    bool
	Fields    bool
	Agg       bool
	Limit     bool // 僅在上述全部為 true 時才可為 true
}

// AllPushed 回報是否全部條件都已下推。
func (p PushdownPlan) AllPushed() bool

type LogResult struct {
	Streams []LogStreamData // Agg == nil 時
	Matrix  []SeriesData    // Agg != nil 時
	Stats   LogStats
}

type LogStreamData struct {
	Labels  utm.Labels
	Entries []utm.LogRecord
}

type LogStats struct {
	TotalBytesProcessed int64
	TotalLinesProcessed int64
	ExecTimeSeconds     float64
	// Streams / Chunks 為 Loki API 的估算欄位，可填 0。
	Streams int64
	Chunks  int64
}

// ---------- 追蹤 ----------

type TraceQuery struct {
	Tenant      string
	Service     string
	Operation   string
	SpanKind    string
	Tags        map[string]string
	MinDuration time.Duration
	MaxDuration time.Duration
	Start, End  int64 // Unix 奈秒
	Limit       int   // trace 數量
}

type TraceIDWithTime struct {
	TraceID   string
	StartNano int64
	EndNano   int64
}

type Operation struct {
	Name     string
	SpanKind string
}

type Dependency struct {
	Parent    string
	Child     string
	CallCount uint64
	ErrCount  uint64
}

type REDQuery struct {
	Tenant     string
	Services   []string
	Operation  string
	Start, End int64 // Unix 奈秒
	Step       time.Duration
	Quantiles  []float64
}

type REDPoint struct {
	Service   string
	Operation string
	TS        int64 // Unix 毫秒
	Requests  uint64
	Errors    uint64
	SumNano   uint64
	Latency   map[float64]float64 // quantile → 奈秒
}
```

---

## 7. `pkg/spi/iterator.go`

```go
package spi

import "github.com/OWNER/prism/pkg/utm"

// SeriesSet 串流回傳序列。
// 契約：
//  1. 必須依 Labels 字典序遞增
//  2. Next() 回 false 後 Err() 才有意義
//  3. At() 回傳的 Series 只在下一次 Next() 前有效
//  4. 呼叫端必須 Close()，即使已迭代完畢
type SeriesSet interface {
	Next() bool
	At() Series
	Err() error
	Warnings() []string
	Close() error
}

type Series interface {
	Labels() utm.Labels
	Samples() SampleIterator
}

// SampleIterator 契約：時間戳嚴格遞增，無重複。
type SampleIterator interface {
	Next() bool
	At() (ts int64, v float64) // ts = Unix 毫秒
	Err() error
}

// LogIterator 契約：
//  1. 順序符合 LogQuery.Direction
//  2. 同一時間戳的多筆記錄順序穩定（次序鍵為驅動的寫入序）
//  3. At() 回傳的 LogRecord 在下一次 Next() 後可能被重用，
//     呼叫端若要保留必須自行拷貝 Body 與 map
type LogIterator interface {
	Next() bool
	At() utm.LogRecord
	Err() error
	Close() error
}

type SpanIterator interface {
	Next() bool
	At() utm.Span
	Err() error
	Close() error
}

// LogStream 供 LiveTail 使用。Close 後 Chan 必須被關閉。
type LogStream interface {
	Chan() <-chan utm.LogRecord
	Err() error
	Close() error
}

// ---------- 輔助建構子（驅動可直接使用，減少重複程式碼） ----------

// EmptySeriesSet 回傳空集合，Err() 為 nil。
func EmptySeriesSet() SeriesSet

// ErrSeriesSet 回傳立即失敗的集合。
func ErrSeriesSet(err error) SeriesSet

// SliceSeriesSet 從已排序的 slice 建構（memory 驅動與測試使用）。
// 若 series 未排序，建構時排序。
func SliceSeriesSet(series []SeriesData) SeriesSet

func EmptyLogIterator() LogIterator
func SliceLogIterator(recs []utm.LogRecord) LogIterator
func EmptySpanIterator() SpanIterator
func SliceSpanIterator(spans []utm.Span) SpanIterator
```

**`At()` 的重用語意（`LogIterator` 第 3 條）必須在每個驅動實作中被遵守，也必須在 conformance 中被驗證**：測試會保留前一次 `At()` 的結果並在下次 `Next()` 後檢查——這是為了允許驅動零配置重用緩衝，同時強制呼叫端正確拷貝。

---

## 8. `pkg/spi/errors.go`

```go
package spi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

type ErrClass string

const (
	ErrBadRequest  ErrClass = "bad_request"
	ErrUnsupported ErrClass = "unsupported"
	ErrNotFound    ErrClass = "not_found"
	ErrTooLarge    ErrClass = "too_large"
	ErrThrottled   ErrClass = "throttled"
	ErrUnavailable ErrClass = "unavailable"
	ErrTimeout     ErrClass = "timeout"
	ErrInternal    ErrClass = "internal"
)

type Error struct {
	Class  ErrClass
	Driver string
	Op     string
	Err    error
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s: %s: %v", e.Driver, e.Op, e.Class, e.Err)
}
func (e *Error) Unwrap() error { return e.Err }

// Wrap 建構 *Error。err 為 nil 時回 nil。
func Wrap(class ErrClass, driver, op string, err error) error

// Classify 取得錯誤分類。特殊處理：
//   context.Canceled         → ErrTimeout
//   context.DeadlineExceeded → ErrTimeout
//   非 *Error                → ErrInternal
func Classify(err error) ErrClass

// Retryable 回報該分類是否值得重試。
// true: ErrThrottled, ErrUnavailable, ErrTimeout
func Retryable(c ErrClass) bool

// HTTPStatus 回報對應的 HTTP 狀態碼。
//   bad_request→400 unsupported→400 not_found→404 too_large→422
//   throttled→429 unavailable→503 timeout→503 internal→500
func HTTPStatus(c ErrClass) int

// PromErrorType 回報 Prometheus API 的 errorType 欄位值。
// 見 02-COMPATIBILITY-CONTRACT.md §2.1。
func PromErrorType(c ErrClass) string
```

`ErrTimeout` 對應 HTTP 503 而非 504，是為了與 Prometheus 的行為一致（Grafana 依此決定是否重試）。

---

## 9. `pkg/spi/metric_store.go` / `log_store.go` / `trace_store.go`

介面定義見 `03-STORAGE-SPI.md` §3–§5。此處補上**每個方法的前置條件與後置條件**，作為 conformance 的判準來源：

| 方法 | 前置條件（中間層保證） | 後置條件（驅動保證） |
|---|---|---|
| `MetricStore.Write` | batch 非空；每點 `Labels` 已排序去重、含 `__name__`；`TS` 為毫秒 | 全部成功或回錯誤；部分成功必須回錯誤（不允許靜默丟棄） |
| `MetricStore.Select` | `Matchers` 至少一個非空值匹配；`Start <= End` | 回非 nil `SeriesSet`；排序契約；空結果回空集合 |
| `MetricStore.LabelNames` | 同上 | 已排序去重；不含 `__` 前綴標籤 |
| `MetricStore.LabelValues` | `name` 非空 | 已排序去重 |
| `LogStore.Write` | batch 非空；`TS` 為奈秒；`Resource` 非 nil | 同 `MetricStore.Write` |
| `LogStore.Search` | `Selectors` 至少一個；`Start < End` | 結果為「Selectors + 時間 + 已宣告可下推的過濾」的**精確**結果，且為完整查詢條件的**超集** |
| `TraceStore.GetTrace` | `traceID` 已正規化為 32 小寫 hex | 回該 trace 全部 span；不存在回空迭代器（非錯誤） |
| `TraceStore.FindTraceIDs` | `Service` 非空；`Limit > 0` | 回最多 `Limit` 個**不同** trace ID，依 `StartNano` 降序 |
| `TraceStore.Services` | `tr` 有效 | 已排序去重 |

「部分成功必須回錯誤」是刻意的：ingest 層的丟棄統計必須準確，驅動不得自行吞掉部分失敗。

---

## 10. `pkg/spi/conformance` 套件骨架

```go
package conformance

import (
	"testing"
	"time"

	"github.com/OWNER/prism/pkg/spi"
)

type Factory func(t *testing.T) (spi.Backend, func())

type Options struct {
	KnownDeviations      map[string]string
	WriteVisibilityDelay time.Duration
	// SkipSignals 允許驅動跳過未實作的 signal（必須與 Capabilities 一致）
	SkipSignals []spi.Signal
}

// Run 執行全部測項。測項 ID 見 10-CONFORMANCE-TESTING.md §2。
func Run(t *testing.T, f Factory, opts Options)

// 個別群組，供除錯時單獨執行。
func RunGeneral(t *testing.T, f Factory, opts Options)
func RunMetrics(t *testing.T, f Factory, opts Options)
func RunLogs(t *testing.T, f Factory, opts Options)
func RunTraces(t *testing.T, f Factory, opts Options)

// ---------- 測試資料產生器（固定種子，結果可重現） ----------

// Fixtures 產生確定性的測試資料。所有驅動用同一份資料，
// 使跨驅動的結果可以直接比對。
type Fixtures struct{ Seed int64 }

func NewFixtures() *Fixtures // Seed = 20260905

func (f *Fixtures) Metrics(nSeries, nPoints int, start int64, step time.Duration) []utm.MetricPoint
func (f *Fixtures) Logs(nStreams, nPerStream int, start int64, step time.Duration) []utm.LogRecord
func (f *Fixtures) Trace(nServices, nSpansPerService int, start int64) []utm.Span
func (f *Fixtures) HighCardinality(nSeries int, start int64) []utm.MetricPoint
```

`Fixtures` 使用固定種子是差分測試（L3）與跨驅動 E2E（`E2E-07`）的基礎：只有輸入完全相同，輸出比對才有意義。
