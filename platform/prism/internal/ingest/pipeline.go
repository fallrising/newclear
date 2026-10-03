// Package ingest connects bounded admission, normalization, tenant limits and
// asynchronous SPI writes. It does not own the supplied storage backend.
package ingest

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest/batcher"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// BatchOptions are package options, not daemon configuration. Each signal has
// three independent queues. Workers is the total worker count for that signal.
type BatchOptions struct {
	MaxItems, MaxBytes, QueueDepth, Workers int
	FlushInterval, WriteTimeout             time.Duration
}

// Options are immutable after New. Now must be bounded, thread-safe and nonblocking.
// Tenants overrides are fixed at construction; unknown tenants use Limits.
type Options struct {
	MaxTenants, MaxInputBytes, MaxElements int
	Metrics, Logs, Traces                  BatchOptions
	Normalize                              normalize.Options
	Limits                                 limits.Options
	Tenants                                map[string]limits.Overrides
	Now                                    func() time.Time
}

// DefaultOptions returns finite package defaults. Resource sizing is deployment-specific.
func DefaultOptions() Options {
	batch := BatchOptions{MaxItems: 5000, MaxBytes: 8 << 20, QueueDepth: 64, Workers: 2, FlushInterval: time.Second, WriteTimeout: 5 * time.Second}
	metrics := batch
	metrics.MaxItems = 10000
	return Options{MaxTenants: 16, MaxInputBytes: 16 << 20, MaxElements: 100000, Metrics: metrics, Logs: batch, Traces: batch, Now: time.Now}
}

// WithTenant records the tenant authenticated by the caller. It does not authenticate.
func WithTenant(ctx context.Context, tenant string) context.Context {
	return context.WithValue(ctx, tenantKey{}, tenant)
}

type tenantKey struct{}

func TenantFromContext(ctx context.Context) string {
	tenant, _ := ctx.Value(tenantKey{}).(string)
	return tenant
}

// Result counts output records; metrics may expand one input point into many.
// Normalize diagnostics are deliberately separate from registered telemetry domains.
type Result struct {
	Accepted, Rejected int
	// OTLPRejected counts original data points, log records or spans; zero for UTM submissions.
	OTLPRejected                          int
	MetadataAccepted, MetadataUnsupported int
	RetryAfter                            time.Duration
	InternalFailures                      int
	Normalize                             normalize.Report
	Limits                                limits.Report
}

// Stats never retains arbitrary tenant, metric, label or error strings.
type Stats struct {
	Tenants               int
	Metrics, Logs, Traces batcher.Stats
	MetadataUnsupported   uint64
}
type tenantState struct {
	normalizer *normalize.Normalizer
	limiter    *limits.Limiter
}
type metricItem struct {
	Point    *utm.MetricPoint
	Metadata *utm.MetricMetadata
}

// Pipeline's mu protects tenant state and serializes bounded admission CPU work.
// No I/O occurs under mu. Contenders receive immediate classified throttling.
type Pipeline struct {
	mu                sync.Mutex
	options           Options
	ctx               context.Context
	tenants           map[string]*tenantState
	metrics           *batcher.Batcher[metricItem]
	logs              *batcher.Batcher[utm.LogRecord]
	traces            *batcher.Batcher[utm.Span]
	closed            atomic.Bool
	unsupported       atomic.Uint64
	metadataSupported bool
	tenantLimits      map[string]limits.Options
}

func ingestError(class spi.ErrClass, message string) error {
	return spi.Wrap(class, "", "ingest", fmt.Errorf("%s", message))
}

