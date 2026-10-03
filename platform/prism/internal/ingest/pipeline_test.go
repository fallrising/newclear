package ingest

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/batcher"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

var received = time.Unix(1700000000, 0).UTC()

func testOptions() Options {
	o := DefaultOptions()
	o.Now = func() time.Time { return received }
	o.Metrics.FlushInterval = time.Hour
	o.Logs.FlushInterval = time.Hour
	o.Traces.FlushInterval = time.Hour
	o.MaxTenants = 2
	return o
}
func memoryBackend(t *testing.T) spi.Backend {
	t.Helper()
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	return backend
}
func pipeline(t *testing.T, backend spi.Backend, o Options) *Pipeline {
	t.Helper()
	p, err := New(context.Background(), backend, o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := p.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	return p
}
func trusted(tenant string) context.Context { return WithTenant(context.Background(), tenant) }
func metric(name string) utm.MetricPoint {
	return utm.MetricPoint{Name: name, Type: utm.TypeGauge, TS: utm.TimeToMilli(received), Value: 3}
}
func logRecord() utm.LogRecord {
	return utm.LogRecord{TS: utm.TimeToNano(received), Body: "original", Severity: utm.SevInfo, Labels: labels.FromStrings("service", "api"), Attrs: map[string]string{"attribute": "original"}}
}
func spanRecord() utm.Span {
	return utm.Span{TraceID: "00000000000000000000000000000001", SpanID: "0000000000000001", Name: "span", StartNano: utm.TimeToNano(received), EndNano: utm.TimeToNano(received), Kind: utm.KindServer, Events: []utm.SpanEvent{{Name: "event", Attrs: map[string]string{"key": "original"}}}, Links: []utm.SpanLink{{TraceID: "00000000000000000000000000000002", SpanID: "0000000000000002", Attrs: map[string]string{"key": "original"}}}}
}

// Only a precommit, exact admission-busy diagnostic is retried. Quota, queue,
// registry, cancellation and oversize errors remain observable on the first capacity decision.
func submitReady(call func() (Result, error)) (Result, error) {
	deadline := time.Now().Add(time.Second)
	for {
		result, err := call()
		var classified *spi.Error
		busy := errors.As(err, &classified) && classified.Class == spi.ErrThrottled && classified.Err.Error() == "admission busy"
		if !busy || time.Now().After(deadline) {
			return result, err
		}
		time.Sleep(time.Millisecond)
	}
}
func throttledBy(err error, reason string) bool {
	var classified *spi.Error
	return errors.As(err, &classified) && classified.Class == spi.ErrThrottled && classified.Err.Error() == reason
}
func closePipeline(t *testing.T, p *Pipeline) {
	t.Helper()
	if err := p.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func metricValues(t *testing.T, backend spi.Backend, tenant, name string) []float64 {
	t.Helper()
	set, err := backend.Metrics().Select(context.Background(), spi.SeriesQuery{Tenant: tenant, Matchers: []spi.Matcher{{Type: spi.MatchEqual, Name: utm.LabelName, Value: name}}, Start: utm.TimeToMilli(received), End: utm.TimeToMilli(received)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := set.Close(); err != nil {
			t.Error(err)
		}
	}()
	var out []float64
	for set.Next() {
		samples := set.At().Samples()
		for samples.Next() {
			_, value := samples.At()
			out = append(out, value)
		}
		if err := samples.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if err := set.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
func TestPipeline_MemoryThreeSignalsTenantIsolationAndOwnership(t *testing.T) {
	backend := memoryBackend(t)
	p := pipeline(t, backend, testOptions())
	point := metric("gauge")
	point.Labels = labels.FromStrings("key", "original")
	point.Histogram = &utm.Histogram{Bounds: []float64{1}, Counts: []uint64{1, 1}}
	point.Exemplar = &utm.Exemplar{Labels: labels.FromStrings("key", "original")}
	logs := []utm.LogRecord{logRecord()}
	span := spanRecord()
	result, err := submitReady(func() (Result, error) {
		return p.SubmitMetrics(trusted("a"), normalize.MetricBatch{Points: []utm.MetricPoint{point}, Metadata: []utm.MetricMetadata{{Metric: "gauge", Help: "help"}}}, 10)
	})
	if err != nil || result.Accepted != 1 || result.MetadataUnsupported != 1 {
		t.Fatalf("metrics %+v %v", result, err)
	}
	if result, err := submitReady(func() (Result, error) { return p.SubmitLogs(trusted("a"), logs, 10) }); err != nil || result.Accepted != 1 {
		t.Fatalf("logs %+v %v", result, err)
	}
	if result, err := submitReady(func() (Result, error) { return p.SubmitSpans(trusted("a"), []utm.Span{span}, 10) }); err != nil || result.Accepted != 1 {
		t.Fatalf("spans %+v %v", result, err)
	}
	point.Labels[0].Value = "changed"
	point.Histogram.Bounds[0] = 99
	point.Exemplar.Labels[0].Value = "changed"
	logs[0].Attrs["attribute"] = "changed"
	logs[0].Body = "changed"
	span.Events[0].Attrs["key"] = "changed"
	span.Links[0].Attrs["key"] = "changed"
	if result, err := submitReady(func() (Result, error) {
		return p.SubmitMetrics(trusted("b"), normalize.MetricBatch{Points: []utm.MetricPoint{metric("gauge")}}, 10)
	}); err != nil || result.Accepted != 1 {
		t.Fatalf("tenant b %+v %v", result, err)
	}
	closePipeline(t, p)
	if got := metricValues(t, backend, "a", "gauge"); len(got) != 1 || got[0] != 3 {
		t.Fatal(got)
	}
	if got := metricValues(t, backend, "b", "gauge"); len(got) != 1 {
		t.Fatal(got)
	}
	it, err := backend.Logs().Search(context.Background(), spi.LogQuery{Tenant: "a", Selectors: []spi.Matcher{{Type: spi.MatchEqual, Name: "service", Value: "api"}}, Start: utm.TimeToNano(received), End: utm.TimeToNano(received.Add(time.Second)), Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := it.Close(); err != nil {
			t.Error(err)
		}
	}()
	if !it.Next() || it.At().Body != "original" || it.At().Attrs["attribute"] != "original" {
		t.Fatal("log ownership lost")
	}
	if it.At().Resource.Tenant != "a" {
		t.Fatal("tenant not injected")
	}
	traces, err := backend.Traces().GetTrace(context.Background(), "a", span.TraceID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := traces.Close(); err != nil {
			t.Error(err)
		}
	}()
	if !traces.Next() || traces.At().Events[0].Attrs["key"] != "original" || traces.At().Links[0].Attrs["key"] != "original" {
		t.Fatal("span ownership lost")
	}
	if err := backend.Ping(context.Background()); err != nil {
		t.Fatal("pipeline closed borrowed backend")
	}
}
func otlpDelta(value int64) pmetric.Metrics {
	input := pmetric.NewMetrics()
	m := input.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	m.SetName("delta")
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(true)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	point := sum.DataPoints().AppendEmpty()
	point.SetIntValue(value)
	point.SetTimestamp(pcommon.Timestamp(1700000000000000000))
	return input
}

type backendOverride struct {
	spi.Backend
	metrics spi.MetricStore
	logs    spi.LogStore
	traces  spi.TraceStore
}

func (b backendOverride) Metrics() spi.MetricStore { return b.metrics }
func (b backendOverride) Logs() spi.LogStore       { return b.logs }
func (b backendOverride) Traces() spi.TraceStore   { return b.traces }

type gatedMetrics struct {
	spi.MetricStore
	entered chan struct{}
	release <-chan struct{}
}

func (g gatedMetrics) Write(ctx context.Context, input []utm.MetricPoint) error {
	select {
	case g.entered <- struct{}{}:
	default:
	}
	select {
	case <-g.release:
		return g.MetricStore.Write(ctx, input)
	case <-ctx.Done():
		return ctx.Err()
	}
}
func waitEntered(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("writer did not enter")
	}
}
func TestPipeline_QueueRejectionBeforeDeltaAndRate(t *testing.T) {
	backend := memoryBackend(t)
	release := make(chan struct{})
	entered := make(chan struct{}, 4)
	o := testOptions()
	o.Metrics.MaxItems = 1
	o.Metrics.QueueDepth = 1
	o.Metrics.Workers = 1
	rate, burst := int64(1), int64(40)
	o.Limits.Global = limits.Overrides{IngestRateBytesPerSec: &rate, IngestBurstBytes: &burst}
	p := pipeline(t, backendOverride{Backend: backend, metrics: gatedMetrics{MetricStore: backend.Metrics(), entered: entered, release: release}}, o)
	defer func() { close(release) }()
	if r, err := submitReady(func() (Result, error) { return p.SubmitOTLPMetrics(trusted("a"), otlpDelta(5), 10) }); err != nil || r.Accepted != 0 {
		t.Fatalf("baseline %+v %v", r, err)
	}
	if _, err := submitReady(func() (Result, error) {
		return p.SubmitMetrics(trusted("a"), normalize.MetricBatch{Points: []utm.MetricPoint{metric("one")}}, 10)
	}); err != nil {
		t.Fatal(err)
	}
	waitEntered(t, entered)
	if _, err := submitReady(func() (Result, error) {
		return p.SubmitMetrics(trusted("a"), normalize.MetricBatch{Points: []utm.MetricPoint{metric("two")}}, 10)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := submitReady(func() (Result, error) { return p.SubmitOTLPMetrics(trusted("a"), otlpDelta(2), 10) }); !throttledBy(err, "priority queue full") {
		t.Fatalf("queue rejected delta: %v", err)
	}
	// Drain the gate without closing pipeline; wait deterministically for all writes.
	close(release)
	release = make(chan struct{})
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for p.metrics.Snapshot().Written < 2 {
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("drain timed out")
		}
	}
	r, err := submitReady(func() (Result, error) { return p.SubmitOTLPMetrics(trusted("a"), otlpDelta(2), 10) })
	if err != nil || r.Accepted != 1 || r.InternalFailures != 0 {
		t.Fatalf("retry %+v %v", r, err)
	}
	closePipeline(t, p)
	values := metricValues(t, backend, "a", "delta_total")
	if len(values) != 1 || values[0] != 7 {
		t.Fatalf("delta replay consumed state: %v", values)
	}
}
func TestPipeline_CancelCommitAndNonEvictingTenantCap(t *testing.T) {
	backend := memoryBackend(t)
	ctx, cancel := context.WithCancel(trusted("a"))
	o := testOptions()
	o.MaxTenants = 1
	rate := int64(100)
	o.Limits.Global.IngestRateBytesPerSec = &rate
	var fired atomic.Bool
	o.Now = func() time.Time {
		if fired.CompareAndSwap(false, true) {
			cancel()
		}
		return received
	}
	p := pipeline(t, backend, o)
	r, err := submitReady(func() (Result, error) { return p.SubmitLogs(ctx, []utm.LogRecord{logRecord()}, 1) })
	if err != nil || r.Accepted != 1 || r.InternalFailures != 0 {
		t.Fatalf("cancel after byte commit %+v %v", r, err)
	}
	if _, err := p.SubmitLogs(trusted("b"), []utm.LogRecord{logRecord()}, 1); !throttledBy(err, "tenant registry full") {
		t.Fatalf("registry evicted live tenant: %v", err)
	}
	if _, err := p.SubmitLogs(ctx, []utm.LogRecord{logRecord()}, 1); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("precommit cancellation: %v", err)
	}
	if p.Snapshot().Tenants != 1 {
		t.Fatal("tenant capacity changed")
	}
}
func TestPipeline_TenantOverridesAndRawBounds(t *testing.T) {
	backend := memoryBackend(t)
	o := testOptions()
	attrs := 200
	rate, burst := int64(1), int64(10)
	o.Limits.Global = limits.Overrides{IngestRateBytesPerSec: &rate, IngestBurstBytes: &burst}
	o.Tenants = map[string]limits.Overrides{"a": {MaxAttrsPerRecord: &attrs}}
	p := pipeline(t, backend, o)
	attrs = 1
	rate = 0
	input := plog.NewLogs()
	record := input.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.Body().SetStr("body")
	record.SetTimestamp(pcommon.Timestamp(1700000000000000000))
	for i := range 150 {
		record.Attributes().PutStr(fmt.Sprintf("attribute.%03d", i), "value")
	}
	r, err := submitReady(func() (Result, error) { return p.SubmitOTLPLogs(trusted("a"), input, 10) })
	if err != nil || r.Accepted != 1 {
		t.Fatalf("effective tenant limits %+v %v", r, err)
	}
	if r.Normalize.Warnings["attributes_truncated"] != 0 {
		t.Fatal("tenant override lost before normalization")
	}
	if r, err := submitReady(func() (Result, error) { return p.SubmitOTLPLogs(trusted("a"), input, 1) }); !throttledBy(err, "tenant byte rate exceeded") || r.Limits.Rejected["rate_limit"] != 1 || r.RetryAfter != time.Second {
		t.Fatalf("tenant override erased global rate: %v", err)
	}
	small := testOptions()
	small.MaxElements = 20
	bounded := pipeline(t, backend, small)
	if _, err := bounded.SubmitOTLPLogs(trusted("b"), input, 1); spi.Classify(err) != spi.ErrTooLarge {
		t.Fatal("raw attributes bypassed element bound")
	}
	if bounded.Snapshot().Tenants != 0 {
		t.Fatal("preflight rejection retained provisional state")
	}
	oversized := normalize.MetricBatch{Metadata: []utm.MetricMetadata{{Metric: "x", Help: string(make([]byte, small.MaxInputBytes+1))}}}
	if _, err := bounded.SubmitMetrics(trusted("b"), oversized, 1); spi.Classify(err) != spi.ErrTooLarge {
		t.Fatal("metadata bypassed bytes")
	}
}
func TestPipeline_OTLPExpansionAndAllSignals(t *testing.T) {
	backend := memoryBackend(t)
	p := pipeline(t, backend, testOptions())
	input := otlpDelta(5)
	metrics := input.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics()
	hist := metrics.AppendEmpty()
	hist.SetName("histogram")
	histogram := hist.SetEmptyHistogram()
	histogram.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	point := histogram.DataPoints().AppendEmpty()
	point.SetTimestamp(pcommon.Timestamp(1700000000000000000))
	point.ExplicitBounds().FromRaw([]float64{1, 2})
	point.BucketCounts().FromRaw([]uint64{1, 1, 1})
	point.SetCount(3)
	r, err := submitReady(func() (Result, error) { return p.SubmitOTLPMetrics(trusted("a"), input, 10) })
	if err != nil || r.Accepted != 6 || r.InternalFailures != 0 {
		t.Fatalf("expansion/baseline %+v %v", r, err)
	}
	logs := plog.NewLogs()
	logs.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("body")
	if r, err := submitReady(func() (Result, error) { return p.SubmitOTLPLogs(trusted("a"), logs, 1) }); err != nil || r.Accepted != 1 {
		t.Fatalf("OTLP logs %+v %v", r, err)
	}
	traces := ptrace.NewTraces()
	span := traces.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID{15: 1})
	span.SetSpanID(pcommon.SpanID{7: 1})
	span.SetStartTimestamp(pcommon.Timestamp(1700000000000000000))
	if r, err := submitReady(func() (Result, error) { return p.SubmitOTLPTraces(trusted("a"), traces, 1) }); err != nil || r.Accepted != 1 {
		t.Fatalf("OTLP traces %+v %v", r, err)
	}
	closePipeline(t, p)
	if values := metricValues(t, backend, "a", "histogram_count"); len(values) != 1 || values[0] != 3 {
		t.Fatal(values)
	}
}
func TestPipeline_ParentCancelThenBackgroundClose(t *testing.T) {
	backend := memoryBackend(t)
	ctx, cancel := context.WithCancel(context.Background())
	p, err := New(ctx, backend, testOptions())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := submitReady(func() (Result, error) { return p.SubmitLogs(trusted("a"), []utm.LogRecord{logRecord()}, 1) }); err != nil {
		t.Fatal(err)
	}
	cancel()
	finished := make(chan error, 1)
	go func() { finished <- p.Close(context.Background()) }()
	select {
	case err := <-finished:
		if spi.Classify(err) != spi.ErrTimeout {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close(background) did not finish after parent cancellation")
	}
	if s := p.Snapshot(); s.Logs.Shutdown != 1 || s.Logs.BufferedItems != 0 {
		t.Fatalf("parent canceled shutdown %+v", s)
	}
	if err := p.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

type metadataMetrics struct {
	spi.MetricStore
	mu       sync.Mutex
	metadata []utm.MetricMetadata
	calls    int
}

func (m *metadataMetrics) UpsertMetadata(ctx context.Context, _ string, input []utm.MetricMetadata) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	m.metadata = append(m.metadata, input...)
	return nil
}
func (m *metadataMetrics) Metadata(context.Context, string, string, int) ([]utm.MetricMetadata, error) {
	return nil, nil
}
func TestPipeline_MetadataOwnershipAndNoSplitDuplication(t *testing.T) {
	backend := memoryBackend(t)
	store := &metadataMetrics{MetricStore: backend.Metrics()}
	o := testOptions()
	o.Metrics.MaxItems = 1
	p := pipeline(t, backendOverride{Backend: backend, metrics: store}, o)
	batch := normalize.MetricBatch{Points: []utm.MetricPoint{metric("one"), metric("two")}, Metadata: []utm.MetricMetadata{{Metric: "family", Help: "original", Unit: "By"}}}
	r, err := submitReady(func() (Result, error) { return p.SubmitMetrics(trusted("a"), batch, 10) })
	if err != nil || r.MetadataAccepted != 1 || r.InternalFailures != 0 {
		t.Fatalf("metadata %+v %v", r, err)
	}
	batch.Metadata[0].Help = "changed"
	closePipeline(t, p)
	if store.calls != 1 || len(store.metadata) != 1 || store.metadata[0].Help != "original" {
		t.Fatalf("metadata duplicated or borrowed %+v", store.metadata)
	}
}
func TestPipeline_UnsupportedAndPriorityMapping(t *testing.T) {
	backend := memoryBackend(t)
	p := pipeline(t, backendOverride{Backend: backend}, testOptions())
	if _, err := p.SubmitLogs(trusted("a"), nil, 0); spi.Classify(err) != spi.ErrUnsupported {
		t.Fatal(err)
	}
	if p.Snapshot().Tenants != 0 {
		t.Fatal("unsupported allocated state")
	}
	for severity := utm.SevUnknown; severity <= utm.SevFatal; severity++ {
		want := batcher.Low
		if severity == utm.SevInfo || severity == utm.SevWarn {
			want = batcher.Normal
		}
		if severity == utm.SevError || severity == utm.SevFatal {
			want = batcher.High
		}
		if logPriority(utm.LogRecord{Severity: severity}) != want {
			t.Fatal("severity priority")
		}
	}
	if spanPriority(utm.Span{Kind: utm.KindInternal}) != batcher.Normal || spanPriority(utm.Span{Kind: utm.KindServer}) != batcher.High {
		t.Fatal("span priority")
	}
}

func TestPreflight_ExpandedAttributeAndSharedByteProducts(t *testing.T) {
	for _, scenario := range []string{"histogram_attributes", "shared_resource_bytes", "shared_metric_name_bytes"} {
		t.Run(scenario, func(t *testing.T) {
			o := testOptions()
			o.MaxElements = 1000
			o.MaxInputBytes = 1000
			p := &Pipeline{options: o}
			input := pmetric.NewMetrics()
			resource := input.ResourceMetrics().AppendEmpty()
			m := resource.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			m.SetName("metric")
			if scenario == "histogram_attributes" {
				point := m.SetEmptyHistogram().DataPoints().AppendEmpty()
				point.ExplicitBounds().FromRaw(make([]float64, 20))
				point.BucketCounts().FromRaw(make([]uint64, 21))
				for i := range 30 {
					point.Attributes().PutStr(fmt.Sprintf("attr%d", i), "value")
				}
			} else {
				if scenario == "shared_resource_bytes" {
					resource.Resource().Attributes().PutStr("service.name", strings.Repeat("x", 100))
				} else {
					m.SetName(strings.Repeat("m", 100))
				}
				points := m.SetEmptyGauge().DataPoints()
				for range 20 {
					points.AppendEmpty()
				}
			}
			if err := p.checkMetrics(context.Background(), input); spi.Classify(err) != spi.ErrTooLarge {
				t.Fatalf("expansion product accepted: %v", err)
			}
		})
	}
	// A many-point gauge does not multiply its whole raw footprint by point count.
	p := &Pipeline{options: testOptions()}
	input := pmetric.NewMetrics()
	m := input.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	m.SetName("ordinary")
	points := m.SetEmptyGauge().DataPoints()
	for range 1000 {
		points.AppendEmpty()
	}
	if err := p.checkMetrics(context.Background(), input); err != nil {
		t.Fatalf("ordinary gauge rejected: %v", err)
	}
}

func TestPipeline_ConcurrentAdmissionAndClose(t *testing.T) {
	backend := memoryBackend(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	var first atomic.Bool
	o := testOptions()
	rate := int64(100)
	o.Limits.Global.IngestRateBytesPerSec = &rate
	o.Now = func() time.Time {
		if first.CompareAndSwap(false, true) {
			close(entered)
			<-release
		}
		return received
	}
	p := pipeline(t, backend, o)
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	type response struct {
		result Result
		err    error
	}
	admission := make(chan response, 1)
	go func() {
		r, err := submitReady(func() (Result, error) { return p.SubmitLogs(trusted("a"), []utm.LogRecord{logRecord()}, 1) })
		admission <- response{r, err}
	}()
	waitEntered(t, entered)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	closed := make(chan error, 2)
	for range 2 {
		go func() { closed <- p.Close(ctx) }()
	}
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for !p.closed.Load() {
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("Close did not reject admission")
		}
	}
	if r, err := p.SubmitLogs(trusted("a"), []utm.LogRecord{logRecord()}, 1); r.Accepted != 0 || (spi.Classify(err) != spi.ErrThrottled && spi.Classify(err) != spi.ErrUnavailable) {
		t.Fatalf("closing admitted new request %+v %v", r, err)
	}
	select {
	case err := <-closed:
		t.Fatalf("Close escaped in-progress CPU admission: %v", err)
	default:
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case got := <-admission:
		if got.err != nil || got.result.Accepted != 1 || got.result.InternalFailures != 0 {
			t.Fatalf("committed admission %+v %v", got.result, got.err)
		}
	case <-ctx.Done():
		t.Fatal("admission did not finish")
	}
	for range 2 {
		select {
		case err := <-closed:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("concurrent Close did not finish")
		}
	}
	if s := p.Snapshot(); s.Tenants != 0 || s.Logs.Accepted != 1 || s.Logs.Written != 1 || s.Logs.Shutdown != 0 {
		t.Fatalf("drain accounting %+v", s)
	}
	if _, err := p.SubmitLogs(trusted("a"), []utm.LogRecord{logRecord()}, 1); spi.Classify(err) != spi.ErrUnavailable {
		t.Fatalf("closed pipeline accepted: %v", err)
	}
}

func TestPipeline_CloseDeadlineCancelsContextAwareWriter(t *testing.T) {
	backend := memoryBackend(t)
	entered := make(chan struct{}, 1)
	o := testOptions()
	o.Metrics.MaxItems = 1
	p := pipeline(t, backendOverride{Backend: backend, metrics: gatedMetrics{MetricStore: backend.Metrics(), entered: entered, release: make(chan struct{})}}, o)
	if r, err := submitReady(func() (Result, error) {
		return p.SubmitMetrics(trusted("a"), normalize.MetricBatch{Points: []utm.MetricPoint{metric("blocked")}}, 1)
	}); err != nil || r.Accepted != 1 {
		t.Fatalf("admission %+v %v", r, err)
	}
	waitEntered(t, entered)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	finished := make(chan error, 1)
	go func() { finished <- p.Close(ctx) }()
	select {
	case err := <-finished:
		if spi.Classify(err) != spi.ErrTimeout {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("deadline Close did not cancel writer")
	}
	if s := p.Snapshot(); s.Tenants != 0 || s.Metrics.Shutdown != 1 || s.Metrics.Inflight != 0 || s.Metrics.WriteFailed != 0 {
		t.Fatalf("deadline accounting %+v", s)
	}
}
