package spi

import (
	"fmt"
	"slices"
	"time"
)

// Signal identifies a telemetry signal supported by a backend.
type Signal string

const (
	// SignalMetrics identifies metric storage.
	SignalMetrics Signal = "metrics"
	// SignalLogs identifies log storage.
	SignalLogs Signal = "logs"
	// SignalTraces identifies trace storage.
	SignalTraces Signal = "traces"
)

// Capabilities declares the exact features implemented by a backend.
type Capabilities struct {
	Driver  string
	Version string
	Signals []Signal

	Metrics MetricCaps
	Logs    LogCaps
	Traces  TraceCaps

	MultiTenant      bool
	OutOfOrderWindow time.Duration
	MaxLookback      time.Duration
	Retention        RetentionCaps
}

// MetricCaps declares optional metric storage features.
type MetricCaps struct {
	NativePromQL     bool
	Exemplars        bool
	NativeHistograms bool
	Downsampling     bool
	DeleteSeries     bool
	Metadata         bool
}

// LogCaps declares optional log storage and query features.
type LogCaps struct {
	NativeLogQuery bool
	Pushdown       LogPushdown
	Aggregation    bool
	LiveTail       bool
	Stats          bool
}

// LogPushdown declares which LogQuery operations a backend can evaluate.
type LogPushdown struct {
	Substring         bool
	Regex             bool
	ParsedFieldJSON   bool
	ParsedFieldLogfmt bool
	Limit             bool
	Sort              bool
}

// TraceCaps declares optional trace storage features.
type TraceCaps struct {
	TagFilter      bool
	DurationFilter bool
	SpanKindFilter bool
	Dependencies   bool
	RED            bool
}

// RetentionCaps declares how a backend enforces retention.
type RetentionCaps struct {
	PerSignal bool
	PerTenant bool
	Enforced  bool
}

// Has reports whether the backend declares support for s.
func (c Capabilities) Has(s Signal) bool {
	return slices.Contains(c.Signals, s)
}

// Validate checks that capability declarations are internally consistent.
func (c Capabilities) Validate() error {
	if len(c.Signals) == 0 {
		return fmt.Errorf("spi: capabilities signals must not be empty")
	}
	if c.metricFeaturesEnabled() && !c.Has(SignalMetrics) {
		return fmt.Errorf("spi: metric capabilities require the metrics signal")
	}
	if c.logFeaturesEnabled() && !c.Has(SignalLogs) {
		return fmt.Errorf("spi: log capabilities require the logs signal")
	}
	if c.traceFeaturesEnabled() && !c.Has(SignalTraces) {
		return fmt.Errorf("spi: trace capabilities require the traces signal")
	}
	if c.Logs.NativeLogQuery && !c.Logs.Pushdown.all() {
		return fmt.Errorf("spi: native log queries require all log pushdown capabilities")
	}
	if c.Logs.Pushdown.Limit && !c.Logs.Pushdown.allFilters() {
		return fmt.Errorf("spi: log limit pushdown requires all filter pushdown capabilities")
	}
	if c.Traces.RED && !c.Has(SignalTraces) {
		return fmt.Errorf("spi: trace RED capability requires the traces signal")
	}
	return nil
}

func (c Capabilities) metricFeaturesEnabled() bool {
	return c.Metrics.NativePromQL || c.Metrics.Exemplars || c.Metrics.NativeHistograms ||
		c.Metrics.Downsampling || c.Metrics.DeleteSeries || c.Metrics.Metadata
}

func (c Capabilities) logFeaturesEnabled() bool {
	return c.Logs.NativeLogQuery || c.Logs.Pushdown.any() || c.Logs.Aggregation ||
		c.Logs.LiveTail || c.Logs.Stats
}

func (c Capabilities) traceFeaturesEnabled() bool {
	return c.Traces.TagFilter || c.Traces.DurationFilter || c.Traces.SpanKindFilter ||
		c.Traces.Dependencies || c.Traces.RED
}

func (p LogPushdown) any() bool {
	return p.Substring || p.Regex || p.ParsedFieldJSON || p.ParsedFieldLogfmt || p.Limit || p.Sort
}

func (p LogPushdown) all() bool {
	return p.allFilters() && p.Limit && p.Sort
}

func (p LogPushdown) allFilters() bool {
	return p.Substring && p.Regex && p.ParsedFieldJSON && p.ParsedFieldLogfmt
}