// New starts finite batch workers. Close is mandatory even after parent cancellation.
func New(ctx context.Context, backend spi.Backend, options Options) (*Pipeline, error) {
	if backend == nil || options.MaxTenants <= 0 || options.MaxTenants > 1024 || options.MaxInputBytes <= 0 || options.MaxInputBytes > 1<<30 || options.MaxElements <= 0 || options.MaxElements > 1000000 || len(options.Tenants) > options.MaxTenants {
		return nil, ingestError(spi.ErrBadRequest, "invalid pipeline capacities")
	}
	if err := ctx.Err(); err != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "ingest.New", err)
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	options.Normalize.Now = options.Now
	options.Normalize.MaxRecords = options.MaxElements
	options.Normalize.LogLabelAllowlist = append([]string(nil), options.Normalize.LogLabelAllowlist...)
	var err error
	baseLimits := options.Limits
	options.Limits, err = freezeLimits(baseLimits, options.MaxElements, options.Now)
	if err != nil {
		return nil, err
	}
	tenantOptions := make(map[string]limits.Options, len(options.Tenants))
	for tenant, configuration := range options.Tenants {
		if tenant == "" || len(tenant) > 2048 {
			return nil, ingestError(spi.ErrBadRequest, "invalid configured tenant")
		}
		tenantConfiguration := baseLimits
		tenantConfiguration.Tenant = configuration
		tenantConfiguration, err = freezeLimits(tenantConfiguration, options.MaxElements, options.Now)
		if err != nil {
			return nil, err
		}
		tenantOptions[strings.Clone(tenant)] = tenantConfiguration
	}
	options.Tenants = nil
	p := &Pipeline{options: options, ctx: ctx, tenants: make(map[string]*tenantState), tenantLimits: tenantOptions}
	// Access stores only through SPI; nil stores are observable unsupported signals.
	if store := backend.Metrics(); store != nil {
		metadata, _ := store.(spi.MetadataStore)
		p.metrics, err = batcher.New(ctx, batchOptions(options.Metrics, options.MaxTenants, payloadSize[metricItem], func(metricItem) batcher.Priority { return batcher.High }, cloneMetricItem, func(ctx context.Context, tenant string, input []metricItem) error {
			points := make([]utm.MetricPoint, 0, len(input))
			md := make([]utm.MetricMetadata, 0, len(input))
			for _, item := range input {
				if item.Point != nil {
					points = append(points, *item.Point)
				}
				if item.Metadata != nil {
					md = append(md, *item.Metadata)
				}
			}
			if len(points) > 0 {
				if err := store.Write(ctx, points); err != nil {
					return err
				}
			}
			if len(md) > 0 && metadata != nil {
				return metadata.UpsertMetadata(ctx, tenant, md)
			}
			return nil
		}))
		if err != nil {
			return nil, err
		}
	}
	if store := backend.Logs(); store != nil {
		p.logs, err = batcher.New(ctx, batchOptions(options.Logs, options.MaxTenants, payloadSize[utm.LogRecord], logPriority, cloneLog, func(ctx context.Context, _ string, input []utm.LogRecord) error { return store.Write(ctx, input) }))
		if err != nil {
			p.cleanup(ctx)
			return nil, err
		}
	}
	if store := backend.Traces(); store != nil {
		p.traces, err = batcher.New(ctx, batchOptions(options.Traces, options.MaxTenants, payloadSize[utm.Span], spanPriority, cloneSpan, func(ctx context.Context, _ string, input []utm.Span) error { return store.Write(ctx, input) }))
		if err != nil {
			p.cleanup(ctx)
			return nil, err
		}
	}
	// Whether metadata is supported is recorded without retaining the backend.
	p.metadataSupported = false
	if store := backend.Metrics(); store != nil {
		_, p.metadataSupported = store.(spi.MetadataStore)
	}
	return p, nil
}
func batchOptions[T any](o BatchOptions, tenants int, size func(T) int, priority func(T) batcher.Priority, clone func(T) T, write func(context.Context, string, []T) error) batcher.Options[T] {
	return batcher.Options[T]{MaxItems: o.MaxItems, MaxBytes: o.MaxBytes, QueueDepth: o.QueueDepth, Workers: o.Workers, MaxTenants: tenants, FlushInterval: o.FlushInterval, WriteTimeout: o.WriteTimeout, Size: size, Priority: priority, Clone: clone, Write: write}
}
func logPriority(record utm.LogRecord) batcher.Priority {
	switch record.Severity {
	case utm.SevInfo, utm.SevWarn:
		return batcher.Normal
	case utm.SevError, utm.SevFatal:
		return batcher.High
	default:
		return batcher.Low
	}
}
func spanPriority(span utm.Span) batcher.Priority {
	if span.Kind == utm.KindInternal {
		return batcher.Normal
	}
	return batcher.High
}
func cloneMetricItem(input metricItem) metricItem {
	if input.Point != nil {
		point := cloneMetric(*input.Point)
		input.Point = &point
	}
	if input.Metadata != nil {
		md := *input.Metadata
		md.Metric = strings.Clone(md.Metric)
		md.Help = strings.Clone(md.Help)
		md.Unit = strings.Clone(md.Unit)
		input.Metadata = &md
	}
	return input
}
func (p *Pipeline) begin(ctx context.Context, n int64) (string, *tenantState, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", nil, false, spi.Wrap(spi.ErrTimeout, "", "ingest", err)
	}
	tenant := TenantFromContext(ctx)
	if tenant == "" || len(tenant) > 2048 {
		return "", nil, false, ingestError(spi.ErrBadRequest, "trusted tenant required")
	}
	if n < 0 {
		return "", nil, false, ingestError(spi.ErrBadRequest, "negative decompressed byte count")
	}
	if n > int64(p.options.MaxInputBytes) {
		return "", nil, false, ingestError(spi.ErrTooLarge, "decompressed request too large")
	}
	if !p.mu.TryLock() {
		return "", nil, false, ingestError(spi.ErrThrottled, "admission busy")
	}
	if p.closed.Load() || p.ctx.Err() != nil {
		p.mu.Unlock()
		return "", nil, false, ingestError(spi.ErrUnavailable, "pipeline closed")
	}
	if state := p.tenants[tenant]; state != nil {
		return tenant, state, false, nil
	}
	if len(p.tenants) >= p.options.MaxTenants {
		p.mu.Unlock()
		return "", nil, false, ingestError(spi.ErrThrottled, "tenant registry full")
	}
	o := p.options.Limits
	if override, ok := p.tenantLimits[tenant]; ok {
		o = override
	}
	limiter, err := limits.New(tenant, o)
	if err != nil {
		p.mu.Unlock()
		return "", nil, false, err
	}
	normalization := p.options.Normalize
	normalization.Tenant = strings.Clone(tenant)
	normalization.MaxAttrsPerRecord = limiter.Settings().MaxAttrsPerRecord
	state := &tenantState{normalizer: normalize.New(p.ctx, normalization), limiter: limiter} //nolint:contextcheck // Normalizer belongs to pipeline lifecycle, not one request.
	return tenant, state, true, nil
}
func (p *Pipeline) end(tenant string, state *tenantState, fresh bool, committed bool) {
	if fresh {
		if committed {
			p.tenants[strings.Clone(tenant)] = state
		} else {
			state.normalizer.Close()
		}
	}
	p.mu.Unlock()
}
func (p *Pipeline) checkPayload(input any) error {
	f := footprint{maxBytes: p.options.MaxInputBytes, maxElements: p.options.MaxElements}
	if !f.value(reflect.ValueOf(input)) {
		return ingestError(spi.ErrTooLarge, "request owned payload exceeds byte or element capacity")
	}
	return nil
}
func metricItems(batch normalize.MetricBatch, metadata bool) []metricItem {
	out := make([]metricItem, 0, len(batch.Points)+len(batch.Metadata))
	for i := range batch.Points {
		out = append(out, metricItem{Point: &batch.Points[i]})
	}
	if metadata {
		for i := range batch.Metadata {
			out = append(out, metricItem{Metadata: &batch.Metadata[i]})
		}
	}
	return out
}

