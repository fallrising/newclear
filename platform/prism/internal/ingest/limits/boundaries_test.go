package limits

import (
	"context"
	"errors"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

var testNow = time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)

func newLimiter(t *testing.T, options Options) *Limiter {
	t.Helper()
	if options.Now == nil {
		options.Now = func() time.Time { return testNow }
	}
	limiter, err := New("tenant-a", options)
	if err != nil {
		t.Fatal(err)
	}
	return limiter
}
func snapshot(t *testing.T, limiter *Limiter) Snapshot {
	t.Helper()
	got, err := limiter.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return got
}
func testSpan(trace, span int) utm.Span {
	return utm.Span{TraceID: fmt.Sprintf("%032x", trace), SpanID: fmt.Sprintf("%016x", span)}
}
func metricBatch(t *testing.T, limiter *Limiter, input ...utm.MetricPoint) ([]utm.MetricPoint, Report) {
	t.Helper()
	got, report, err := limiter.Metrics(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	return got, report
}

func TestResolve_DefaultsEveryTenantOverride(t *testing.T) {
	defaults := Defaults()
	if defaults.MaxLabelNameLength != 128 || defaults.MaxLabelValueLength != 2048 || defaults.MaxLabelsPerSeries != 40 || defaults.MaxActiveSeriesPerTenant != 500000 || defaults.MaxSeriesPerMetricName != 50000 || defaults.MaxLogLineBytes != 256<<10 || defaults.MaxAttrsPerRecord != 128 || defaults.MaxSpansPerTrace != 20000 || defaults.CardinalityAlarmThreshold != 10000 || defaults.AutoDropHighCardinality || defaults.IngestRateBytesPerSec != 0 {
		t.Fatalf("wrong SDD defaults: %+v", defaults)
	}
	override := Overrides{MaxLabelNameLength: new(1), MaxLabelValueLength: new(2), MaxLabelsPerSeries: new(3), MaxActiveSeriesPerTenant: new(4), MaxSeriesPerMetricName: new(5), MaxLogLineBytes: new(6), MaxAttrsPerRecord: new(7), MaxSpansPerTrace: new(8), IngestRateBytesPerSec: new(int64(9)), IngestBurstBytes: new(int64(10)), CardinalityAlarmThreshold: new(11), AutoDropHighCardinality: new(false), DeniedLabelPattern: new("^custom$")}
	got, err := Resolve(Overrides{MaxLabelNameLength: new(99), AutoDropHighCardinality: new(true)}, override)
	if err != nil {
		t.Fatal(err)
	}
	want := Settings{MaxLabelNameLength: 1, MaxLabelValueLength: 2, MaxLabelsPerSeries: 3, MaxActiveSeriesPerTenant: 4, MaxSeriesPerMetricName: 5, MaxLogLineBytes: 6, MaxAttrsPerRecord: 7, MaxSpansPerTrace: 8, IngestRateBytesPerSec: 9, IngestBurstBytes: 10, CardinalityAlarmThreshold: 11, DeniedLabelPattern: "^custom$"}
	if got != want {
		t.Fatalf("resolve=%+v want=%+v", got, want)
	}
	limiter := newLimiter(t, Options{Tenant: Overrides{MaxActiveSeriesPerTenant: new(2)}})
	effective := limiter.Settings()
	effective.MaxActiveSeriesPerTenant = 100
	if limiter.Settings().MaxActiveSeriesPerTenant != 2 {
		t.Fatal("settings exposed mutation")
	}
	for _, options := range []Options{{Tenant: Overrides{MaxAttrsPerRecord: new(0)}}, {Tenant: Overrides{IngestRateBytesPerSec: new(int64(-1))}}, {Tenant: Overrides{DeniedLabelPattern: new("[")}}, {MaxRecords: -1}, {TraceTTL: -1}} {
		if _, err := New("tenant-a", options); spi.Classify(err) != spi.ErrBadRequest {
			t.Fatalf("invalid options accepted: %+v err=%v", options, err)
		}
	}
	if _, err := New("", Options{}); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatal("empty tenant accepted")
	}
}

