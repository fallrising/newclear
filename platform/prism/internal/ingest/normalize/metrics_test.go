package normalize

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func TestNormalizeMetricsAllTypes(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{Tenant: "tenant-a"})
	metrics := pmetric.NewMetrics()
	resourceMetrics := metrics.ResourceMetrics().AppendEmpty()
	resourceMetrics.Resource().Attributes().PutStr("service.name", "checkout")
	resourceMetrics.Resource().Attributes().PutStr("host.name", "node-a")
	inputMetrics := resourceMetrics.ScopeMetrics().AppendEmpty().Metrics()
	timestamp := pcommon.NewTimestampFromTime(fixedNow.Add(-time.Minute))

	gauge := inputMetrics.AppendEmpty()
	gauge.SetName("9.latency")
	gauge.SetDescription("request latency")
	gauge.SetUnit("ms")
	gaugePoint := gauge.SetEmptyGauge().DataPoints().AppendEmpty()
	gaugePoint.SetTimestamp(timestamp)
	gaugePoint.SetDoubleValue(1500)
	gaugePoint.Attributes().PutStr("service", "user-service")
	gaugePoint.Attributes().PutStr("http.method", "GET")
	gaugePoint.Attributes().PutStr("user_id", "drop-me")
	gaugePoint.Attributes().PutStr("__reserved", "drop-me")
	staleGauge := gauge.Gauge().DataPoints().AppendEmpty()
	staleGauge.SetTimestamp(timestamp)
	staleGauge.SetDoubleValue(9)
	staleGauge.SetFlags(pmetric.DefaultDataPointFlags.WithNoRecordedValue(true))

	counter := inputMetrics.AppendEmpty()
	counter.SetName("requests")
	counter.SetUnit("1")
	counterSum := counter.SetEmptySum()
	counterSum.SetIsMonotonic(true)
	counterSum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	for _, value := range []int64{10, 2} {
		point := counterSum.DataPoints().AppendEmpty()
		point.SetTimestamp(timestamp)
		point.SetIntValue(value)
	}

	nonMonotonic := inputMetrics.AppendEmpty()
	nonMonotonic.SetName("temperature")
	nonMonotonicSum := nonMonotonic.SetEmptySum()
	nonMonotonicSum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	nonMonotonicPoint := nonMonotonicSum.DataPoints().AppendEmpty()
	nonMonotonicPoint.SetTimestamp(timestamp)
	nonMonotonicPoint.SetDoubleValue(-2.5)

	delta := inputMetrics.AppendEmpty()
	delta.SetName("jobs")
	deltaSum := delta.SetEmptySum()
	deltaSum.SetIsMonotonic(true)
	deltaSum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	for _, value := range []int64{2, 3} {
		point := deltaSum.DataPoints().AppendEmpty()
		point.SetTimestamp(timestamp)
		point.SetIntValue(value)
	}

	histogram := inputMetrics.AppendEmpty()
	histogram.SetName("duration")
	histogram.SetUnit("milliseconds")
	histogramData := histogram.SetEmptyHistogram()
	histogramData.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	histogramPoint := histogramData.DataPoints().AppendEmpty()
	histogramPoint.SetTimestamp(timestamp)
	histogramPoint.SetCount(3)
	histogramPoint.SetSum(3500)
	histogramPoint.ExplicitBounds().FromRaw([]float64{1000, 2000})
	histogramPoint.BucketCounts().FromRaw([]uint64{1, 1, 1})
	exemplar := histogramPoint.Exemplars().AppendEmpty()
	exemplar.SetTimestamp(timestamp)
	exemplar.SetDoubleValue(1500)
	exemplar.SetTraceID(testTraceID)
	exemplar.SetSpanID(testSpanID)
	exemplar.FilteredAttributes().PutStr("sampled", "true")
	histogramPoint.Exemplars().AppendEmpty().SetDoubleValue(999)

	exponential := inputMetrics.AppendEmpty()
	exponential.SetName("exp")
	exponentialData := exponential.SetEmptyExponentialHistogram()
	exponentialData.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	exponentialPoint := exponentialData.DataPoints().AppendEmpty()
	exponentialPoint.SetTimestamp(timestamp)
	exponentialPoint.SetScale(0)
	exponentialPoint.SetCount(2)
	exponentialPoint.SetSum(2)
	exponentialPoint.SetZeroThreshold(0)
	exponentialPoint.SetZeroCount(1)
	exponentialPoint.Positive().SetOffset(0)
	exponentialPoint.Positive().BucketCounts().FromRaw([]uint64{1})

	summary := inputMetrics.AppendEmpty()
	summary.SetName("payload")
	summary.SetUnit("By")
	summaryPoint := summary.SetEmptySummary().DataPoints().AppendEmpty()
	summaryPoint.SetTimestamp(timestamp)
	summaryPoint.SetCount(4)
	summaryPoint.SetSum(100)
	q50 := summaryPoint.QuantileValues().AppendEmpty()
	q50.SetQuantile(0.5)
	q50.SetValue(20)
	q99 := summaryPoint.QuantileValues().AppendEmpty()
	q99.SetQuantile(0.99)
	q99.SetValue(40)

	batch, report, err := normalizer.NormalizeMetrics(context.Background(), metrics, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Metadata) != 7 {
		t.Fatalf("len(metadata) = %d, want 7", len(batch.Metadata))
	}
	if len(batch.Points) != 22 {
		t.Fatalf("len(points) = %d, want 22; names=%v", len(batch.Points), pointNames(batch.Points))
	}

	gaugePoints := pointsNamed(batch.Points, "_9_latency_seconds")
	if len(gaugePoints) != 2 || gaugePoints[0].Value != 1.5 || !math.IsNaN(gaugePoints[1].Value) || gaugePoints[0].Type != utm.TypeGauge {
		t.Fatalf("gauge points = %#v", gaugePoints)
	}
	if gaugePoints[0].Labels.Get("service") != "user-service" || gaugePoints[0].Labels.Get("resource_service") != "checkout" || gaugePoints[0].Labels.Get("job") != "checkout" || gaugePoints[0].Labels.Get("http_method") != "GET" || gaugePoints[0].Labels.Get("user_id") != "" || gaugePoints[0].Labels.Get("__reserved") != "" {
		t.Fatalf("gauge labels = %s", gaugePoints[0].Labels)
	}
	counters := pointsNamed(batch.Points, "requests_total")
	if len(counters) != 2 || counters[0].Value != 10 || counters[1].Value != 2 || counters[0].Type != utm.TypeCounter {
		t.Fatalf("counter reset points = %#v", counters)
	}
	nonMonotonicPoints := pointsNamed(batch.Points, "temperature")
	if len(nonMonotonicPoints) != 1 || nonMonotonicPoints[0].Type != utm.TypeGauge || nonMonotonicPoints[0].Value != -2.5 {
		t.Fatalf("non-monotonic points = %#v", nonMonotonicPoints)
	}
	deltas := pointsNamed(batch.Points, "jobs_total")
	if len(deltas) != 1 || deltas[0].Value != 5 || report.Warnings["delta_baseline"] != 1 {
		t.Fatalf("delta points/report = %#v / %#v", deltas, report)
	}

	histograms := pointsNamed(batch.Points, "duration_seconds")
	if len(histograms) != 1 || histograms[0].Histogram == nil || histograms[0].Histogram.Sum != 3.5 || histograms[0].Histogram.Bounds[0] != 1 || histograms[0].Exemplar == nil || histograms[0].Exemplar.Value != 1.5 || histograms[0].Exemplar.Labels.Get("trace_id") == "" {
		t.Fatalf("histogram base = %#v", histograms)
	}
	if len(pointsNamed(batch.Points, "duration_seconds_bucket")) != 3 || pointsNamed(batch.Points, "duration_seconds_sum")[0].Value != 3.5 || pointsNamed(batch.Points, "duration_seconds_count")[0].Value != 3 {
		t.Fatalf("histogram expansion names=%v", pointNames(batch.Points))
	}
	exponentialPoints := pointsNamed(batch.Points, "exp")
	if len(exponentialPoints) != 1 || exponentialPoints[0].Histogram == nil || report.Warnings["exponential_histogram_approximated"] != 1 {
		t.Fatalf("exponential histogram/report = %#v / %#v", exponentialPoints, report)
	}
	if len(pointsNamed(batch.Points, "payload_bytes")) != 2 || len(pointsNamed(batch.Points, "payload_bytes_sum")) != 1 || len(pointsNamed(batch.Points, "payload_bytes_count")) != 1 {
		t.Fatalf("summary expansion names=%v", pointNames(batch.Points))
	}
	if report.Warnings["extra_exemplars_dropped"] != 1 || report.Warnings["high_cardinality_label_dropped"] != 1 || report.Warnings["reserved_label_dropped"] != 1 {
		t.Fatalf("warnings = %#v", report.Warnings)
	}
}

