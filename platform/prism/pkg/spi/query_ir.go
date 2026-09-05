package spi

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// TimeRange is an inclusive range whose unit is defined by the store method.
type TimeRange struct {
	Start int64
	End   int64
}

// MatchType identifies a label matcher operation.
type MatchType uint8

const (
	// MatchEqual matches equal label values.
	MatchEqual MatchType = iota
	// MatchNotEqual matches unequal label values.
	MatchNotEqual
	// MatchRegexp matches a fully anchored regular expression.
	MatchRegexp
	// MatchNotRegexp negates a fully anchored regular expression.
	MatchNotRegexp
)

// String returns the matcher operator.
func (t MatchType) String() string {
	switch t {
	case MatchEqual:
		return "="
	case MatchNotEqual:
		return "!="
	case MatchRegexp:
		return "=~"
	case MatchNotRegexp:
		return "!~"
	default:
		return "unknown"
	}
}

// Matcher matches one label value. Regular expressions are precompiled and
// anchored by NewMatcher.
type Matcher struct {
	Type     MatchType
	Name     string
	Value    string
	Compiled *regexp.Regexp
}

// Matches reports whether v satisfies the matcher.
func (m Matcher) Matches(v string) bool {
	switch m.Type {
	case MatchEqual:
		return v == m.Value
	case MatchNotEqual:
		return v != m.Value
	case MatchRegexp:
		return m.Compiled != nil && m.Compiled.MatchString(v)
	case MatchNotRegexp:
		return m.Compiled != nil && !m.Compiled.MatchString(v)
	default:
		return false
	}
}

// NewMatcher constructs a matcher and precompiles fully anchored regular
// expressions. Invalid match types and patterns are classified as bad requests.
func NewMatcher(t MatchType, name, value string) (Matcher, error) {
	matcher := Matcher{Type: t, Name: name, Value: value}
	switch t {
	case MatchEqual, MatchNotEqual:
		return matcher, nil
	case MatchRegexp, MatchNotRegexp:
		compiled, err := regexp.Compile("^(?:" + value + ")$")
		if err != nil {
			return Matcher{}, Wrap(ErrBadRequest, "spi", "matcher.compile", err)
		}
		matcher.Compiled = compiled
		return matcher, nil
	default:
		return Matcher{}, Wrap(ErrBadRequest, "spi", "matcher.create", fmt.Errorf("unknown match type %d", t))
	}
}

// SeriesQuery selects metric series in an inclusive millisecond range.
type SeriesQuery struct {
	Tenant   string
	Matchers []Matcher
	Start    int64
	End      int64
	Hints    SelectHints
}

// SelectHints describes safe metric query pushdown opportunities.
type SelectHints struct {
	Start    int64
	End      int64
	Step     int64
	Func     string
	Grouping []string
	By       bool
	Range    int64
	Limit    int
}

// LabelQuery selects label names or values for metrics or logs.
type LabelQuery struct {
	Tenant   string
	Matchers []Matcher
	Start    int64
	End      int64
	Limit    int
}

// PromResult is the backend-neutral representation of a Prometheus result.
type PromResult struct {
	ResultType string
	Vector     []VectorSample
	Matrix     []SeriesData
	Scalar     *VectorSample
	Warnings   []string
}

// VectorSample is one labeled metric value at a millisecond timestamp.
type VectorSample struct {
	Labels utm.Labels
	TS     int64
	Value  float64
}

// SeriesData is one metric series and its samples.
type SeriesData struct {
	Labels  utm.Labels
	Samples []Sample
}

// Sample is one metric value at a millisecond timestamp.
type Sample struct {
	TS    int64
	Value float64
}

// ExemplarSet groups exemplars with their series labels.
type ExemplarSet struct {
	SeriesLabels utm.Labels
	Exemplars    []utm.Exemplar
}

// Direction controls log result ordering.
type Direction uint8

const (
	// Backward orders logs from newest to oldest.
	Backward Direction = iota
	// Forward orders logs from oldest to newest.
	Forward
)

// LineFilterOp identifies a log line filter operation.
type LineFilterOp uint8

const (
	// LineContains requires a literal substring.
	LineContains LineFilterOp = iota
	// LineNotContains rejects a literal substring.
	LineNotContains
	// LineMatch requires a regular-expression match.
	LineMatch
	// LineNotMatch rejects a regular-expression match.
	LineNotMatch
)

// LineFilter filters a raw log line.
type LineFilter struct {
	Op          LineFilterOp
	Value       string
	Compiled    *regexp.Regexp
	LiteralHint string
}

// Matches reports whether line satisfies the filter.
func (f LineFilter) Matches(line string) bool {
	switch f.Op {
	case LineContains:
		return strings.Contains(line, f.Value)
	case LineNotContains:
		return !strings.Contains(line, f.Value)
	case LineMatch:
		return f.Compiled != nil && f.Compiled.MatchString(line)
	case LineNotMatch:
		return f.Compiled != nil && !f.Compiled.MatchString(line)
	default:
		return false
	}
}

// ParseKind identifies a structured log parsing stage.
type ParseKind uint8

const (
	// ParseJSON parses a log line as JSON.
	ParseJSON ParseKind = iota
	// ParseLogfmt parses a log line as logfmt.
	ParseLogfmt
)