func TestMetrics_LabelLimitsUTF8CollisionsAndIdentity(t *testing.T) {
	limiter := newLimiter(t, Options{Tenant: Overrides{MaxLabelNameLength: new(3), MaxLabelValueLength: new(4)}})
	input := utm.MetricPoint{Name: "m", Labels: labels.FromStrings("abcdef", "ééé", "abcxyz", "loses", "keep", "界界")}
	got, report := metricBatch(t, limiter, input)
	if len(got) != 1 || got[0].Labels.Get("abc") != "éé" || got[0].Labels.Get("kee") != "界" || got[0].Labels.Get(utm.LabelName) != "m" || report.Warnings["label_collision"] != 1 || report.Normalized["truncate"] != 6 || report.Normalized["drop_label"] != 1 {
		t.Fatalf("got=%+v report=%+v", got, report)
	}
	if !utf8.ValidString(got[0].Labels.Get("kee")) || input.Labels.Get("abcdef") != "ééé" {
		t.Fatal("invalid UTF8 or input changed")
	}
	reversed := input
	reversed.Labels = slices.Clone(input.Labels)
	slices.Reverse(reversed.Labels)
	again, _ := metricBatch(t, limiter, reversed)
	if !reflect.DeepEqual(got[0].Labels, again[0].Labels) {
		t.Fatal("collision result depends on ordering")
	}
	got, report = metricBatch(t, limiter, point("identity-too-long", "v"))
	if len(got) != 0 || report.Rejected["too_large"] != 1 {
		t.Fatal("metric identity should be rejected, never truncated")
	}
	for _, point := range []utm.MetricPoint{{Name: "m", Labels: labels.FromStrings(utm.LabelName, "other")}, {Name: "m", Labels: labels.FromStrings(utm.LabelTenant, "other")}} {
		got, _ := metricBatch(t, limiter, point)
		if len(got) != 0 {
			t.Fatal("mismatched trusted identity accepted")
		}
	}
}

func TestMetrics_LabelCountIncludesSystemAndCollisionDoesNotBypass(t *testing.T) {
	limiter := newLimiter(t, Options{Tenant: Overrides{MaxLabelsPerSeries: new(3), MaxLabelNameLength: new(1)}})
	got, _ := metricBatch(t, limiter, point("m", "v"))
	if len(got) != 1 {
		t.Fatal("boundary rejected")
	}
	got, report := metricBatch(t, limiter, utm.MetricPoint{Name: "m", Labels: labels.FromStrings("ab", "v", "ac", "w")})
	if len(got) != 0 || report.Rejected["too_large"] != 1 {
		t.Fatal("collisions bypassed count cap")
	}
}

func TestFinalTruncatedNameCannotBecomeDeniedLabel(t *testing.T) {
	limiter := newLimiter(t, Options{Tenant: Overrides{MaxLabelNameLength: new(10)}})
	got, report := metricBatch(t, limiter, utm.MetricPoint{Name: "m", Labels: labels.FromStrings("request_id_extra", "value", "url_full", "url")})
	if len(got) != 1 || got[0].Labels.Has("request_id") || got[0].Labels.Has("url_full") || report.Normalized["drop_label"] != 2 {
		t.Fatalf("metric deny bypass: %+v %+v", got, report)
	}
	logs, report, err := limiter.Logs(context.Background(), []utm.LogRecord{{Labels: labels.FromStrings("request_id_extra", "value")}})
	if err != nil || len(logs) != 1 || logs[0].Labels.Has("request_id") || logs[0].Attrs["request_id"] != "value" || report.Normalized["drop_label"] != 1 {
		t.Fatalf("log deny bypass: %+v %+v %v", logs, report, err)
	}
	if snapshot(t, limiter).TrackedLabels != 0 {
		t.Fatal("denied labels consumed cardinality state")
	}
}

