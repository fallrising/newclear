package ingest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"go.opentelemetry.io/collector/pdata/pmetric"
)

func TestOTLPOriginalRejectedHistogramExpansion(t *testing.T) {
	o := testOptions()
	cap := 2
	o.Limits.Global.MaxLabelsPerSeries = &cap
	p := pipeline(t, memoryBackend(t), o)
	data := pmetric.NewMetrics()
	m := data.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	m.SetName("latency")
	h := m.SetEmptyHistogram()
	h.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	for range 2 {
		point := h.DataPoints().AppendEmpty()
		point.SetTimestamp(1700000000000000000)
		point.SetCount(2)
		point.SetSum(3)
		point.ExplicitBounds().FromRaw([]float64{1})
		point.BucketCounts().FromRaw([]uint64{1, 1})
	}
	result, err := p.SubmitOTLPMetrics(WithTenant(context.Background(), "one"), data, 100)
	if err != nil {
		t.Fatal(err)
	}
	if result.OTLPRejected != 2 || result.Rejected != 4 || result.Accepted != 6 {
		t.Fatalf("original=%d expanded rejected=%d accepted=%d", result.OTLPRejected, result.Rejected, result.Accepted)
	}
}

func TestOTLPOriginalNormalizationUnitsAndBaselines(t *testing.T) {
	tests := []struct {
		name               string
		configure          func(pmetric.Metric)
		rejected, accepted int
	}{
		{"multiple empty-name points", func(m pmetric.Metric) {
			g := m.SetEmptyGauge()
			for range 3 {
				g.DataPoints().AppendEmpty()
			}
		}, 3, 0},
		{"multiple unsupported delta-histogram points", func(m pmetric.Metric) {
			m.SetName("hist")
			h := m.SetEmptyHistogram()
			h.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
			for range 3 {
				h.DataPoints().AppendEmpty()
			}
		}, 3, 0},
		{"invalid histogram points", func(m pmetric.Metric) {
			m.SetName("hist")
			h := m.SetEmptyHistogram()
			h.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
			for range 2 {
				point := h.DataPoints().AppendEmpty()
				point.SetCount(2)
				point.ExplicitBounds().FromRaw([]float64{1})
				point.BucketCounts().FromRaw([]uint64{1})
			}
		}, 2, 0},
		{"baseline is consumed without rejection", func(m pmetric.Metric) {
			m.SetName("delta")
			sum := m.SetEmptySum()
			sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
			sum.DataPoints().AppendEmpty().SetDoubleValue(2)
		}, 0, 0},
		{"identical delta points remain distinct", func(m pmetric.Metric) {
			m.SetName("delta")
			sum := m.SetEmptySum()
			sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
			for range 2 {
				sum.DataPoints().AppendEmpty().SetDoubleValue(2)
			}
		}, 0, 1},
		{"exemplar loss is not original point rejection", func(m pmetric.Metric) {
			m.SetName("gauge")
			point := m.SetEmptyGauge().DataPoints().AppendEmpty()
			point.SetDoubleValue(1)
			point.Exemplars().AppendEmpty()
			point.Exemplars().AppendEmpty()
		}, 0, 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			p := pipeline(t, memoryBackend(t), testOptions())
			data := pmetric.NewMetrics()
			m := data.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			test.configure(m)
			result, err := p.SubmitOTLPMetrics(trusted("one"), data, 100)
			if err != nil {
				t.Fatal(err)
			}
			if result.OTLPRejected != test.rejected || result.Accepted != test.accepted {
				t.Fatalf("original rejected=%d accepted=%d diagnostics=%+v", result.OTLPRejected, result.Accepted, result.Normalize)
			}
			if strings.Contains(test.name, "baseline") && result.Normalize.Warnings["delta_baseline"] != 1 {
				t.Fatal("baseline diagnostic absent")
			}
		})
	}
}
func TestOTLPOriginalClockDropAndSummaryChildLoss(t *testing.T) {
	for _, kind := range []string{"clock", "summary"} {
		t.Run(kind, func(t *testing.T) {
			o := testOptions()
			if kind == "clock" {
				o.Normalize.ClockSkewPolicy = normalize.ClockSkewDrop
			} else {
				cap := 2
				o.Limits.Global.MaxLabelsPerSeries = &cap
			}
			p := pipeline(t, memoryBackend(t), o)
			data := pmetric.NewMetrics()
			m := data.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			m.SetName(kind)
			if kind == "clock" {
				g := m.SetEmptyGauge()
				for range 2 {
					g.DataPoints().AppendEmpty().SetTimestamp(originalTimestamp(t, received.Add(-24*time.Hour)))
				}
			} else {
				s := m.SetEmptySummary()
				for range 2 {
					point := s.DataPoints().AppendEmpty()
					point.SetTimestamp(originalTimestamp(t, received))
					point.QuantileValues().AppendEmpty().SetQuantile(0.5)
					point.QuantileValues().AppendEmpty().SetQuantile(0.9)
				}
			}
			result, err := p.SubmitOTLPMetrics(trusted("one"), data, 100)
			if err != nil {
				t.Fatal(err)
			}
			if result.OTLPRejected != 2 {
				t.Fatalf("original rejection=%d normalized=%+v", result.OTLPRejected, result.Normalize)
			}
		})
	}
}
func TestOTLPOriginalLogsAndSpansExcludeNestedDiagnostics(t *testing.T) {
	p := pipeline(t, memoryBackend(t), testOptions())
	logs := plog.NewLogs()
	records := logs.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords()
	records.AppendEmpty()
	good := records.AppendEmpty()
	good.Body().SetStr("good")
	good.SetDroppedAttributesCount(20)
	result, err := p.SubmitOTLPLogs(trusted("one"), logs, 100)
	if err != nil || result.OTLPRejected != 1 || result.Accepted != 1 || result.Normalize.UpstreamDropped != 20 {
		t.Fatalf("logs result=%+v err=%v", result, err)
	}
	traces := ptrace.NewTraces()
	spans := traces.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans()
	spans.AppendEmpty()
	valid := spans.AppendEmpty()
	valid.SetTraceID(pcommon.TraceID{15: 1})
	valid.SetSpanID(pcommon.SpanID{7: 1})
	valid.SetStartTimestamp(originalTimestamp(t, received))
	valid.SetEndTimestamp(originalTimestamp(t, received))
	valid.SetDroppedEventsCount(30)
	result, err = p.SubmitOTLPTraces(trusted("one"), traces, 100)
	if err != nil || result.OTLPRejected != 1 || result.Accepted != 1 || result.Normalize.UpstreamDropped != 30 {
		t.Fatalf("traces result=%+v err=%v", result, err)
	}
}

func originalTimestamp(t *testing.T, at time.Time) pcommon.Timestamp {
	t.Helper()
	n := utm.TimeToNano(at)
	if n < 0 {
		t.Fatal("negative fixture time")
	}
	return pcommon.Timestamp(n) // #nosec G115 -- Negative values rejected above; fixture times fit int64.
}
