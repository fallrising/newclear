package memory

import (
	"context"
	"math"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestMetricStoreWriteSelectAndDeduplicate(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })

	apiLabels := labels.FromStrings(utm.LabelName, "requests_total", utm.LabelTenant, "tenant-a", "job", "api", "zone", "eu")
	workerLabels := labels.FromStrings(utm.LabelName, "requests_total", utm.LabelTenant, "tenant-a", "job", "worker")
	otherTenant := labels.FromStrings(utm.LabelName, "requests_total", utm.LabelTenant, "tenant-b", "job", "api")
	batch := []utm.MetricPoint{
		{Labels: apiLabels, TS: 20, Value: 2},
		{Labels: apiLabels, TS: 5, Value: 0.5},
		{Labels: apiLabels, TS: 10, Value: 1},
		{Labels: apiLabels, TS: 20, Value: 22},
		{Labels: apiLabels, TS: 30, Value: math.NaN()},
		{Labels: apiLabels, TS: 40, Value: math.Inf(1)},
		{Labels: apiLabels, TS: 50, Value: math.Inf(-1)},
		{Labels: workerLabels, TS: 15, Value: 3},
		{Labels: otherTenant, TS: 15, Value: 99},
	}
	if err := backend.metrics.Write(context.Background(), batch); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	apiLabels[0].Value = "mutated"

	jobAPI := mustMatcher(t, spi.MatchEqual, "job", "api")
	series := selectSeries(t, backend.metrics, spi.SeriesQuery{
		Tenant: "tenant-a", Matchers: []spi.Matcher{jobAPI}, Start: 5, End: 20,
	})
	if len(series) != 1 {
		t.Fatalf("Select() returned %d series, want 1", len(series))
	}
	wantSamples := []spi.Sample{{TS: 5, Value: 0.5}, {TS: 10, Value: 1}, {TS: 20, Value: 22}}
	if !reflect.DeepEqual(series[0].Samples, wantSamples) {
		t.Fatalf("samples = %v, want %v", series[0].Samples, wantSamples)
	}
	if got := series[0].Labels.Get("job"); got != "api" {
		t.Fatalf("stored labels changed through caller mutation: job=%q", got)
	}

	other := selectSeries(t, backend.metrics, spi.SeriesQuery{
		Tenant: "tenant-b", Matchers: []spi.Matcher{jobAPI}, Start: 0, End: 100,
	})
	if len(other) != 1 || other[0].Samples[0].Value != 99 {
		t.Fatalf("tenant-b Select() = %#v", other)
	}
	missing := selectSeries(t, backend.metrics, spi.SeriesQuery{
		Tenant: "tenant-c", Matchers: []spi.Matcher{jobAPI}, Start: 0, End: 100,
	})
	if len(missing) != 0 {
		t.Fatalf("tenant-c Select() leaked %d series", len(missing))
	}

	special := selectSeries(t, backend.metrics, spi.SeriesQuery{
		Tenant: "tenant-a", Matchers: []spi.Matcher{jobAPI}, Start: 30, End: 50,
	})[0].Samples
	if !math.IsNaN(special[0].Value) || !math.IsInf(special[1].Value, 1) || !math.IsInf(special[2].Value, -1) {
		t.Fatalf("special values were not preserved: %v", special)
	}
}