func TestMetrics_PerMetricCapHourlySlidingExpiryAndTenantIsolation(t *testing.T) {
	now := testNow
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, Tenant: Overrides{MaxActiveSeriesPerTenant: new(2), MaxSeriesPerMetricName: new(1)}})
	got, _ := metricBatch(t, limiter, point("m", "a"), point("n", "a"))
	if len(got) != 2 {
		t.Fatal("metric name not in identity")
	}
	got, report := metricBatch(t, limiter, point("m", "b"))
	if len(got) != 0 || len(report.Alarms) != 1 || report.Alarms[0].Kind != "series_per_metric" {
		t.Fatalf("per metric cap %+v", report)
	}
	now = now.Add(30 * time.Minute)
	metricBatch(t, limiter, point("m", "a"))
	now = testNow.Add(time.Hour - time.Nanosecond)
	if snapshot(t, limiter).ActiveSeries != 2 {
		t.Fatal("expired early")
	}
	now = testNow.Add(time.Hour)
	state := snapshot(t, limiter)
	if state.ActiveSeries != 1 || state.MetricNames != 1 || math.Abs(state.EstimatedActiveSeries-1) > 0.01 {
		t.Fatalf("not sliding: %+v", state)
	}
	got, _ = metricBatch(t, limiter, point("n", "new"))
	if len(got) != 1 {
		t.Fatal("expired capacity not released")
	}
	other := newLimiter(t, Options{Tenant: Overrides{MaxActiveSeriesPerTenant: new(1)}})
	got, _ = metricBatch(t, other, point("m", "b"))
	if len(got) != 1 {
		t.Fatal("tenant state shared")
	}
	now = testNow.Add(2 * time.Hour)
	if snapshot(t, limiter).ActiveSeries != 0 {
		t.Fatal("idle state not fully reclaimed")
	}
}

func TestHighCardinality_PerValueExpiryAutoDropAndCapacityAtomicity(t *testing.T) {
	now := testNow
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, Tenant: Overrides{CardinalityAlarmThreshold: new(2), AutoDropHighCardinality: new(true)}})
	metricBatch(t, limiter, point("m", "a"))
	now = now.Add(time.Minute)
	metricBatch(t, limiter, point("m", "b"))
	got, report := metricBatch(t, limiter, point("m", "c"))
	if len(got) != 1 || got[0].Labels.Has("id") || len(report.Alarms) != 1 || report.Alarms[0].Kind != "high_cardinality_label" {
		t.Fatalf("no threshold alarm/drop: %+v %+v", got, report)
	}
	got, report = metricBatch(t, limiter, point("m", "c"))
	if len(got) != 1 || len(report.Alarms) != 0 {
		t.Fatal("duplicate value inflated/repeated alarm")
	}
	now = testNow.Add(5 * time.Minute)
	state := snapshot(t, limiter)
	if state.TrackedValues != 2 {
		t.Fatalf("whole label window reset instead of per-value expiry: %+v", state)
	}
	got, _ = metricBatch(t, limiter, point("m", "b"))
	if got[0].Labels.Get("id") != "b" {
		t.Fatal("expired cardinality did not restore label")
	}
	now = testNow.Add(6 * time.Minute)
	state = snapshot(t, limiter)
	if state.TrackedValues != 1 {
		t.Fatalf("refreshed value did not survive: %+v", state)
	}
	capped := newLimiter(t, Options{MaxCardinalityLabels: 1, MaxCardinalityValues: 1})
	metricBatch(t, capped, point("m", "a"))
	before := snapshot(t, capped)
	got, report = metricBatch(t, capped, point("n", "b"))
	after := snapshot(t, capped)
	if len(got) != 0 || report.Rejected["cardinality"] != 1 || before != after {
		t.Fatalf("tracker capacity rejection mutated admission: before=%+v after=%+v", before, after)
	}
}