// reservePayload adds a fixed per-item allowance for identity and mutation
// markers before projecting queues. It does not modify the caller's payload.
func reservePayload[T any](ctx context.Context, b *batcher.Batcher[T], tenant string, input []T, size func(T) int, overhead int) (*batcher.Reservation[T], error) {
	return b.ReserveSized(ctx, tenant, input, func(item T) int { return size(item) + overhead })
}

// SubmitMetrics takes already-normalized UTM (remote_write and other adapters
// normalize first). Metadata participates once in the same high-priority lane.
func (p *Pipeline) SubmitMetrics(ctx context.Context, batch normalize.MetricBatch, n int64) (result Result, err error) {
	return p.submitMetrics(ctx, batch, pmetric.Metrics{}, false, n)
}
func (p *Pipeline) SubmitOTLPMetrics(ctx context.Context, input pmetric.Metrics, n int64) (Result, error) {
	return p.submitMetrics(ctx, normalize.MetricBatch{}, input, true, n)
}
func (p *Pipeline) submitMetrics(ctx context.Context, batch normalize.MetricBatch, input pmetric.Metrics, otlp bool, n int64) (result Result, err error) {
	if p.metrics == nil {
		return result, ingestError(spi.ErrUnsupported, "metrics unsupported")
	}
	tenant, state, fresh, err := p.begin(ctx, n)
	if err != nil {
		return result, err
	}
	committed := false
	defer func() { p.end(tenant, state, fresh, committed) }()
	now := p.options.Now()
	if otlp {
		if err := p.checkMetrics(ctx, input); err != nil {
			return result, err
		}
		batch, result.Normalize, err = state.normalizer.PreviewMetrics(ctx, input, now)
		if err != nil {
			return result, err
		}
	}
	if err := p.checkPayload(batch); err != nil {
		return result, err
	}
	items := metricItems(batch, p.metadataSupported)
	reservation, err := reservePayload(ctx, p.metrics, tenant, items, payloadSize[metricItem], 128+len(tenant)*2+maxMetricName(batch))
	if err != nil {
		return result, err
	}
	defer reservation.Abort()
	result.Limits, result.RetryAfter, err = state.limiter.AllowBytes(ctx, n)
	if err != nil {
		return result, err
	}
	committed = true
	detached := context.WithoutCancel(ctx)
	if otlp {
		var stageErr error
		batch, result.Normalize, stageErr = state.normalizer.NormalizeMetrics(detached, input, now)
		if stageErr != nil {
			result.InternalFailures++
		}
	}
	points, accepted, report, stageErr := state.limiter.MetricsWithAcceptance(detached, batch.Points)
	if stageErr != nil {
		result.InternalFailures++
	}
	result.Limits = report
	result.Accepted = len(points)
	result.Rejected = len(batch.Points) - len(points)
	if otlp {
		result.OTLPRejected = originalMetricRejections(batch.Origins, accepted)
	}
	if p.metadataSupported {
		result.MetadataAccepted = len(batch.Metadata)
	} else {
		result.MetadataUnsupported = len(batch.Metadata)
		p.unsupported.Add(uint64(len(batch.Metadata)))
	}
	batch.Points = points
	// Counts and byte sums only shrink within the reserved per-priority bound.
	err = reservation.Commit(metricItems(batch, p.metadataSupported))
	if err != nil {
		result.Rejected += result.Accepted
		result.Accepted = 0
		result.MetadataAccepted = 0
		if otlp {
			result.OTLPRejected = originalMetricRejections(batch.Origins, nil)
		}
		result.InternalFailures++
	}
	return result, nil
}
func maxMetricName(batch normalize.MetricBatch) int {
	maxName := 0
	for _, point := range batch.Points {
		maxName = max(maxName, len(point.Name))
	}
	return maxName
}
func (p *Pipeline) SubmitLogs(ctx context.Context, input []utm.LogRecord, n int64) (Result, error) {
	return p.submitLogs(ctx, input, plog.Logs{}, false, n)
}
func (p *Pipeline) SubmitOTLPLogs(ctx context.Context, input plog.Logs, n int64) (Result, error) {
	return p.submitLogs(ctx, nil, input, true, n)
}
func (p *Pipeline) submitLogs(ctx context.Context, input []utm.LogRecord, otlp plog.Logs, isOTLP bool, n int64) (result Result, err error) {
	if p.logs == nil {
		return result, ingestError(spi.ErrUnsupported, "logs unsupported")
	}
	tenant, state, fresh, err := p.begin(ctx, n)
	if err != nil {
		return result, err
	}
	committed := false
	defer func() { p.end(tenant, state, fresh, committed) }()
	if isOTLP {
		if err := p.checkLogs(ctx, otlp); err != nil {
			return result, err
		}
		input, result.Normalize, err = state.normalizer.NormalizeLogs(ctx, otlp, p.options.Now())
		if err != nil {
			return result, err
		}
	}
	if err := p.checkPayload(input); err != nil {
		return result, err
	}
	// SPI requires nonnil Resource, and identity is always trusted.
	input = append([]utm.LogRecord(nil), input...)
	for i := range input {
		input[i] = cloneLog(input[i])
		if input[i].Resource == nil {
			input[i].Resource = &utm.Resource{Tenant: tenant}
		}
	}
	reservation, err := reservePayload(ctx, p.logs, tenant, input, payloadSize[utm.LogRecord], 128+len(tenant))
	if err != nil {
		return result, err
	}
	defer reservation.Abort()
	result.Limits, result.RetryAfter, err = state.limiter.AllowBytes(ctx, n)
	if err != nil {
		return result, err
	}
	committed = true
	output, report, stageErr := state.limiter.Logs(context.WithoutCancel(ctx), input)
	if stageErr != nil {
		result.InternalFailures++
	}
	result.Limits = report
	result.Accepted = len(output)
	result.Rejected = len(input) - len(output)
	if isOTLP {
		result.OTLPRejected = otlp.LogRecordCount() - len(output)
	}
	if err := reservation.Commit(output); err != nil {
		result.Rejected += result.Accepted
		result.Accepted = 0
		if isOTLP {
			result.OTLPRejected = otlp.LogRecordCount()
		}
		result.InternalFailures++
	}
	return result, nil
}
func (p *Pipeline) SubmitSpans(ctx context.Context, input []utm.Span, n int64) (Result, error) {
	return p.submitSpans(ctx, input, ptrace.Traces{}, false, n)
}
func (p *Pipeline) SubmitOTLPTraces(ctx context.Context, input ptrace.Traces, n int64) (Result, error) {
	return p.submitSpans(ctx, nil, input, true, n)
}
func (p *Pipeline) submitSpans(ctx context.Context, input []utm.Span, otlp ptrace.Traces, isOTLP bool, n int64) (result Result, err error) {
	if p.traces == nil {
		return result, ingestError(spi.ErrUnsupported, "traces unsupported")
	}
	tenant, state, fresh, err := p.begin(ctx, n)
	if err != nil {
		return result, err
	}
	committed := false
	defer func() { p.end(tenant, state, fresh, committed) }()
	if isOTLP {
		if err := p.checkTraces(ctx, otlp); err != nil {
			return result, err
		}
		input, result.Normalize, err = state.normalizer.NormalizeTraces(ctx, otlp, p.options.Now())
		if err != nil {
			return result, err
		}
	}
	if err := p.checkPayload(input); err != nil {
		return result, err
	}
	input = append([]utm.Span(nil), input...)
	for i := range input {
		if input[i].Resource == nil {
			input[i].Resource = &utm.Resource{Tenant: tenant}
		}
	}
	reservation, err := reservePayload(ctx, p.traces, tenant, input, payloadSize[utm.Span], 128+len(tenant))
	if err != nil {
		return result, err
	}
	defer reservation.Abort()
	result.Limits, result.RetryAfter, err = state.limiter.AllowBytes(ctx, n)
	if err != nil {
		return result, err
	}
	committed = true
	output, report, stageErr := state.limiter.Spans(context.WithoutCancel(ctx), input)
	if stageErr != nil {
		result.InternalFailures++
	}
	result.Limits = report
	result.Accepted = len(output)
	result.Rejected = len(input) - len(output)
	if isOTLP {
		result.OTLPRejected = otlp.SpanCount() - len(output)
	}
	if err := reservation.Commit(output); err != nil {
		result.Rejected += result.Accepted
		result.Accepted = 0
		if isOTLP {
			result.OTLPRejected = otlp.SpanCount()
		}
		result.InternalFailures++
	}
	return result, nil
}
func (p *Pipeline) Snapshot() Stats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := Stats{Tenants: len(p.tenants), MetadataUnsupported: p.unsupported.Load()}
	if p.metrics != nil {
		s.Metrics = p.metrics.Snapshot()
	}
	if p.logs != nil {
		s.Logs = p.logs.Snapshot()
	}
	if p.traces != nil {
		s.Traces = p.traces.Snapshot()
	}
	return s
}
func (p *Pipeline) cleanup(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	if p.metrics != nil {
		_ = p.metrics.Close(ctx)
	}
	if p.logs != nil {
		_ = p.logs.Close(ctx)
	}
	if p.traces != nil {
		_ = p.traces.Close(ctx)
	}
}

// Close rejects new admission, waits for bounded committed CPU work, then drains
// with one shared deadline. Context-compliant backend writes are required.
func (p *Pipeline) Close(ctx context.Context) error {
	p.closed.Store(true)
	p.mu.Lock()
	defer p.mu.Unlock()
	var errs []error
	if p.metrics != nil {
		if err := p.metrics.Close(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if p.logs != nil {
		if err := p.logs.Close(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if p.traces != nil {
		if err := p.traces.Close(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	for _, state := range p.tenants {
		state.normalizer.Close()
	}
	clear(p.tenants)
	return errors.Join(errs...)
}

func originalMetricRejections(origins []normalize.MetricOrigin, accepted []bool) int {
	rejected := 0
	for _, origin := range origins {
		lost := origin.Rejected
		for i := origin.Start; i < origin.End && !lost; i++ {
			lost = i >= len(accepted) || !accepted[i]
		}
		if lost {
			rejected++
		}
	}
	return rejected
}
