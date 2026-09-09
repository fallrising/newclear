package normalize

import (
	"context"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize/deltaconv"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const (
	defaultMaxAttrs           = 128
	defaultMaxRecords         = 100_000
	defaultMaxDeltaSeries     = 100_000
	defaultDeltaStateTTL      = 5 * time.Minute
	defaultDeltaSweepInterval = 30 * time.Second
	defaultMaxPast            = time.Hour
	defaultMaxFuture          = 5 * time.Minute
)

// ClockSkewPolicy controls how timestamps outside the accepted time window are
// handled.
type ClockSkewPolicy string

const (
	// ClockSkewClamp clamps timestamps to the nearest accepted boundary.
	ClockSkewClamp ClockSkewPolicy = "clamp"
	// ClockSkewDrop rejects records whose timestamps are outside the window.
	ClockSkewDrop ClockSkewPolicy = "drop"
)

var defaultLogLabelAllowlist = []string{
	"level",
	"service",
	"host",
	"env",
	"cluster",
	"unit",
	"container",
	"namespace",
	"pod",
	"job",
	"log_type",
	"source",
}

// Options controls deterministic normalization limits and timestamp handling.
// Zero values select the SDD defaults.
type Options struct {
	Tenant             string
	Now                func() time.Time
	ClockSkewPolicy    ClockSkewPolicy
	MaxPast            time.Duration
	MaxFuture          time.Duration
	MaxAttrsPerRecord  int
	MaxRecords         int
	LogLabelAllowlist  []string
	DeltaStateTTL      time.Duration
	DeltaSweepInterval time.Duration
	MaxDeltaSeries     int
}

func (o Options) withDefaults() Options {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.ClockSkewPolicy == "" {
		o.ClockSkewPolicy = ClockSkewClamp
	}
	if o.MaxPast <= 0 {
		o.MaxPast = defaultMaxPast
	}
	if o.MaxFuture <= 0 {
		o.MaxFuture = defaultMaxFuture
	}
	if o.MaxAttrsPerRecord <= 0 {
		o.MaxAttrsPerRecord = defaultMaxAttrs
	}
	if o.MaxRecords <= 0 {
		o.MaxRecords = defaultMaxRecords
	}
	if o.LogLabelAllowlist == nil {
		o.LogLabelAllowlist = defaultLogLabelAllowlist
	}
	if o.DeltaStateTTL <= 0 {
		o.DeltaStateTTL = defaultDeltaStateTTL
	}
	if o.DeltaSweepInterval <= 0 {
		o.DeltaSweepInterval = defaultDeltaSweepInterval
	}
	if o.MaxDeltaSeries <= 0 {
		o.MaxDeltaSeries = defaultMaxDeltaSeries
	}
	o.LogLabelAllowlist = append([]string(nil), o.LogLabelAllowlist...)
	return o
}

// Report describes observable normalization actions. Callers use these values
// to populate the self-telemetry counters registered by internal/telemetry.
type Report struct {
	Normalized      map[string]uint64 `json:"normalized,omitempty"`
	Rejected        map[string]uint64 `json:"rejected,omitempty"`
	Warnings        map[string]uint64 `json:"warnings,omitempty"`
	UpstreamDropped uint64            `json:"upstream_dropped,omitempty"`
}

func newReport() Report {
	return Report{
		Normalized: make(map[string]uint64),
		Rejected:   make(map[string]uint64),
		Warnings:   make(map[string]uint64),
	}
}

func (r *Report) normalized(action string) { r.Normalized[action]++ }
func (r *Report) rejected(reason string)   { r.Rejected[reason]++ }
func (r *Report) warning(reason string)    { r.Warnings[reason]++ }

// MetricBatch contains normalized samples and their family metadata.
type MetricBatch struct {
	Points   []utm.MetricPoint    `json:"points"`
	Metadata []utm.MetricMetadata `json:"metadata"`
}

// Normalizer owns the bounded delta-to-cumulative state used by OTLP metrics.
type Normalizer struct {
	options      Options
	delta        *deltaconv.Converter
	logAllowlist map[string]struct{}
}

// New constructs a normalizer. Close must be called to stop the delta-state
// cleanup loop.
func New(ctx context.Context, options Options) *Normalizer {
	options = options.withDefaults()
	delta := deltaconv.New(ctx, deltaconv.Options{
		TTL:           options.DeltaStateTTL,
		SweepInterval: options.DeltaSweepInterval,
		MaxSeries:     options.MaxDeltaSeries,
		Now:           options.Now,
	})

	allowlist := make(map[string]struct{}, len(options.LogLabelAllowlist))
	for _, name := range options.LogLabelAllowlist {
		allowlist[name] = struct{}{}
	}
	return &Normalizer{
		options:      options,
		delta:        delta,
		logAllowlist: allowlist,
	}
}

// Close stops the delta-state cleanup loop. It is safe to call more than once.
func (n *Normalizer) Close() {
	if n != nil {
		n.delta.Close()
	}
}