func TestLogs_TruncationAttrsMarkersAndOwnership(t *testing.T) {
	limiter := newLimiter(t, Options{Tenant: Overrides{MaxLogLineBytes: new(4), MaxAttrsPerRecord: new(2)}})
	input := utm.LogRecord{Body: "ééé", Labels: labels.FromStrings("user_id", "u"), Attrs: map[string]string{"z": "z", "a": "a"}, Resource: &utm.Resource{Attrs: map[string]string{"z": "z", "b": "b", "a": "a"}}}
	output, report, err := limiter.Logs(context.Background(), []utm.LogRecord{input})
	if err != nil || len(output) != 1 {
		t.Fatal(err)
	}
	got := output[0]
	if got.Body != "éé" || len(got.Attrs) != 2 || got.Attrs[truncationMarker] != "true" || got.Attrs["a"] != "a" || got.Labels.Has("user_id") || len(got.Resource.Attrs) != 2 || got.Resource.Attrs["a"] != "a" || got.Resource.Attrs["b"] != "b" || report.Normalized["truncate"] != 4 {
		t.Fatalf("clamped=%+v report=%+v", got, report)
	}
	got.Attrs["a"] = "changed"
	got.Resource.Attrs["a"] = "changed"
	if input.Attrs["a"] != "a" || input.Resource.Attrs["a"] != "a" || input.Body != "ééé" {
		t.Fatal("caller changed")
	}
	defaults := newLimiter(t, Options{})
	boundary := strings.Repeat("x", 256<<10)
	gotLogs, _, err := defaults.Logs(context.Background(), []utm.LogRecord{{Body: boundary}, {Body: boundary + "x"}})
	if err != nil || gotLogs[0].Body != boundary || gotLogs[0].Attrs[truncationMarker] != "" || len(gotLogs[1].Body) != len(boundary) || gotLogs[1].Attrs[truncationMarker] != "true" {
		t.Fatal("default log boundary")
	}
	one := newLimiter(t, Options{Tenant: Overrides{MaxAttrsPerRecord: new(1), MaxLogLineBytes: new(1)}})
	marked, _, _ := one.Logs(context.Background(), []utm.LogRecord{{Body: "xx", Attrs: map[string]string{"a": "a"}}})
	if len(marked[0].Attrs) != 1 || marked[0].Attrs[truncationMarker] != "true" {
		t.Fatal("marker lost at cap one")
	}
}

func TestSpans_DedupOverflowMarkersBoundedTrackersAndExpiry(t *testing.T) {
	now := testNow
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, MaxTraces: 1, Tenant: Overrides{MaxSpansPerTrace: new(2), MaxAttrsPerRecord: new(1)}})
	first := testSpan(1, 1)
	first.Attrs = map[string]string{"a": "a", "b": "b"}
	first.Events = []utm.SpanEvent{{Attrs: map[string]string{"b": "b", "a": "a"}}}
	first.Links = []utm.SpanLink{{Attrs: map[string]string{"b": "b", "a": "a"}}}
	output, report, err := limiter.Spans(context.Background(), []utm.Span{first, first, testSpan(1, 2), testSpan(1, 3)})
	if err != nil || len(output) != 3 || report.Rejected["too_large"] != 1 || len(report.TruncatedTraces) != 1 {
		t.Fatalf("trace overflow: %+v %v", report, err)
	}
	for _, span := range output {
		if len(span.Attrs) != 1 || span.Attrs[truncationMarker] != "true" {
			t.Fatal("trace marker not reserved within cap")
		}
	}
	output[0].Events[0].Attrs["a"] = "changed"
	output[0].Links[0].Attrs["a"] = "changed"
	if first.Attrs[truncationMarker] != "" || first.Events[0].Attrs["a"] != "a" || first.Links[0].Attrs["a"] != "a" {
		t.Fatal("nested caller data changed")
	}
	output, report, err = limiter.Spans(context.Background(), []utm.Span{testSpan(1, 1), testSpan(2, 1)})
	if err != nil || len(output) != 1 || report.Rejected["cardinality"] != 1 || output[0].Attrs[truncationMarker] != "true" {
		t.Fatal("dedup/tracker cap bypass")
	}
	now = now.Add(time.Hour)
	output, _, err = limiter.Spans(context.Background(), []utm.Span{testSpan(2, 1)})
	if err != nil || len(output) != 1 || snapshot(t, limiter).Traces != 1 {
		t.Fatal("trace capacity not expired")
	}
	output, report, _ = limiter.Spans(context.Background(), []utm.Span{{TraceID: "invalid", SpanID: "invalid"}})
	if len(output) != 0 || report.Rejected["invalid_id"] != 1 {
		t.Fatal("unbounded trace identity accepted")
	}
}