func TestMetricStoreMatchersAndLabels(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	points := []utm.MetricPoint{
		{Labels: labels.FromStrings(utm.LabelName, "metric", utm.LabelTenant, "tenant", "job", "api", "zone", "eu"), TS: 10, Value: 1},
		{Labels: labels.FromStrings(utm.LabelName, "metric", utm.LabelTenant, "tenant", "job", "worker", "zone", "us"), TS: 20, Value: 2},
		{Labels: labels.FromStrings(utm.LabelName, "metric", utm.LabelTenant, "tenant", "zone", "eu"), TS: 30, Value: 3},
	}
	if err := backend.metrics.Write(context.Background(), points); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	tests := []struct {
		name    string
		matcher spi.Matcher
		want    int
	}{
		{name: "equal", matcher: mustMatcher(t, spi.MatchEqual, "job", "api"), want: 1},
		{name: "not equal includes missing", matcher: mustMatcher(t, spi.MatchNotEqual, "job", "worker"), want: 2},
		{name: "regexp", matcher: mustMatcher(t, spi.MatchRegexp, "job", "api|worker"), want: 2},
		{name: "not regexp includes missing", matcher: mustMatcher(t, spi.MatchNotRegexp, "job", "worker"), want: 2},
		{name: "empty matches missing", matcher: mustMatcher(t, spi.MatchEqual, "job", ""), want: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := selectSeries(t, backend.metrics, spi.SeriesQuery{
				Tenant: "tenant", Matchers: []spi.Matcher{test.matcher}, Start: 0, End: 100,
			})
			if len(got) != test.want {
				t.Fatalf("Select() returned %d series, want %d", len(got), test.want)
			}
		})
	}

	query := spi.LabelQuery{Tenant: "tenant", Matchers: []spi.Matcher{mustMatcher(t, spi.MatchRegexp, utm.LabelName, ".+")}, Start: 10, End: 20}
	names, err := backend.metrics.LabelNames(context.Background(), query)
	if err != nil {
		t.Fatalf("LabelNames() error = %v", err)
	}
	if want := []string{"job", "zone"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("LabelNames() = %v, want %v", names, want)
	}
	values, err := backend.metrics.LabelValues(context.Background(), "zone", query)
	if err != nil {
		t.Fatalf("LabelValues() error = %v", err)
	}
	if want := []string{"eu", "us"}; !reflect.DeepEqual(values, want) {
		t.Fatalf("LabelValues() = %v, want %v", values, want)
	}
	query.Limit = 1
	limited, err := backend.metrics.LabelValues(context.Background(), "zone", query)
	if err != nil || !reflect.DeepEqual(limited, []string{"eu"}) {
		t.Fatalf("limited LabelValues() = %v, %v", limited, err)
	}
	if _, err := backend.metrics.LabelValues(context.Background(), "", query); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("empty LabelValues() class = %v, want bad_request", spi.Classify(err))
	}
}

func TestMetricStoreRejectsEmptyBatch(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	if got := spi.Classify(backend.metrics.Write(context.Background(), nil)); got != spi.ErrBadRequest {
		t.Fatalf("Write(nil) class = %v, want bad_request", got)
	}
}

func mustMatcher(t *testing.T, matchType spi.MatchType, name, value string) spi.Matcher {
	t.Helper()
	matcher, err := spi.NewMatcher(matchType, name, value)
	if err != nil {
		t.Fatalf("NewMatcher() error = %v", err)
	}
	return matcher
}

func selectSeries(t *testing.T, store spi.MetricStore, query spi.SeriesQuery) []spi.SeriesData {
	t.Helper()
	set, err := store.Select(context.Background(), query)
	if err != nil {
		t.Fatalf("Select() error = %v", err)
	}
	if set == nil {
		t.Fatal("Select() returned a nil SeriesSet")
	}
	defer func() {
		if err := set.Close(); err != nil {
			t.Errorf("SeriesSet.Close() error = %v", err)
		}
	}()

	var result []spi.SeriesData
	for set.Next() {
		series := set.At()
		data := spi.SeriesData{Labels: series.Labels()}
		samples := series.Samples()
		for samples.Next() {
			ts, value := samples.At()
			data.Samples = append(data.Samples, spi.Sample{TS: ts, Value: value})
		}
		if err := samples.Err(); err != nil {
			t.Fatalf("SampleIterator.Err() = %v", err)
		}
		result = append(result, data)
	}
	if err := set.Err(); err != nil {
		t.Fatalf("SeriesSet.Err() = %v", err)
	}
	return result
}
