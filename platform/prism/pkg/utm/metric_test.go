package utm

import (
	"math"
	"testing"

	"github.com/prometheus/prometheus/model/labels"
)

func TestMetricTypeString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		metricType MetricType
		want       string
	}{
		{metricType: TypeUnknown, want: "unknown"},
		{metricType: TypeGauge, want: "gauge"},
		{metricType: TypeCounter, want: "counter"},
		{metricType: TypeHistogram, want: "histogram"},
		{metricType: TypeSummary, want: "summary"},
		{metricType: MetricType(255), want: "unknown"},
	}
	for _, test := range tests {
		if got := test.metricType.String(); got != test.want {
			t.Errorf("MetricType(%d).String() = %q, want %q", test.metricType, got, test.want)
		}
	}
}

func TestHistogramValidate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		histogram *Histogram
		wantErr   bool
	}{
		{name: "nil", histogram: nil, wantErr: true},
		{name: "empty", histogram: &Histogram{Counts: []uint64{0}}},
		{name: "valid", histogram: &Histogram{Bounds: []float64{-1, 0, 10}, Counts: []uint64{1, 2, 3, 4}}},
		{name: "negative infinity allowed", histogram: &Histogram{Bounds: []float64{math.Inf(-1), 0}, Counts: []uint64{1, 2, 3}}},
		{name: "count length", histogram: &Histogram{Bounds: []float64{1}, Counts: []uint64{1}}, wantErr: true},
		{name: "duplicate bound", histogram: &Histogram{Bounds: []float64{1, 1}, Counts: []uint64{1, 2, 3}}, wantErr: true},
		{name: "decreasing bound", histogram: &Histogram{Bounds: []float64{2, 1}, Counts: []uint64{1, 2, 3}}, wantErr: true},
		{name: "NaN bound", histogram: &Histogram{Bounds: []float64{math.NaN()}, Counts: []uint64{1, 2}}, wantErr: true},
		{name: "positive infinity bound", histogram: &Histogram{Bounds: []float64{math.Inf(1)}, Counts: []uint64{1, 2}}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := test.histogram.Validate()
			if (err != nil) != test.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestHistogramExpand(t *testing.T) {
	t.Parallel()

	base := labels.FromStrings("method", "GET")
	histogram := &Histogram{
		Count:  6,
		Sum:    12.5,
		Bounds: []float64{0.5, 1, 10},
		Counts: []uint64{1, 2, 1, 2},
	}
	got := histogram.Expand("request_duration_seconds", base, 1234)
	if len(got) != 6 {
		t.Fatalf("Expand() returned %d points, want 6", len(got))
	}

	wantBuckets := []struct {
		le    string
		value float64
	}{
		{le: "0.5", value: 1},
		{le: "1", value: 3},
		{le: "10", value: 4},
		{le: "+Inf", value: 6},
	}
	for i, want := range wantBuckets {
		point := got[i]
		if point.Name != "request_duration_seconds_bucket" || point.Type != TypeHistogram || point.TS != 1234 || point.Value != want.value {
			t.Errorf("bucket %d = %#v, want name/type/ts/value request_duration_seconds_bucket/histogram/1234/%v", i, point, want.value)
		}
		if point.Labels.Get("le") != want.le || point.Labels.Get("method") != "GET" {
			t.Errorf("bucket %d labels = %v, want le=%q method=GET", i, point.Labels, want.le)
		}
	}
	if got[4].Name != "request_duration_seconds_sum" || got[4].Type != TypeCounter || got[4].Value != 12.5 {
		t.Errorf("sum point = %#v", got[4])
	}
	if got[5].Name != "request_duration_seconds_count" || got[5].Type != TypeCounter || got[5].Value != 6 {
		t.Errorf("count point = %#v", got[5])
	}
	if base.Has("le") {
		t.Fatalf("Expand() mutated base labels: %v", base)
	}
}

func TestHistogramExpandRejectsInvalid(t *testing.T) {
	t.Parallel()

	var nilHistogram *Histogram
	if got := nilHistogram.Expand("test", nil, 0); got != nil {
		t.Fatalf("nil Histogram.Expand() = %v, want nil", got)
	}
	invalid := &Histogram{Bounds: []float64{1}, Counts: nil}
	if got := invalid.Expand("test", nil, 0); got != nil {
		t.Fatalf("invalid Histogram.Expand() = %v, want nil", got)
	}
}