func TestAllowBytes_NonblockingClassificationRefillAndRollbackClock(t *testing.T) {
	now := testNow
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, Tenant: Overrides{IngestRateBytesPerSec: new(int64(10)), IngestBurstBytes: new(int64(20))}})
	_, _, err := limiter.AllowBytes(context.Background(), 20)
	if err != nil {
		t.Fatal(err)
	}
	report, delay, err := limiter.AllowBytes(context.Background(), 1)
	if spi.Classify(err) != spi.ErrThrottled || report.Rejected["rate_limit"] != 1 || delay != 100*time.Millisecond {
		t.Fatalf("rate rejection: %+v %v %v", report, delay, err)
	}
	now = now.Add(time.Second)
	_, _, err = limiter.AllowBytes(context.Background(), 10)
	if err != nil {
		t.Fatal("did not refill")
	}
	now = testNow
	_, delay, err = limiter.AllowBytes(context.Background(), 1)
	if spi.Classify(err) != spi.ErrThrottled || delay != 100*time.Millisecond {
		t.Fatal("clock rollback corrupted rate")
	}
	_, delay, err = limiter.AllowBytes(context.Background(), 21)
	if spi.Classify(err) != spi.ErrThrottled || delay != 0 {
		t.Fatal("oversized burst")
	}
	_, _, err = limiter.AllowBytes(context.Background(), -1)
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatal("negative bytes")
	}
	unlimited := newLimiter(t, Options{})
	_, _, err = unlimited.AllowBytes(context.Background(), math.MaxInt64)
	if err != nil {
		t.Fatal("default tenant-defined rate not unlimited")
	}
}

func TestBoundedReportsAndRecordElements(t *testing.T) {
	limiter := newLimiter(t, Options{MaxReportEvents: 1, Tenant: Overrides{MaxSeriesPerMetricName: new(1)}})
	metricBatch(t, limiter, point("m", "a"), point("n", "a"))
	_, report := metricBatch(t, limiter, point("m", "b"), point("n", "b"))
	if len(report.Alarms) != 1 || report.EventOverflow != 1 {
		t.Fatal("report unbounded or overflow invisible")
	}
	bounded := newLimiter(t, Options{MaxRecords: 1, MaxRecordElements: 2})
	_, report, err := bounded.Metrics(context.Background(), []utm.MetricPoint{point("m", "a"), point("m", "b")})
	if spi.Classify(err) != spi.ErrTooLarge || report.Rejected["too_large"] != 2 || snapshot(t, bounded).ActiveSeries != 0 {
		t.Fatal("oversized batch consumed state")
	}
	nested := point("m", "a")
	nested.Histogram = &utm.Histogram{Bounds: []float64{1}, Counts: []uint64{1, 1}}
	output, report := metricBatch(t, bounded, nested)
	if len(output) != 0 || report.Rejected["too_large"] != 1 {
		t.Fatal("unbounded histogram clone")
	}
	span := testSpan(1, 1)
	span.Events = make([]utm.SpanEvent, 3)
	spans, report, _ := bounded.Spans(context.Background(), []utm.Span{span})
	if len(spans) != 0 || report.Rejected["too_large"] != 1 || snapshot(t, bounded).Traces != 0 {
		t.Fatal("unbounded span events")
	}
}

func TestCancellationOwnershipAndConcurrentAccess(t *testing.T) {
	limiter := newLimiter(t, Options{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := limiter.Metrics(ctx, []utm.MetricPoint{point("m", "a")})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("canceled metrics")
	}
	if snapshot(t, limiter).ActiveSeries != 0 {
		t.Fatal("canceled work mutated state")
	}
	if err := limiter.mu.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	waiting, cancelWaiting := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, _, err := limiter.Metrics(waiting, []utm.MetricPoint{point("m", "a")}); done <- err }()
	cancelWaiting()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled lock contender blocked")
	}
	limiter.mu.Unlock()
	input := point("m", "a")
	input.Histogram = &utm.Histogram{Bounds: []float64{1}, Counts: []uint64{1, 2}}
	input.Exemplar = &utm.Exemplar{Labels: labels.FromStrings("trace_id", "context")}
	output, _ := metricBatch(t, limiter, input)
	output[0].Histogram.Bounds[0] = 2
	output[0].Histogram.Counts[0] = 2
	output[0].Exemplar.Labels[0].Value = "changed"
	output[0].Labels[0].Value = "changed"
	if input.Histogram.Bounds[0] != 1 || input.Histogram.Counts[0] != 1 || input.Exemplar.Labels[0].Value != "context" || input.Labels.Get("id") != "a" {
		t.Fatal("nested metric caller changed")
	}
	var group sync.WaitGroup
	for worker := range 16 {
		group.Go(func() {
			for iteration := range 20 {
				value := fmt.Sprint(worker, iteration)
				metricBatch(t, limiter, point("parallel", value))
				_, _, err := limiter.Logs(context.Background(), []utm.LogRecord{{Body: value}})
				if err != nil {
					t.Error(err)
				}
				_, _, err = limiter.Spans(context.Background(), []utm.Span{testSpan(worker+1, iteration+1)})
				if err != nil {
					t.Error(err)
				}
				_, _, err = limiter.AllowBytes(context.Background(), 1)
				if err != nil {
					t.Error(err)
				}
				if _, err := limiter.Snapshot(context.Background()); err != nil {
					t.Error(err)
				}
			}
		})
	}
	group.Wait()
}