// ParseStage requests structured field extraction from a log line.
type ParseStage struct {
	Kind ParseKind
}

// CompareOp identifies a parsed-field comparison.
type CompareOp uint8

const (
	// CmpEq compares strings for equality.
	CmpEq CompareOp = iota
	// CmpNe compares strings for inequality.
	CmpNe
	// CmpRe matches a regular expression.
	CmpRe
	// CmpNotRe negates a regular-expression match.
	CmpNotRe
	// CmpGt performs a numeric greater-than comparison.
	CmpGt
	// CmpGte performs a numeric greater-than-or-equal comparison.
	CmpGte
	// CmpLt performs a numeric less-than comparison.
	CmpLt
	// CmpLte performs a numeric less-than-or-equal comparison.
	CmpLte
)

// FieldFilter filters a parsed log field.
type FieldFilter struct {
	Field    string
	Op       CompareOp
	Value    string
	Num      *float64
	Compiled *regexp.Regexp
}

// LogAggregation describes a LogQL range and optional vector aggregation.
type LogAggregation struct {
	RangeFunc string
	Window    time.Duration
	Step      time.Duration
	VectorOp  string
	By        []string
	Without   []string
	K         int
}

// LogQuery is the backend-neutral log query representation.
type LogQuery struct {
	Tenant    string
	Selectors []Matcher
	Start     int64
	End       int64
	Filters   []LineFilter
	Stages    []ParseStage
	Fields    []FieldFilter
	Direction Direction
	Limit     int
	Agg       *LogAggregation
}

// PushdownPlan reports which parts of q can be evaluated by a backend.
func (q LogQuery) PushdownPlan(caps LogPushdown, agg bool) PushdownPlan {
	plan := PushdownPlan{
		Selectors: true,
		TimeRange: true,
		Filters:   make([]bool, len(q.Filters)),
		Stages:    true,
		Fields:    len(q.Fields) == 0,
		Agg:       q.Agg == nil || agg,
	}

	filtersPushed := true
	for i, filter := range q.Filters {
		supported := false
		switch filter.Op {
		case LineContains, LineNotContains:
			supported = caps.Substring
		case LineMatch, LineNotMatch:
			supported = caps.Regex
		}
		plan.Filters[i] = supported
		filtersPushed = filtersPushed && supported
	}

	for _, stage := range q.Stages {
		switch stage.Kind {
		case ParseJSON:
			plan.Stages = plan.Stages && caps.ParsedFieldJSON
		case ParseLogfmt:
			plan.Stages = plan.Stages && caps.ParsedFieldLogfmt
		default:
			plan.Stages = false
		}
	}
	if len(q.Fields) > 0 {
		plan.Fields = len(q.Stages) > 0 && plan.Stages
	}

	allBeforeLimit := filtersPushed && plan.Stages && plan.Fields && plan.Agg
	plan.Limit = q.Limit <= 0 || caps.Limit && allBeforeLimit
	return plan
}

// PushdownPlan identifies the query operations evaluated by a backend.
type PushdownPlan struct {
	Selectors bool
	TimeRange bool
	Filters   []bool
	Stages    bool
	Fields    bool
	Agg       bool
	Limit     bool
}

// AllPushed reports whether every query operation is pushed down.
func (p PushdownPlan) AllPushed() bool {
	if !p.Selectors || !p.TimeRange || !p.Stages || !p.Fields || !p.Agg || !p.Limit {
		return false
	}
	for _, pushed := range p.Filters {
		if !pushed {
			return false
		}
	}
	return true
}

// LogResult contains either raw log streams or an aggregate matrix.
type LogResult struct {
	Streams []LogStreamData
	Matrix  []SeriesData
	Stats   LogStats
}

// LogStreamData is one labeled stream of log records.
type LogStreamData struct {
	Labels  utm.Labels
	Entries []utm.LogRecord
}

// LogStats reports estimated log query execution work.
type LogStats struct {
	TotalBytesProcessed int64
	TotalLinesProcessed int64
	ExecTimeSeconds     float64
	Streams             int64
	Chunks              int64
}

// TraceQuery selects trace IDs in a nanosecond time range.
type TraceQuery struct {
	Tenant      string
	Service     string
	Operation   string
	SpanKind    string
	Tags        map[string]string
	MinDuration time.Duration
	MaxDuration time.Duration
	Start       int64
	End         int64
	Limit       int
}

// TraceIDWithTime identifies a trace and its nanosecond time range.
type TraceIDWithTime struct {
	TraceID   string
	StartNano int64
	EndNano   int64
}

// Operation identifies a service operation and span kind.
type Operation struct {
	Name     string
	SpanKind string
}

// Dependency is an aggregated directed service dependency.
type Dependency struct {
	Parent    string
	Child     string
	CallCount uint64
	ErrCount  uint64
}

// REDQuery requests rate, error, and duration data for services.
type REDQuery struct {
	Tenant    string
	Services  []string
	Operation string
	Start     int64
	End       int64
	Step      time.Duration
	Quantiles []float64
}

// REDPoint contains aggregated rate, error, and duration values.
type REDPoint struct {
	Service   string
	Operation string
	TS        int64
	Requests  uint64
	Errors    uint64
	SumNano   uint64
	Latency   map[float64]float64
}