func TestMetricUnitMapping(t *testing.T) {
	t.Parallel()

	tests := []struct {
		unit      string
		wantName  string
		wantScale float64
	}{
		{unit: "s", wantName: "latency_seconds", wantScale: 1},
		{unit: "seconds", wantName: "latency_seconds", wantScale: 1},
		{unit: "ms", wantName: "latency_seconds", wantScale: 0.001},
		{unit: "milliseconds", wantName: "latency_seconds", wantScale: 0.001},
		{unit: "By", wantName: "latency_bytes", wantScale: 1},
		{unit: "bytes", wantName: "latency_bytes", wantScale: 1},
		{unit: "1", wantName: "latency", wantScale: 1},
		{unit: "{ratio}", wantName: "latency", wantScale: 1},
		{unit: "%", wantName: "latency_ratio", wantScale: 0.01},
		{unit: "widgets", wantName: "latency", wantScale: 1},
	}
	for _, test := range tests {
		report := newReport()
		name, scale := normalizeUnit("latency", test.unit, &report)
		if name != test.wantName || scale != test.wantScale {
			t.Errorf("normalizeUnit(%q) = %q/%v, want %q/%v", test.unit, name, scale, test.wantName, test.wantScale)
		}
	}
}

func TestMetricClockPolicyAndDeltaCapacity(t *testing.T) {
	t.Parallel()

	metrics := pmetric.NewMetrics()
	metric := metrics.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	metric.SetName("old")
	point := metric.SetEmptyGauge().DataPoints().AppendEmpty()
	point.SetTimestamp(pcommon.NewTimestampFromTime(fixedNow.Add(-2 * time.Hour)))
	point.SetIntValue(1)
	drop := testNormalizer(t, Options{ClockSkewPolicy: ClockSkewDrop})
	batch, report, err := drop.NormalizeMetrics(context.Background(), metrics, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Points) != 0 || report.Rejected["clock_skew"] != 1 {
		t.Fatalf("batch/report = %#v/%#v", batch, report)
	}

}

func pointNames(points []utm.MetricPoint) []string {
	names := make([]string, 0, len(points))
	for _, point := range points {
		names = append(names, point.Name)
	}
	return names
}

func pointsNamed(points []utm.MetricPoint, name string) []utm.MetricPoint {
	result := make([]utm.MetricPoint, 0)
	for _, point := range points {
		if point.Name == name {
			result = append(result, point)
		}
	}
	return result
}