func TestHLL_RepresentativeErrorDuplicateAndRemoval(t *testing.T) {
	for _, count := range []uint64{1000, 10000, 50000, 100000, 500000} {
		for seed := range uint64(3) {
			t.Run(fmt.Sprintf("%d-seed%d", count, seed), func(t *testing.T) {
				sketch := new(hll)
				for index := range count {
					hash := index + 1 + seed*1000003
					sketch.add(hash)
				}
				estimate := sketch.estimate()
				relative := math.Abs(estimate-float64(count)) / float64(count)
				t.Logf("count=%d estimate=%.2f relative_error=%.4f%%", count, estimate, relative*100)
				if relative >= 0.03 {
					t.Fatalf("estimate %f count %d error %f", estimate, count, relative)
				}
				for index := range count {
					hash := index + 1 + seed*1000003
					sketch.remove(hash)
				}
				if sketch.estimate() != 0 {
					t.Fatal("removal did not reset estimate")
				}
			})
		}
	}
	sketch := new(hll)
	sketch.add(42)
	sketch.add(42)
	before := sketch.estimate()
	sketch.remove(42)
	if sketch.estimate() != before {
		t.Fatal("rank contribution removed while another identity uses it")
	}
	sketch.remove(42)
	if sketch.estimate() != 0 {
		t.Fatal("rank frequency not removed")
	}
}

func TestMetrics_TrustedTenantCanonicalizationAndFinalLabelCount(t *testing.T) {
	limiter := newLimiter(t, Options{})
	metricBatch(t, limiter, point("m", "a"))
	explicit := point("m", "a")
	builder := labels.NewBuilder(explicit.Labels)
	builder.Set(utm.LabelTenant, "tenant-a")
	explicit.Labels = builder.Labels()
	metricBatch(t, limiter, explicit)
	if snapshot(t, limiter).ActiveSeries != 1 {
		t.Fatal("optional tenant label changed logical identity")
	}
	values := map[string]string{}
	for index := range 38 {
		values[fmt.Sprintf("k%02d", index)] = "v"
	}
	got, _ := metricBatch(t, limiter, utm.MetricPoint{Name: "boundary", Labels: labels.FromMap(values)})
	if len(got) != 1 || len(got[0].Labels) != 40 {
		t.Fatal("final 40-label boundary rejected")
	}
	values["k38"] = "v"
	got, report := metricBatch(t, limiter, utm.MetricPoint{Name: "boundary", Labels: labels.FromMap(values)})
	if len(got) != 0 || report.Rejected["too_large"] != 1 {
		t.Fatal("future tenant injection bypasses final label cap")
	}
}
func TestSpans_AggregateIdentityCapacityAndExpiry(t *testing.T) {
	now := testNow
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, MaxTrackedSpans: 2})
	output, _, err := limiter.Spans(context.Background(), []utm.Span{testSpan(1, 1), testSpan(2, 1)})
	if err != nil || len(output) != 2 {
		t.Fatal(err)
	}
	output, report, err := limiter.Spans(context.Background(), []utm.Span{testSpan(3, 1), testSpan(1, 1)})
	state := snapshot(t, limiter)
	if err != nil || len(output) != 1 || report.Rejected["cardinality"] != 1 || state.TrackedSpans != 2 || state.Traces != 2 {
		t.Fatalf("aggregate span budget: %+v %+v", state, report)
	}
	now = now.Add(time.Hour)
	output, _, err = limiter.Spans(context.Background(), []utm.Span{testSpan(3, 1)})
	if err != nil || len(output) != 1 || snapshot(t, limiter).TrackedSpans != 1 {
		t.Fatal("expired span budget not released")
	}
}
func TestAllowBytes_ExactNumericCapacity(t *testing.T) {
	for _, override := range []Overrides{{IngestRateBytesPerSec: new(int64(math.MaxInt64))}, {IngestRateBytesPerSec: new(int64(1)), IngestBurstBytes: new(int64(math.MaxInt64))}} {
		if _, err := New("tenant-a", Options{Tenant: override}); spi.Classify(err) != spi.ErrBadRequest {
			t.Fatal("imprecise float configuration accepted")
		}
	}
	limiter := newLimiter(t, Options{Tenant: Overrides{IngestRateBytesPerSec: new(int64(1)), IngestBurstBytes: new(int64(1 << 53))}})
	_, _, err := limiter.AllowBytes(context.Background(), (1<<53)-1)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = limiter.AllowBytes(context.Background(), 1)
	if err != nil {
		t.Fatal("last exact byte rejected")
	}
	_, _, err = limiter.AllowBytes(context.Background(), 1)
	if spi.Classify(err) != spi.ErrThrottled {
		t.Fatal("subtraction failed to consume byte")
	}
}

func TestAllowBytes_ZeroOriginClockRefills(t *testing.T) {
	now := time.Time{}
	limiter := newLimiter(t, Options{Now: func() time.Time { return now }, Tenant: Overrides{IngestRateBytesPerSec: new(int64(1))}})
	_, _, err := limiter.AllowBytes(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	_, _, err = limiter.AllowBytes(context.Background(), 1)
	if err != nil {
		t.Fatal("zero-origin clock lost refill", err)
	}
}
func TestReportDomainsAndAllCancelledEntryPoints(t *testing.T) {
	report := newReport(1)
	report.normalized("truncate", 1)
	report.normalized("drop_label", 1)
	for _, reason := range []string{"too_large", "cardinality", "rate_limit", "auth", "decode_error", "invalid_id"} {
		report.reject(reason)
	}
	for action := range report.Normalized {
		if !slices.Contains([]string{"truncate", "rename", "drop_label", "clamp_time", "sanitize_name"}, action) {
			t.Fatal("unregistered action", action)
		}
	}
	for reason := range report.Rejected {
		if !slices.Contains([]string{"auth", "tenant_unknown", "rate_limit", "queue_full", "too_large", "decode_error", "clock_skew", "cardinality", "empty_log", "invalid_id", "unsupported_version", "disk_pressure"}, reason) {
			t.Fatal("unregistered reason", reason)
		}
	}
	limiter := newLimiter(t, Options{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := limiter.Logs(ctx, []utm.LogRecord{{Body: "x"}})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("log cancellation", err)
	}
	_, _, err = limiter.Spans(ctx, []utm.Span{testSpan(1, 1)})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("span cancellation", err)
	}
	_, _, err = limiter.AllowBytes(ctx, 1)
	if !errors.Is(err, context.Canceled) {
		t.Fatal("byte cancellation", err)
	}
	_, err = limiter.Snapshot(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatal("snapshot cancellation", err)
	}
}

func TestSDDDefaultBoundaryValues(t *testing.T) {
	limiter := newLimiter(t, Options{})
	name := strings.Repeat("a", 128)
	value := strings.Repeat("x", 2048)
	got, report := metricBatch(t, limiter, utm.MetricPoint{Name: "m", Labels: labels.FromStrings(name, value, name+"z", value+"x")})
	if len(got) != 1 || got[0].Labels.Get(name) != value || report.Normalized["truncate"] != 2 || report.Warnings["label_collision"] != 1 {
		t.Fatalf("default label boundaries: %+v %+v", got, report)
	}
	attrs := map[string]string{}
	for index := range 129 {
		attrs[fmt.Sprintf("%03d", index)] = "v"
	}
	logs, report, err := limiter.Logs(context.Background(), []utm.LogRecord{{Attrs: attrs}})
	if err != nil || len(logs[0].Attrs) != 128 || logs[0].Attrs["127"] != "v" || logs[0].Attrs["128"] != "" || report.Normalized["truncate"] != 1 {
		t.Fatal("default attrs boundary")
	}
	spans := make([]utm.Span, 20001)
	for index := range len(spans) {
		spans[index] = testSpan(1, index+1)
	}
	output, report, err := limiter.Spans(context.Background(), spans)
	if err != nil || len(output) != 20000 || report.Rejected["too_large"] != 1 || output[0].Attrs[truncationMarker] != "true" {
		t.Fatalf("default span cap: len=%d report=%+v err=%v", len(output), report, err)
	}
}
